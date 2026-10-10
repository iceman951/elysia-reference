import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { satteri } from '@astrojs/markdown-satteri';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { buildSidebar, type NavManifestPage } from './src/config/navigation';
import { resolveSeo } from './src/config/seo';
import { allowIndexing, resolveSiteUrl, SITE } from './src/config/site';

const root = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(root, 'src/content/docs');
const manifestFile = path.join(root, 'src/generated/upstream-manifest.json');

const manifest: { pages: (NavManifestPage & { upstreamUrl: string })[] } = existsSync(manifestFile)
	? JSON.parse(readFileSync(manifestFile, 'utf8'))
	: { pages: [] };

/** Content slugs exactly as Starlight's docs loader derives them (`a/index.mdx` → `a`). */
function contentSlugs(dir: string, prefix = ''): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name.startsWith('_') || entry.name.startsWith('.')) return [];
		if (entry.isDirectory()) return contentSlugs(path.join(dir, entry.name), `${prefix}${entry.name}/`);
		if (!/\.mdx?$/.test(entry.name)) return [];
		const slug = `${prefix}${entry.name.replace(/\.mdx?$/, '')}`.replace(/(^|\/)index$/, '');
		return [slug];
	});
}

const site = resolveSiteUrl();
const indexingAllowed = allowIndexing();
const { sidebar } = buildSidebar(manifest.pages, new Set(contentSlugs(contentDir)));
const upstreamUrlBySlug = new Map(manifest.pages.map((page) => [page.slug, page.upstreamUrl]));

export default defineConfig({
	site,
	markdown: {
		// VitePress does not apply typographic replacements; keep `--flags` and quotes verbatim.
		processor: satteri({ features: { smartPunctuation: false } }),
	},
	integrations: [
		starlight({
			title: SITE.name,
			description: SITE.description,
			logo: { src: './src/assets/logo.svg' },
			favicon: '/favicon.svg',
			social: [{ icon: 'github', label: 'Elysia Reference on GitHub', href: SITE.repository }],
			editLink: { baseUrl: `${SITE.repository}/edit/${SITE.productionBranch}/` },
			lastUpdated: true,
			sidebar,
			customCss: ['./src/styles/theme.css'],
			components: {
				SiteTitle: './src/components/overrides/SiteTitle.astro',
				PageTitle: './src/components/overrides/PageTitle.astro',
				Footer: './src/components/overrides/Footer.astro',
				EditLink: './src/components/overrides/EditLink.astro',
			},
			routeMiddleware: './src/routeData.ts',
			head: [
				{ tag: 'meta', attrs: { name: 'theme-color', content: '#f8fafc', media: '(prefers-color-scheme: light)' } },
				{ tag: 'meta', attrs: { name: 'theme-color', content: '#0f1115', media: '(prefers-color-scheme: dark)' } },
			],
			expressiveCode: {
				themes: ['github-dark', 'github-light'],
				useStarlightUiThemeColors: true,
				styleOverrides: { borderRadius: '0.5rem' },
			},
		}),
		sitemap({
			filter: (page) => {
				const pathname = new URL(page).pathname;
				if (pathname.startsWith('/md/')) return false;
				const slug = pathname.replace(/^\/+|\/+$/g, '');
				return resolveSeo({ slug, upstreamUrl: upstreamUrlBySlug.get(slug), selfUrl: page, indexingAllowed }).inSitemap;
			},
		}),
	],
});
