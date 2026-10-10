/**
 * Canonical URL and indexing policy.
 *
 * Imported pages are substantially copied from the official documentation, so by
 * default their canonical URL points to the corresponding official page and they
 * are left out of this site's sitemap. Locally authored pages are self-canonical.
 *
 * When an imported page becomes substantially differentiated (for example after an
 * independently written rewrite), add an override here — imported files are
 * regenerated on every sync, so overrides cannot live in their frontmatter.
 */

export type CanonicalTarget = 'upstream' | 'self';

export interface SeoRule {
	canonical: CanonicalTarget;
	/** `false` adds `<meta name="robots" content="noindex, follow">`. */
	index: boolean;
}

export const seoConfig: {
	imported: SeoRule;
	local: SeoRule;
	/** Per-page overrides keyed by content slug (e.g. `essential/route`, `index` for the homepage). */
	overrides: Record<string, Partial<SeoRule>>;
} = {
	imported: { canonical: 'upstream', index: true },
	local: { canonical: 'self', index: true },
	overrides: {},
};

export interface ResolvedSeo {
	canonical: string | undefined;
	index: boolean;
	inSitemap: boolean;
}

export function resolveSeo(input: {
	slug: string;
	/** Official page URL for imported pages. */
	upstreamUrl: string | undefined;
	/** This page's own absolute URL (undefined when no site URL is configured). */
	selfUrl: string | undefined;
	/** `false` on preview/development deployments. */
	indexingAllowed: boolean;
}): ResolvedSeo {
	const base = input.upstreamUrl ? seoConfig.imported : seoConfig.local;
	const rule: SeoRule = { ...base, ...seoConfig.overrides[input.slug || 'index'] };
	const canonical = rule.canonical === 'upstream' && input.upstreamUrl ? input.upstreamUrl : input.selfUrl;
	const index = input.indexingAllowed && rule.index;
	return { canonical, index, inSitemap: index && canonical !== undefined && canonical === input.selfUrl };
}
