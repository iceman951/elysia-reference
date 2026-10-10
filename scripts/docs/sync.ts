/**
 * pnpm docs:sync [--ref <branch|commit>] [--dry-run]
 *
 * 1. Resolves the latest upstream commit (default: the configured branch).
 * 2. Compares it with the commit recorded in the import manifest.
 * 3. If upstream changed, re-imports at the new commit (same safety rules as
 *    `docs:import`: locally authored and locally modified files are never overwritten).
 * 4. Writes reports/sync-summary.md, used as the pull request description.
 *
 * Exit codes: 0 = up to date or synced successfully, 1 = sync failed (conversion
 * failure or conflict). In GitHub Actions the outcome is also written to
 * $GITHUB_OUTPUT (`changed`, `commit`, `short_commit`, `ok`).
 */
import { appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { importConfig } from './import.config.ts';
import { runImport, type ImportResult } from './import.ts';
import { readJson, writeIfChanged } from './lib/fs-utils.ts';
import type { Issue } from './lib/issues.ts';
import type { Manifest } from './lib/manifest.ts';
import { paths } from './lib/paths.ts';
import type { MigrationReport } from './lib/report.ts';
import { changedFiles, commitsBetween, ensureCommit, isCommitSha, remoteHead, type ChangedFile, type CommitInfo } from './lib/upstream.ts';

async function setOutput(values: Record<string, string>): Promise<void> {
	const file = process.env['GITHUB_OUTPUT'];
	if (!file) return;
	await appendFile(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

function issueKey(issue: Issue): string {
	return `${issue.file ?? ''}|${issue.code}|${issue.line ?? ''}|${issue.message}`;
}

const STATUS_LABELS: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed' };

function renderSummary(input: {
	previous: Manifest | undefined;
	result: ImportResult;
	commits: CommitInfo[];
	files: ChangedFile[];
	newIssues: Issue[];
	resolvedIssues: number;
}): string {
	const { previous, result, commits, files, newIssues, resolvedIssues } = input;
	const { upstream } = result.manifest;
	const repo = upstream.repository;
	const from = previous?.upstream.commit;
	const lines: string[] = [];
	lines.push('## Upstream documentation sync', '');
	lines.push(
		from
			? `Updates the imported documentation from [\`${from.slice(0, 7)}\`](${repo}/commit/${from}) to [\`${upstream.commit.slice(0, 7)}\`](${repo}/commit/${upstream.commit}) ([compare](${repo}/compare/${from}...${upstream.commit})).`
			: `Initial import at [\`${upstream.commit.slice(0, 7)}\`](${repo}/commit/${upstream.commit}).`,
		''
	);

	lines.push(`### Upstream commits touching \`${importConfig.upstream.docsDir}/\` (${commits.length})`, '');
	if (commits.length === 0) {
		lines.push(
			files.length > 0
				? 'None listed: the new commit is not a descendant of the recorded commit (for example a rollback with `--ref`).'
				: 'None (only files outside the docs directory changed).'
		);
	}
	for (const commit of commits.slice(0, 50)) {
		lines.push(`- [\`${commit.sha.slice(0, 7)}\`](${repo}/commit/${commit.sha}) ${commit.subject} (${commit.date.slice(0, 10)})`);
	}
	if (commits.length > 50) lines.push(`- … and ${commits.length - 50} more`);
	lines.push('');

	lines.push(`### Upstream files changed (${files.length})`, '');
	if (files.length === 0) lines.push('None.');
	for (const file of files.slice(0, 100)) {
		const label = STATUS_LABELS[file.status[0] ?? ''] ?? file.status;
		lines.push(`- ${label}: \`${file.path}\`${file.previousPath ? ` (from \`${file.previousPath}\`)` : ''}`);
	}
	if (files.length > 100) lines.push(`- … and ${files.length - 100} more`);
	lines.push('');

	const previousOutputs = new Set((previous?.pages ?? []).map((page) => page.output));
	const added = result.written.filter((file) => file.startsWith('src/content/') && !previousOutputs.has(file));
	const updated = result.written.filter((file) => file.startsWith('src/content/') && previousOutputs.has(file));
	lines.push('### Changes to this site', '');
	lines.push(`- Pages added: ${added.length}`, `- Pages updated: ${updated.length}`, `- Pages removed: ${result.deleted.length}`);
	for (const file of [...added.map((f) => `added \`${f}\``), ...updated.map((f) => `updated \`${f}\``), ...result.deleted.map((f) => `removed \`${f}\``)].slice(0, 100)) {
		lines.push(`  - ${file}`);
	}
	const before = previous?.summary;
	const after = result.manifest.summary;
	lines.push(
		`- Imported pages: ${before?.imported ?? 0} → ${after.imported}; skipped: ${before?.skipped ?? 0} → ${after.skipped}`,
		`- Conversion issues: errors ${before?.issues.error ?? 0} → ${after.issues.error}, warnings ${before?.issues.warning ?? 0} → ${after.issues.warning}`,
		`- Mirrored assets: ${before?.assetsMirrored ?? 0} → ${after.assetsMirrored}`,
		''
	);

	lines.push(`### New conversion issues (${newIssues.length})`, '');
	if (newIssues.length === 0) lines.push('None.');
	for (const issue of newIssues.slice(0, 60)) {
		lines.push(`- **${issue.severity}** \`${issue.code}\` ${issue.file ?? ''}${issue.line ? `:${issue.line}` : ''} — ${issue.message}`);
	}
	if (newIssues.length > 60) lines.push(`- … and ${newIssues.length - 60} more (see reports/migration-report.md)`);
	if (resolvedIssues > 0) lines.push('', `${resolvedIssues} previously reported issue(s) no longer occur.`);
	lines.push('');

	if (result.conflicts.length > 0) {
		lines.push('### ⚠️ Conflicts', '', 'These files were **not** updated:', '');
		for (const conflict of result.conflicts) lines.push(`- \`${conflict.file}\`: ${conflict.reason}`);
		lines.push('');
	}

	lines.push(
		'### Review checklist',
		'',
		'- [ ] Skim the content diff of the changed pages',
		'- [ ] Check new conversion issues above and in `reports/migration-report.md`',
		'- [ ] CI is green (type check, tests, `docs:check`, build, `docs:check --dist`)',
		'- [ ] New upstream pages are placed in `src/config/navigation.ts` (otherwise they appear under "Other Pages")',
		'',
		'_Generated by `pnpm docs:sync`._'
	);
	return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: { ref: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
	});
	const { upstream } = importConfig;
	const previous = await readJson<Manifest>(paths.manifest);
	const previousReport = await readJson<MigrationReport>(paths.migrationReportJson);
	const ref = values.ref ?? upstream.branch;
	const latest = isCommitSha(ref) ? ref : remoteHead(upstream.gitUrl, ref);

	console.log(`→ Upstream ${upstream.name}: recorded ${previous?.upstream.commit.slice(0, 7) ?? '(none)'}, latest ${latest.slice(0, 7)}`);
	if (previous?.upstream.commit === latest) {
		console.log('✓ Already up to date.');
		await writeIfChanged(paths.syncSummaryMd, `## Upstream documentation sync\n\nNo upstream changes since \`${latest.slice(0, 7)}\`.\n`);
		await setOutput({ changed: 'false', commit: latest, short_commit: latest.slice(0, 7), ok: 'true' });
		return;
	}

	const result = await runImport({ ref: latest, dryRun: values['dry-run'] });
	const dir = paths.upstreamCheckout;
	let commits: CommitInfo[] = [];
	let files: ChangedFile[] = [];
	if (previous) {
		ensureCommit(dir, previous.upstream.commit);
		commits = commitsBetween(dir, previous.upstream.commit, latest, upstream.docsDir);
		files = changedFiles(dir, previous.upstream.commit, latest, upstream.docsDir);
	}

	const before = new Set((previousReport?.pages ?? []).flatMap((page) => page.issues).filter((issue) => issue.severity !== 'info').map(issueKey));
	const afterIssues = result.report.pages.flatMap((page) => page.issues).filter((issue) => issue.severity !== 'info');
	const afterKeys = new Set(afterIssues.map(issueKey));
	const newIssues = afterIssues.filter((issue) => !before.has(issueKey(issue)));
	const resolvedIssues = [...before].filter((key) => !afterKeys.has(key)).length;

	const summary = renderSummary({ previous, result, commits, files, newIssues, resolvedIssues });
	if (!values['dry-run']) await writeIfChanged(paths.syncSummaryMd, summary);
	await setOutput({
		changed: String(result.written.length + result.deleted.length > 0 || previous?.upstream.commit !== latest),
		commit: latest,
		short_commit: latest.slice(0, 7),
		ok: String(result.ok),
	});
	console.log(`✓ Summary written to ${paths.syncSummaryMd}`);
	if (!result.ok) {
		console.error('✗ Sync finished with failures or conflicts; nothing should be merged until they are resolved.');
		process.exitCode = 1;
	}
}

await main();
