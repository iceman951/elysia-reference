/**
 * Stage 1 of the VitePress → Starlight conversion: a block-level pre-pass.
 *
 * VitePress (markdown-it + @mdit-vue/plugin-component) and CommonMark (remark)
 * disagree on a few block rules that matter for this corpus:
 *
 * - A line starting with an unknown/component tag (`<Tab …`, `<Playground`,
 *   `<template v-slot:x>`) starts an HTML block that runs until the next blank
 *   line and may interrupt a paragraph, even when the tag spans several lines.
 *   In CommonMark such a line only starts an HTML block if the complete tag is on
 *   that line, and it cannot interrupt a paragraph.
 * - `::: name` custom containers do not exist in CommonMark at all.
 * - `<script setup>` / `<style>` blocks are Vue SFC blocks, not content.
 *
 * This pass walks the lines (skipping fenced code and raw HTML blocks exactly like
 * markdown-it would) and replaces those constructs with single-line placeholder
 * tags that remark parses as standalone HTML nodes. Later stages substitute the
 * original source back. No content is modified by this pass.
 */

/** Block-level tags (CommonMark HTML block type 6), as listed by @mdit-vue/plugin-component. */
const TAGS_BLOCK = [
	'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col',
	'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
	'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr',
	'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol',
	'optgroup', 'option', 'p', 'param', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
	'th', 'thead', 'title', 'tr', 'track', 'ul',
];

const TAGS_INLINE = [
	'a', 'abbr', 'acronym', 'audio', 'b', 'bdi', 'bdo', 'big', 'br', 'button', 'canvas', 'cite', 'code',
	'data', 'datalist', 'del', 'dfn', 'em', 'embed', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label',
	'map', 'mark', 'meter', 'noscript', 'object', 'output', 'picture', 'progress', 'q', 'ruby', 's', 'samp',
	'script', 'select', 'slot', 'small', 'span', 'strong', 'sub', 'sup', 'svg', 'template', 'textarea',
	'time', 'u', 'tt', 'var', 'video', 'wbr',
];

const TAGS_VUE_RESERVED = ['template', 'component', 'transition', 'transition-group', 'keep-alive', 'slot', 'teleport'];

const FORCE_INLINE = TAGS_INLINE.filter((tag) => !TAGS_VUE_RESERVED.includes(tag));

const RE_BLOCK_TAG = new RegExp(`^</?(${TAGS_BLOCK.join('|')})(?=(\\s|/?>|$))`, 'i');
// Note: intentionally case-sensitive, like @mdit-vue (so `<Code>` is a component, `<code>` is inline).
const RE_COMPONENT_TAG = new RegExp(`^</?(?!(${FORCE_INLINE.join('|')})(?![\\w-]))[A-Za-z][A-Za-z0-9\\-]*(?=(\\s|/?>|$))`);

