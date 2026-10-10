import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { tokenizeHtml } from '../scripts/docs/lib/html.ts';
import { extractPropertyLiteral, extractVariableLiteral, isExpression, isRecord, parseLiteral } from '../scripts/docs/lib/literal.ts';
import { preprocess } from '../scripts/docs/lib/convert/preprocess.ts';
import { AstroSlugger, VitepressSlugger, vitepressSlugify } from '../scripts/docs/lib/slug.ts';

describe('literal parser', () => {
	test('parses arrays, objects, numbers with separators, and skips comments', () => {
		const value = parseLiteral("[{ label: 'Hono', value: 88_936, highlight: true }, /* c */ { label: \"x\", value: -1 }]");
		assert.deepEqual(value, [
			{ label: 'Hono', value: 88936, highlight: true },
			{ label: 'x', value: -1 },
		]);
	});

	test('returns expressions without evaluating them', () => {
		const value = parseLiteral('{ a: compute(1), b: `t${x}` }');
		assert.ok(isRecord(value));
		assert.ok(isExpression(value['a']));
		assert.ok(isExpression(value['b']));
	});

	test('finds the VitePress sidebar and ignores commented-out entries', () => {
		const source = "export default { themeConfig: { sidebar: [ { text: 'A', items: [ { text: 'B', link: '/b' } ] }, // { text: 'Old', link: '/old' }\n ] } }";
		assert.deepEqual(extractPropertyLiteral(source, 'sidebar'), [{ text: 'A', items: [{ text: 'B', link: '/b' }] }]);
	});

	test('reads typed variable initializers', () => {
		const source = "export const tableOfContents: Group[] = [{ title: 'Intro', contents: [] }]";
		assert.deepEqual(extractVariableLiteral(source, 'tableOfContents'), [{ title: 'Intro', contents: [] }]);
	});
});

describe('HTML tokenizer', () => {
	test('accepts Vue attribute syntax and decodes entities', () => {
		const tokens = tokenizeHtml('<template #answer><Tab :names="[\'a\']" v-slot:x @click="f" id=plain>A &amp; B</Tab></template>');
		const open = tokens.filter((token) => token.type === 'open');
		assert.deepEqual(open[0]?.type === 'open' && open[0].attributes, [{ name: '#answer', value: null }]);
		assert.deepEqual(open[1]?.type === 'open' && open[1].attributes.map((attribute) => attribute.name), [':names', 'v-slot:x', '@click', 'id']);
		assert.ok(tokens.some((token) => token.type === 'text' && token.value === 'A & B'));
	});

	test('treats a stray "<" as text', () => {
		const tokens = tokenizeHtml('5 < 6 and <b>bold</b>');
		assert.equal(tokens[0]?.type, 'text');
		assert.equal(tokens[0]?.type === 'text' && tokens[0].value, '5 < 6 and ');
	});
});

describe('slugs', () => {
	test('VitePress slugify matches @mdit-vue/shared', () => {
		assert.equal(vitepressSlugify('TypeBox (Elysia.t)'), 'typebox-elysia-t');
		assert.equal(vitepressSlugify('On Error (Error Handling)'), 'on-error-error-handling');
		assert.equal(vitepressSlugify('1.4 release'), '_1-4-release');
	});

	test('duplicate headings get numeric suffixes in both algorithms', () => {
		const vp = new VitepressSlugger();
		assert.deepEqual([vp.slug('Route'), vp.slug('Route')], ['route', 'route-1']);
		const astro = new AstroSlugger();
		assert.deepEqual([astro.slug('TypeBox (Elysia.t)'), astro.slug('TypeBox (Elysia.t)')], ['typebox-elysiat', 'typebox-elysiat-1']);
	});
});

describe('preprocess', () => {
	test('replaces component blocks and containers with placeholders, outside code fences only', () => {
		const result = preprocess(['::: tip', 'x', ':::', '', '```md', '::: tip', '<Tab>', '```', '', '<Card title="a">', 'text', '</Card>'].join('\n'), 1);
		const kinds = [...result.placeholders.values()].map((placeholder) => placeholder.kind);
		assert.deepEqual(kinds, ['container-open', 'container-close', 'html']);
		assert.match(result.markdown, /```md\n::: tip\n<Tab>\n```/);
	});

	test('treats a complete inline tag alone on a line as an HTML block only at a block boundary', () => {
		const block = preprocess(['', '<video controls>', '  <source src="a.mp4" />', '</video>'].join('\n'), 1);
		assert.equal(block.placeholders.size, 0);
		const inParagraph = preprocess(['Some text', '<video controls>'].join('\n'), 1);
		assert.equal(inParagraph.placeholders.size, 0);
	});

	test('records removed <script setup> blocks with their line', () => {
		const result = preprocess(['# T', '', '<script setup>', 'const a = 1', '</script>'].join('\n'), 10);
		assert.equal(result.removed.length, 1);
		assert.equal(result.removed[0]?.line, 12);
		assert.doesNotMatch(result.markdown, /script/);
	});
});
