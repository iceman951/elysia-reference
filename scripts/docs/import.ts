/**
 * pnpm docs:import [--ref <commit|branch>] [--offline] [--force] [--dry-run]
 *
 * Imports (or rebuilds) the upstream ElysiaJS documentation at a given commit.
 * Without --ref, the commit recorded in the current manifest is re-imported, which
 * makes the import reproducible; use `pnpm docs:sync` to move to the latest commit.
 *
 * Safety rules:
 * - Only files listed in the previous manifest are ever overwritten or deleted.
 * - A generated file edited by hand is not overwritten (unless --force).
 * - A page whose generated MDX does not compile is not written.
 */
import { existsSync, readFileSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compile } from '@mdx-js/mdx';
import { importConfig } from './import.config.ts';
import { AssetManager } from './lib/assets.ts';
import { convertPage, finalizeLinks, serializePage, type ConvertedPage } from './lib/convert/index.ts';
import { PageIndex, upstreamUrlOf } from './lib/convert/links.ts';
import { discover, readDependencyRange, readUpstreamNavigation } from './lib/discover.ts';
import { readJson, readText, sha256, writeIfChanged, writeJson } from './lib/fs-utils.ts';
import { countBySeverity, IssueCollector, type Issue } from './lib/issues.ts';
import { MANIFEST_GENERATOR, type Manifest, type ManifestPage } from './lib/manifest.ts';
import { outputOfPage, parseReleaseDate, releaseVersionLabel, sectionOfPage, slugOfPage } from './lib/pages.ts';
import { paths, ROOT } from './lib/paths.ts';
import { renderMigrationReport, type MigrationReport } from './lib/report.ts';
import { checkoutUpstream, lastModifiedDates } from './lib/upstream.ts';

export interface ImportOptions {
	ref?: string;
	offline?: boolean;
	force?: boolean;
	dryRun?: boolean;
	log?: (message: string) => void;
}

export interface ImportResult {
	manifest: Manifest;
	previous: Manifest | undefined;
	report: MigrationReport;
	conflicts: { file: string; reason: string }[];
	written: string[];
	deleted: string[];
	ok: boolean;
}

function stripFrontmatter(mdx: string): string {
	return mdx.replace(/^---\n[\s\S]*?\n---\n/, '');
}

function buildFrontmatter(
	page: ConvertedPage,
	extra: { lastModified: string | undefined; section: ManifestPage['section']; versionLabel: string | undefined; releaseDate: string | undefined }
): Record<string, unknown> {
	const { upstream } = importConfig;
	const frontmatter: Record<string, unknown> = { title: page.title };
	if (page.description) frontmatter['description'] = page.description;
	frontmatter['editUrl'] =
		page.frontmatter.editLink === false ? false : `${upstream.repository}/edit/${upstream.branch}/${page.repoPath}`;
	if (extra.lastModified) frontmatter['lastUpdated'] = new Date(extra.lastModified);
	if (page.frontmatter.search === false) frontmatter['pagefind'] = false;
	frontmatter['upstream'] = { path: page.repoPath, url: page.upstreamUrl };
	// Release notes and articles describe the version they announce, not the current doc set.
	if (extra.section === 'docs' || extra.section === 'tutorial') frontmatter['docVersion'] = importConfig.docVersion;
	if (extra.section === 'release-notes' || extra.section === 'articles') {
		const release: Record<string, string> = {};
		if (extra.versionLabel) release['version'] = extra.versionLabel;
		if (extra.releaseDate) release['date'] = extra.releaseDate;
		else if (page.release?.date) release['date'] = page.release.date;
		if (page.release?.author) release['author'] = page.release.author;
		if (Object.keys(release).length > 0) frontmatter['release'] = release;
	}
	return frontmatter;
}

