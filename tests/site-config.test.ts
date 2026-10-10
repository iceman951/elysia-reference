import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildSidebar, type NavManifestPage } from '../src/config/navigation.ts';
import { resolveSeo } from '../src/config/seo.ts';
import { deploymentEnvironment, resolveSiteUrl } from '../src/config/site.ts';
import { PageIndex } from '../scripts/docs/lib/convert/links.ts';

describe('link resolution', () => {
	const index = new PageIndex(
		[
			{ upstreamPath: 'essential/route.md', imported: true, slug: 'essential/route', upstreamUrl: 'https://elysiajs.com/essential/route' },
			{ upstreamPath: 'tutorial/index.md', imported: true, slug: 'tutorial', upstreamUrl: 'https://elysiajs.com/tutorial/' },
		],
		{ siteUrl: 'https://elysiajs.com', publicFiles: new Set(['assets/a.webp']), aliases: { '/old': '/essential/route' } }
	);

	test('resolves the different upstream spellings of a page', () => {
		for (const href of ['/essential/route', '/essential/route.html', '/essential/route.md', 'https://elysiajs.com/essential/route', '../essential/route']) {
			const target = index.resolve(href, 'patterns/x.md');
			assert.equal(target?.kind, 'page', href);
		}
		assert.equal(index.resolve('/tutorial/', 'a.md')?.kind, 'page');
	});

	test('classifies assets, aliases, external, home and broken links', () => {
		assert.deepEqual(index.resolve('/assets/a.webp', 'a.md'), { kind: 'asset', publicPath: 'assets/a.webp' });
		assert.equal(index.resolve('/old#x', 'a.md')?.kind, 'page');
		assert.equal(index.resolve('https://github.com/elysiajs', 'a.md')?.kind, 'external');
		assert.equal(index.resolve('/', 'a.md')?.kind, 'home');
		assert.equal(index.resolve('/nope', 'a.md')?.kind, 'broken');
		assert.equal(index.resolve('mailto:a@b.c', 'a.md'), undefined);
	});
});

describe('navigation', () => {
	const pages: NavManifestPage[] = [
		{ slug: 'blog/elysia-14', title: 'Elysia 1.4 - X', section: 'release-notes', release: { versionLabel: '1.4' } },
		{ slug: 'blog/elysia-20', title: 'Elysia 2 beta - Y', section: 'release-notes', release: { versionLabel: '2 beta' } },
		{ slug: 'tutorial', title: 'Welcome', section: 'tutorial', upstreamNav: { group: 'Tutorial', subgroup: 'Getting Started', label: 'Introduction', order: 1 } },
	];

	test('drops entries for missing pages and appends unlisted pages', () => {
		const result = buildSidebar(pages, new Set(['essential/route', 'blog/elysia-14', 'blog/elysia-20', 'tutorial', 'brand-new', '404', '']));
		assert.ok(result.missing.includes('quick-start'));
		assert.deepEqual(result.unlisted, ['brand-new']);
		const other = result.sidebar.at(-1) as { label?: string } | undefined;
		assert.equal(other?.label, 'Other Pages');
	});

	test('orders release notes newest first and labels them by version', () => {
		const result = buildSidebar(pages, new Set(['blog/elysia-14', 'blog/elysia-20', 'tutorial']));
		const groups = result.sidebar as { label?: string; items?: { label?: string }[] }[];
		const group = groups.find((item) => item.label === 'Release Notes');
		assert.deepEqual(
			group?.items?.map((item) => item.label),
			['Elysia 2 beta', 'Elysia 1.4']
		);
	});
});

describe('SEO policy', () => {
	test('imported pages canonicalize to the official page and stay out of the sitemap', () => {
		const seo = resolveSeo({ slug: 'essential/route', upstreamUrl: 'https://elysiajs.com/essential/route', selfUrl: 'https://x.dev/essential/route/', indexingAllowed: true });
		assert.deepEqual(seo, { canonical: 'https://elysiajs.com/essential/route', index: true, inSitemap: false });
	});

	test('local pages are self-canonical; previews are never indexed', () => {
		assert.deepEqual(resolveSeo({ slug: 'project/about', upstreamUrl: undefined, selfUrl: 'https://x.dev/project/about/', indexingAllowed: true }), {
			canonical: 'https://x.dev/project/about/',
			index: true,
			inSitemap: true,
		});
		assert.equal(resolveSeo({ slug: '', upstreamUrl: undefined, selfUrl: 'https://x.dev/', indexingAllowed: false }).index, false);
	});
});

describe('deployment environment', () => {
	test('Cloudflare Pages branches map to production and preview', () => {
		assert.equal(deploymentEnvironment({ CF_PAGES: '1', CF_PAGES_BRANCH: 'main' }), 'production');
		assert.equal(deploymentEnvironment({ CF_PAGES: '1', CF_PAGES_BRANCH: 'feature' }), 'preview');
		assert.equal(deploymentEnvironment({ DEPLOY_ENV: 'preview' }), 'preview');
	});

	test('site URL: explicit SITE_URL, then the preview deployment URL, then the default', () => {
		assert.equal(resolveSiteUrl({ SITE_URL: 'https://docs.example.com/' }), 'https://docs.example.com');
		assert.equal(resolveSiteUrl({ CF_PAGES: '1', CF_PAGES_BRANCH: 'pr-1', CF_PAGES_URL: 'https://abc.elysia-reference.pages.dev' }), 'https://abc.elysia-reference.pages.dev');
		assert.equal(resolveSiteUrl({}), 'https://elysia-reference.pages.dev');
	});
});
