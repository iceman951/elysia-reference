/**
 * Information architecture of the site sidebar.
 *
 * Groups are derived from the existing upstream content and its VitePress sidebar
 * (labels follow the upstream sidebar unless the upstream label is a typo or
 * inconsistent with the page title). No group exists without real pages.
 *
 * Imported pages that are not listed here are appended to an "Other pages" group by
 * `buildSidebar()` and reported by `pnpm docs:check`, so nothing becomes
 * undiscoverable after an upstream sync adds a page.
 */
import type { StarlightUserConfig } from '@astrojs/starlight/types';

export interface NavLink {
	slug: string;
	label?: string;
	badge?: { text: string; variant: 'note' | 'tip' | 'caution' | 'danger' | 'success' | 'default' };
}

export interface NavGroup {
	label: string;
	collapsed?: boolean;
	items: NavItem[];
}

/** A group generated from the import manifest. */
export interface NavGenerated {
	generate: 'tutorial' | 'release-notes' | 'articles';
}

export type NavItem = NavLink | NavGroup | NavGenerated;

export const navigation: NavGroup[] = [
	{
		label: 'Getting Started',
		items: [
			{ slug: 'at-glance', label: 'At a Glance' },
			{ slug: 'quick-start', label: 'Quick Start' },
			{ slug: 'key-concept', label: 'Key Concepts' },
			{ slug: 'table-of-content', label: 'Table of Contents' },
			{ slug: 'integrations/cheat-sheet', label: 'Cheat Sheet' },
		],
	},
	{
		label: 'Core Concepts',
		items: [
			{ slug: 'essential/route', label: 'Routing' },
			{ slug: 'essential/handler', label: 'Handler' },
			{ slug: 'essential/plugin', label: 'Plugin' },
			{ slug: 'essential/life-cycle', label: 'Lifecycle' },
			{ slug: 'essential/validation', label: 'Validation' },
			{ slug: 'essential/best-practice', label: 'Best Practice' },
		],
	},
	{
		label: 'Patterns',
		items: [
			{ slug: 'patterns/configuration', label: 'Configuration' },
			{ slug: 'patterns/error-handling', label: 'Error Handling' },
			{ slug: 'patterns/extends-context', label: 'Extends Context' },
			{ slug: 'patterns/macro', label: 'Macro' },
			{ slug: 'patterns/cookie', label: 'Cookie' },
			{ slug: 'patterns/websocket', label: 'WebSocket' },
			{ slug: 'patterns/mount', label: 'Mount' },
			{ slug: 'patterns/fullstack-dev-server', label: 'Fullstack Dev Server' },
		],
	},
	{
		label: 'Type Safety',
		items: [
			{ slug: 'patterns/typebox', label: 'TypeBox (Elysia.t)' },
			{ slug: 'patterns/typescript', label: 'TypeScript' },
		],
	},
	{
		label: 'OpenAPI & Observability',
		items: [
			{ slug: 'patterns/openapi', label: 'OpenAPI' },
			{ slug: 'patterns/opentelemetry', label: 'OpenTelemetry' },
			{ slug: 'patterns/trace', label: 'Trace' },
		],
	},
	{
		label: 'Testing',
		items: [
			{ slug: 'patterns/unit-test', label: 'Unit Test' },
			{ slug: 'eden/test', label: 'Eden Test' },
		],
	},
	{
		label: 'Runtimes & Deployment',
		items: [
			{ slug: 'patterns/deploy', label: 'Deploy to Production' },
			{ slug: 'integrations/node', label: 'Node.js' },
			{ slug: 'integrations/deno', label: 'Deno' },
			{ slug: 'integrations/cloudflare-worker', label: 'Cloudflare Worker' },
			{ slug: 'integrations/vercel', label: 'Vercel' },
			{ slug: 'integrations/netlify', label: 'Netlify' },
		],
	},
	{
		label: 'Eden',
		items: [
			{ slug: 'eden/overview', label: 'Overview' },
			{ slug: 'eden/installation', label: 'Installation' },
			{
				label: 'Eden Treaty',
				items: [
					{ slug: 'eden/treaty/overview', label: 'Overview' },
					{ slug: 'eden/treaty/parameters', label: 'Parameters' },
					{ slug: 'eden/treaty/response', label: 'Response' },
					{ slug: 'eden/treaty/websocket', label: 'WebSocket' },
					{ slug: 'eden/treaty/config', label: 'Config' },
					{ slug: 'eden/treaty/unit-test', label: 'Unit Test' },
					{ slug: 'eden/treaty/legacy', label: 'Legacy (Treaty 1)' },
				],
			},
			{ slug: 'eden/fetch', label: 'Eden Fetch' },
		],
	},
	{
		label: 'Plugins',
		collapsed: true,
		items: [
			{ slug: 'plugins/overview', label: 'Overview' },
			{ slug: 'plugins/bearer', label: 'Bearer' },
			{ slug: 'plugins/cors', label: 'CORS' },
			{ slug: 'plugins/cron', label: 'Cron' },
			{ slug: 'plugins/graphql-apollo', label: 'GraphQL Apollo' },
			{ slug: 'plugins/graphql-yoga', label: 'GraphQL Yoga' },
			{ slug: 'plugins/html', label: 'HTML' },
			{ slug: 'plugins/jwt', label: 'JWT' },
			{ slug: 'plugins/openapi', label: 'OpenAPI' },
			{ slug: 'plugins/opentelemetry', label: 'OpenTelemetry' },
			{ slug: 'plugins/server-timing', label: 'Server Timing' },
			{ slug: 'plugins/static', label: 'Static' },
			// The upstream page itself states that the Swagger plugin is deprecated.
			{ slug: 'plugins/swagger', label: 'Swagger', badge: { text: 'Deprecated', variant: 'caution' } },
		],
	},
	{
		label: 'Integrations',
		collapsed: true,
		items: [
			{ slug: 'integrations/ai-sdk', label: 'AI SDK' },
			{ slug: 'integrations/astro', label: 'Astro' },
			{ slug: 'integrations/better-auth', label: 'Better Auth' },
			{ slug: 'integrations/drizzle', label: 'Drizzle' },
			{ slug: 'integrations/expo', label: 'Expo' },
			{ slug: 'integrations/nextjs', label: 'Next.js' },
			{ slug: 'integrations/nuxt', label: 'Nuxt' },
			{ slug: 'integrations/prisma', label: 'Prisma' },
			{ slug: 'integrations/react-email', label: 'React Email' },
			{ slug: 'integrations/sveltekit', label: 'SvelteKit' },
			{ slug: 'integrations/tanstack-start', label: 'TanStack Start' },
		],
	},
	{
		label: 'Internals',
		collapsed: true,
		items: [{ slug: 'internal/jit-compiler', label: 'JIT Compiler' }],
	},
	{
		label: 'API Reference',
		collapsed: true,
		items: [
			{ slug: 'reference', label: 'Overview' },
			{ slug: 'reference/listen', label: 'Elysia.listen()' },
			{ slug: 'reference/stop', label: 'Elysia.stop()' },
		],
	},
	{ label: 'Interactive Tutorial (text)', collapsed: true, items: [{ generate: 'tutorial' }] },
	{ label: 'Release Notes', collapsed: true, items: [{ generate: 'release-notes' }] },
	{ label: 'Articles', collapsed: true, items: [{ generate: 'articles' }] },
	{
		label: 'About This Project',
		collapsed: true,
		items: [
			{ slug: 'project/about', label: 'About' },
			{ slug: 'project/attribution', label: 'Attribution & Licensing' },
			{ slug: 'project/versions', label: 'Versions' },
			{ slug: 'project/migration-status', label: 'Migration Status' },
		],
	},
];

