import GithubSlugger from 'github-slugger';

/**
 * Heading slug algorithms.
 *
 * Upstream (VitePress) and this site (Astro + Sätteri) generate different heading
 * IDs for the same text, e.g. "TypeBox (Elysia.t)" becomes `typebox-elysia-t`
 * upstream but `typebox-elysiat` here. The importer computes both so that anchor
 * links (`/essential/validation#typebox-elysia-t`) can be rewritten precisely.
 */

const rControl = /[\u0000-\u001f]/g;
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const rCombining = /[̀-ͯ]/g;

/** Port of `slugify` from `@mdit-vue/shared`, used by VitePress for heading anchors. */
export function vitepressSlugify(value: string): string {
	return value
		.normalize('NFKD')
		.replace(rCombining, '')
		.replace(rControl, '')
		.replace(rSpecial, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/^(\d)/, '_$1')
		.toLowerCase();
}

/** Mirrors markdown-it-anchor's `uniqueSlug` (suffixes `-1`, `-2`, … on collisions). */
export class VitepressSlugger {
	private readonly used = new Set<string>();

	slug(text: string): string {
		const base = vitepressSlugify(text);
		let unique = base;
		let index = 1;
		while (this.used.has(unique)) unique = `${base}-${index++}`;
		this.used.add(unique);
		return unique;
	}
}

/** Mirrors the heading ID plugin of `@astrojs/markdown-satteri` (github-slugger on text content). */
export class AstroSlugger {
	private readonly slugger = new GithubSlugger();

	slug(text: string): string {
		return this.slugger.slug(text);
	}
}
