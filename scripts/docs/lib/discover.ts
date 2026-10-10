import { existsSync } from 'node:fs';
import path from 'node:path';
import { importConfig } from '../import.config.ts';
import { listFiles, matchesAnyGlob, readText } from './fs-utils.ts';
import { extractPropertyLiteral, extractVariableLiteral, isRecord, type LiteralValue } from './literal.ts';

export interface SkippedPage {
	/** Path relative to the docs dir. */
	path: string;
	reason: string;
}

export interface IgnoredFile {
	path: string;
	reason: string;
}

export interface Discovery {
	/** Pages to import (relative to the docs dir). */
	pages: string[];
	skipped: SkippedPage[];
	/** Every discovered Markdown page, imported or not. */
	allPages: string[];
	/** Non-Markdown files inside content directories. */
	ignored: IgnoredFile[];
	srcExclude: string[];
}

function ignoredReason(file: string): string {
	if (file.endsWith('.vue')) return 'Vue component used by a page (not a page itself)';
	if (file.endsWith('.ts') || file.endsWith('.js')) return 'Script module (e.g. interactive tutorial starter code and test cases)';
	if (file.endsWith('.txt')) return 'Plain-text file; not part of the upstream build';
	if (file.endsWith('.css')) return 'Stylesheet of the upstream theme';
	return 'Not a Markdown page';
}

export async function discover(checkoutDir: string): Promise<Discovery> {
	const docsDir = path.join(checkoutDir, importConfig.upstream.docsDir);
	const files = await listFiles(docsDir, {
		ignoreDirs: (relDir) => importConfig.ignoredDirs.includes(relDir.split('/')[0]!),
	});
	const configPath = path.join(checkoutDir, importConfig.upstream.vitepressConfig);
	const configSource = existsSync(configPath) ? await readText(configPath) : '';
	const srcExcludeValue = extractPropertyLiteral(configSource, 'srcExclude');
	const srcExclude = Array.isArray(srcExcludeValue) ? srcExcludeValue.filter((v): v is string => typeof v === 'string') : [];

	const pages: string[] = [];
	const skipped: SkippedPage[] = [];
	const allPages: string[] = [];
	const ignored: IgnoredFile[] = [];
	for (const file of files) {
		if (!file.endsWith('.md')) {
			const excludedUpstream = matchesAnyGlob(file, srcExclude);
			ignored.push({
				path: file,
				reason: excludedUpstream ? `Excluded from the upstream build (srcExclude: ${srcExclude.join(', ')}); ${ignoredReason(file)}` : ignoredReason(file),
			});
			continue;
		}
		allPages.push(file);
		if (matchesAnyGlob(file, srcExclude)) {
			skipped.push({ path: file, reason: 'Excluded from the upstream build (VitePress srcExclude).' });
			continue;
		}
		const rule = importConfig.skip.find((candidate) => matchesAnyGlob(file, [candidate.pattern]));
		if (rule) {
			skipped.push({ path: file, reason: rule.reason });
			continue;
		}
		pages.push(file);
	}
	return { pages, skipped, allPages, ignored, srcExclude };
}

export interface UpstreamNavEntry {
	group: string;
	/** Nested group label, e.g. "Eden Treaty". */
	subgroup?: string;
	label: string;
	order: number;
}

function normalizeRoute(link: string): string {
	return link
		.replace(/^https?:\/\/(www\.)?elysiajs\.com/, '')
		.replace(/[#?].*$/, '')
		.replace(/\.(md|html)$/, '')
		.replace(/^\/+/, '')
		.replace(/\/+$/, '');
}

/** Maps an upstream route (`essential/route`, `tutorial`) to the page path. */
function pageForRoute(route: string, pages: ReadonlySet<string>): string | undefined {
	for (const candidate of [`${route}.md`, `${route}/index.md`, route === '' ? 'index.md' : '']) {
		if (candidate && pages.has(candidate)) return candidate;
	}
	return undefined;
}

/**
 * Reads navigation labels from the upstream VitePress sidebar and the tutorial
 * table of contents. Returns entries keyed by page path.
 */
export async function readUpstreamNavigation(checkoutDir: string, pages: readonly string[]): Promise<{
	entries: Map<string, UpstreamNavEntry>;
	unresolved: string[];
}> {
	const pageSet = new Set(pages);
	const entries = new Map<string, UpstreamNavEntry>();
	const unresolved: string[] = [];
	let order = 0;

	const visit = (items: LiteralValue | undefined, group: string, subgroup: string | undefined, textKey: string, linkKey: string, childKey: string) => {
		if (!Array.isArray(items)) return;
		for (const item of items) {
			if (!isRecord(item)) continue;
			const label = item[textKey];
			const link = item[linkKey];
			const children = item[childKey];
			if (typeof label === 'string' && typeof link === 'string') {
				const page = pageForRoute(normalizeRoute(link), pageSet);
				if (page) {
					if (!entries.has(page)) {
						const entry: UpstreamNavEntry = { group, label, order: order++ };
						if (subgroup) entry.subgroup = subgroup;
						entries.set(page, entry);
					}
				} else {
					unresolved.push(link);
				}
			}
			if (Array.isArray(children) && typeof label === 'string') {
				const nextGroup = group === '' ? label : group;
				const nextSubgroup = group === '' ? undefined : label;
				visit(children, nextGroup, nextSubgroup, textKey, linkKey, childKey);
			}
		}
	};

	const configPath = path.join(checkoutDir, importConfig.upstream.vitepressConfig);
	if (existsSync(configPath)) {
		const sidebar = extractPropertyLiteral(await readText(configPath), 'sidebar');
		visit(sidebar, '', undefined, 'text', 'link', 'items');
	}
	const tocPath = path.join(checkoutDir, importConfig.upstream.tutorialToc);
	if (existsSync(tocPath)) {
		const toc = extractVariableLiteral(await readText(tocPath), 'tableOfContents');
		if (Array.isArray(toc)) {
			for (const group of toc) {
				if (!isRecord(group) || typeof group['title'] !== 'string') continue;
				visit(group['contents'], `Tutorial`, group['title'], 'title', 'href', 'contents');
			}
		}
	}
	return { entries, unresolved };
}

/** Reads the declared version range of a dependency from the upstream package.json. */
export async function readDependencyRange(checkoutDir: string, name: string): Promise<string | undefined> {
	const file = path.join(checkoutDir, 'package.json');
	if (!existsSync(file)) return undefined;
	const pkg = JSON.parse(await readText(file)) as Record<string, Record<string, string> | undefined>;
	return pkg['dependencies']?.[name] ?? pkg['devDependencies']?.[name] ?? pkg['peerDependencies']?.[name];
}