/** Minimal view of the import manifest needed to build navigation. */
export interface NavManifestPage {
	slug: string;
	title: string;
	section: 'docs' | 'tutorial' | 'release-notes' | 'articles';
	upstreamNav?: { group: string; subgroup?: string; label: string; order: number };
	release?: { versionLabel?: string; date?: string };
}

/** Pages that are intentionally not part of the sidebar. */
const UNLISTED_BY_DESIGN = new Set(['', 'index', '404']);

type StarlightSidebar = NonNullable<StarlightUserConfig['sidebar']>;
type StarlightSidebarItem = StarlightSidebar[number];

function versionKey(label: string | undefined): number[] {
	return (label ?? '0').split(/[^\d]+/).filter(Boolean).map(Number);
}

function compareVersionsDesc(a: NavManifestPage, b: NavManifestPage): number {
	const x = versionKey(a.release?.versionLabel);
	const y = versionKey(b.release?.versionLabel);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const diff = (y[i] ?? 0) - (x[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function generatedItems(kind: NavGenerated['generate'], pages: readonly NavManifestPage[]): StarlightSidebarItem[] {
	if (kind === 'release-notes') {
		return pages
			.filter((page) => page.section === 'release-notes')
			.sort(compareVersionsDesc)
			.map((page) => ({ slug: page.slug, label: page.release?.versionLabel ? `Elysia ${page.release.versionLabel}` : page.title }));
	}
	if (kind === 'articles') {
		return pages
			.filter((page) => page.section === 'articles')
			.sort((a, b) => (b.release?.date ?? '').localeCompare(a.release?.date ?? ''))
			.map((page) => ({ slug: page.slug, label: page.title }));
	}
	const tutorial = pages
		.filter((page) => page.section === 'tutorial')
		.sort((a, b) => (a.upstreamNav?.order ?? Number.MAX_SAFE_INTEGER) - (b.upstreamNav?.order ?? Number.MAX_SAFE_INTEGER));
	const groups = new Map<string, StarlightSidebarItem[]>();
	for (const page of tutorial) {
		const group = page.upstreamNav?.subgroup ?? 'Lessons';
		const list = groups.get(group) ?? [];
		list.push({ slug: page.slug, label: page.upstreamNav?.label ?? page.title });
		groups.set(group, list);
	}
	return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

export interface BuiltSidebar {
	sidebar: StarlightSidebar;
	/** Slugs referenced by the sidebar. */
	referenced: Set<string>;
	/** Navigation entries whose page does not exist (e.g. removed upstream). */
	missing: string[];
	/** Existing pages that were appended because the navigation does not list them. */
	unlisted: string[];
}

/**
 * Converts the navigation definition into Starlight's sidebar configuration.
 * Links to pages that do not exist are dropped (and reported) so a sync that
 * removes a page cannot break the build.
 */
export function buildSidebar(pages: readonly NavManifestPage[], existingSlugs: ReadonlySet<string>): BuiltSidebar {
	const referenced = new Set<string>();
	const missing: string[] = [];

	const convert = (items: readonly NavItem[]): StarlightSidebarItem[] => {
		const out: StarlightSidebarItem[] = [];
		for (const item of items) {
			if ('generate' in item) {
				for (const generated of generatedItems(item.generate, pages)) {
					collect(generated);
					out.push(generated);
				}
				continue;
			}
			if ('items' in item) {
				const children = convert(item.items);
				if (children.length > 0) out.push({ label: item.label, collapsed: item.collapsed ?? false, items: children });
				continue;
			}
			if (!existingSlugs.has(item.slug)) {
				missing.push(item.slug);
				continue;
			}
			referenced.add(item.slug);
			out.push({ slug: item.slug, ...(item.label ? { label: item.label } : {}), ...(item.badge ? { badge: item.badge } : {}) });
		}
		return out;
	};

	const collect = (item: StarlightSidebarItem) => {
		if (typeof item === 'string') referenced.add(item);
		else if ('slug' in item && typeof item.slug === 'string') referenced.add(item.slug);
		else if ('items' in item && Array.isArray(item.items)) for (const child of item.items) collect(child as StarlightSidebarItem);
	};

	const sidebar = navigation.flatMap((group) => convert([group]));
	const unlisted = [...existingSlugs].filter((slug) => !UNLISTED_BY_DESIGN.has(slug) && !referenced.has(slug)).sort();
	if (unlisted.length > 0) {
		sidebar.push({ label: 'Other Pages', collapsed: true, items: unlisted.map((slug) => ({ slug })) });
	}
	return { sidebar, referenced, missing, unlisted };
}
