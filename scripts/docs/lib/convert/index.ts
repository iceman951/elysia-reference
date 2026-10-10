/**
 * Converts one upstream VitePress page into Starlight MDX.
 *
 *   frontmatter ─┐
 *   body ── preprocess ── remark parse ── stitch ── transform ── headings ── (links) ── serialize
 *
 * Conversion happens in two phases because anchor links depend on the heading IDs
 * of *other* pages: `convertPage()` builds every page tree, then `finalizeLinks()`
 * resolves links across pages, and `serializePage()` renders the MDX.
 */
import type { Heading, Root, RootContent } from 'mdast';
import { directiveToMarkdown } from 'mdast-util-directive';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { mdxToMarkdown } from 'mdast-util-mdx';
import type { MdxjsEsm } from 'mdast-util-mdx';
import { toMarkdown } from 'mdast-util-to-markdown';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { IssueCollector } from '../issues.ts';
import { AstroSlugger, VitepressSlugger } from '../slug.ts';
import { hasChildren, paragraph } from './ast.ts';
import { localUrlOf, type AnchorMap, type PageIndex } from './links.ts';
import { preprocess } from './preprocess.ts';
import { stitch } from './stitch.ts';
import {
	astroHeadingText,
	sourceLine,
	transformRoot,
	vitepressHeadingText,
	type AssetResolver,
	type PageContext,
	type ReleaseInfo,
} from './transform.ts';

export interface UpstreamFrontmatter {
	title?: string;
	description?: string;
	search?: boolean;
	editLink?: boolean;
	layout?: unknown;
	sidebar?: unknown;
	head?: unknown;
	[key: string]: unknown;
}

export interface ConvertInput {
	/** Path relative to the upstream docs dir, e.g. `essential/route.md`. */
	upstreamPath: string;
	/** Repository-relative path, e.g. `docs/essential/route.md` (used in issues). */
	repoPath: string;
	source: string;
	upstreamUrl: string;
	siteUrl: string;
	pageIndex: PageIndex;
	assets: AssetResolver;
	isTutorial: boolean;
}

export interface ConvertedPage {
	upstreamPath: string;
	repoPath: string;
	upstreamUrl: string;
	frontmatter: UpstreamFrontmatter;
	title: string;
	description: string | undefined;
	root: Root;
	ctx: PageContext;
	anchors: AnchorMap;
	release: ReleaseInfo | undefined;
	issues: IssueCollector;
}

const TITLE_SUFFIXES = [/\s+-\s+ElysiaJS(\s+Internal)?$/i, /\s+-\s+Elysia Tutorial$/i, /\s+\|\s+ElysiaJS$/i];

export function splitFrontmatter(source: string): { data: UpstreamFrontmatter; body: string; bodyStartLine: number } {
	const normalized = source.replace(/\r\n?/g, '\n');
	const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
	if (!match) return { data: {}, body: normalized, bodyStartLine: 1 };
	const yamlSource = match[1]!;
	const parsed = (parseYaml(yamlSource) ?? {}) as UpstreamFrontmatter;
	const bodyStartLine = match[0].split('\n').length - (match[0].endsWith('\n') ? 1 : 0) + 1;
	return { data: parsed, body: normalized.slice(match[0].length), bodyStartLine };
}

/** Reads `<meta name="description">` from a VitePress `head` frontmatter array. */
export function descriptionFromHead(head: unknown): string | undefined {
	if (!Array.isArray(head)) return undefined;
	for (const entry of head) {
		if (!Array.isArray(entry) || entry[0] !== 'meta') continue;
		const attrs = entry[1] as Record<string, unknown> | undefined;
		if (attrs && attrs['name'] === 'description' && typeof attrs['content'] === 'string') {
			return attrs['content'].trim();
		}
	}
	return undefined;
}

function cleanTitle(title: string): string {
	let result = title.trim();
	for (const suffix of TITLE_SUFFIXES) result = result.replace(suffix, '');
	return result;
}

