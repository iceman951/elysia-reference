import type { APIRoute } from 'astro';
import { allowIndexing } from '../config/site';

export const GET: APIRoute = ({ site }) => {
	if (!allowIndexing()) {
		// Preview and development builds must never be indexed.
		return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
	}
	const sitemap = site ? `\nSitemap: ${new URL('sitemap-index.xml', site).href}\n` : '';
	return new Response(`User-agent: *\nAllow: /\n${sitemap}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
