import { compile } from '@mdx-js/mdx';
import { convertPage, finalizeLinks, serializePage, type ConvertedPage } from '../scripts/docs/lib/convert/index.ts';
import { PageIndex, upstreamUrlOf } from '../scripts/docs/lib/convert/links.ts';
import type { AssetResolution, AssetResolver } from '../scripts/docs/lib/convert/transform.ts';
import type { Issue } from '../scripts/docs/lib/issues.ts';
import { slugOfPage } from '../scripts/docs/lib/pages.ts';

export const SITE_URL = 'https://elysiajs.com';

export interface ConvertFixtureOptions {
	/** Other pages that exist upstream: path → markdown source (imported) or `null` (exists, not imported). */
	pages?: Record<string, string | null>;
	/** Files in the upstream public directory. */
	publicFiles?: string[];
	excludedAssets?: Record<string, string>;
}

export interface ConvertedFixture {
	mdx: string;
	body: string;
	page: ConvertedPage;
	issues: Issue[];
	all: Map<string, ConvertedPage>;
}

class FixtureAssets implements AssetResolver {
	private readonly files: Set<string>;
	private readonly excluded: Record<string, string>;

	constructor(files: string[], excluded: Record<string, string>) {
		this.files = new Set(files);
		this.excluded = excluded;
	}

	resolve(publicPath: string): AssetResolution {
		if (this.excluded[publicPath]) {
			return { kind: 'excluded', upstreamUrl: `${SITE_URL}/${publicPath}`, reason: this.excluded[publicPath]! };
		}
		if (!this.files.has(publicPath)) return { kind: 'missing', upstreamUrl: `${SITE_URL}/${publicPath}` };
		return { kind: 'mirrored', url: `/upstream/${publicPath}`, width: 800, height: 600 };
	}
}

/** Converts `source` as upstream page `path` (e.g. `essential/route.md`) through the full pipeline. */
export function convertFixture(path: string, source: string, options: ConvertFixtureOptions = {}): ConvertedFixture {
	const pages: Record<string, string | null> = { ...options.pages, [path]: source };
	const publicFiles = options.publicFiles ?? [];
	const index = new PageIndex(
		Object.entries(pages).map(([upstreamPath, content]) => ({
			upstreamPath,
			imported: content !== null,
			...(content !== null ? { slug: slugOfPage(upstreamPath) } : {}),
			upstreamUrl: upstreamUrlOf(SITE_URL, upstreamPath),
		})),
		{ siteUrl: SITE_URL, publicFiles: new Set(publicFiles), aliases: {} }
	);
	const assets = new FixtureAssets(publicFiles, options.excludedAssets ?? {});
	const all = new Map<string, ConvertedPage>();
	for (const [upstreamPath, content] of Object.entries(pages)) {
		if (content === null) continue;
		all.set(
			upstreamPath,
			convertPage({
				upstreamPath,
				repoPath: `docs/${upstreamPath}`,
				source: content,
				upstreamUrl: upstreamUrlOf(SITE_URL, upstreamPath),
				siteUrl: SITE_URL,
				pageIndex: index,
				assets,
				isTutorial: upstreamPath.startsWith('tutorial/'),
			})
		);
	}
	finalizeLinks(all, (upstreamPath) => (pages[upstreamPath] !== null && pages[upstreamPath] !== undefined ? slugOfPage(upstreamPath) : undefined));
	const page = all.get(path)!;
	const mdx = serializePage(page, { title: page.title });
	const body = mdx.replace(/^---\n[\s\S]*?\n---\n/, '');
	return { mdx, body, page, issues: page.issues.issues, all };
}

/** Throws when the MDX body does not compile. */
export async function assertCompiles(body: string): Promise<void> {
	await compile(body);
}

export function issueCodes(issues: readonly Issue[]): string[] {
	return issues.map((issue) => issue.code);
}
