import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importConfig } from '../scripts/docs/import.config.ts';
import { assertCompiles, convertFixture, issueCodes } from './helpers.ts';

const page = (body: string, frontmatter = 'title: Fixture - ElysiaJS') => `---\n${frontmatter}\n---\n\n${body}\n`;

describe('frontmatter and title', () => {
	test('uses the first H1 as title and removes it from the body', async () => {
		const result = convertFixture('essential/route.md', page('# Routing\n\nText.'));
		assert.equal(result.page.title, 'Routing');
		assert.doesNotMatch(result.body, /^# Routing/m);
		await assertCompiles(result.body);
	});

	test('falls back to the frontmatter title without the " - ElysiaJS" suffix', () => {
		const result = convertFixture('a.md', page('Text only.', 'title: Cookie - ElysiaJS'));
		assert.equal(result.page.title, 'Cookie');
	});

	test('reads the description from VitePress head meta', () => {
		const source = page('# T', "title: T\nhead:\n  - - meta\n    - name: 'description'\n      content: The description.");
		assert.equal(convertFixture('a.md', source).page.description, 'The description.');
	});

	test('moves components out of the H1 into a paragraph', () => {
		const result = convertFixture(
			'essential/route.md',
			page('<script setup>\nimport TutorialBadge from "x"\n</script>\n\n# Routing <TutorialBadge href="/tutorial/a" />\n\nText.'),
			{ pages: { 'tutorial/a.md': null } }
		);
		assert.equal(result.page.title, 'Routing');
		assert.match(result.body, /<TutorialBadge href="https:\/\/elysiajs\.com\/tutorial\/a" \/>/);
	});

	test('demotes additional H1 headings and reports them', () => {
		const result = convertFixture('a.md', page('# One\n\ntext\n\n# Two\n\ntext'));
		assert.match(result.body, /^## Two$/m);
		assert.ok(issueCodes(result.issues).includes('extra-h1'));
	});
});

describe('VitePress containers', () => {
	test('converts tip/warning/danger/info to Starlight asides', async () => {
		const result = convertFixture(
			'a.md',
			page('# T\n\n::: tip\nA tip.\n:::\n\n::: warning\nCareful.\n:::\n\n::: danger\nNo.\n:::\n\n::: info\nFYI.\n:::')
		);
		assert.match(result.body, /:::tip\nA tip\.\n:::/);
		assert.match(result.body, /:::caution\nCareful\.\n:::/);
		assert.match(result.body, /:::danger\nNo\.\n:::/);
		assert.match(result.body, /:::note\nFYI\.\n:::/);
		await assertCompiles(result.body);
	});

	test('keeps custom container titles', () => {
		const result = convertFixture('a.md', page('# T\n\n::: tip NOTE\nBody.\n:::'));
		assert.match(result.body, /:::tip\[NOTE\]\nBody\.\n:::/);
	});

	test('converts details containers to <details>/<summary>', async () => {
		const result = convertFixture('a.md', page('# T\n\n::: details Click me\nHidden **content**.\n:::'));
		assert.match(result.body, /<details>\n {2}<summary>Click me<\/summary>\n\n {2}Hidden \*\*content\*\*\.\n<\/details>/);
		await assertCompiles(result.body);
	});

	test('a container may interrupt a paragraph, like markdown-it-container', () => {
		const result = convertFixture('a.md', page('# T\n\nText line\n::: tip\nInside.\n:::'));
		assert.match(result.body, /Text line\n\n:::tip\nInside\.\n:::/);
	});

	test('converts code-group to Tabs with labels and synced package-manager tabs', async () => {
		const result = convertFixture(
			'a.md',
			page('# T\n\n::: code-group\n\n```bash [bun]\nbun add elysia\n```\n\n```bash [npm]\nnpm install elysia\n```\n\n:::')
		);
		assert.match(result.body, /import \{ TabItem, Tabs \} from '@astrojs\/starlight\/components';/);
		assert.match(result.body, /<Tabs syncKey="package-manager">/);
		assert.match(result.body, /<TabItem label="bun">\n {4}```bash\n {4}bun add elysia\n {4}```\n {2}<\/TabItem>/);
		assert.match(result.body, /<TabItem label="npm">/);
		await assertCompiles(result.body);
	});

	test('repairs a closing marker written as "::: code-group" and reports it', () => {
		const result = convertFixture('a.md', page('# T\n\n::: code-group\n\n```ts [a.ts]\nconst a = 1\n```\n\n::: code-group\n\nAfter the group.'));
		assert.match(result.body, /<\/Tabs>\n\nAfter the group\./);
		assert.ok(issueCodes(result.issues).includes('upstream-markup-repaired'));
	});

	test('renders non-code content of a code group after the tabs', () => {
		const result = convertFixture('a.md', page('# T\n\n::: code-group\n\n```ts [a.ts]\nconst a = 1\n```\n\nExplanation.\n\n:::'));
		assert.match(result.body, /<\/Tabs>\n\nExplanation\./);
	});

	test('converts the undefined "note" container and reports the upstream defect', () => {
		const result = convertFixture('a.md', page('# T\n\n::: note\nRemember this.\n:::'));
		assert.match(result.body, /:::note\nRemember this\.\n:::/);
		assert.ok(issueCodes(result.issues).includes('container-note'));
	});
});

describe('Vue components', () => {
	test('converts <Tab> with template slots into Tabs ordered by the tabs binding', async () => {
		const source = page(
			[
				'# T',
				'',
				'<Tab',
				'\tid="quickstart"',
				"\t:names=\"['Bun', 'Node.js']\"",
				"\t:tabs=\"['bun', 'node']\"",
				'>',
				'',
				'<template v-slot:node>',
				'',
				'Node content.',
				'',
				'</template>',
				'',
				'<template v-slot:bun>',
				'',
				'Bun content with `code`.',
				'',
				'</template>',
				'',
				'</Tab>',
			].join('\n')
		);
		const result = convertFixture('a.md', source);
		assert.match(result.body, /<Tabs syncKey="quickstart">\n {2}<TabItem label="Bun">\n {4}Bun content with `code`\.\n {2}<\/TabItem>\n\n {2}<TabItem label="Node\.js">\n {4}Node content\.\n {2}<\/TabItem>\n<\/Tabs>/);
		await assertCompiles(result.body);
	});

	test('converts Deck/Card into CardGrid/LinkCard with escaped titles and resolved links', async () => {
		const source = page(
			'# T\n\n<Deck>\n\t<Card title="Routing & <More>" href="/essential/route.html">\n\t\tDefine **routes**\n\t</Card>\n</Deck>'
		);
		const result = convertFixture('a.md', source, { pages: { 'essential/route.md': '# Routing\n' } });
		// LinkCard renders `title` with set:html, so the prop must be HTML-escaped once after MDX decoding.
		assert.match(result.body, /<CardGrid>\n {2}<LinkCard title="Routing &amp;amp; &amp;lt;More&amp;gt;" href="\/essential\/route\/" description="Define \*\*routes\*\*" \/>\n<\/CardGrid>/);
		await assertCompiles(result.body);
	});

	test('converts DocLink to a Markdown link', () => {
		const result = convertFixture('a.md', page('# T\n\nSee <DocLink href="/essential/handler#context">Context</DocLink>.'), {
			pages: { 'essential/handler.md': '# Handler\n\n## Context\n' },
		});
		assert.match(result.body, /See \[Context\]\(\/essential\/handler\/#context\)\./);
	});

	test('maps VitePress Badge types to Starlight Badge variants and keeps heading IDs clean', () => {
		const result = convertFixture('a.md', page('# T\n\n## Encapsulation <Badge type="danger" text="MUST READ" />\n\n<details>\n\n<summary>\nredirect <Badge type="warning">Legacy</Badge>\n</summary>\n\nBody.\n\n</details>'));
		assert.match(result.body, /## Encapsulation<Badge text="MUST READ" variant="danger" \/>/);
		assert.match(result.body, /<summary>redirect <Badge text="Legacy" variant="caution" \/><\/summary>/);
		assert.ok(result.page.anchors.local.has('encapsulation'));
	});

	test('replaces interactive widgets with a notice and preserves the source in an MDX comment', async () => {
		const result = convertFixture('essential/route.md', page('# T\n\n<Playground\n  :elysia="demo1"\n  :alias="{ \'/a\': \'/b\' }"\n/>\n\nAfter.'));
		assert.match(result.body, /\{\/\* upstream <Playground>:\n[\s\S]*:elysia="demo1"[\s\S]*\*\/\}/);
		assert.match(result.body, /<InteractiveNotice kind="interactive example" href="https:\/\/elysiajs\.com\/essential\/route" \/>/);
		assert.ok(issueCodes(result.issues).includes('interactive-component'));
		await assertCompiles(result.body);
	});

	test('renders <Chart> data from <script setup> as a table', () => {
		const source = page(
			[
				'<script setup>',
				"const startup = [{ label: 'Hono', value: 21 }, { label: 'Elysia', detail: '2.0', value: 1_234, highlight: true }]",
				'</script>',
				'',
				'# T',
				'',
				'<Chart :items="startup" unit="ms" />',
			].join('\n')
		);
		const result = convertFixture('blog/x.md', source);
		assert.match(result.body, /\| Hono +\| +21 ms \|/);
		assert.match(result.body, /\| \*\*Elysia <sup>2\.0<\/sup>\*\* \| \*\*1,234 ms\*\* \|/);
	});

	test('turns tutorial <Editor> pages into text with a notice and collapsible answers', async () => {
		const source = page(
			'<script setup lang="ts">\nimport Editor from "x"\n</script>\n\n<Editor :code="code" doc="/essential/handler#context">\n\n# Lesson\n\nDo it.\n\n<template #answer>\n\nThe answer.\n\n</template>\n\n</Editor>'
		);
		const result = convertFixture('tutorial/a/index.md', source, { pages: { 'essential/handler.md': '# Handler\n\n## Context\n' } });
		assert.equal(result.page.title, 'Lesson');
		assert.match(result.body, /<TutorialNotice href="https:\/\/elysiajs\.com\/tutorial\/a\/" doc="\/essential\/handler\/#context" \/>/);
		assert.match(result.body, /<details>\n {2}<summary>Show answer<\/summary>\n\n {2}The answer\.\n<\/details>/);
		await assertCompiles(result.body);
	});

	test('removes <script setup> blocks and reports them', () => {
		const result = convertFixture('a.md', page('<script setup>\nconst x = 1\n</script>\n\n# T\n\nText.'));
		assert.doesNotMatch(result.body, /script/);
		assert.ok(issueCodes(result.issues).includes('vue-sfc-block-removed'));
	});
});

describe('HTML', () => {
	test('stitches HTML tables with Markdown code blocks in cells', async () => {
		const source = page('# T\n\n<table class="md-table">\n<tr>\n<td>Type</td>\n</tr>\n<tr>\n<td>\n\n```ts\nconst a = 1\n```\n\n</td>\n</tr>\n</table>');
		const result = convertFixture('a.md', source);
		assert.match(result.body, /<table class="md-table">\n {2}<tr>\n {4}<td>Type<\/td>\n {2}<\/tr>\n\n {2}<tr>\n {4}<td>\n {6}```ts\n {6}const a = 1\n {6}```\n {4}<\/td>\n {2}<\/tr>\n<\/table>/);
		await assertCompiles(result.body);
	});

	test('keeps a <video> block with nested <source> together', () => {
		const result = convertFixture('a.md', page('# T\n\n<video controls style="aspect-ratio: 16/9;">\n  <source src="/eden/x.mp4" type="video/mp4" />\n  Fallback text\n</video>'), {
			publicFiles: ['eden/x.mp4'],
		});
		assert.match(result.body, /<video controls style="aspect-ratio: 16\/9;">\n {2}<source src="\/upstream\/eden\/x\.mp4" type="video\/mp4" \/>\n\n {2}Fallback text\n<\/video>/);
		assert.ok(!issueCodes(result.issues).includes('unclosed-element'));
	});

	test('keeps paragraphs of inline HTML inside <p> (MDX would unwrap them)', () => {
		const result = convertFixture('a.md', page('# T\n\n<small id="ref-1">1. First note.</small>\n\n<small id="ref-2">2. Second note.</small>'));
		assert.match(result.body, /<p>\n {2}<small id="ref-1">1\. First note\.<\/small>\n<\/p>\n\n<p>\n {2}<small id="ref-2">/);
	});

	test('removes HTML comments and records their source', () => {
		const result = convertFixture('a.md', page('# T\n\n<!-- hidden ::: tip -->\n\nVisible.'));
		assert.doesNotMatch(result.body, /hidden/);
		const issue = result.issues.find((entry) => entry.code === 'html-comment-removed');
		assert.equal(issue?.source, '<!-- hidden ::: tip -->');
	});

	test('escapes text that would otherwise be MDX syntax', async () => {
		const result = convertFixture('a.md', page('# T\n\nUse `{}` or {braces} and a <string> type; 5 < 6.'));
		await assertCompiles(result.body);
		assert.match(result.body, /or \\\{braces\} and a \\<string> type; 5 \\< 6\./);
	});

	test('replaces third-party iframes with a link', () => {
		const result = convertFixture('a.md', page('# T\n\n<iframe\n    src="https://discord.com/widget?id=1"\n/>'));
		assert.match(result.body, /\[Embedded content from discord\.com\]\(https:\/\/discord\.com\/widget\?id=1\)/);
	});
});

describe('links, anchors and assets', () => {
	test('rewrites .html/.md links and maps VitePress anchors to local heading IDs', () => {
		const target = '# Validation\n\n## TypeBox (Elysia.t)\n';
		const result = convertFixture('a.md', page('# T\n\n[a](/essential/validation.html#typebox-elysia-t) [b](/essential/validation.md)'), {
			pages: { 'essential/validation.md': target },
		});
		assert.match(result.body, /\[a\]\(\/essential\/validation\/#typebox-elysiat\)/);
		assert.match(result.body, /\[b\]\(\/essential\/validation\/\)/);
	});

	test('maps a link to the removed H1 to #_top', () => {
		const result = convertFixture('a.md', page('# Routing\n\n[top](#routing)'));
		assert.match(result.body, /\[top\]\(#_top\)/);
	});

	test('points links to pages that are not imported to the official site', () => {
		const result = convertFixture('a.md', page('# T\n\n[play](/playground/preview)'), { pages: { 'playground/preview.md': null } });
		assert.match(result.body, /\[play\]\(https:\/\/elysiajs\.com\/playground\/preview\)/);
	});

	test('reports dead upstream links and keeps them pointing to the official site', () => {
		const result = convertFixture('a.md', page('# T\n\n[gone](/integrations/nextj)'));
		assert.match(result.body, /\[gone\]\(https:\/\/elysiajs\.com\/integrations\/nextj\)/);
		assert.ok(issueCodes(result.issues).includes('broken-link'));
	});

	test('links generated upstream LLMS files without reporting them as missing', async () => {
		const result = convertFixture(
			'a.md',
			page('# T\n\n<Card title="llms.txt" href="/llms.txt" />\n\n[full](https://elysiajs.com/llms-full.txt) [download](/llms.txt?download=1#overview) [missing](/missing.txt)'),
			{ generatedRoutes: importConfig.generatedRoutes }
		);
		assert.match(result.body, /<LinkCard title="llms\.txt" href="https:\/\/elysiajs\.com\/llms\.txt" \/>/);
		assert.match(result.body, /\[full\]\(https:\/\/elysiajs\.com\/llms-full\.txt\)/);
		assert.match(result.body, /\[download\]\(https:\/\/elysiajs\.com\/llms\.txt\?download=1#overview\)/);
		const upstreamLinks = result.issues.filter((issue) => issue.code === 'link-to-upstream');
		assert.equal(upstreamLinks.length, 3);
		assert.ok(upstreamLinks.every((issue) => issue.severity === 'info'));
		assert.deepEqual(result.issues.filter((issue) => issue.code === 'broken-link').map((issue) => issue.source), ['/missing.txt']);
		await assertCompiles(result.body);
	});

	test('reports anchors that do not exist on the target page', () => {
		const result = convertFixture('a.md', page('# T\n\n[x](/essential/handler#decorate)'), { pages: { 'essential/handler.md': '# Handler\n\n## Context\n' } });
		assert.ok(issueCodes(result.issues).includes('broken-anchor'));
	});

	test('mirrors images with dimensions and links excluded artwork instead', () => {
		const result = convertFixture('a.md', page('# T\n\n![Diagram](/assets/chart.svg)\n\n![Mascot](/elysia/sprite.webp)'), {
			publicFiles: ['assets/chart.svg', 'elysia/sprite.webp'],
			excludedAssets: { 'elysia/sprite.webp': 'Mascot character artwork' },
		});
		assert.match(result.body, /<img src="\/upstream\/assets\/chart\.svg" alt="Diagram" width="800" height="600" loading="lazy" decoding="async" \/>/);
		assert.match(result.body, /\*Image \(hosted on elysiajs\.com\): \[Mascot\]\(https:\/\/elysiajs\.com\/elysia\/sprite\.webp\)\*/);
		assert.ok(issueCodes(result.issues).includes('asset-not-mirrored'));
	});
});

describe('code blocks', () => {
	test('converts titles and diff notations to Expressive Code meta', () => {
		const result = convertFixture('a.md', page("# T\n\n```ts [src/index.ts]\nconst a = 1 // [!code --]\nconst b = 2 // [!code ++]\n```"));
		assert.match(result.body, /```ts title="src\/index\.ts" ins=\{2\} del=\{1\}\nconst a = 1\nconst b = 2\n```/);
	});

	test('renders Twoslash blocks as the code upstream readers see', () => {
		const source = page(
			'# T\n\n```typescript twoslash\n// @filename: server.ts\nexport const a = 1\n// ---cut---\nimport { a } from "./server"\n// @noErrors\nconst b = a\n//    ^?\n```'
		);
		const result = convertFixture('a.md', source);
		assert.match(result.body, /```typescript\nimport \{ a \} from "\.\/server"\nconst b = a\n```/);
	});
});
