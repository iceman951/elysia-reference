/**
 * Stage 3: component mapping and tree transformation.
 *
 * Turns the stitched tree (Markdown + `vpElement`/`vpContainer` nodes) into an
 * mdast tree that serializes to Starlight-compatible MDX:
 *
 * | Upstream (VitePress / Vue)            | Output                                   |
 * | ------------------------------------- | ---------------------------------------- |
 * | `::: tip/info/warning/danger/note`    | Starlight aside (`:::tip` …)             |
 * | `::: details`                         | `<details>` / `<summary>`                |
 * | `::: code-group`                      | `<Tabs>` / `<TabItem>` per code block    |
 * | `<Tab :names :tabs>` + `<template>`   | `<Tabs syncKey>` / `<TabItem>`           |
 * | `<Deck>` / `<Card>`                   | `<CardGrid>` / `<LinkCard>`              |
 * | `<Badge type text>`                   | Starlight `<Badge variant text>`         |
 * | `<DocLink href>`                      | Markdown link                            |
 * | `<Playground>`, `<Chart>`, …          | `<InteractiveNotice>` + preserved source |
 * | `<Editor>` (tutorial)                 | `<TutorialNotice>`, answer in `<details>`|
 * | `<Blog>` (release layout)             | unwrapped, metadata → frontmatter        |
 * | HTML elements                         | JSX elements                             |
 *
 * Every lossy step records an issue; nothing is dropped silently.
 */
