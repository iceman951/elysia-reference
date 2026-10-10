/**
 * A small, safe parser for JavaScript *literal* values (objects, arrays, strings,
 * numbers, booleans) embedded in TypeScript/Vue sources.
 *
 * It never evaluates code. Anything that is not a plain literal (function calls,
 * identifiers, template literals with substitutions, …) is returned as a
 * `LiteralExpression` holding its source text, so callers can decide how to report it.
 *
 * Used to read the upstream VitePress sidebar, the tutorial table of contents and
 * Vue attribute bindings such as `:names="['Bun', 'Node.js']"`.
 */

/** Source text of a non-literal expression (never evaluated). */
export class LiteralExpression {
	readonly source: string;
	constructor(source: string) {
		this.source = source;
	}
}

export interface LiteralObject {
	[key: string]: LiteralValue;
}

export type LiteralValue = string | number | boolean | null | LiteralValue[] | LiteralObject | LiteralExpression;

type Token =
	| { kind: 'string'; value: string; start: number; end: number }
	| { kind: 'number'; value: number; start: number; end: number }
	| { kind: 'ident'; value: string; start: number; end: number }
	| { kind: 'punct'; value: string; start: number; end: number }
	| { kind: 'template'; value: string; hasSubstitution: boolean; start: number; end: number };

export function tokenizeJs(source: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const n = source.length;
	while (i < n) {
		const ch = source[i]!;
		if (/\s/.test(ch)) {
			i++;
			continue;
		}
		if (ch === '/' && source[i + 1] === '/') {
			while (i < n && source[i] !== '\n') i++;
			continue;
		}
		if (ch === '/' && source[i + 1] === '*') {
			const end = source.indexOf('*/', i + 2);
			i = end === -1 ? n : end + 2;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const start = i;
			let value = '';
			i++;
			while (i < n && source[i] !== ch) {
				if (source[i] === '\\' && i + 1 < n) {
					value += unescapeChar(source[i + 1]!);
					i += 2;
					continue;
				}
				value += source[i];
				i++;
			}
			i++;
			tokens.push({ kind: 'string', value, start, end: i });
			continue;
		}
		if (ch === '`') {
			const start = i;
			let value = '';
			let hasSubstitution = false;
			i++;
			while (i < n && source[i] !== '`') {
				if (source[i] === '\\' && i + 1 < n) {
					value += unescapeChar(source[i + 1]!);
					i += 2;
					continue;
				}
				if (source[i] === '$' && source[i + 1] === '{') hasSubstitution = true;
				value += source[i];
				i++;
			}
			i++;
			tokens.push({ kind: 'template', value, hasSubstitution, start, end: i });
			continue;
		}
		if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
			const start = i;
			while (i < n && /[0-9._xXa-fA-FeEn]/.test(source[i]!)) i++;
			const raw = source.slice(start, i).replace(/_/g, '').replace(/n$/, '');
			tokens.push({ kind: 'number', value: Number(raw), start, end: i });
			continue;
		}
		if (/[A-Za-z_$]/.test(ch)) {
			const start = i;
			while (i < n && /[\w$]/.test(source[i]!)) i++;
			tokens.push({ kind: 'ident', value: source.slice(start, i), start, end: i });
			continue;
		}
		if (ch === '.' && source.startsWith('...', i)) {
			tokens.push({ kind: 'punct', value: '...', start: i, end: i + 3 });
			i += 3;
			continue;
		}
		tokens.push({ kind: 'punct', value: ch, start: i, end: i + 1 });
		i++;
	}
	return tokens;
}

function unescapeChar(ch: string): string {
	switch (ch) {
		case 'n':
			return '\n';
		case 't':
			return '\t';
		case 'r':
			return '\r';
		default:
			return ch;
	}
}

class LiteralParser {
	private pos = 0;
	private readonly tokens: Token[];
	private readonly source: string;

	constructor(tokens: Token[], source: string) {
		this.tokens = tokens;
		this.source = source;
	}

	get position(): number {
		return this.pos;
	}

	seek(pos: number): void {
		this.pos = pos;
	}

	private peek(offset = 0): Token | undefined {
		return this.tokens[this.pos + offset];
	}

	private isPunct(token: Token | undefined, value: string): boolean {
		return token?.kind === 'punct' && token.value === value;
	}

	parseValue(): LiteralValue {
		const token = this.peek();
		if (!token) return new LiteralExpression('');
		if (this.isPunct(token, '{')) return this.parseObject();
		if (this.isPunct(token, '[')) return this.parseArray();
		const next = this.peek(1);
		const endsHere = !next || next.kind === 'punct' && [',', '}', ']', ')', ';'].includes(next.value);
		if (token.kind === 'string' && endsHere) {
			this.pos++;
			return token.value;
		}
		if (token.kind === 'template' && !token.hasSubstitution && endsHere) {
			this.pos++;
			return token.value;
		}
		if (token.kind === 'number' && endsHere) {
			this.pos++;
			return token.value;
		}
		if (this.isPunct(token, '-') && next?.kind === 'number') {
			const after = this.peek(2);
			if (!after || (after.kind === 'punct' && [',', '}', ']', ')', ';'].includes(after.value))) {
				this.pos += 2;
				return -next.value;
			}
		}
		if (token.kind === 'ident' && endsHere) {
			if (token.value === 'true') return this.advance(true);
			if (token.value === 'false') return this.advance(false);
			if (token.value === 'null') return this.advance(null);
		}
		return this.parseExpression();
	}