function walk(node: Root | RootContent, visit: (node: RootContent) => void): void {
	if (!hasChildren(node as Root)) return;
	for (const child of (node as Root).children as RootContent[]) {
		visit(child);
		walk(child, visit);
	}
}

/** Plain text of a heading without inline components (used for the page title). */
function headingTitleText(heading: Heading): string {
	return heading.children
		.map((child) => (child.type === 'mdxJsxTextElement' ? '' : astroHeadingText(child)))
		.join('')
		.replace(/\s+/g, ' ')
		.trim();
}

export function convertPage(input: ConvertInput): ConvertedPage {
	const issues = new IssueCollector(input.repoPath);
	const { data: frontmatter, body, bodyStartLine } = splitFrontmatter(input.source);

	const pre = preprocess(body, bodyStartLine);
	for (const block of pre.removed) {
		issues.info('vue-sfc-block-removed', `<${block.kind}> block removed (Vue single-file-component code, not documentation content).`, {
			line: block.line,
			source: block.source,
		});
	}
	for (const marker of pre.strayMarkers) {
		issues.warn('container-marker', `Container marker kept as text: ${marker.reason}.`, { line: marker.line, source: marker.source });
	}
	for (const repair of pre.repairs) {
		issues.warn('upstream-markup-repaired', `Malformed upstream markup repaired: ${repair.reason}.`, { line: repair.line, source: repair.source });
	}

	const root = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).parse(pre.markdown) as Root;
	stitch(root, { placeholders: pre.placeholders, lineMap: pre.lineMap, issues });

	// Upstream heading IDs, computed on the tree as VitePress sees it.
	const vpSlugger = new VitepressSlugger();
	walk(root, (node) => {
		if (node.type !== 'heading') return;
		node.data = { ...node.data, vpSlug: vpSlugger.slug(vitepressHeadingText(node)) } as Heading['data'];
	});

	const ctx: PageContext = {
		upstreamPath: input.upstreamPath,
		upstreamUrl: input.upstreamUrl,
		issues,
		pageIndex: input.pageIndex,
		assets: input.assets,
		links: [],
		imports: new Map(),
		release: undefined,
		tutorialDoc: undefined,
		isTutorial: input.isTutorial,
		stats: { twoslashBlocks: 0, twoslashQueries: 0, notationBlocks: 0, htmlComments: 0 },
		siteUrl: input.siteUrl,
		lineMap: pre.lineMap,
		scriptSource: pre.removed
			.filter((block) => block.kind === 'script')
			.map((block) => block.source)
			.join('\n'),
	};
	transformRoot(root, ctx);

	// Title: first top-level H1 (Starlight renders the title itself).
	let title: string | undefined;
	let titleSlug: string | undefined;
	const h1Index = root.children.findIndex((node) => node.type === 'heading' && node.depth === 1);
	if (h1Index >= 0) {
		const heading = root.children[h1Index] as Heading;
		title = headingTitleText(heading) || undefined;
		titleSlug = (heading.data as { vpSlug?: string } | undefined)?.vpSlug;
		const extras = heading.children.filter((child) => child.type === 'mdxJsxTextElement');
		root.children.splice(h1Index, 1, ...(extras.length > 0 ? [paragraph(extras)] : []));
	}
	if (!title) title = cleanTitle(String(ctx.release?.title ?? frontmatter.title ?? input.upstreamPath));

	walk(root, (node) => {
		if (node.type !== 'heading') return;
		if (node.depth === 1) {
			node.depth = 2;
			issues.warn('extra-h1', `Additional level-1 heading "${headingTitleText(node)}" demoted to level 2 (one H1 per page).`, {
				line: sourceLine(ctx, node),
			});
		}
		// `## Title <Badge/> <Other/>`: drop whitespace before trailing components so the
		// heading ID has no trailing dash (CSS provides the visual spacing).
		let index = node.children.length - 1;
		let trailingComponents = 0;
		while (index >= 0) {
			const child = node.children[index]!;
			if (child.type === 'mdxJsxTextElement') trailingComponents++;
			else if (!(child.type === 'text' && child.value.trim() === '')) break;
			index--;
		}
		if (trailingComponents > 0) {
			const run = node.children.slice(index + 1).filter((child) => child.type !== 'text');
			const lastText = node.children[index];
			if (lastText?.type === 'text') lastText.value = lastText.value.replace(/\s+$/, '');
			node.children = [...node.children.slice(0, index + 1), ...run];
		}
	});

	// Local heading IDs and the upstream → local mapping.
	const anchors: AnchorMap = { fromUpstream: new Map(), local: new Set(['_top']) };
	if (titleSlug) anchors.fromUpstream.set(titleSlug, '_top');
	const astroSlugger = new AstroSlugger();
	walk(root, (node) => {
		if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
			for (const attribute of node.attributes) {
				if (attribute.type === 'mdxJsxAttribute' && (attribute.name === 'id' || attribute.name === 'name') && typeof attribute.value === 'string') {
					anchors.local.add(attribute.value);
				}
			}
			return;
		}
		if (node.type !== 'heading') return;
		const slug = astroSlugger.slug(astroHeadingText(node));
		anchors.local.add(slug);
		const vpSlug = (node.data as { vpSlug?: string } | undefined)?.vpSlug;
		if (vpSlug && !anchors.fromUpstream.has(vpSlug)) anchors.fromUpstream.set(vpSlug, slug);
	});

	if (ctx.stats.twoslashBlocks > 0) {
		issues.info('twoslash-rendered-static', `${ctx.stats.twoslashBlocks} Twoslash code block(s) rendered as static code (${ctx.stats.twoslashQueries} type-query marker(s) removed; hover type information is not reproduced).`);
	}

	const description = descriptionFromHead(frontmatter.head) ?? (typeof frontmatter.description === 'string' ? frontmatter.description : undefined);

	return {
		upstreamPath: input.upstreamPath,
		repoPath: input.repoPath,
		upstreamUrl: input.upstreamUrl,
		frontmatter,
		title,
		description,
		root,
		ctx,
		anchors,
		release: ctx.release,
		issues,
	};
}