import type {
	Code,
	Emphasis,
	Heading,
	Image,
	Link,
	PhrasingContent,
	Root,
	RootContent,
	Table,
	TableCell,
} from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import type { MdxFlowExpression, MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx';
import { asStringArray, extractVariableLiteral, isRecord, parseLiteral, type LiteralValue } from '../literal.ts';
import { escapeHtml, getAttribute, hasAttribute, VOID_ELEMENTS } from '../html.ts';
import type { IssueCollector } from '../issues.ts';
import {
	collapseWhitespace,
	jsxAttribute,
	jsxFlow,
	jsxText,
	paragraph,
	text,
	toPlainText,
	type VpContainer,
	type VpElement,
} from './ast.ts';
import { convertCode } from './code.ts';
import type { LinkRef, LinkTarget, PageIndex } from './links.ts';

export type AssetResolution =
	| { kind: 'mirrored'; url: string; width?: number; height?: number }
	| { kind: 'excluded'; upstreamUrl: string; reason: string }
	| { kind: 'missing'; upstreamUrl: string };

export interface AssetResolver {
	/** @param publicPath Path relative to the upstream public directory, e.g. `assets/x.webp`. */
	resolve(publicPath: string, usage: { decorative?: boolean }): AssetResolution;
}

export interface ReleaseInfo {
	title?: string;
	author?: string;
	date?: string;
	cover?: string;
}

export interface TransformStats {
	twoslashBlocks: number;
	twoslashQueries: number;
	notationBlocks: number;
	htmlComments: number;
}

export interface PageContext {
	/** Path relative to the upstream docs dir, e.g. `essential/route.md`. */
	upstreamPath: string;
	upstreamUrl: string;
	issues: IssueCollector;
	pageIndex: PageIndex;
	assets: AssetResolver;
	links: LinkRef[];
	/** Component name → module specifier. */
	imports: Map<string, string>;
	release: ReleaseInfo | undefined;
	tutorialDoc: LinkTarget | undefined;
	isTutorial: boolean;
	stats: TransformStats;
	siteUrl: string;
	/** Source of the page's removed `<script setup>` blocks (read, never executed). */
	scriptSource: string;
	/** Maps a line of the pre-processed Markdown to the upstream file's line. */
	lineMap: readonly number[];
}

/** Upstream line of an mdast node (positions refer to the pre-processed Markdown). */
export function sourceLine(ctx: Pick<PageContext, 'lineMap'>, node: { position?: { start: { line: number } } | undefined }): number | undefined {
	const line = node.position?.start.line;
	return line === undefined ? undefined : (ctx.lineMap[line - 1] ?? line);
}

const STARLIGHT = '@astrojs/starlight/components';
const LOCAL = '@components/imported';

const COMPONENT_MODULES: Record<string, string> = {
	Tabs: STARLIGHT,
	TabItem: STARLIGHT,
	CardGrid: STARLIGHT,
	LinkCard: STARLIGHT,
	Badge: STARLIGHT,
	Icon: STARLIGHT,
	InteractiveNotice: `${LOCAL}/InteractiveNotice.astro`,
	TutorialNotice: `${LOCAL}/TutorialNotice.astro`,
	TutorialBadge: `${LOCAL}/TutorialBadge.astro`,
};

function useComponent(ctx: PageContext, name: keyof typeof COMPONENT_MODULES): void {
	ctx.imports.set(name, COMPONENT_MODULES[name]!);
}

/** Inline-level HTML elements; everything else is treated as a block. */
const INLINE_HTML = new Set([
	'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'img', 'ins',
	'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);

const BLOCK_HTML = new Set([
	'address', 'article', 'aside', 'blockquote', 'caption', 'center', 'col', 'colgroup', 'dd', 'details',
	'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
	'li', 'main', 'nav', 'ol', 'p', 'picture', 'pre', 'section', 'source', 'summary', 'table', 'tbody',
	'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'video', 'audio', 'track', 'iframe',
]);

/** Components that render inline in the output. */
const INLINE_COMPONENTS = new Set(['DocLink', 'Badge', 'TutorialBadge', 'Cog', 'Bookmark', 'Code']);

const INTERACTIVE_COMPONENTS: Record<string, string> = {
	Playground: 'interactive example',
	Chart: 'interactive chart',
	Benchmark: 'interactive benchmark chart',
	JIT: 'interactive visualization',
	Preview: 'interactive preview',
	Ray: 'decorative animation',
};

const ASIDE_VARIANTS: Record<string, string> = {
	tip: 'tip',
	info: 'note',
	note: 'note',
	warning: 'caution',
	danger: 'danger',
};

const BADGE_VARIANTS: Record<string, string> = {
	info: 'note',
	tip: 'tip',
	warning: 'caution',
	danger: 'danger',
};

const PACKAGE_MANAGERS = new Set(['bun', 'npm', 'pnpm', 'yarn', 'deno']);

function isWhitespaceText(node: RootContent): boolean {
	return (node.type === 'vpText' || node.type === 'text') && node.value.trim() === '';
}

function isInlineLevel(node: RootContent): boolean {
	if (node.type === 'vpElement') {
		if (INLINE_COMPONENTS.has(node.name)) return true;
		const lower = node.name.toLowerCase();
		if (INLINE_HTML.has(lower)) return true;
		return isAccidentalTag(node);
	}
	return [
		'text', 'vpText', 'emphasis', 'strong', 'delete', 'inlineCode', 'break', 'link', 'linkReference',
		'image', 'imageReference', 'footnoteReference', 'html', 'vpComment',
	].includes(node.type);
}

/** Tags that are neither known HTML nor a supported component (e.g. `Array<string>` typed in prose). */
function isAccidentalTag(node: VpElement): boolean {
	const lower = node.name.toLowerCase();
	if (INLINE_HTML.has(lower) || BLOCK_HTML.has(lower) || lower === 'template') return false;
	return !(node.name in HANDLERS);
}

/** Wraps an MDX comment around upstream source that cannot be rendered. */
function sourceComment(label: string, source: string): MdxFlowExpression {
	let body = source.replace(/\*\//g, '*\\/').trim();
	let balance = 0;
	let balanced = true;
	for (const char of body) {
		if (char === '{') balance++;
		else if (char === '}') balance--;
		if (balance < 0) balanced = false;
	}
	if (!balanced || balance !== 0) body = '(source omitted: unbalanced braces; see reports/migration-report.json)';
	const indented = body.includes('\n') ? `\n${body}\n` : ` ${body} `;
	return { type: 'mdxFlowExpression', value: `/* upstream ${label}:${indented}*/` };
}

function literalAttribute(element: VpElement, name: string): ReturnType<typeof parseLiteral> | undefined {
	const bound = getAttribute(element.attributes, `:${name}`) ?? getAttribute(element.attributes, `v-bind:${name}`);
	if (typeof bound === 'string') return parseLiteral(bound);
	const plain = getAttribute(element.attributes, name);
	if (typeof plain === 'string') return plain;
	return undefined;
}

function stringAttribute(element: VpElement, name: string): string | undefined {
	const value = getAttribute(element.attributes, name);
	return typeof value === 'string' ? value : undefined;
}

function slotName(element: VpElement): string | undefined {
	for (const attribute of element.attributes) {
		if (attribute.name.startsWith('v-slot:')) return attribute.name.slice('v-slot:'.length);
		if (attribute.name.startsWith('#')) return attribute.name.slice(1);
		if (attribute.name === 'v-slot' || attribute.name === 'slot') return attribute.value ?? 'default';
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Links and assets
// ---------------------------------------------------------------------------

function registerLink(ctx: PageContext, href: string, line: number | undefined, apply: (url: string) => void): void {
	const target = ctx.pageIndex.resolve(href, ctx.upstreamPath);
	if (!target) {
		apply(href);
		return;
	}
	if (target.kind === 'external') {
		apply(target.url);
		return;
	}
	if (target.kind === 'asset') {
		const resolution = ctx.assets.resolve(target.publicPath, {});
		if (resolution.kind === 'mirrored') apply(resolution.url);
		else {
			apply(resolution.upstreamUrl);
			if (resolution.kind === 'missing') {
				ctx.issues.warn('missing-asset', `Linked file "/${target.publicPath}" does not exist upstream.`, { line, source: href });
			}
		}
		return;
	}
	ctx.links.push({ original: href, target, line, apply });
}

/** Resolves a media `src`/`poster` value: mirrored URL, official-site URL, or unchanged (external). */
function resolveMediaSource(ctx: PageContext, src: string, element: VpElement): string {
	const target = ctx.pageIndex.resolve(src, ctx.upstreamPath);
	if (!target || target.kind === 'external') return src;
	if (target.kind === 'asset') {
		const resolution = ctx.assets.resolve(target.publicPath, {});
		if (resolution.kind === 'mirrored') return resolution.url;
		ctx.issues.warn(
			resolution.kind === 'excluded' ? 'asset-not-mirrored' : 'missing-asset',
			resolution.kind === 'excluded'
				? `Media "/${target.publicPath}" is not mirrored (${resolution.reason}); it is loaded from the official site.`
				: `Media "/${target.publicPath}" does not exist upstream.`,
			{ line: element.line, source: src }
		);
		return resolution.upstreamUrl;
	}
	const url = target.kind === 'broken' ? target.url : target.kind === 'page' ? target.page.upstreamUrl : src;
	ctx.issues.warn('missing-asset', `Media "${src}" does not exist upstream.`, { line: element.line, source: src });
	return url;
}

function unavailableAssetNotice(label: string, url: string, alt: string): Emphasis {
	const link: Link = { type: 'link', url, children: [text(alt || url.split('/').pop() || url)] };
	return { type: 'emphasis', children: [text(`${label}: `), link] };
}

/** Converts an image source; returns the attributes for a mirrored image or a replacement node. */
function resolveImage(
	ctx: PageContext,
	src: string,
	alt: string,
	line: number | undefined
): { attributes: Record<string, string> } | { replacement: PhrasingContent } {
	if (/^https?:\/\//i.test(src) && !/^https?:\/\/(www\.)?elysiajs\.com\//i.test(src)) {
		return { attributes: { src } };
	}
	const target = ctx.pageIndex.resolve(src, ctx.upstreamPath);
	if (!target || target.kind === 'external') return { attributes: { src } };
	if (target.kind !== 'asset') {
		const url = target.kind === 'broken' ? target.url : src;
		ctx.issues.warn('missing-asset', `Image "${src}" does not exist upstream.`, { line, source: src });
		return { replacement: unavailableAssetNotice('Image unavailable', url, alt) };
	}
	const resolution = ctx.assets.resolve(target.publicPath, {});
	if (resolution.kind === 'mirrored') {
		const attributes: Record<string, string> = { src: resolution.url };
		if (resolution.width && resolution.height) {
			attributes['width'] = String(resolution.width);
			attributes['height'] = String(resolution.height);
		}
		return { attributes };
	}
	if (resolution.kind === 'excluded') {
		ctx.issues.warn('asset-not-mirrored', `Image "/${target.publicPath}" is not mirrored (${resolution.reason}); replaced with a link to the official site.`, {
			line,
			source: src,
		});
		return { replacement: unavailableAssetNotice('Image (hosted on elysiajs.com)', resolution.upstreamUrl, alt) };
	}
	ctx.issues.warn('missing-asset', `Image "/${target.publicPath}" does not exist upstream.`, { line, source: src });
	return { replacement: unavailableAssetNotice('Image unavailable', resolution.upstreamUrl, alt) };
}

function imageElement(attributes: Record<string, string>, alt: string, title: string | undefined): MdxJsxTextElement {
	const ordered: Record<string, string | undefined> = {
		src: attributes['src'],
		alt,
		title,
		width: attributes['width'],
		height: attributes['height'],
		loading: 'lazy',
		decoding: 'async',
	};
	for (const [key, value] of Object.entries(attributes)) if (!(key in ordered)) ordered[key] = value;
	return jsxText('img', ordered);
}

// ---------------------------------------------------------------------------
// Tree walking
// ---------------------------------------------------------------------------

export function transformRoot(root: Root, ctx: PageContext): void {
	root.children = transformFlow(root.children, ctx) as Root['children'];
}

export function transformFlow(nodes: readonly RootContent[], ctx: PageContext): RootContent[] {
	const out: RootContent[] = [];
	let run: RootContent[] = [];
	const flush = () => {
		if (run.some((node) => !isWhitespaceText(node) && node.type !== 'vpComment')) {
			const children = trimInline(transformPhrasing(run, ctx, true));
			if (children.length > 0) out.push(paragraph(children));
		} else {
			for (const node of run) if (node.type === 'vpComment') recordComment(node.value, node.line, ctx);
		}
		run = [];
	};
	for (const node of nodes) {
		if (isInlineLevel(node)) {
			run.push(node);
			continue;
		}
		flush();
		out.push(...transformFlowNode(node, ctx));
	}
	flush();
	return out;
}

function recordComment(value: string, line: number | undefined, ctx: PageContext): void {
	ctx.stats.htmlComments++;
	ctx.issues.info('html-comment-removed', 'HTML comment removed (not rendered upstream).', {
		...(line !== undefined ? { line } : {}),
		source: `<!--${value}-->`,
	});
}

function transformFlowNode(node: RootContent, ctx: PageContext): RootContent[] {
	switch (node.type) {
		case 'vpContainer':
			return convertContainer(node, ctx);
		case 'vpElement':
			return convertElement(node, ctx, 'flow');
		case 'vpComment':
			recordComment(node.value, node.line, ctx);
			return [];
		case 'code':
			return [processCode(node, ctx, false).node];
		case 'heading':
			node.children = transformPhrasing(node.children, ctx, false) as Heading['children'];
			return [node];
		case 'paragraph': {
			const children = transformPhrasing(node.children, ctx, false);
			if (children.length === 0) return [];
			// A paragraph that only held a block-level replacement (e.g. a notice) is unwrapped.
			if (children.every((child) => (child as RootContent).type === 'mdxJsxFlowElement')) return children as RootContent[];
			node.children = children;
			// MDX unwraps paragraphs that contain nothing but JSX, but upstream renders such a
			// paragraph of inline HTML (e.g. `<small id="ref-1">…</small>`) inside a <p>.
			const meaningful = children.filter((child) => !(child.type === 'text' && child.value.trim() === ''));
			if (meaningful.every((child) => child.type === 'mdxJsxTextElement' && /^[a-z]/.test(child.name ?? ''))) {
				return [jsxFlow('p', {}, [node])];
			}
			return [node];
		}
		case 'blockquote':
			node.children = transformFlow(node.children, ctx) as typeof node.children;
			return [node];
		case 'list':
			for (const item of node.children) item.children = transformFlow(item.children, ctx) as typeof item.children;
			return [node];
		case 'listItem':
			node.children = transformFlow(node.children, ctx) as typeof node.children;
			return [node];
		case 'table':
			for (const row of node.children) {
				for (const cell of row.children) cell.children = transformPhrasing(cell.children, ctx, false) as typeof cell.children;
			}
			return [node];
		case 'footnoteDefinition':
			node.children = transformFlow(node.children, ctx) as typeof node.children;
			return [node];
		case 'definition': {
			const definition = node;
			registerLink(ctx, definition.url, sourceLine(ctx, node), (url) => {
				definition.url = url;
			});
			return [node];
		}
		case 'html':
			ctx.issues.warn('raw-html', 'Unprocessed raw HTML was kept as text.', { source: node.value });
			return [paragraph([text(node.value)])];
		default:
			return [node];
	}
}

export function transformPhrasing(nodes: readonly RootContent[], ctx: PageContext, fromRawHtml: boolean): PhrasingContent[] {
	const out: PhrasingContent[] = [];
	for (const node of nodes) {
		switch (node.type) {
			case 'vpText':
				out.push(text(fromRawHtml ? collapseWhitespace(node.value) : node.value.replace(/\s*\n\s*/g, ' ')));
				break;
			case 'vpComment':
				recordComment(node.value, node.line, ctx);
				break;
			case 'vpElement':
				out.push(...(convertElement(node, ctx, 'phrasing') as PhrasingContent[]));
				break;
			case 'link': {
				const link = node;
				link.children = transformPhrasing(link.children, ctx, false) as Link['children'];
				registerLink(ctx, link.url, sourceLine(ctx, node), (url) => {
					link.url = url;
				});
				out.push(link);
				break;
			}
			case 'image':
				out.push(convertImage(node, ctx));
				break;
			case 'emphasis':
			case 'strong':
			case 'delete':
			case 'linkReference':
				node.children = transformPhrasing(node.children, ctx, fromRawHtml) as typeof node.children;
				out.push(node);
				break;
			case 'html':
				ctx.issues.warn('raw-html', 'Unprocessed inline HTML was kept as text.', { source: node.value });
				out.push(text(node.value));
				break;
			default:
				if (isInlineLevel(node)) out.push(node as PhrasingContent);
				else {
					ctx.issues.warn('unexpected-block', `Block content (${node.type}) inside inline content was flattened to text.`);
					out.push(text(toPlainText(node)));
				}
		}
	}
	return out;
}

/** Trims leading/trailing whitespace of an inline run (HTML-style). */
function trimInline(children: PhrasingContent[]): PhrasingContent[] {
	const result = [...children];
	while (result.length > 0) {
		const first = result[0]!;
		if (first.type !== 'text') break;
		first.value = first.value.replace(/^\s+/, '');
		if (first.value === '') result.shift();
		else break;
	}
	while (result.length > 0) {
		const last = result[result.length - 1]!;
		if (last.type !== 'text') break;
		last.value = last.value.replace(/\s+$/, '');
		if (last.value === '') result.pop();
		else break;
	}
	return result;
}

function convertImage(node: Image, ctx: PageContext): PhrasingContent {
	const resolved = resolveImage(ctx, node.url, node.alt ?? '', sourceLine(ctx, node));
	if ('replacement' in resolved) return resolved.replacement;
	return imageElement(resolved.attributes, node.alt ?? '', node.title ?? undefined);
}

function processCode(node: Code, ctx: PageContext, inGroup: boolean) {
	const result = convertCode(node, inGroup);
	if (result.twoslash) {
		ctx.stats.twoslashBlocks++;
		ctx.stats.twoslashQueries += result.twoslash.queries;
	}
	if (result.notations.ins.length + result.notations.del.length + result.notations.mark.length > 0) ctx.stats.notationBlocks++;
	if (result.notations.unsupported.length > 0) {
		ctx.issues.warn('unsupported-code-notation', `Code notation(s) without an equivalent were removed: ${result.notations.unsupported.join(', ')}.`, {
			line: sourceLine(ctx, node),
		});
	}
	if (result.info.unknown.length > 0) {
		ctx.issues.info('code-meta-ignored', `Unsupported code fence options ignored: ${result.info.unknown.join(' ')}.`, {
			line: sourceLine(ctx, node),
		});
	}
	return result;
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

function convertContainer(container: VpContainer, ctx: PageContext): RootContent[] {
	const variant = ASIDE_VARIANTS[container.name];
	if (variant) {
		if (container.name === 'note') {
			ctx.issues.warn('container-note', 'Upstream uses "::: note", which VitePress does not define (it renders the markers as literal text). Converted to a note aside to match the evident intent.', {
				line: container.line,
				source: container.source,
			});
		}
		const children = transformFlow(container.children, ctx);
		const directive: ContainerDirective = { type: 'containerDirective', name: variant, attributes: {}, children: [] };
		if (container.title) {
			directive.children.push({ type: 'paragraph', data: { directiveLabel: true }, children: [text(container.title)] });
		}
		directive.children.push(...(children as ContainerDirective['children']));
		return [directive];
	}
	switch (container.name) {
		case 'details': {
			const summary = paragraph([jsxText('summary', {}, [text(container.title || 'Details')])]);
			return [jsxFlow('details', {}, [summary, ...(transformFlow(container.children, ctx) as MdxJsxFlowElement['children'])])];
		}
		case 'code-group':
			return convertCodeGroup(container, ctx);
		case 'raw':
		case 'v-pre':
			return transformFlow(container.children, ctx);
		default:
			ctx.issues.error('unknown-container', `Unknown container "::: ${container.name}" kept as plain content.`, {
				line: container.line,
				source: container.source,
			});
			return transformFlow(container.children, ctx);
	}
}

/**
 * `::: code-group` → `<Tabs>`. VitePress shows only the active code block, but any
 * other content inside the group stays visible below the blocks, so it is placed
 * after the tabs.
 */
function convertCodeGroup(container: VpContainer, ctx: PageContext): RootContent[] {
	const items: { label: string; children: RootContent[] }[] = [];
	const after: RootContent[] = [];
	for (const child of container.children) {
		if (child.type === 'code') {
			const result = processCode(child, ctx, true);
			const label = result.label ?? result.info.lang ?? 'txt';
			items.push({ label, children: [result.node] });
			continue;
		}
		if (child.type === 'vpComment') {
			recordComment(child.value, child.line, ctx);
			continue;
		}
		if (isWhitespaceText(child)) continue;
		after.push(child);
	}
	if (after.length > 0) {
		ctx.issues.info('code-group-content', 'Non-code content inside "::: code-group" is rendered after the tabs (it is always visible upstream as well).', {
			line: container.line,
		});
	}
	const result: RootContent[] = [];
	if (items.length > 0) {
		useComponent(ctx, 'Tabs');
		useComponent(ctx, 'TabItem');
		const labels = items.map((item) => item.label.toLowerCase());
		const syncKey = labels.every((label) => PACKAGE_MANAGERS.has(label)) ? 'package-manager' : undefined;
		result.push(
			jsxFlow(
				'Tabs',
				{ syncKey },
				items.map((item) => jsxFlow('TabItem', { label: item.label }, item.children as MdxJsxFlowElement['children']))
			)
		);
	}
	result.push(...transformFlow(after, ctx));
	return result;
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

type Mode = 'flow' | 'phrasing';
type Handler = (element: VpElement, ctx: PageContext, mode: Mode) => RootContent[];

function convertElement(element: VpElement, ctx: PageContext, mode: Mode): RootContent[] {
	const handler = HANDLERS[element.name];
	if (handler) return handler(element, ctx, mode);
	const lower = element.name.toLowerCase();
	if (INLINE_HTML.has(lower) || BLOCK_HTML.has(lower)) return convertHtmlElement(element, ctx, mode);
	if (lower === 'template') {
		ctx.issues.warn('orphan-template', '<template> outside a supported component was unwrapped.', {
			line: element.line,
			source: element.source,
		});
		return mode === 'flow' ? transformFlow(element.children, ctx) : transformPhrasing(element.children, ctx, true);
	}
	return convertAccidentalTag(element, ctx, mode);
}

/** Unknown tags are restored as literal text (the author evidently meant e.g. `Array<string>`). */
function convertAccidentalTag(element: VpElement, ctx: PageContext, mode: Mode): RootContent[] {
	ctx.issues.warn('unknown-tag', `Unknown tag <${element.name}> is not a supported component; kept as literal text.`, {
		line: element.line,
		source: element.source,
	});
	const nodes: RootContent[] = [text(element.source), ...element.children];
	if (element.closed && !element.selfClosing) nodes.push(text(`</${element.name}>`));
	return mode === 'flow' ? transformFlow(nodes, ctx) : transformPhrasing(nodes, ctx, true);
}

function wrapInline(nodes: PhrasingContent[], mode: Mode): RootContent[] {
	return mode === 'flow' ? (nodes.length > 0 ? [paragraph(nodes)] : []) : nodes;
}

function convertAttributes(element: VpElement, ctx: PageContext): MdxJsxAttribute[] {
	const out: MdxJsxAttribute[] = [];
	for (const attribute of element.attributes) {
		const { name, value } = attribute;
		if (/^(:|v-|@|#)/.test(name)) {
			ctx.issues.warn('vue-binding-removed', `Vue binding "${name}" on <${element.name}> has no static equivalent and was removed.`, {
				line: element.line,
				source: element.source,
			});
			continue;
		}
		if (/^on/i.test(name) || !/^[A-Za-z_][\w.:-]*$/.test(name)) {
			ctx.issues.warn('attribute-removed', `Attribute "${name}" on <${element.name}> was removed.`, {
				line: element.line,
				source: element.source,
			});
			continue;
		}
		const jsx = jsxAttribute(name, value);
		if (value !== null && name === 'href') {
			registerLink(ctx, value, element.line, (url) => {
				jsx.value = url;
			});
		}
		if (value !== null && (name === 'src' || name === 'poster') && element.name.toLowerCase() !== 'img') {
			jsx.value = resolveMediaSource(ctx, value, element);
		}
		out.push(jsx);
	}
	return out;
}

function convertHtmlElement(element: VpElement, ctx: PageContext, mode: Mode): RootContent[] {
	const name = element.name.toLowerCase();

	if (name === 'img') {
		const src = stringAttribute(element, 'src') ?? stringAttribute(element, ':src');
		const alt = stringAttribute(element, 'alt') ?? '';
		if (!src) {
			ctx.issues.warn('image-without-src', '<img> without a static src was removed.', { line: element.line, source: element.source });
			return [];
		}
		const resolved = resolveImage(ctx, src, alt, element.line);
		if ('replacement' in resolved) return wrapInline([resolved.replacement], mode);
		const extra: Record<string, string> = {};
		for (const attribute of convertAttributes(element, ctx)) {
			if (['src', 'alt'].includes(attribute.name) || typeof attribute.value !== 'string') continue;
			extra[attribute.name] = attribute.value;
		}
		const image = imageElement({ ...resolved.attributes, ...extra }, alt, stringAttribute(element, 'title'));
		if (mode === 'phrasing') return [image];
		return [{ ...image, type: 'mdxJsxFlowElement', children: [] } satisfies MdxJsxFlowElement];
	}

	if (name === 'iframe') {
		const src = stringAttribute(element, 'src') ?? '';
		ctx.issues.info('iframe-replaced', 'Third-party <iframe> embed replaced with a link (no third-party scripts on this site).', {
			line: element.line,
			source: element.source,
		});
		let host = src;
		try {
			host = new URL(src).hostname;
		} catch {
			// keep raw src
		}
		const link: Link = { type: 'link', url: src, children: [text(`Embedded content from ${host}`)] };
		return wrapInline([{ type: 'emphasis', children: [link] }], mode);
	}

	const attributes = convertAttributes(element, ctx);

	if (mode === 'phrasing') {
		const children = VOID_ELEMENTS.has(name) ? [] : transformPhrasing(element.children, ctx, true);
		return [{ type: 'mdxJsxTextElement', name, attributes, children }];
	}

	const meaningful = element.children.filter((child) => !isWhitespaceText(child) && child.type !== 'vpComment');
	if (VOID_ELEMENTS.has(name) || meaningful.length === 0) {
		for (const child of element.children) if (child.type === 'vpComment') recordComment(child.value, child.line, ctx);
		return [{ type: 'mdxJsxFlowElement', name, attributes, children: [] }];
	}
	if (meaningful.every(isInlineLevel)) {
		const children = trimInline(transformPhrasing(element.children, ctx, true));
		return [paragraph([{ type: 'mdxJsxTextElement', name, attributes, children }])];
	}
	return [
		{
			type: 'mdxJsxFlowElement',
			name,
			attributes,
			children: transformFlow(element.children, ctx) as MdxJsxFlowElement['children'],
		},
	];
}

// ---------------------------------------------------------------------------
// Component handlers
// ---------------------------------------------------------------------------

const HANDLERS: Record<string, Handler> = {
	Tab(element, ctx) {
		const names = asStringArray(literalAttribute(element, 'names') as never);
		const keys = asStringArray(literalAttribute(element, 'tabs') as never);
		const id = stringAttribute(element, 'id');
		if (!names || !keys || names.length !== keys.length) {
			ctx.issues.error('tab-unparsed', '<Tab> names/tabs bindings could not be read; its slots were unwrapped in source order.', {
				line: element.line,
				source: element.source,
			});
			return transformFlow(element.children, ctx);
		}
		const slots = new Map<string, VpElement>();
		for (const child of element.children) {
			if (child.type === 'vpElement' && child.name === 'template') {
				const slot = slotName(child);
				if (slot) {
					slots.set(slot, child);
					continue;
				}
			}
			if (isWhitespaceText(child)) continue;
			if (child.type === 'vpComment') {
				recordComment(child.value, child.line, ctx);
				continue;
			}
			ctx.issues.warn('tab-stray-content', 'Content outside <template v-slot:…> is not rendered by the upstream <Tab> component and was omitted.', {
				line: element.line,
				source: toPlainText(child).slice(0, 500),
			});
		}
		const items: MdxJsxFlowElement[] = [];
		keys.forEach((key, index) => {
			const slot = slots.get(key);
			if (!slot) {
				ctx.issues.warn('tab-missing-slot', `<Tab> declares tab "${key}" but has no matching <template v-slot:${key}>.`, {
					line: element.line,
				});
				return;
			}
			slots.delete(key);
			items.push(jsxFlow('TabItem', { label: names[index]! }, transformFlow(slot.children, ctx) as MdxJsxFlowElement['children']));
		});
		for (const [key, slot] of slots) {
			ctx.issues.warn('tab-unused-slot', `<template v-slot:${key}> is not listed in the <Tab> tabs and is not rendered upstream; omitted.`, {
				line: slot.line,
				source: slot.source,
			});
		}
		useComponent(ctx, 'Tabs');
		useComponent(ctx, 'TabItem');
		return [jsxFlow('Tabs', { syncKey: id }, items)];
	},

	Deck(element, ctx) {
		const cards: MdxJsxFlowElement[] = [];
		const rest: RootContent[] = [];
		for (const child of element.children) {
			if (child.type === 'vpElement' && child.name === 'Card') {
				cards.push(...(HANDLERS['Card']!(child, ctx, 'flow') as MdxJsxFlowElement[]));
			} else if (child.type === 'vpComment') {
				recordComment(child.value, child.line, ctx);
			} else if (!isWhitespaceText(child)) {
				rest.push(child);
			}
		}
		if (rest.length > 0) {
			ctx.issues.warn('deck-content', 'Non-card content inside <Deck> was placed after the card grid.', { line: element.line });
		}
		useComponent(ctx, 'CardGrid');
		return [jsxFlow('CardGrid', {}, cards), ...transformFlow(rest, ctx)];
	},

	Card(element, ctx, mode) {
		const title = stringAttribute(element, 'title') ?? '';
		const href = stringAttribute(element, 'href');
		const description = phrasingToHtml(element.children).trim();
		const card = jsxFlow('LinkCard', {
			title: escapeHtml(title),
			href: href ?? '#',
			description: description || undefined,
			download: hasAttribute(element.attributes, 'download') || hasAttribute(element.attributes, ':download') ? null : undefined,
		});
		if (href) {
			const hrefAttribute = card.attributes.find((attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'href');
			registerLink(ctx, href, element.line, (url) => {
				if (hrefAttribute) hrefAttribute.value = url;
			});
		}
		useComponent(ctx, 'LinkCard');
		if (mode === 'phrasing') {
			ctx.issues.warn('card-inline', '<Card> used inline was converted to a link.', { line: element.line });
			const link: Link = { type: 'link', url: href ?? '#', children: [text(title)] };
			if (href) registerLink(ctx, href, element.line, (url) => (link.url = url));
			return [link];
		}
		return [card];
	},

	DocLink(element, ctx, mode) {
		const href = stringAttribute(element, 'href') ?? '#';
		const link: Link = { type: 'link', url: href, children: transformPhrasing(element.children, ctx, true) as Link['children'] };
		registerLink(ctx, href, element.line, (url) => {
			link.url = url;
		});
		return wrapInline([link], mode);
	},

	Badge(element, ctx, mode) {
		const label = stringAttribute(element, 'text') ?? collapseWhitespace(toPlainText(element)).trim();
		const type = stringAttribute(element, 'type');
		useComponent(ctx, 'Badge');
		return wrapInline([jsxText('Badge', { text: label, variant: type ? (BADGE_VARIANTS[type] ?? 'default') : undefined })], mode);
	},

	TutorialBadge(element, ctx, mode) {
		const href = stringAttribute(element, 'href');
		if (!href) return [];
		const target = ctx.pageIndex.resolve(href, ctx.upstreamPath);
		const url = target?.kind === 'page' ? target.page.upstreamUrl : `${ctx.siteUrl}${href.startsWith('/') ? '' : '/'}${href}`;
		useComponent(ctx, 'TutorialBadge');
		return wrapInline([jsxText('TutorialBadge', { href: url })], mode);
	},

	TutorialLink(element, ctx) {
		ctx.issues.info('component-converted', 'Interactive tutorial banner converted to a link card to the official interactive tutorial.', {
			line: element.line,
			source: element.source,
		});
		useComponent(ctx, 'LinkCard');
		return [
			jsxFlow('LinkCard', {
				title: 'Interactive Tutorial',
				description: 'An interactive experience to learn Elysia with IDE, playground, and more.',
				href: `${ctx.siteUrl}/tutorial/`,
			}),
		];
	},

	AronaBanner(element, ctx) {
		ctx.issues.info('component-removed', '"Ask Elysia" AI assistant banner removed (a service of the official site).', {
			line: element.line,
			source: element.source,
		});
		return [];
	},

	Editor(element, ctx) {
		const doc = stringAttribute(element, 'doc');
		if (doc) ctx.tutorialDoc = ctx.pageIndex.resolve(doc, ctx.upstreamPath);
		const children: RootContent[] = [];
		for (const child of element.children) {
			if (child.type === 'vpElement' && child.name === 'template' && slotName(child) === 'answer') {
				const summary = paragraph([jsxText('summary', {}, [text('Show answer')])]);
				children.push(jsxFlow('details', {}, [summary, ...(transformFlow(child.children, ctx) as MdxJsxFlowElement['children'])]));
				continue;
			}
			children.push(...transformFlow([child], ctx));
		}
		ctx.issues.info('tutorial-static', 'Interactive tutorial page imported as text: the in-browser editor, starter code and test cases are only available on the official site.', {
			line: element.line,
			source: element.source,
		});
		useComponent(ctx, 'TutorialNotice');
		const notice = jsxFlow('TutorialNotice', { href: ctx.upstreamUrl, doc: undefined });
		if (ctx.tutorialDoc) {
			const docAttribute = jsxAttribute('doc', '');
			notice.attributes.push(docAttribute);
			ctx.links.push({
				original: doc ?? '',
				target: ctx.tutorialDoc,
				line: element.line,
				apply: (url) => {
					docAttribute.value = url;
				},
			});
		}
		return [notice, ...children];
	},

	Blog(element, ctx) {
		const release: ReleaseInfo = {};
		const title = stringAttribute(element, 'title');
		const author = stringAttribute(element, 'author');
		const date = stringAttribute(element, 'date');
		const src = stringAttribute(element, 'src');
		if (title) release.title = title;
		if (author) release.author = author;
		if (date) release.date = date;
		if (src) {
			release.cover = src;
			ctx.issues.info('release-cover-omitted', `Decorative cover artwork "${src}" is not mirrored or displayed.`, { line: element.line, source: element.source });
		}
		ctx.release = release;
		return transformFlow(element.children, ctx);
	},

	Cog(element, ctx, mode) {
		useComponent(ctx, 'Icon');
		ctx.issues.info('icon-converted', 'Lucide "Cog" icon replaced with the Starlight "setting" icon.', { line: element.line });
		return wrapInline([jsxText('Icon', { name: 'setting', label: 'Settings', class: 'sl-inline-icon' })], mode);
	},

	Bookmark(element, ctx, mode) {
		useComponent(ctx, 'Icon');
		ctx.issues.info('icon-converted', 'Lucide "Bookmark" icon replaced with the Starlight "open-book" icon.', { line: element.line });
		return wrapInline([jsxText('Icon', { name: 'open-book', label: 'Documentation', class: 'sl-inline-icon' })], mode);
	},

	Code(element, ctx, mode) {
		ctx.issues.info('icon-converted', 'Lucide "Code" icon replaced with the text "</>".', { line: element.line });
		return wrapInline([{ type: 'inlineCode', value: '</>' }], mode);
	},
};

for (const [name, label] of Object.entries(INTERACTIVE_COMPONENTS)) {
	HANDLERS[name] = (element, ctx, mode) => {
		ctx.issues.warn('interactive-component', `<${name}> (${label}) requires the official site's Vue runtime; replaced with a link to the original page. The original markup is preserved in an MDX comment.`, {
			line: element.line,
			source: element.source,
		});
		useComponent(ctx, 'InteractiveNotice');
		const nodes: RootContent[] = [sourceComment(`<${name}>`, element.source), jsxFlow('InteractiveNotice', { kind: label, href: ctx.upstreamUrl })];
		if (mode === 'phrasing') return [];
		return nodes;
	};
}

/**
 * `<Chart :items="data" unit="ms" :series="[a, b]" />` draws a bar chart from a
 * literal array declared in `<script setup>`. The numbers are content, so the
 * chart is rendered as a table with the values exactly as the chart labels them.
 */
const interactiveChart = HANDLERS['Chart']!;
HANDLERS['Chart'] = (element, ctx, mode) => {
	const binding = stringAttribute(element, ':items');
	let data: LiteralValue | undefined;
	if (binding && /^[A-Za-z_$][\w$]*$/.test(binding.trim())) data = extractVariableLiteral(ctx.scriptSource, binding.trim());
	else if (binding) data = parseLiteral(binding);
	const items = Array.isArray(data) ? data.filter(isRecord) : [];
	if (mode === 'phrasing' || items.length === 0 || items.some((item) => typeof item['label'] !== 'string' || typeof item['value'] !== 'number')) {
		return interactiveChart(element, ctx, mode);
	}
	const unit = stringAttribute(element, 'unit');
	const secondaryUnit = stringAttribute(element, 'secondaryUnit') ?? stringAttribute(element, 'secondary-unit');
	const series = asStringArray(literalAttribute(element, 'series') as never);
	const hasSecondary = items.some((item) => typeof item['secondaryValue'] === 'number');
	const format = (value: number, display: LiteralValue | undefined, suffix: string | undefined) =>
		typeof display === 'string' ? display : `${value.toLocaleString('en-US')} ${suffix ?? ''}`.trim();
	const cell = (children: PhrasingContent[]): TableCell => ({ type: 'tableCell', children });
	const emphasize = (highlight: boolean, children: PhrasingContent[]): PhrasingContent[] =>
		highlight ? [{ type: 'strong', children }] : children;

	const header = [cell([text('Name')]), cell([text(series?.[0] ?? 'Value')])];
	if (hasSecondary) header.push(cell([text(series?.[1] ?? 'Secondary value')]));
	const rows = items.map((item) => {
		const highlight = item['highlight'] === true;
		const label: PhrasingContent[] = [text(item['label'] as string)];
		if (typeof item['detail'] === 'string') label.push(text(' '), jsxText('sup', {}, [text(item['detail'])]));
		const cells = [
			cell(emphasize(highlight, label)),
			cell(emphasize(highlight, [text(format(item['value'] as number, item['display'], unit))])),
		];
		if (hasSecondary) {
			const secondary = item['secondaryValue'];
			cells.push(
				cell(typeof secondary === 'number' ? emphasize(highlight, [text(format(secondary, item['secondaryDisplay'], secondaryUnit ?? unit))]) : [])
			);
		}
		return { type: 'tableRow' as const, children: cells };
	});
	const table: Table = {
		type: 'table',
		align: hasSecondary ? [null, 'right', 'right'] : [null, 'right'],
		children: [{ type: 'tableRow', children: header }, ...rows],
	};
	ctx.issues.info('chart-as-table', `<Chart> rendered as a table from its literal data (${binding ?? 'inline'}); the bar graphics are not reproduced.`, {
		line: element.line,
		source: element.source,
	});
	return [table];
};

/** Renders inline content as an HTML string (for Starlight props rendered with `set:html`). */
function phrasingToHtml(nodes: readonly RootContent[]): string {
	return collapseWhitespace(nodes.map(nodeToHtml).join(''));
}

const FORMATTING_TAGS = new Set(['b', 'strong', 'i', 'em', 'code', 'small', 'sup', 'sub', 'u', 'mark', 'kbd', 's', 'del']);

function nodeToHtml(node: RootContent): string {
	switch (node.type) {
		case 'text':
		case 'vpText':
			return escapeHtml(node.value);
		case 'inlineCode':
			return `<code>${escapeHtml(node.value)}</code>`;
		case 'strong':
			return `<strong>${node.children.map(nodeToHtml).join('')}</strong>`;
		case 'emphasis':
			return `<em>${node.children.map(nodeToHtml).join('')}</em>`;
		case 'delete':
			return `<del>${node.children.map(nodeToHtml).join('')}</del>`;
		case 'break':
			return ' ';
		case 'paragraph':
			return `${node.children.map(nodeToHtml).join('')} `;
		case 'vpElement': {
			const name = node.name.toLowerCase();
			const inner = node.children.map(nodeToHtml).join('');
			if (name === 'br') return ' ';
			return FORMATTING_TAGS.has(name) ? `<${name}>${inner}</${name}>` : inner;
		}
		case 'vpComment':
			return '';
		default:
			return 'children' in node ? (node.children as RootContent[]).map(nodeToHtml).join('') : escapeHtml(toPlainText(node));
	}
}

/** Collected for headings: the text VitePress uses to compute a slug. */
export function vitepressHeadingText(node: RootContent): string {
	switch (node.type) {
		case 'text':
		case 'inlineCode':
		case 'vpText':
			return node.value;
		case 'image':
		case 'vpComment':
			return '';
		default:
			return 'children' in node ? (node.children as RootContent[]).map(vitepressHeadingText).join('') : '';
	}
}

/** Text content of a converted heading, as the Sätteri heading-ID plugin sees it. */
export function astroHeadingText(node: RootContent): string {
	switch (node.type) {
		case 'text':
		case 'inlineCode':
			return node.value;
		case 'image':
		case 'mdxJsxTextElement':
			return node.type === 'mdxJsxTextElement' ? node.children.map(astroHeadingText).join('') : '';
		default:
			return 'children' in node ? (node.children as RootContent[]).map(astroHeadingText).join('') : '';
	}
}

