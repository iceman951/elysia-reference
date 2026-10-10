/**
 * pnpm examples:smoke
 *
 * Runs a small, curated set of code examples from the imported documentation
 * against a real Elysia install and checks the responses the documentation states.
 *
 * - Examples are extracted verbatim from the generated pages (no edits).
 * - `elysia` is installed at the version range the upstream documentation pins
 *   (recorded in the import manifest); the exact resolved version is reported.
 * - Requires Bun (Elysia's primary runtime) and network access for `bun install`.
 *
 * A passing run only shows that these specific examples ran with the reported
 * Bun and Elysia versions; it does not verify the rest of the documentation.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProcessor } from '@mdx-js/mdx';
import type { Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import { readJson, writeIfChanged } from '../docs/lib/fs-utils.ts';
import type { Manifest } from '../docs/lib/manifest.ts';
import { paths, ROOT } from '../docs/lib/paths.ts';

interface Check {
	path: string;
	status: number;
	/** Expected response body; omitted when the documentation only states the status (e.g. "Not Found"). */
	body?: string;
}

interface Example {
	id: string;
	/** Generated page the example is taken from (repository-relative). */
	page: string;
	/** Where the example and its expected output are documented. */
	location: string;
	/** Unique snippet identifying the code block. */
	match: string;
	checks: Check[];
}

const EXAMPLES: Example[] = [
	{
		id: 'quick-start-bun',
		page: 'src/content/docs/quick-start.mdx',
		location: 'Quick Start › Bun › Manual Installation',
		match: "const app = new Elysia()\n\t.get('/', () => 'Hello Elysia')\n\t.listen(3000)\n\nconsole.log(",
		checks: [{ path: '/', status: 200, body: 'Hello Elysia' }],
	},
	{
		id: 'route-verbs',
		page: 'src/content/docs/essential/route.mdx',
		location: 'Routing (first example)',
		match: "    .get('/', 'hello')\n    .get('/hi', 'hi')",
		checks: [
			{ path: '/', status: 200, body: 'hello' },
			{ path: '/hi', status: 200, body: 'hi' },
		],
	},
	{
		id: 'route-static-path',
		page: 'src/content/docs/essential/route.mdx',
		location: 'Routing › Static Path',
		match: "\t.get('/hello', 'hello')\n\t.get('/hi', 'hi')",
		checks: [
			{ path: '/hello', status: 200, body: 'hello' },
			{ path: '/hi', status: 200, body: 'hi' },
		],
	},
	{
		id: 'route-dynamic-path',
		page: 'src/content/docs/essential/route.mdx',
		location: 'Routing › Dynamic path (response table)',
		match: "    .get('/id/:id', ({ params: { id } }) => id)\n    .listen(3000)",
		checks: [
			{ path: '/id/1', status: 200, body: '1' },
			{ path: '/id/123', status: 200, body: '123' },
			{ path: '/id/anything', status: 200, body: 'anything' },
			{ path: '/id/anything?name=salt', status: 200, body: 'anything' },
			{ path: '/id', status: 404 },
			{ path: '/id/anything/rest', status: 404 },
		],
	},
];

const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;

function codeBlocks(source: string): string[] {
	const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
	const tree = createProcessor({ remarkPlugins: [remarkGfm] }).parse(body) as Root;
	const blocks: string[] = [];
	const walk = (node: Root | RootContent) => {
		if (node.type === 'code') blocks.push(node.value);
		if ('children' in node && Array.isArray(node.children)) for (const child of node.children as RootContent[]) walk(child);
	};
	walk(tree);
	return blocks;
}

async function waitForServer(child: ChildProcess, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`process exited with code ${child.exitCode}`);
		try {
			await fetch(`${BASE}/`, { signal: AbortSignal.timeout(500) });
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
	}
	throw new Error(`server did not start within ${timeoutMs} ms`);
}

async function stop(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return;
	const exited = new Promise((resolve) => child.once('exit', resolve));
	child.kill('SIGTERM');
	await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
	if (child.exitCode === null) child.kill('SIGKILL');
}