function mapAnchor(fragment: string, anchors: AnchorMap | undefined, page: ConvertedPage, original: string, line: number | undefined): string {
	if (!fragment) return '';
	let decoded = fragment;
	try {
		decoded = decodeURIComponent(fragment);
	} catch {
		// keep raw
	}
	if (!anchors) return fragment;
	const mapped = anchors.fromUpstream.get(decoded);
	if (mapped) return mapped;
	if (anchors.local.has(decoded)) return decoded;
	page.issues.warn('broken-anchor', `Anchor "#${decoded}" does not match any heading of the target page; kept unchanged.`, {
		...(line !== undefined ? { line } : {}),
		source: original,
	});
	return fragment;
}

/** Phase 2: resolves every registered link now that all heading IDs are known. */
export function finalizeLinks(pages: ReadonlyMap<string, ConvertedPage>, slugOf: (upstreamPath: string) => string | undefined): void {
	for (const page of pages.values()) {
		for (const ref of page.ctx.links) {
			const { target } = ref;
			const lineExtra = ref.line !== undefined ? { line: ref.line } : {};
			switch (target.kind) {
				case 'self': {
					const anchor = mapAnchor(target.fragment, page.anchors, page, ref.original, ref.line);
					ref.apply(anchor ? `#${anchor}` : '#');
					break;
				}
				case 'page': {
					const slug = target.page.imported ? slugOf(target.page.upstreamPath) : undefined;
					const targetPage = pages.get(target.page.upstreamPath);
					if (slug !== undefined && targetPage) {
						const anchor = mapAnchor(target.fragment, targetPage.anchors, page, ref.original, ref.line);
						ref.apply(`${localUrlOf(slug)}${target.query}${anchor ? `#${anchor}` : ''}`);
					} else {
						page.issues.info('link-to-upstream', `Link to a page that is not imported (${target.page.upstreamPath}) points to the official site.`, {
							...lineExtra,
							source: ref.original,
						});
						ref.apply(`${target.page.upstreamUrl}${target.query}${target.fragment ? `#${target.fragment}` : ''}`);
					}
					break;
				}
				case 'home':
					ref.apply(target.fragment ? `${page.ctx.siteUrl}/#${target.fragment}` : '/');
					break;
				case 'broken':
					page.issues.warn('broken-link', `Link target "${ref.original}" does not exist upstream; it points to the official site unchanged.`, {
						...lineExtra,
						source: ref.original,
					});
					ref.apply(`${target.url}${target.fragment ? `#${target.fragment}` : ''}`);
					break;
				default:
					break;
			}
		}
	}
}

export interface OutputFrontmatter {
	[key: string]: unknown;
}

const GENERATED_NOTICE = (repoPath: string) =>
	`/* Imported from elysiajs/documentation (${repoPath}) by \`pnpm docs:import\`. Do not edit this file: it is overwritten on the next upstream sync. See docs/CONTENT_PIPELINE.md. */`;

/**
 * MDX decodes character references inside JSX attribute strings, but the serializer
 * writes `&` verbatim, so a value such as `a &amp; b` would come back as `a & b`.
 * Encode every `&` that starts a character reference to keep values exact.
 */
function protectAttributeEntities(node: Root | RootContent): void {
	if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
		for (const attribute of node.attributes) {
			if (attribute.type === 'mdxJsxAttribute' && typeof attribute.value === 'string') {
				attribute.value = attribute.value.replace(/&(?=#?[A-Za-z0-9]+;)/g, '&amp;');
			}
		}
	}
	if ('children' in node && Array.isArray(node.children)) {
		for (const child of node.children as RootContent[]) protectAttributeEntities(child);
	}
}

export function serializePage(page: ConvertedPage, frontmatter: OutputFrontmatter): string {
	const byModule = new Map<string, string[]>();
	for (const [name, module] of [...page.ctx.imports.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		const list = byModule.get(module) ?? [];
		list.push(name);
		byModule.set(module, list);
	}
	const statements: string[] = [];
	for (const [module, names] of [...byModule.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		statements.push(
			module.endsWith('.astro') ? `import ${names[0]} from '${module}';` : `import { ${names.join(', ')} } from '${module}';`
		);
	}
	const imports: MdxjsEsm[] = statements.length > 0 ? [{ type: 'mdxjsEsm', value: statements.join('\n') }] : [];

	const root: Root = {
		type: 'root',
		children: [
			...imports,
			{ type: 'mdxFlowExpression', value: GENERATED_NOTICE(page.repoPath) },
			...structuredClone(page.root.children),
		] as Root['children'],
	};
	protectAttributeEntities(root);

	// Directive names start with a letter, so `:` only needs escaping before letters
	// (keeps `localhost:3000` readable instead of `localhost\:3000`).
	const directive = directiveToMarkdown();
	directive.unsafe = directive.unsafe?.map((pattern) =>
		pattern.character === ':' && pattern.after ? { ...pattern, after: '[A-Za-z]' } : pattern
	);

	const body = toMarkdown(root, {
		extensions: [gfmToMarkdown(), mdxToMarkdown(), directive],
		bullet: '-',
		emphasis: '*',
		strong: '*',
		fence: '`',
		fences: true,
		listItemIndent: 'one',
		resourceLink: true,
		rule: '-',
		tightDefinitions: true,
	});

	const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();
	return `---\n${yaml}\n---\n\n${body.trimEnd()}\n`;
}
