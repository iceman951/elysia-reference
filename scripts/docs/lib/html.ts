import { parseEntities } from 'parse-entities';

/**
 * A lenient HTML tokenizer for the raw HTML / Vue template fragments found in
 * VitePress Markdown. Unlike a spec-compliant HTML parser it does not apply tree
 * construction rules (which would, for example, drop a `<tr>` outside a table),
 * and it accepts Vue attribute syntax (`:prop`, `@event`, `#slot`, `v-slot:name`).
 */

export interface HtmlAttribute {
	name: string;
	/** Entity-decoded value, or `null` for boolean attributes. */
	value: string | null;
}

export type HtmlToken =
	| { type: 'open'; name: string; attributes: HtmlAttribute[]; selfClosing: boolean; raw: string; start: number; end: number }
	| { type: 'close'; name: string; raw: string; start: number; end: number }
	| { type: 'text'; value: string; raw: string; start: number; end: number }
	| { type: 'comment'; value: string; raw: string; start: number; end: number };

export const VOID_ELEMENTS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);

const NAME_START = /[A-Za-z]/;
const NAME_CHAR = /[\w:.-]/;

export function decodeEntities(value: string): string {
	return value.includes('&') ? parseEntities(value) : value;
}

export function tokenizeHtml(src: string): HtmlToken[] {
	const tokens: HtmlToken[] = [];
	let textStart = 0;
	let i = 0;
	const n = src.length;

	const flushText = (end: number) => {
		if (end > textStart) {
			const raw = src.slice(textStart, end);
			tokens.push({ type: 'text', value: decodeEntities(raw), raw, start: textStart, end });
		}
	};

	while (i < n) {
		if (src[i] !== '<') {
			i++;
			continue;
		}
		if (src.startsWith('<!--', i)) {
			flushText(i);
			const close = src.indexOf('-->', i + 4);
			const end = close === -1 ? n : close + 3;
			const raw = src.slice(i, end);
			tokens.push({ type: 'comment', value: src.slice(i + 4, close === -1 ? n : close), raw, start: i, end });
			i = end;
			textStart = i;
			continue;
		}
		if (src[i + 1] === '/' && NAME_START.test(src[i + 2] ?? '')) {
			let j = i + 2;
			while (j < n && NAME_CHAR.test(src[j]!)) j++;
			const name = src.slice(i + 2, j);
			while (j < n && /\s/.test(src[j]!)) j++;
			if (src[j] === '>') {
				flushText(i);
				tokens.push({ type: 'close', name, raw: src.slice(i, j + 1), start: i, end: j + 1 });
				i = j + 1;
				textStart = i;
				continue;
			}
			i++;
			continue;
		}
		if (NAME_START.test(src[i + 1] ?? '')) {
			const parsed = parseOpenTag(src, i);
			if (parsed) {
				flushText(i);
				tokens.push(parsed);
				i = parsed.end;
				textStart = i;
				continue;
			}
		}
		i++;
	}
	flushText(n);
	return tokens;
}

function parseOpenTag(src: string, start: number): Extract<HtmlToken, { type: 'open' }> | undefined {
	const n = src.length;
	let j = start + 1;
	while (j < n && NAME_CHAR.test(src[j]!)) j++;
	const name = src.slice(start + 1, j);
	const attributes: HtmlAttribute[] = [];
	// A tag name must be followed by whitespace, `>` or `/>`.
	if (j < n && !/[\s/>]/.test(src[j]!)) return undefined;
	while (j < n) {
		while (j < n && /\s/.test(src[j]!)) j++;
		if (src[j] === '>') {
			return { type: 'open', name, attributes, selfClosing: false, raw: src.slice(start, j + 1), start, end: j + 1 };
		}
		if (src[j] === '/' && src[j + 1] === '>') {
			return { type: 'open', name, attributes, selfClosing: true, raw: src.slice(start, j + 2), start, end: j + 2 };
		}
		if (src[j] === '/') {
			j++;
			continue;
		}
		if (src[j] === '<') return undefined;
		const nameStart = j;
		while (j < n && !/[\s=>/"'<]/.test(src[j]!)) j++;
		// Allow `/` inside attribute names only when it is not closing the tag.
		if (j === nameStart) return undefined;
		const attrName = src.slice(nameStart, j);
		while (j < n && /\s/.test(src[j]!)) j++;
		if (src[j] !== '=') {
			attributes.push({ name: attrName, value: null });
			continue;
		}
		j++;
		while (j < n && /\s/.test(src[j]!)) j++;
		const quote = src[j];
		if (quote === '"' || quote === "'") {
			const close = src.indexOf(quote, j + 1);
			if (close === -1) return undefined;
			attributes.push({ name: attrName, value: decodeEntities(src.slice(j + 1, close)) });
			j = close + 1;
		} else {
			const valueStart = j;
			while (j < n && !/[\s>]/.test(src[j]!)) j++;
			attributes.push({ name: attrName, value: decodeEntities(src.slice(valueStart, j)) });
		}
	}
	return undefined;
}

export function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function getAttribute(attributes: readonly HtmlAttribute[], name: string): string | null | undefined {
	const found = attributes.find((attribute) => attribute.name === name);
	return found ? found.value : undefined;
}

export function hasAttribute(attributes: readonly HtmlAttribute[], name: string): boolean {
	return attributes.some((attribute) => attribute.name === name);
}
