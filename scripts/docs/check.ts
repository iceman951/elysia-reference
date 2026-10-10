/**
 * pnpm docs:check [--dist]
 *
 * Validates documentation content. Exits with code 1 when an error is found.
 *
 * Source checks (always):
 * - manifest ↔ generated files (missing, unmanaged, locally modified, failed pages)
 * - attribution and source metadata (frontmatter, upstream LICENSE, notices)
 * - unsupported markup left over from VitePress
 * - sidebar completeness
 * - internal links and asset references in Markdown/MDX
 *
 * Built-site checks (--dist, after `pnpm build`):
 * - every internal link and anchor resolves to a built page / element
 * - every referenced image, video and file exists
 * - canonical URLs follow the SEO policy; disclaimer present on every page
 * - accessibility basics: <html lang>, one <h1>, image alt text
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createProcessor } from '@mdx-js/mdx';
import type { Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import { buildSidebar } from '../../src/config/navigation.ts';
import { SITE } from '../../src/config/site.ts';
import { proseLines, readContentFiles, type ContentFile } from './lib/content.ts';
import { listFiles, readJson, sha256, writeIfChanged } from './lib/fs-utils.ts';
import { tokenizeHtml } from './lib/html.ts';
import type { Manifest } from './lib/manifest.ts';
import { paths, ROOT } from './lib/paths.ts';
import type { MigrationReport } from './lib/report.ts';

interface Finding {
	severity: 'error' | 'warning';
	check: string;
	file?: string;
	message: string;
}

const findings: Finding[] = [];
const error = (check: string, message: string, file?: string) =>
	findings.push({ severity: 'error', check, message, ...(file ? { file } : {}) });
const warn = (check: string, message: string, file?: string) =>
	findings.push({ severity: 'warning', check, message, ...(file ? { file } : {}) });

/** VitePress / Vue syntax that must not survive conversion (checked outside code blocks and MDX comments). */
const LEFTOVER_PATTERNS: { pattern: RegExp; label: string }[] = [
	{ pattern: /^\s*:{3,}\s+[a-z-]+/, label: 'VitePress container marker ("::: name")' },
	{ pattern: /^\s*:{3,}\s*(info|warning|details|code-group|v-pre|raw)\b/, label: 'unconverted VitePress container' },
	{ pattern: /<script\b/i, label: '<script> block' },
	{ pattern: /<template\b/, label: 'Vue <template>' },
	{ pattern: /\sv-(slot|if|else|for|bind|on|show|model)(:|=|\s|>)/, label: 'Vue directive' },
	{ pattern: /\s[:@][a-zA-Z-]+="/, label: 'Vue attribute binding' },
	{ pattern: /\[!code\s/, label: 'Shiki notation comment' },
	{ pattern: /\{\{[^}]*\}\}/, label: 'Vue interpolation' },
];

/** Twoslash directives must not appear in code shown to readers. */
const TWOSLASH_LEFTOVER = /^\s*\/\/\s*(---cut(-before|-after|-start|-end)?---|@noErrors\b|@errors:|\^\?)/m;

function walkMdast(node: Root | RootContent, visit: (node: RootContent) => void): void {
	if (!('children' in node) || !Array.isArray(node.children)) return;
	for (const child of node.children as RootContent[]) {
		visit(child);
		walkMdast(child, visit);
	}
}

function referencesOf(content: ContentFile): { url: string; kind: 'link' | 'asset' }[] {
	const processor = createProcessor({ format: content.file.endsWith('.md') ? 'md' : 'mdx', remarkPlugins: [remarkGfm] });
	const tree = processor.parse(content.body) as Root;
	const refs: { url: string; kind: 'link' | 'asset' }[] = [];
	walkMdast(tree, (node) => {
		if (node.type === 'link' || node.type === 'definition') refs.push({ url: node.url, kind: 'link' });
		else if (node.type === 'image') refs.push({ url: node.url, kind: 'asset' });
		else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
			for (const attribute of node.attributes) {
				if (attribute.type !== 'mdxJsxAttribute' || typeof attribute.value !== 'string') continue;
				if (['href', 'doc'].includes(attribute.name)) refs.push({ url: attribute.value, kind: 'link' });
				if (['src', 'poster'].includes(attribute.name)) refs.push({ url: attribute.value, kind: 'asset' });
			}
		}
	});
	return refs;
}