export async function runImport(options: ImportOptions = {}): Promise<ImportResult> {
	const log = options.log ?? ((message: string) => console.log(message));
	const { upstream } = importConfig;
	const previous = await readJson<Manifest>(paths.manifest);
	const ref = options.ref ?? previous?.upstream.commit ?? upstream.branch;

	log(`→ Fetching ${upstream.name} (${ref})`);
	const checkout = await checkoutUpstream({
		dir: paths.upstreamCheckout,
		gitUrl: upstream.gitUrl,
		ref,
		...(options.offline ? { offline: true } : {}),
	});
	log(`  commit ${checkout.commit} (${checkout.commitDate})`);

	const licenseText = await readText(path.join(checkout.dir, upstream.licenseFile));
	const discovery = await discover(checkout.dir);
	const nav = await readUpstreamNavigation(checkout.dir, discovery.allPages);
	const versionRange = await readDependencyRange(checkout.dir, importConfig.versionEvidencePackage);
	const dates = lastModifiedDates(checkout.dir, checkout.commit, upstream.docsDir);
	const assets = await AssetManager.create(checkout.dir, upstream.siteUrl);
	log(`  ${discovery.allPages.length} Markdown pages discovered, ${discovery.pages.length} selected for import`);

	const imported = new Set(discovery.pages);
	const pageIndex = new PageIndex(
		discovery.allPages.map((page) => ({
			upstreamPath: page,
			imported: imported.has(page),
			...(imported.has(page) ? { slug: slugOfPage(page) } : {}),
			upstreamUrl: upstreamUrlOf(upstream.siteUrl, page),
		})),
		{ siteUrl: upstream.siteUrl, publicFiles: assets.publicFiles, aliases: importConfig.linkAliases }
	);

	// Phase 1: convert every page.
	const converted = new Map<string, ConvertedPage>();
	const failed = new Map<string, Issue[]>();
	for (const page of discovery.pages) {
		const repoPath = `${upstream.docsDir}/${page}`;
		const source = await readText(path.join(checkout.dir, repoPath));
		try {
			converted.set(
				page,
				convertPage({
					upstreamPath: page,
					repoPath,
					source,
					upstreamUrl: upstreamUrlOf(upstream.siteUrl, page),
					siteUrl: upstream.siteUrl,
					pageIndex,
					assets: assets.forPage(repoPath, (file) => readFileSync(file)),
					isTutorial: page.startsWith('tutorial/'),
				})
			);
		} catch (error) {
			const collector = new IssueCollector(repoPath);
			collector.error('conversion-failed', `Conversion threw: ${(error as Error).stack ?? String(error)}`);
			failed.set(page, collector.issues);
		}
	}

	// Phase 2: resolve links across pages.
	finalizeLinks(converted, (page) => (imported.has(page) ? slugOfPage(page) : undefined));

	// Phase 3: serialize and validate.
	interface Output {
		page: string;
		output: string;
		content: string;
		manifest: ManifestPage;
		issues: Issue[];
	}
	const outputs: Output[] = [];
	for (const page of discovery.pages) {
		const repoPath = `${upstream.docsDir}/${page}`;
		const source = await readFile(path.join(checkout.dir, repoPath));
		const result = converted.get(page);
		const output = outputOfPage(page);
		const upstreamNav = navEntry(page);
		if (!result) {
			const issues = failed.get(page) ?? [];
			outputs.push({
				page,
				output,
				content: '',
				issues,
				manifest: basePageManifest(page, output, source, '', page, 'docs', issues, 'failed', upstreamNav, true),
			});
			continue;
		}
		const section = sectionOfPage(page, result.title);
		const versionLabel = section === 'release-notes' ? releaseVersionLabel(result.title) : undefined;
		const releaseDate = parseReleaseDate(result.release?.date);
		const lastModified = dates.get(repoPath);
		const mdx = serializePage(result, buildFrontmatter(result, { lastModified, section, versionLabel, releaseDate }));
		try {
			await compile(stripFrontmatter(mdx));
		} catch (error) {
			result.issues.error('mdx-invalid', `Generated MDX does not compile: ${(error as Error).message}`);
		}
		const hasError = result.issues.issues.some((issue) => issue.severity === 'error' && issue.code === 'mdx-invalid');
		const counts = countBySeverity(result.issues.issues);
		const status = hasError ? 'failed' : counts.error + counts.warning > 0 ? 'imported-with-warnings' : 'imported';
		const manifestPage = basePageManifest(page, output, source, hasError ? '' : mdx, result.title, section, result.issues.issues, status, upstreamNav, result.frontmatter.search !== false);
		if (lastModified) manifestPage.lastModified = lastModified;
		if (section === 'release-notes' || section === 'articles') {
			const release: NonNullable<ManifestPage['release']> = {};
			if (versionLabel) release.versionLabel = versionLabel;
			if (releaseDate ?? result.release?.date) release.date = (releaseDate ?? result.release?.date)!;
			if (result.release?.author) release.author = result.release.author;
			manifestPage.release = release;
		}
		outputs.push({ page, output, content: hasError ? '' : mdx, issues: result.issues.issues, manifest: manifestPage });
	}

	function navEntry(page: string): ManifestPage['upstreamNav'] | undefined {
		const entry = nav.entries.get(page);
		if (!entry) return undefined;
		const value: NonNullable<ManifestPage['upstreamNav']> = { group: entry.group, label: entry.label, order: entry.order };
		if (entry.subgroup) value.subgroup = entry.subgroup;
		return value;
	}

	// Phase 4: write files, respecting ownership.
	const conflicts: { file: string; reason: string }[] = [];
	const written: string[] = [];
	const deleted: string[] = [];
	const previousByOutput = new Map((previous?.pages ?? []).map((page) => [page.output, page]));
	const nextOutputs = new Set(outputs.map((output) => output.output));

	for (const output of outputs) {
		const absolute = path.join(ROOT, output.output);
		if (!output.content) {
			if (existsSync(absolute)) conflicts.push({ file: output.output, reason: 'conversion failed; the previously generated file was kept unchanged' });
			continue;
		}
		if (existsSync(absolute)) {
			const current = sha256(await readFile(absolute));
			const prior = previousByOutput.get(output.output);
			if (!prior) {
				if (!options.force) {
					conflicts.push({ file: output.output, reason: 'a file that is not managed by the importer already exists at this path' });
					continue;
				}
			} else if (current !== prior.outputSha256 && current !== output.manifest.outputSha256 && !options.force) {
				conflicts.push({ file: output.output, reason: 'the generated file was edited locally since the last import (use --force to overwrite)' });
				continue;
			}
		}
		if (!options.dryRun && (await writeIfChanged(absolute, output.content))) written.push(output.output);
	}

	for (const prior of previous?.pages ?? []) {
		if (nextOutputs.has(prior.output)) continue;
		const absolute = path.join(ROOT, prior.output);
		if (!existsSync(absolute)) continue;
		const current = sha256(await readFile(absolute));
		if (current !== prior.outputSha256 && !options.force) {
			conflicts.push({ file: prior.output, reason: 'page was removed upstream, but the generated file was edited locally; not deleted' });
			continue;
		}
		if (!options.dryRun) {
			await unlink(absolute);
			deleted.push(prior.output);
		}
	}

	await assets.measure();
	if (!options.dryRun) {
		const assetSync = await assets.sync(paths.publicUpstream);
		if (assetSync.removed.length > 0) log(`  removed ${assetSync.removed.length} unused asset(s)`);
	}

	// Manifest and report.
	const mirrored = [...assets.records.values()].filter((record) => record.status === 'mirrored');
	const notMirrored = [...assets.records.values()].filter((record) => record.status !== 'mirrored');
	const allIssues = outputs.flatMap((output) => output.issues);
	const manifest: Manifest = {
		schemaVersion: 1,
		generator: MANIFEST_GENERATOR,
		upstream: {
			name: upstream.name,
			repository: upstream.repository,
			branch: upstream.branch,
			commit: checkout.commit,
			commitDate: checkout.commitDate,
			siteUrl: upstream.siteUrl,
			license: upstream.license,
			licenseSha256: sha256(licenseText),
			...(versionRange
				? { versionEvidence: { package: importConfig.versionEvidencePackage, range: versionRange, source: 'package.json' } }
				: {}),
		},
		docVersion: importConfig.docVersion,
		summary: {
			discovered: discovery.allPages.length,
			imported: outputs.filter((output) => output.manifest.status !== 'failed').length,
			importedWithWarnings: outputs.filter((output) => output.manifest.status === 'imported-with-warnings').length,
			failed: outputs.filter((output) => output.manifest.status === 'failed').length,
			skipped: discovery.skipped.length,
			issues: countBySeverity(allIssues),
			assetsMirrored: mirrored.length,
			assetsNotMirrored: notMirrored.filter((record) => record.status === 'excluded').length,
			assetsMissing: notMirrored.filter((record) => record.status === 'missing').length,
		},
		pages: outputs.map((output) => output.manifest).sort((a, b) => a.source.localeCompare(b.source)),
		skipped: discovery.skipped.map((page) => ({ source: `${upstream.docsDir}/${page.path}`, reason: page.reason })),
		ignoredFiles: discovery.ignored.map((file) => ({ source: `${upstream.docsDir}/${file.path}`, reason: file.reason })),
		assets: mirrored
			.map((record) => ({
				source: `${upstream.publicDir}/${record.publicPath}`,
				output: `public/upstream/${record.publicPath}`,
				url: record.url,
				bytes: record.bytes ?? 0,
				sha256: record.sha256 ?? '',
				...(record.width !== undefined ? { width: record.width } : {}),
				...(record.height !== undefined ? { height: record.height } : {}),
				referencedBy: [...record.referencedBy].sort(),
			}))
			.sort((a, b) => a.source.localeCompare(b.source)),
		assetsNotMirrored: notMirrored
			.map((record) => ({
				source: `${upstream.publicDir}/${record.publicPath}`,
				status: record.status as 'excluded' | 'missing',
				reason: record.reason ?? 'not present in the upstream repository',
				referencedBy: [...record.referencedBy].sort(),
			}))
			.sort((a, b) => a.source.localeCompare(b.source)),
	};

	const report: MigrationReport = {
		generatedBy: MANIFEST_GENERATOR,
		upstream: manifest.upstream,
		summary: manifest.summary,
		pages: outputs
			.map((output) => ({ source: output.manifest.source, output: output.output, status: output.manifest.status, issues: output.issues }))
			.sort((a, b) => a.source.localeCompare(b.source)),
		conflicts,
		skipped: manifest.skipped,
		ignoredFiles: manifest.ignoredFiles,
		assetsNotMirrored: manifest.assetsNotMirrored,
	};

	if (!options.dryRun) {
		await writeJson(paths.manifest, manifest);
		await writeJson(paths.migrationReportJson, report);
		await writeIfChanged(paths.migrationReportMd, renderMigrationReport(report));
		await writeIfChanged(path.join(paths.thirdPartyDir, 'LICENSE'), licenseText);
		await writeIfChanged(path.join(paths.thirdPartyDir, 'SOURCE.md'), renderSourceNotice(manifest));
	}

	const ok = manifest.summary.failed === 0 && conflicts.length === 0;
	log(
		`✓ ${manifest.summary.imported}/${discovery.pages.length} pages imported ` +
			`(${manifest.summary.importedWithWarnings} with warnings, ${manifest.summary.failed} failed, ${manifest.summary.skipped} skipped); ` +
			`issues: ${manifest.summary.issues.error} errors, ${manifest.summary.issues.warning} warnings, ${manifest.summary.issues.info} notes`
	);
	log(`  ${written.length} file(s) written, ${deleted.length} deleted, ${conflicts.length} conflict(s)`);
	for (const conflict of conflicts) log(`  ! ${conflict.file}: ${conflict.reason}`);
	return { manifest, previous, report, conflicts, written, deleted, ok };
}

