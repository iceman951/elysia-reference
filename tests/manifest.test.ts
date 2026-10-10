/**
 * Consistency of the committed import output (manifest ↔ generated files ↔ assets).
 * Runs against the repository state, so it fails if a generated file is edited by
 * hand or the manifest is out of date.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { sha256 } from '../scripts/docs/lib/fs-utils.ts';
import type { Manifest } from '../scripts/docs/lib/manifest.ts';
import { ROOT } from '../scripts/docs/lib/paths.ts';

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'src/generated/upstream-manifest.json'), 'utf8')) as Manifest;

describe('import manifest', () => {
	test('records the upstream commit and license', () => {
		assert.match(manifest.upstream.commit, /^[0-9a-f]{40}$/);
		assert.equal(manifest.upstream.license, 'MIT');
		const license = readFileSync(path.join(ROOT, 'third-party/elysia-documentation/LICENSE'), 'utf8');
		assert.equal(sha256(license), manifest.upstream.licenseSha256);
		assert.match(license, /Permission is hereby granted, free of charge/);
	});

	test('summary counts match the page list', () => {
		const imported = manifest.pages.filter((page) => page.status !== 'failed').length;
		assert.equal(manifest.summary.imported, imported);
		assert.equal(manifest.summary.discovered, manifest.pages.length + manifest.skipped.length);
	});

	test('every generated page exists, is unmodified and carries source metadata', () => {
		for (const page of manifest.pages) {
			const file = path.join(ROOT, page.output);
			assert.ok(existsSync(file), `${page.output} is missing`);
			const source = readFileSync(file, 'utf8');
			assert.equal(sha256(source), page.outputSha256, `${page.output} differs from the import output`);
			const frontmatter = parseYaml(/^---\n([\s\S]*?)\n---/.exec(source)![1]!) as { upstream?: { path: string; url: string } };
			assert.equal(frontmatter.upstream?.path, page.source);
			assert.equal(frontmatter.upstream?.url, page.upstreamUrl);
		}
	});

	test('every mirrored asset exists with the recorded hash', () => {
		for (const asset of manifest.assets) {
			const file = path.join(ROOT, asset.output);
			assert.ok(existsSync(file), `${asset.output} is missing`);
			assert.equal(sha256(readFileSync(file)), asset.sha256, `${asset.output} changed`);
		}
	});
});