async function sourceChecks(): Promise<void> {
	const manifest = await readJson<Manifest>(paths.manifest);
	if (!manifest) {
		error('manifest', 'src/generated/upstream-manifest.json is missing; run `pnpm docs:import`.');
		return;
	}
	const content = await readContentFiles();
	const byFile = new Map(content.map((entry) => [entry.file, entry]));
	const slugs = new Set(content.map((entry) => entry.slug));
	const publicFiles = new Set(await listFiles(path.join(ROOT, 'public')));

	// Manifest ↔ files.
	const managed = new Set<string>();
	for (const page of manifest.pages) {
		managed.add(page.output);
		if (page.status === 'failed') error('import-failed', `Upstream page ${page.source} failed to convert.`, page.output);
		const entry = byFile.get(page.output);
		if (!entry) {
			error('missing-imported-page', `Imported page listed in the manifest is missing (${page.source}).`, page.output);
			continue;
		}
		if (page.outputSha256 && sha256(entry.source) !== page.outputSha256) {
			error('generated-file-modified', 'Generated file differs from the import output; edit the importer or upstream instead.', page.output);
		}
	}
	for (const entry of content) {
		if (entry.frontmatter['upstream'] && !managed.has(entry.file)) {
			error('unmanaged-imported-page', 'Page declares `upstream` frontmatter but is not in the import manifest.', entry.file);
		}
	}

	// Attribution and source metadata.
	for (const entry of content) {
		const upstream = entry.frontmatter['upstream'] as { path?: unknown; url?: unknown } | undefined;
		if (!managed.has(entry.file)) continue;
		if (!upstream || typeof upstream.path !== 'string' || typeof upstream.url !== 'string') {
			error('attribution', 'Imported page lacks `upstream.path` / `upstream.url` source metadata.', entry.file);
		} else if (!upstream.url.startsWith(manifest.upstream.siteUrl)) {
			error('attribution', `upstream.url does not point to ${manifest.upstream.siteUrl}.`, entry.file);
		}
		if (!('editUrl' in entry.frontmatter)) error('attribution', 'Imported page lacks an editUrl.', entry.file);
	}
	const licenseFile = path.join(paths.thirdPartyDir, 'LICENSE');
	if (!existsSync(licenseFile)) error('attribution', 'third-party/elysia-documentation/LICENSE is missing.');
	else if (sha256(await readFile(licenseFile, 'utf8')) !== manifest.upstream.licenseSha256) {
		error('attribution', 'third-party/elysia-documentation/LICENSE does not match the upstream license recorded at import.');
	}
	for (const file of ['third-party/elysia-documentation/SOURCE.md', 'ATTRIBUTION.md', 'LICENSE']) {
		if (!existsSync(path.join(ROOT, file))) error('attribution', `${file} is missing.`);
	}
	if (SITE.disclaimer !== 'Independent community documentation. Not affiliated with or endorsed by the ElysiaJS maintainers.') {
		error('attribution', 'The footer disclaimer text was changed.');
	}

	// Unsupported markup (inline code spans are documentation, not markup).
	for (const entry of content) {
		for (const [line, text] of proseLines(entry.body)) {
			const withoutCode = text.replace(/(`+)[^`]*?\1/g, '');
			for (const { pattern, label } of LEFTOVER_PATTERNS) {
				if (pattern.test(withoutCode)) error('unsupported-markup', `${label} at body line ${line}: ${text.trim().slice(0, 100)}`, entry.file);
			}
		}
		// Upstream shows Twoslash markers literally in blocks without the `twoslash` flag, so this is a warning.
		if (managed.has(entry.file) && TWOSLASH_LEFTOVER.test(entry.body)) {
			warn('twoslash-marker', 'Code block contains a Twoslash marker (displayed literally, as upstream does for non-Twoslash blocks).', entry.file);
		}
	}

	// Sidebar completeness.
	const navigation = buildSidebar(manifest.pages, slugs);
	for (const slug of navigation.missing) error('navigation', `Sidebar entry "${slug}" has no page.`);
	for (const slug of navigation.unlisted) warn('navigation', `Page "${slug}" is not in src/config/navigation.ts (shown under "Other Pages").`);

	// Internal links and assets.
	for (const entry of content) {
		let refs: { url: string; kind: 'link' | 'asset' }[];
		try {
			refs = referencesOf(entry);
		} catch (cause) {
			error('mdx-syntax', `Cannot parse: ${(cause as Error).message}`, entry.file);
			continue;
		}
		for (const ref of refs) {
			const url = ref.url.trim();
			if (!url.startsWith('/') || url.startsWith('//')) {
				if (!/^([a-z][a-z0-9+.-]*:|#)/i.test(url) && url !== '') {
					warn('relative-link', `Relative link "${url}" (use root-relative links).`, entry.file);
				}
				continue;
			}
			const pathname = decodeURI(url.replace(/[?#].*$/, ''));
			const relative = pathname.replace(/^\/+/, '');
			if (publicFiles.has(relative)) continue;
			if (relative.startsWith('upstream/') || ref.kind === 'asset') {
				error('missing-asset', `Referenced file "${pathname}" does not exist in public/.`, entry.file);
				continue;
			}
			const slug = relative.replace(/\/+$/, '');
			if (slugs.has(slug) || slug.startsWith('md/') || slug === 'robots.txt' || slug.startsWith('sitemap')) continue;
			error('broken-link', `Internal link "${url}" does not match any page.`, entry.file);
		}
	}

	// Unresolved import errors.
	const report = await readJson<MigrationReport>(paths.migrationReportJson);
	const importErrors = report?.pages.flatMap((page) => page.issues.filter((issue) => issue.severity === 'error')) ?? [];
	for (const issue of importErrors) error('import-error', `${issue.code}: ${issue.message}`, issue.file);
	if (report && report.conflicts.length > 0) {
		for (const conflict of report.conflicts) error('import-conflict', conflict.reason, conflict.file);
	}
}

interface HtmlPage {
	file: string;
	url: string;
	ids: Set<string>;
	links: string[];
	assets: string[];
	h1: number;
	lang: string | undefined;
	imagesWithoutAlt: number;
	canonical: string | undefined;
	hasDisclaimer: boolean;
	/** Heading levels inside the main content, in document order. */
	headingLevels: number[];
}

function parseHtml(file: string, url: string, html: string): HtmlPage {
	const page: HtmlPage = {
		file,
		url,
		ids: new Set(),
		links: [],
		assets: [],
		h1: 0,
		lang: undefined,
		imagesWithoutAlt: 0,
		canonical: undefined,
		hasDisclaimer: html.includes(SITE.disclaimer),
		headingLevels: [],
	};
	let inContent = false;
	for (const token of tokenizeHtml(html)) {
		if (token.type !== 'open') continue;
		const attr = (name: string) => token.attributes.find((attribute) => attribute.name === name)?.value ?? undefined;
		const id = attr('id');
		if (id) page.ids.add(id);
		const tag = token.name.toLowerCase();
		if (tag === 'html') page.lang = attr('lang') ?? undefined;
		if (tag === 'h1') page.h1++;
		if (attr('class')?.split(/\s+/).includes('sl-markdown-content')) inContent = true;
		if (tag === 'footer') inContent = false;
		if (inContent && /^h[2-6]$/.test(tag)) page.headingLevels.push(Number(tag[1]));
		if (tag === 'a') {
			const href = attr('href');
			if (href) page.links.push(href);
			const name = attr('name');
			if (name) page.ids.add(name);
		}
		if (tag === 'link' && attr('rel') === 'canonical') page.canonical = attr('href') ?? undefined;
		if (tag === 'img') {
			if (token.attributes.every((attribute) => attribute.name !== 'alt')) page.imagesWithoutAlt++;
			const src = attr('src');
			if (src) page.assets.push(src);
		}
		if ((tag === 'source' || tag === 'video') && attr('src')) page.assets.push(attr('src')!);
	}
	return page;
}

async function distChecks(): Promise<void> {
	if (!existsSync(paths.distDir)) {
		error('dist', 'dist/ does not exist; run `pnpm build` first.');
		return;
	}
	const manifest = await readJson<Manifest>(paths.manifest);
	const report = await readJson<MigrationReport>(paths.migrationReportJson);
	const files = await listFiles(paths.distDir);
	const fileSet = new Set(files);
	const pages = new Map<string, HtmlPage>();
	for (const file of files.filter((candidate) => candidate.endsWith('.html'))) {
		const url = `/${file.replace(/index\.html$/, '').replace(/\.html$/, '')}`;
		pages.set(url, parseHtml(file, url, await readFile(path.join(paths.distDir, file), 'utf8')));
	}

	// Anchors already reported as defects in the upstream source.
	const knownAnchors = new Set<string>();
	for (const pageReport of report?.pages ?? []) {
		const slug = pageReport.output.replace(/^src\/content\/docs\//, '').replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '');
		for (const issue of pageReport.issues) {
			if (issue.code !== 'broken-anchor' || !issue.source) continue;
			const fragment = issue.source.split('#')[1];
			if (fragment) knownAnchors.add(`/${slug ? `${slug}/` : ''}#${fragment}`);
		}
	}

	const resolvePage = (pathname: string): HtmlPage | undefined => {
		const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`;
		return pages.get(normalized) ?? pages.get(pathname);
	};

	const upstreamBySlug = new Map((manifest?.pages ?? []).map((page) => [page.slug, page.upstreamUrl]));
	let checkedLinks = 0;
	for (const page of pages.values()) {
		if (page.url === '/404/' || page.url === '/404') continue;
		if (!page.lang) error('a11y', 'Missing <html lang>.', page.file);
		if (page.h1 !== 1) error('a11y', `Expected exactly one <h1>, found ${page.h1}.`, page.file);
		if (page.imagesWithoutAlt > 0) error('a11y', `${page.imagesWithoutAlt} <img> without alt attribute.`, page.file);
		if (!page.hasDisclaimer) error('attribution', 'Footer disclaimer missing.', page.file);
		// The page title is the only <h1>, so content headings start at level 2 and should not skip levels.
		let previous = 1;
		for (const level of page.headingLevels) {
			if (level > previous + 1) {
				warn('a11y-heading-order', `Heading level jumps from h${previous} to h${level}.`, page.file);
				break;
			}
			previous = level;
		}

		const slug = page.url.replace(/^\/+|\/+$/g, '');
		const upstreamUrl = upstreamBySlug.get(slug);
		if (upstreamUrl && page.canonical !== upstreamUrl) {
			error('seo', `Canonical URL should be ${upstreamUrl} (imported page), found ${page.canonical ?? 'none'}.`, page.file);
		}

		for (const href of page.links) {
			if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(href) || href.startsWith('//')) continue;
			checkedLinks++;
			const resolved = new URL(href, `https://site.invalid${page.url}`);
			const pathname = decodeURI(resolved.pathname);
			const fragment = decodeURIComponent(resolved.hash.slice(1));
			const relative = pathname.replace(/^\/+/, '');
			const isFile = fileSet.has(relative) && !relative.endsWith('.html');
			const target = isFile ? undefined : resolvePage(pathname);
			if (!isFile && !target) {
				error('broken-link', `Link "${href}" does not resolve to a built page or file.`, page.file);
				continue;
			}
			if (fragment && target && !target.ids.has(fragment)) {
				const key = `${page.url === target.url ? page.url : target.url}#${fragment}`;
				const knownKey = `${page.url}#${fragment}`;
				if (knownAnchors.has(knownKey) || knownAnchors.has(key)) {
					warn('broken-anchor', `Anchor "#${fragment}" on ${target.url} does not exist (upstream defect, see migration report).`, page.file);
				} else {
					error('broken-anchor', `Anchor "#${fragment}" on ${target.url} does not exist.`, page.file);
				}
			}
		}
		for (const src of page.assets) {
			if (/^(https?:|data:)/i.test(src) || src.startsWith('//')) continue;
			const relative = decodeURI(new URL(src, `https://site.invalid${page.url}`).pathname).replace(/^\/+/, '');
			if (!fileSet.has(relative)) error('missing-asset', `Asset "${src}" is missing from the build.`, page.file);
		}
	}
	if (!fileSet.has('robots.txt')) error('seo', 'robots.txt missing from the build.');
	if (!files.some((file) => file.startsWith('pagefind/'))) error('search', 'Pagefind search index missing from the build.');
	console.log(`  checked ${pages.size} HTML pages and ${checkedLinks} internal links`);
}

function renderReport(dist: boolean): string {
	const errors = findings.filter((finding) => finding.severity === 'error');
	const warnings = findings.filter((finding) => finding.severity === 'warning');
	const lines = [
		'# Documentation check report',
		'',
		`> Generated by \`pnpm docs:check${dist ? ' --dist' : ''}\`.`,
		'',
		`- Errors: ${errors.length}`,
		`- Warnings: ${warnings.length}`,
		'',
	];
	for (const [title, list] of [
		['Errors', errors],
		['Warnings', warnings],
	] as const) {
		lines.push(`## ${title}`, '');
		if (list.length === 0) lines.push('None.', '');
		else {
			const grouped = new Map<string, Finding[]>();
			for (const finding of list) grouped.set(finding.check, [...(grouped.get(finding.check) ?? []), finding]);
			for (const [check, items] of grouped) {
				lines.push(`### ${check} (${items.length})`, '');
				for (const item of items) lines.push(`- ${item.file ? `\`${item.file}\`: ` : ''}${item.message}`);
				lines.push('');
			}
		}
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

async function main(): Promise<void> {
	const { values } = parseArgs({ options: { dist: { type: 'boolean', default: false } } });
	console.log('→ Checking documentation sources');
	await sourceChecks();
	if (values.dist) {
		console.log('→ Checking the built site (dist/)');
		await distChecks();
	}
	await writeIfChanged(paths.checkReportMd, renderReport(values.dist));
	const errors = findings.filter((finding) => finding.severity === 'error');
	const warnings = findings.filter((finding) => finding.severity === 'warning');
	const summarize = (list: Finding[]) => {
		const counts = new Map<string, number>();
		for (const finding of list) counts.set(finding.check, (counts.get(finding.check) ?? 0) + 1);
		return [...counts.entries()].map(([check, count]) => `${check}: ${count}`).join(', ');
	};
	if (warnings.length > 0) console.log(`  ${warnings.length} warning(s) — ${summarize(warnings)}`);
	if (errors.length > 0) {
		for (const finding of errors.slice(0, 25)) console.error(`  ✗ [${finding.check}] ${finding.file ?? ''} ${finding.message}`);
		if (errors.length > 25) console.error(`  … ${errors.length - 25} more (see reports/check-report.md)`);
		console.error(`✗ ${errors.length} error(s) — ${summarize(errors)}`);
		process.exitCode = 1;
	} else {
		console.log('✓ No errors. Details: reports/check-report.md');
	}
}

await main();