function basePageManifest(
	page: string,
	output: string,
	source: Buffer,
	content: string,
	title: string,
	section: ManifestPage['section'],
	issues: Issue[],
	status: ManifestPage['status'],
	nav: ManifestPage['upstreamNav'] | undefined,
	searchable: boolean
): ManifestPage {
	const { upstream } = importConfig;
	const manifestPage: ManifestPage = {
		source: `${upstream.docsDir}/${page}`,
		sourceSha256: sha256(source),
		output,
		outputSha256: content ? sha256(content) : '',
		slug: slugOfPage(page),
		title,
		upstreamUrl: upstreamUrlOf(upstream.siteUrl, page),
		section,
		status,
		issues: countBySeverity(issues),
		searchable,
	};
	if (nav) manifestPage.upstreamNav = nav;
	return manifestPage;
}

function renderSourceNotice(manifest: Manifest): string {
	const { upstream } = manifest;
	return `# Upstream source

The pages under \`src/content/docs/\` that carry an \`upstream\` frontmatter block, and the files under
\`public/upstream/\`, are derived from the official ElysiaJS documentation:

- Repository: ${upstream.repository}
- Commit: ${upstream.commit} (${upstream.commitDate})
- License: ${upstream.license} — the complete license text is in [LICENSE](./LICENSE) (${importConfig.upstream.copyright}).

The content was converted from VitePress Markdown to Starlight MDX by \`scripts/docs/import.ts\`.
Conversion changes are mechanical; see \`reports/migration-report.md\` for every lossy step.
This file is generated by \`pnpm docs:import\`.
`;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			ref: { type: 'string' },
			offline: { type: 'boolean', default: false },
			force: { type: 'boolean', default: false },
			'dry-run': { type: 'boolean', default: false },
		},
	});
	const result = await runImport({
		...(values.ref ? { ref: values.ref } : {}),
		offline: values.offline,
		force: values.force,
		dryRun: values['dry-run'],
	});
	if (!result.ok) {
		console.error('✗ Import finished with failures or conflicts. See reports/migration-report.md.');
		process.exitCode = 1;
	}
}

// Run only when executed directly (sync.ts imports runImport()).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
