/**
 * Code block conversion.
 *
 * - VitePress fence info: ```ts twoslash [src/index.ts] {1,3}
 * - Expressive Code meta: ```ts title="src/index.ts" ins={2} del={1} {1,3}
 *
 * The visible code is preserved exactly as upstream readers see it: Twoslash
 * compiler directives, hidden setup code (`// ---cut---`) and query markers
 * (`// ^?`) are not displayed upstream, so they are removed; Shiki diff
 * notations (`// [!code ++]`) become Expressive Code `ins`/`del` line markers.
 */
import type { Code } from 'mdast';

export interface CodeInfo {
	lang: string | undefined;
	/** Text inside `[…]` (VitePress code-group tab label or file title). */
	label: string | undefined;
	twoslash: boolean;
	/** Line highlight ranges from `{1,3-5}`. */
	highlight: string | undefined;
	/** Meta tokens that have no equivalent here. */
	unknown: string[];
}

export function parseCodeInfo(lang: string | null | undefined, meta: string | null | undefined): CodeInfo {
	const info = `${lang ?? ''} ${meta ?? ''}`.trim();
	let rest = meta ?? '';
	let label: string | undefined;
	// VitePress extracts titles greedily: /\[(.*)\]/ (supports `[app/[[...slugs]]/route.ts]`).
	const labelMatch = /\[(.*)\]/.exec(info);
	if (labelMatch) {
		label = labelMatch[1]!.trim() || undefined;
		rest = rest.replace(labelMatch[0], ' ');
	}
	let highlight: string | undefined;
	const highlightMatch = /\{([\d,\s-]+)\}/.exec(rest);
	if (highlightMatch) {
		highlight = highlightMatch[1]!.replace(/\s+/g, '');
		rest = rest.replace(highlightMatch[0], ' ');
	}
	const tokens = rest.split(/\s+/).filter(Boolean);
	const twoslash = tokens.includes('twoslash');
	const unknown = tokens.filter((token) => token !== 'twoslash');
	let normalizedLang = lang ?? undefined;
	// `ts[title]` without a space puts the bracket into the language token.
	if (normalizedLang?.includes('[')) normalizedLang = normalizedLang.slice(0, normalizedLang.indexOf('[')) || undefined;
	return { lang: normalizedLang, label, twoslash, highlight, unknown };
}

export interface TwoslashResult {
	value: string;
	removedLines: number;
	queries: number;
}

const CUT_BEFORE = /^\s*\/\/\s*---cut(?:-before)?---\s*$/;
const CUT_AFTER = /^\s*\/\/\s*---cut-after---\s*$/;
const CUT_START = /^\s*\/\/\s*---cut-start---\s*$/;
const CUT_END = /^\s*\/\/\s*---cut-end---\s*$/;
/**
 * Compiler/handbook flags such as `// @noErrors`, `// @errors: 2322`, `// @strict: true`.
 * Not `// @ts-ignore` (a TypeScript pragma) and not `// @filename:` (Twoslash keeps
 * file markers visible when they are outside a cut region).
 */
const DIRECTIVE = /^\s*\/\/\s*@(?!ts-|filename\b)[A-Za-z][\w-]*(?::.*)?\s*$/;
/** `// ^?` (type query), `// ^|` (completions), `// ^^^` (highlight). */
const QUERY = /^\s*\/\/\s*\^(?:[?|]|\^*)(?:\s.*)?$/;

/** Removes Twoslash-only lines, reproducing what Twoslash renders. */
export function stripTwoslash(value: string): TwoslashResult {
	let lines = value.split('\n');
	const originalCount = lines.length;
	let queries = 0;

	let cutIndex = -1;
	lines.forEach((line, index) => {
		if (CUT_BEFORE.test(line)) cutIndex = index;
	});
	if (cutIndex >= 0) lines = lines.slice(cutIndex + 1);

	const cutAfter = lines.findIndex((line) => CUT_AFTER.test(line));
	if (cutAfter >= 0) lines = lines.slice(0, cutAfter);

	const kept: string[] = [];
	let hidden = false;
	for (const line of lines) {
		if (CUT_START.test(line)) {
			hidden = true;
			continue;
		}
		if (CUT_END.test(line)) {
			hidden = false;
			continue;
		}
		if (hidden) continue;
		if (DIRECTIVE.test(line)) continue;
		if (QUERY.test(line)) {
			queries++;
			continue;
		}
		kept.push(line);
	}
	while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop();
	return { value: kept.join('\n'), removedLines: originalCount - kept.length, queries };
}

export interface NotationResult {
	value: string;
	ins: number[];
	del: number[];
	mark: number[];
	/** Notations without an Expressive Code equivalent (`focus`, `error`, `warning`, `word`). */
	unsupported: string[];
}