async function main(): Promise<void> {
	const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' });
	if (bun.status !== 0) {
		console.error('✗ Bun is required (https://bun.sh). Install it and re-run `pnpm examples:smoke`.');
		process.exitCode = 1;
		return;
	}
	const manifest = await readJson<Manifest>(paths.manifest);
	const range = manifest?.upstream.versionEvidence?.range;
	if (!range) throw new Error('The import manifest does not record the elysia version range; run `pnpm docs:import`.');

	const workspace = await mkdtemp(path.join(os.tmpdir(), 'elysia-reference-smoke-'));
	await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { elysia: range } }, null, 2));
	console.log(`→ Installing elysia@${range} with Bun ${bun.stdout.trim()} in ${workspace}`);
	const install = spawnSync('bun', ['install'], { cwd: workspace, encoding: 'utf8' });
	if (install.status !== 0) throw new Error(`bun install failed:\n${install.stderr}`);
	const installed = JSON.parse(await readFile(path.join(workspace, 'node_modules/elysia/package.json'), 'utf8')) as { version: string };

	const results: { example: Example; ok: boolean; details: string[] }[] = [];
	for (const example of EXAMPLES) {
		const details: string[] = [];
		let ok = true;
		const matches = codeBlocks(await readFile(path.join(ROOT, example.page), 'utf8')).filter((code) => code.includes(example.match));
		if (matches.length !== 1) {
			const detail = `expected exactly one matching code block, found ${matches.length} (the page changed?)`;
			results.push({ example, ok: false, details: [detail] });
			console.log(`✗ ${example.id} — ${example.location}\n    ${detail}`);
			continue;
		}
		const file = path.join(workspace, `${example.id}.ts`);
		await writeFile(file, matches[0]!);
		const child = spawn('bun', ['run', file], { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
		child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
		try {
			await waitForServer(child, 15000);
			for (const check of example.checks) {
				const response = await fetch(`${BASE}${check.path}`);
				const text = await response.text();
				const statusOk = response.status === check.status;
				const bodyOk = check.body === undefined || text === check.body;
				ok &&= statusOk && bodyOk;
				details.push(
					`${statusOk && bodyOk ? 'pass' : 'FAIL'} GET ${check.path} → ${response.status}${check.body === undefined ? '' : ` "${text.slice(0, 60)}"`}` +
						(statusOk && bodyOk ? '' : ` (expected ${check.status}${check.body === undefined ? '' : ` "${check.body}"`})`)
				);
			}
		} catch (cause) {
			ok = false;
			details.push(`error: ${(cause as Error).message}`, ...output.trim().split('\n').slice(-10));
		} finally {
			await stop(child);
		}
		results.push({ example, ok, details });
		console.log(`${ok ? '✓' : '✗'} ${example.id} — ${example.location}`);
		for (const line of details) console.log(`    ${line}`);
	}

	const passed = results.filter((result) => result.ok).length;
	const lines = [
		'# Example smoke tests',
		'',
		`> Generated by \`pnpm examples:smoke\`. Bun ${bun.stdout.trim()}, elysia ${installed.version} (range \`${range}\` from the upstream documentation), ${os.platform()}-${os.arch()}.`,
		'',
		`${passed} of ${results.length} examples passed. Only the examples listed here were executed.`,
		'',
	];
	for (const { example, ok, details } of results) {
		lines.push(`## ${ok ? '✅' : '❌'} ${example.id}`, '', `- Source: \`${example.page}\` — ${example.location}`, ...details.map((line) => `- ${line}`), '');
	}
	await writeIfChanged(path.join(paths.reportsDir, 'examples-smoke.md'), `${lines.join('\n').trimEnd()}\n`);
	console.log(`${passed === results.length ? '✓' : '✗'} ${passed}/${results.length} examples passed with Bun ${bun.stdout.trim()} and elysia ${installed.version}`);
	if (passed !== results.length) process.exitCode = 1;
}

await main();