const ATTR_NAME = '[a-zA-Z_:@][a-zA-Z0-9:._-]*';
const ATTR_VALUE = `(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*")`;
const ATTRIBUTE = `(?:\\s+${ATTR_NAME}(?:\\s*=\\s*${ATTR_VALUE})?)`;
const RE_SELF_CLOSING_TAG = new RegExp(`^<[A-Za-z][A-Za-z0-9\\-]*${ATTRIBUTE}*\\s*\\/>`);
const RE_OPEN_AND_CLOSE_SAME_LINE = new RegExp(`^<([A-Za-z][A-Za-z0-9\\-]*)${ATTRIBUTE}*\\s*>.*<\\/\\1\\s*>`);
/** A complete opening or closing tag alone on its line (HTML block type 7; cannot interrupt a paragraph). */
const RE_COMPLETE_TAG_LINE = new RegExp(`^(?:<[A-Za-z][A-Za-z0-9\\-]*${ATTRIBUTE}*\\s*\\/?>|<\\/[A-Za-z][A-Za-z0-9\\-]*\\s*>)\\s*$`);
/** ATX headings and thematic breaks end a paragraph. */
const RE_SINGLE_LINE_BLOCK = /^(#{1,6}(\s|$)|([-*_])(\s*\3){2,}\s*$)/;

/** Containers registered by VitePress, plus `note` which upstream uses but VitePress does not define. */
export const KNOWN_CONTAINERS = new Set(['tip', 'info', 'warning', 'danger', 'details', 'code-group', 'raw', 'v-pre', 'note']);

export type Placeholder =
	| { id: number; kind: 'html'; source: string; line: number; trailingText: string }
	| { id: number; kind: 'container-open'; source: string; line: number; name: string; title: string; markerLength: number }
	| { id: number; kind: 'container-close'; source: string; line: number; openId: number };

export interface RemovedBlock {
	kind: 'script' | 'style';
	source: string;
	line: number;
}

export interface PreprocessResult {
	markdown: string;
	placeholders: Map<number, Placeholder>;
	removed: RemovedBlock[];
	/** Maps a 1-based line of `markdown` to the 1-based line of the original file. */
	lineMap: number[];
	/** Container markers that could not be interpreted, kept as literal text. */
	strayMarkers: { line: number; source: string; reason: string }[];
	/** Malformed upstream markup that was repaired (reported as warnings). */
	repairs: { line: number; source: string; reason: string }[];
}

export const PLACEHOLDER_RE = /^\s*<div data-vp-placeholder="(\d+)"><\/div>\s*$/;

function placeholderLine(indent: string, id: number): string {
	return `${indent}<div data-vp-placeholder="${id}"></div>`;
}

function indentWidth(line: string): number {
	let width = 0;
	for (const char of line) {
		if (char === ' ') width++;
		else if (char === '\t') width += 4 - (width % 4);
		else break;
	}
	return width;
}

interface Fence {
	char: '`' | '~';
	length: number;
}

function openFence(trimmed: string): Fence | undefined {
	const match = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
	if (!match) return undefined;
	const marker = match[1]!;
	const char = marker[0] as '`' | '~';
	if (char === '`' && match[2]!.includes('`')) return undefined;
	return { char, length: marker.length };
}

function closesFence(trimmed: string, fence: Fence): boolean {
	const match = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
	return !!match && match[1]![0] === fence.char && match[1]!.length >= fence.length;
}

/**
 * @param body Markdown without frontmatter.
 * @param firstLine 1-based line number of `body`'s first line in the original file.
 */
export function preprocess(body: string, firstLine: number): PreprocessResult {
	const lines = body.replace(/\r\n?/g, '\n').split('\n');
	const out: string[] = [];
	const lineMap: number[] = [];
	const placeholders = new Map<number, Placeholder>();
	const removed: RemovedBlock[] = [];
	const strayMarkers: PreprocessResult['strayMarkers'] = [];
	const repairs: PreprocessResult['repairs'] = [];
	const containerStack: { id: number; name: string; markerLength: number }[] = [];
	let nextId = 1;

	const emit = (text: string, original: number) => {
		out.push(text);
		lineMap.push(original);
	};
	const ensureBlank = (original: number) => {
		if (out.length > 0 && out[out.length - 1]!.trim() !== '') emit('', original);
	};
	const emitPlaceholder = (indent: string, id: number, original: number) => {
		ensureBlank(original);
		emit(placeholderLine(indent, id), original);
		emit('', original);
	};
	const closeContainer = (line: string, indent: string, original: number) => {
		const top = containerStack.pop()!;
		const id = nextId++;
		placeholders.set(id, { id, kind: 'container-close', source: line, line: original, openId: top.id });
		emitPlaceholder(indent, id, original);
	};

	let fence: Fence | undefined;
	let rawUntilBlank = false;
	let rawUntil: RegExp | undefined;
	/** True when the next line starts a new block (no open paragraph). */
	let atBoundary = true;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const original = firstLine + i;
		const indentSize = indentWidth(line);
		const trimmed = line.trimStart();

		if (fence) {
			emit(line, original);
			if (closesFence(trimmed, fence)) {
				fence = undefined;
				atBoundary = true;
			}
			continue;
		}
		if (rawUntil) {
			emit(line, original);
			if (rawUntil.test(line)) {
				rawUntil = undefined;
				atBoundary = true;
			}
			continue;
		}
		if (rawUntilBlank) {
			emit(line, original);
			if (trimmed === '') {
				rawUntilBlank = false;
				atBoundary = true;
			}
			continue;
		}
		if (trimmed === '') {
			emit(line, original);
			atBoundary = true;
			continue;
		}

		const newFence = openFence(trimmed);
		if (newFence) {
			fence = newFence;
			emit(line, original);
			continue;
		}

		if (indentSize >= 4 || (!trimmed.startsWith('<') && !trimmed.startsWith(':::'))) {
			emit(line, original);
			atBoundary = indentSize < 4 && RE_SINGLE_LINE_BLOCK.test(trimmed);
			continue;
		}

		const indent = line.slice(0, line.length - trimmed.length);

		// HTML comment: identical in CommonMark (type 2), kept as-is.
		if (trimmed.startsWith('<!--')) {
			emit(line, original);
			if (!trimmed.slice(4).includes('-->')) rawUntil = /-->/;
			else atBoundary = true;
			continue;
		}

		// <script> / <style>: Vue SFC blocks, removed and reported.
		const sfc = /^<(script|style)(?=[\s>]|$)/i.exec(trimmed);
		if (sfc) {
			const kind = sfc[1]!.toLowerCase() as 'script' | 'style';
			const closing = new RegExp(`</${kind}>`, 'i');
			const block: string[] = [line];
			let j = i;
			if (!closing.test(line)) {
				while (j + 1 < lines.length) {
					j++;
					block.push(lines[j]!);
					if (closing.test(lines[j]!)) break;
				}
			}
			removed.push({ kind, source: block.join('\n'), line: original });
			ensureBlank(original);
			atBoundary = true;
			i = j;
			continue;
		}

		if (/^<pre(?=[\s>]|$)/i.test(trimmed)) {
			emit(line, original);
			if (!/<\/pre>/i.test(line)) rawUntil = /<\/pre>/i;
			continue;
		}

		// Custom containers (may interrupt a paragraph, like markdown-it-container).
		const containerOpen = /^(:{3,})\s*([\w-]+)(.*)$/.exec(trimmed);
		if (containerOpen) {
			const name = containerOpen[2]!;
			const top = containerStack[containerStack.length - 1];
			if (name === 'code-group' && top?.name === 'code-group') {
				// Code groups cannot nest: upstream wrote the closing marker as "::: code-group".
				repairs.push({ line: original, source: line, reason: 'a second "::: code-group" inside an open code group was treated as its closing marker' });
				closeContainer(line, indent, original);
				atBoundary = true;
				continue;
			}
			if (KNOWN_CONTAINERS.has(name)) {
				const id = nextId++;
				placeholders.set(id, {
					id,
					kind: 'container-open',
					source: line,
					line: original,
					name,
					title: containerOpen[3]!.trim(),
					markerLength: containerOpen[1]!.length,
				});
				containerStack.push({ id, name, markerLength: containerOpen[1]!.length });
				emitPlaceholder(indent, id, original);
				atBoundary = true;
				continue;
			}
			strayMarkers.push({ line: original, source: line, reason: `unknown container type "${name}"` });
			emit(line, original);
			atBoundary = false;
			continue;
		}
		const containerClose = /^(:{3,})\s*$/.exec(trimmed);
		if (containerClose) {
			const top = containerStack[containerStack.length - 1];
			if (top && containerClose[1]!.length >= top.markerLength) {
				closeContainer(line, indent, original);
				atBoundary = true;
				continue;
			}
			strayMarkers.push({ line: original, source: line, reason: 'closing container marker without an open container' });
			emit(line, original);
			atBoundary = false;
			continue;
		}

		if (!trimmed.startsWith('<')) {
			emit(line, original);
			atBoundary = false;
			continue;
		}

		// Block-level HTML tags behave identically in CommonMark (type 6).
		if (RE_BLOCK_TAG.test(trimmed)) {
			emit(line, original);
			rawUntilBlank = true;
			continue;
		}

		// Vue components / unknown tags: VitePress-specific HTML block.
		if (RE_COMPONENT_TAG.test(trimmed)) {
			const single = RE_SELF_CLOSING_TAG.exec(trimmed) ?? RE_OPEN_AND_CLOSE_SAME_LINE.exec(trimmed);
			const id = nextId++;
			if (single) {
				placeholders.set(id, {
					id,
					kind: 'html',
					source: single[0],
					line: original,
					trailingText: trimmed.slice(single[0].length),
				});
				emitPlaceholder(indent, id, original);
				const rest = trimmed.slice(single[0].length).trim();
				if (rest) {
					emit(`${indent}${rest}`, original);
					emit('', original);
				}
				atBoundary = true;
				continue;
			}
			const block: string[] = [trimmed];
			let j = i;
			while (j + 1 < lines.length && lines[j + 1]!.trim() !== '') {
				j++;
				block.push(lines[j]!);
			}
			placeholders.set(id, { id, kind: 'html', source: block.join('\n'), line: original, trailingText: '' });
			emitPlaceholder(indent, id, original);
			atBoundary = true;
			i = j;
			continue;
		}

		// A complete inline tag alone on its line starts an HTML block (type 7), but only
		// when it does not continue a paragraph.
		if (atBoundary && RE_COMPLETE_TAG_LINE.test(trimmed)) {
			emit(line, original);
			rawUntilBlank = true;
			continue;
		}

		emit(line, original);
		atBoundary = false;
	}

	return { markdown: out.join('\n'), placeholders, removed, lineMap, strayMarkers, repairs };
}