const NOTATION = /\[!code\s+(\+\+|--|highlight|hl|focus|error|warning|word:[^\]]*)(?::(\d+))?\]/;
/** A comment that is empty once the notation is removed: `//`, `#`, `--`, `<!-- -->`, `/* *\/`, `{/* *\/}`. */
const EMPTY_COMMENT = /\s*(?:\/\/|#|--|<!--\s*-->|\{?\/\*\s*\*\/\}?)\s*$/;

/**
 * Applies Shiki notation transformers semantics (`matchAlgorithm: 'v3'`, the default
 * in Shiki 3+): the `[!code …]` marker is removed from its comment, and the comment
 * itself is removed when nothing else is left in it. A notation alone on its line
 * applies to the following line(s) and the empty line is removed.
 */
export function extractNotations(value: string): NotationResult {
	const source = value.split('\n');
	const lines: string[] = [];
	const ins = new Set<number>();
	const del = new Set<number>();
	const mark = new Set<number>();
	const unsupported: string[] = [];
	const pending: { kind: string; count: number }[] = [];

	const apply = (kind: string, lineNumber: number) => {
		if (kind === '++') ins.add(lineNumber);
		else if (kind === '--') del.add(lineNumber);
		else if (kind === 'highlight' || kind === 'hl') mark.add(lineNumber);
	};

	for (const raw of source) {
		const match = NOTATION.exec(raw);
		if (!match) {
			lines.push(raw);
			const lineNumber = lines.length;
			for (const entry of pending) {
				apply(entry.kind, lineNumber);
				entry.count--;
			}
			for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.count <= 0) pending.splice(i, 1);
			continue;
		}
		const kind = match[1]!;
		const count = match[2] ? Number(match[2]) : 1;
		if (!['++', '--', 'highlight', 'hl'].includes(kind)) unsupported.push(kind);
		let rest = `${raw.slice(0, match.index)}${raw.slice(match.index + match[0].length)}`;
		if (EMPTY_COMMENT.test(rest)) rest = rest.replace(EMPTY_COMMENT, '');
		else rest = rest.replace(/\s+$/, '');
		if (rest.trim() === '') {
			// Standalone notation line: applies to the next `count` lines.
			pending.push({ kind, count });
			continue;
		}
		lines.push(rest);
		const lineNumber = lines.length;
		apply(kind, lineNumber);
		if (count > 1) pending.push({ kind, count: count - 1 });
	}

	return {
		value: lines.join('\n'),
		ins: [...ins].sort((a, b) => a - b),
		del: [...del].sort((a, b) => a - b),
		mark: [...mark].sort((a, b) => a - b),
		unsupported,
	};
}

/** Formats `[1, 2, 3, 5]` as `1-3,5`. */
export function formatRanges(lines: readonly number[]): string {
	const parts: string[] = [];
	let start: number | undefined;
	let previous: number | undefined;
	for (const line of lines) {
		if (start === undefined) {
			start = previous = line;
			continue;
		}
		if (line === previous! + 1) {
			previous = line;
			continue;
		}
		parts.push(start === previous ? `${start}` : `${start}-${previous}`);
		start = previous = line;
	}
	if (start !== undefined) parts.push(start === previous ? `${start}` : `${start}-${previous}`);
	return parts.join(',');
}

function quoteMeta(value: string): string {
	if (!value.includes('"')) return `"${value}"`;
	if (!value.includes("'")) return `'${value}'`;
	return `"${value.replace(/"/g, "'")}"`;
}

export interface ConvertedCode {
	node: Code;
	label: string | undefined;
	twoslash: TwoslashResult | undefined;
	notations: NotationResult;
	info: CodeInfo;
}

/**
 * Converts a VitePress code node in place to Expressive Code conventions.
 * @param inGroup `true` inside a `::: code-group` (the label becomes the tab name, not a title).
 */
export function convertCode(node: Code, inGroup: boolean): ConvertedCode {
	const info = parseCodeInfo(node.lang, node.meta);
	let value = node.value;
	let twoslash: TwoslashResult | undefined;
	if (info.twoslash) {
		twoslash = stripTwoslash(value);
		value = twoslash.value;
	}
	const notations = extractNotations(value);
	value = notations.value;

	const meta: string[] = [];
	if (info.label && !inGroup) meta.push(`title=${quoteMeta(info.label)}`);
	if (notations.ins.length > 0) meta.push(`ins={${formatRanges(notations.ins)}}`);
	if (notations.del.length > 0) meta.push(`del={${formatRanges(notations.del)}}`);
	const marks = [...notations.mark];
	if (info.highlight) meta.push(`{${info.highlight}}`);
	if (marks.length > 0) meta.push(`mark={${formatRanges(marks)}}`);

	node.lang = info.lang ?? null;
	node.meta = meta.length > 0 ? meta.join(' ') : null;
	node.value = value;
	return { node, label: info.label, twoslash, notations, info };
}
