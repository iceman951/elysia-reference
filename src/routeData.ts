import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { resolveSeo } from './config/seo';
import { allowIndexing } from './config/site';

/**
 * Applies the canonical/indexing policy from src/config/seo.ts:
 * - imported pages: canonical (and og:url) point to the official page,
 * - preview and development deployments: `noindex` everywhere.
 */
export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	const { head, entry } = route;

	const canonicalTag = head.find((tag) => tag.tag === 'link' && tag.attrs?.['rel'] === 'canonical');
	const selfUrl = typeof canonicalTag?.attrs?.['href'] === 'string' ? canonicalTag.attrs['href'] : undefined;
	const seo = resolveSeo({
		slug: entry.id === 'index' ? '' : entry.id,
		upstreamUrl: entry.data.upstream?.url,
		selfUrl,
		indexingAllowed: allowIndexing(),
	});

	if (seo.canonical && canonicalTag?.attrs) {
		canonicalTag.attrs['href'] = seo.canonical;
		const ogUrl = head.find((tag) => tag.tag === 'meta' && tag.attrs?.['property'] === 'og:url');
		if (ogUrl?.attrs) ogUrl.attrs['content'] = seo.canonical;
	}
	if (!seo.index) {
		head.push({ tag: 'meta', attrs: { name: 'robots', content: 'noindex, follow' } });
	}
});