	private advance<T extends LiteralValue>(value: T): T {
		this.pos++;
		return value;
	}

	/** Captures an arbitrary expression up to the next top-level `,`, `}`, `]` or `)`. */
	private parseExpression(): LiteralValue {
		const startToken = this.peek();
		if (!startToken) return new LiteralExpression('');
		let depth = 0;
		let endToken = startToken;
		while (this.pos < this.tokens.length) {
			const token = this.peek()!;
			if (token.kind === 'punct') {
				if (['{', '[', '('].includes(token.value)) depth++;
				else if (['}', ']', ')'].includes(token.value)) {
					if (depth === 0) break;
					depth--;
				} else if ((token.value === ',' || token.value === ';') && depth === 0) break;
			}
			endToken = token;
			this.pos++;
		}
		return new LiteralExpression(this.source.slice(startToken.start, endToken.end));
	}

	private parseObject(): LiteralValue {
		this.pos++; // {
		const result: LiteralObject = {};
		while (this.pos < this.tokens.length) {
			const token = this.peek();
			if (!token) break;
			if (this.isPunct(token, '}')) {
				this.pos++;
				break;
			}
			if (this.isPunct(token, ',')) {
				this.pos++;
				continue;
			}
			if (this.isPunct(token, '...')) {
				this.pos++;
				this.parseExpression();
				continue;
			}
			let key: string | undefined;
			if (token.kind === 'ident' || token.kind === 'string') key = token.value;
			else if (token.kind === 'number') key = String(token.value);
			if (key === undefined) {
				// Computed keys or unsupported syntax: skip the entry.
				this.parseExpression();
				continue;
			}
			this.pos++;
			if (this.isPunct(this.peek(), ':')) {
				this.pos++;
				result[key] = this.parseValue();
			} else if (this.isPunct(this.peek(), '(')) {
				// Method shorthand: skip parameters and body.
				this.parseExpression();
				result[key] = new LiteralExpression('method');
			} else {
				// Shorthand property `{ foo }`.
				result[key] = new LiteralExpression(key);
			}
		}
		return result;
	}

	private parseArray(): LiteralValue {
		this.pos++; // [
		const result: LiteralValue[] = [];
		while (this.pos < this.tokens.length) {
			const token = this.peek();
			if (!token) break;
			if (this.isPunct(token, ']')) {
				this.pos++;
				break;
			}
			if (this.isPunct(token, ',')) {
				this.pos++;
				continue;
			}
			result.push(this.parseValue());
		}
		return result;
	}
}

/** Parses a complete literal expression, e.g. the value of a Vue `:prop` binding. */
export function parseLiteral(source: string): LiteralValue {
	const tokens = tokenizeJs(source);
	const parser = new LiteralParser(tokens, source);
	return parser.parseValue();
}

/**
 * Finds `key: <literal>` (object property) in a source file and parses the literal.
 * The first occurrence wins. Returns `undefined` when the key does not exist.
 */
export function extractPropertyLiteral(source: string, key: string): LiteralValue | undefined {
	const tokens = tokenizeJs(source);
	for (let i = 0; i < tokens.length - 1; i++) {
		const token = tokens[i]!;
		const next = tokens[i + 1]!;
		if ((token.kind === 'ident' || token.kind === 'string') && token.value === key && next.kind === 'punct' && next.value === ':') {
			const parser = new LiteralParser(tokens, source);
			parser.seek(i + 2);
			return parser.parseValue();
		}
	}
	return undefined;
}

/**
 * Finds `const name ... = <literal>` (a variable initializer, optionally with a type
 * annotation) and parses the literal.
 */
export function extractVariableLiteral(source: string, name: string): LiteralValue | undefined {
	const tokens = tokenizeJs(source);
	for (let i = 0; i < tokens.length - 1; i++) {
		const token = tokens[i]!;
		const previous = tokens[i - 1];
		if (token.kind !== 'ident' || token.value !== name) continue;
		if (!previous || previous.kind !== 'ident' || !['const', 'let', 'var'].includes(previous.value)) continue;
		for (let j = i + 1; j < tokens.length; j++) {
			const candidate = tokens[j]!;
			if (candidate.kind === 'punct' && candidate.value === '=') {
				const parser = new LiteralParser(tokens, source);
				parser.seek(j + 1);
				return parser.parseValue();
			}
			if (candidate.kind === 'punct' && candidate.value === ';') break;
		}
	}
	return undefined;
}

export function isExpression(value: LiteralValue | undefined): value is LiteralExpression {
	return value instanceof LiteralExpression;
}

export function isRecord(value: LiteralValue | undefined): value is LiteralObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof LiteralExpression);
}

export function asStringArray(value: LiteralValue | undefined): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') return undefined;
		out.push(item);
	}
	return out;
}
