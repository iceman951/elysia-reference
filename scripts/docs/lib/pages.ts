import type { PageSection } from './manifest.ts';

/** Starlight entry id for an upstream page path (`tutorial/index.md` → `tutorial`). */
export function slugOfPage(upstreamPath: string): string {
	const withoutExt = upstreamPath.replace(/\.md$/, '');
	if (withoutExt === 'index') return '';
	return withoutExt.replace(/\/index$/, '');
}

/** Repository-relative output file for an upstream page path. */
export function outputOfPage(upstreamPath: string): string {
	return `src/content/docs/${upstreamPath.replace(/\.md$/, '.mdx')}`;
}

export function sectionOfPage(upstreamPath: string, title: string): PageSection {
	if (upstreamPath.startsWith('tutorial/')) return 'tutorial';
	if (upstreamPath.startsWith('blog/')) return /^Elysia\s+\d/i.test(title) ? 'release-notes' : 'articles';
	return 'docs';
}

/** "Elysia 1.4 - Supersymmetry" → "1.4"; "Elysia 2 beta - DayDream" → "2 beta". */
export function releaseVersionLabel(title: string): string | undefined {
	const match = /^Elysia\s+(\d+(?:\.\d+)*)(?:\s+(alpha|beta|rc))?\b/i.exec(title);
	if (!match) return undefined;
	return match[2] ? `${match[1]} ${match[2].toLowerCase()}` : match[1];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "13 Sep 2025" → "2025-09-13"; returns undefined for other formats. */
export function parseReleaseDate(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const match = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(value.trim());
	if (!match) return undefined;
	const month = MONTHS.indexOf(match[2]!.slice(0, 3).toLowerCase());
	if (month < 0) return undefined;
	return `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
}
