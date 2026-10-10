/**
 * Site-wide constants and environment handling.
 *
 * Imported by astro.config.ts and by components at build time (Node.js), so it may
 * read `process.env`.
 */

export const SITE = {
	name: 'Elysia Reference',
	tagline: 'A clearer, structured reference for ElysiaJS.',
	description:
		'Unofficial, independent, community-maintained reference documentation for ElysiaJS, adapted from the official ElysiaJS documentation.',
	repository: 'https://github.com/iceman951/elysia-reference',
	productionBranch: 'main',
	/** Default production URL; override with the SITE_URL environment variable. */
	defaultUrl: 'https://elysia-reference.pages.dev',
	disclaimer: 'Independent community documentation. Not affiliated with or endorsed by the ElysiaJS maintainers.',
	official: {
		site: 'https://elysiajs.com',
		docsRepository: 'https://github.com/elysiajs/documentation',
		frameworkRepository: 'https://github.com/elysiajs/elysia',
	},
} as const;

export type DeploymentEnvironment = 'production' | 'preview' | 'development';

type Env = Record<string, string | undefined>;

function readEnv(): Env {
	return typeof process === 'undefined' ? {} : process.env;
}

/**
 * - `DEPLOY_ENV` wins when set explicitly.
 * - On Cloudflare Pages (`CF_PAGES=1`), the production branch builds production,
 *   every other branch builds a preview.
 * - `astro dev` is development; any other build is production.
 */
export function deploymentEnvironment(env: Env = readEnv()): DeploymentEnvironment {
	const explicit = env['DEPLOY_ENV'];
	if (explicit === 'production' || explicit === 'preview' || explicit === 'development') return explicit;
	if (env['CF_PAGES'] === '1') {
		const productionBranch = env['PRODUCTION_BRANCH'] ?? SITE.productionBranch;
		return env['CF_PAGES_BRANCH'] === productionBranch ? 'production' : 'preview';
	}
	if (env['NODE_ENV'] === 'development') return 'development';
	return 'production';
}

/**
 * Absolute site URL used for canonical links, the sitemap and robots.txt.
 * Production should set SITE_URL to its public domain. Cloudflare preview builds
 * fall back to the unique deployment URL Cloudflare provides.
 */
export function resolveSiteUrl(env: Env = readEnv()): string {
	const explicit = env['SITE_URL'];
	if (explicit) return explicit.replace(/\/+$/, '');
	if (deploymentEnvironment(env) === 'preview' && env['CF_PAGES_URL']) return env['CF_PAGES_URL'].replace(/\/+$/, '');
	return SITE.defaultUrl;
}

/** Search engines may index only production deployments. */
export function allowIndexing(env: Env = readEnv()): boolean {
	return deploymentEnvironment(env) === 'production';
}
