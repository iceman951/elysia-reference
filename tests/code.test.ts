import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { convertCode, extractNotations, formatRanges, parseCodeInfo, stripTwoslash } from '../scripts/docs/lib/convert/code.ts';

describe('parseCodeInfo', () => {
	test('extracts language, greedy [title] (with brackets inside), twoslash and line highlights', () => {
		const info = parseCodeInfo('typescript', 'twoslash [app/api/[[...slugs]]/route.ts] {1,3-4}');
		assert.equal(info.lang, 'typescript');
		assert.equal(info.label, 'app/api/[[...slugs]]/route.ts');
		assert.equal(info.twoslash, true);
		assert.equal(info.highlight, '1,3-4');
		assert.deepEqual(info.unknown, []);
	});

	test('accepts labels with spaces', () => {
		assert.equal(parseCodeInfo('bash', '[apt (Linux)]').label, 'apt (Linux)');
	});
});

describe('stripTwoslash', () => {
	test('removes hidden setup code, directives and queries but keeps TypeScript pragmas', () => {
		const result = stripTwoslash(
			['// @filename: a.ts', 'export const a = 1', '// ---cut---', '// @ts-expect-error', 'const b: string = 1', '// @errors: 2322', 'b', '//^?', '// ---cut-after---', 'hidden'].join('\n')
		);
		assert.equal(result.value, ['// @ts-expect-error', 'const b: string = 1', 'b'].join('\n'));
		assert.equal(result.queries, 1);
	});

	test('keeps @filename markers that are not inside a cut region', () => {
		assert.equal(stripTwoslash('// @filename: a.ts\nconst a = 1').value, '// @filename: a.ts\nconst a = 1');
	});

	test('removes cut-start/cut-end ranges', () => {
		assert.equal(stripTwoslash('a\n// ---cut-start---\nb\n// ---cut-end---\nc').value, 'a\nc');
	});
});

describe('extractNotations', () => {
	test('marks inserted and deleted lines and strips the comments', () => {
		const result = extractNotations("const a = 1 // [!code --]\nconst a = 2 // [!code ++]\n# shell [!code ++]");
		assert.equal(result.value, 'const a = 1\nconst a = 2\n# shell');
		assert.deepEqual(result.del, [1]);
		assert.deepEqual(result.ins, [2, 3]);
	});

	test('a standalone notation applies to the following lines (Shiki v3 semantics)', () => {
		const result = extractNotations('// [!code ++:2]\na\nb\nc');
		assert.equal(result.value, 'a\nb\nc');
		assert.deepEqual(result.ins, [1, 2]);
	});

	test('supports HTML and block comment styles', () => {
		const result = extractNotations('<div /> <!-- [!code ++] -->\nx /* [!code highlight] */');
		assert.equal(result.value, '<div />\nx');
		assert.deepEqual(result.ins, [1]);
		assert.deepEqual(result.mark, [2]);
	});

	test('reports notations without an equivalent', () => {
		assert.deepEqual(extractNotations('a // [!code focus]').unsupported, ['focus']);
	});
});

describe('formatRanges', () => {
	test('collapses consecutive lines', () => {
		assert.equal(formatRanges([1, 2, 3, 5, 7, 8]), '1-3,5,7-8');
		assert.equal(formatRanges([]), '');
	});
});

describe('convertCode', () => {
	test('uses the label as title outside code groups only', () => {
		const outside = convertCode({ type: 'code', lang: 'ts', meta: '[index.ts]', value: 'x' }, false);
		assert.equal(outside.node.meta, 'title="index.ts"');
		const inside = convertCode({ type: 'code', lang: 'ts', meta: '[index.ts]', value: 'x' }, true);
		assert.equal(inside.node.meta, null);
		assert.equal(inside.label, 'index.ts');
	});

	test('computes notation line numbers after Twoslash stripping', () => {
		const result = convertCode({ type: 'code', lang: 'ts', meta: 'twoslash', value: 'setup\n// ---cut---\na\nb // [!code ++]' }, false);
		assert.equal(result.node.value, 'a\nb');
		assert.equal(result.node.meta, 'ins={2}');
	});
});
