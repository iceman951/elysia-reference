/**
 * Static Markdown export of every page (`/md/<slug>.md`), used by the
 * "Copy as Markdown" button. The leading MDX import block and MDX comments
 * outside code blocks are removed; everything else is kept as written.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { SITE } from '../../config/site';

export const getStaticPaths = (async () => {
	const entries = await getCollection('docs');
	return entries
		.filter((entry) => entry.body !== undefined)
		.map((entry) => ({ params: { slug: `${entry.id}.md` }, props: { entry } }));
}) satisfies GetStaticPaths;

/** Removes MDX-only syntax without touching fenced code blocks. */
function stripMdxSyntax(source: string): string {
	const lines = source.split('\n');
	const out: string[] = [];
	let fence: string | undefined;
	let inComment = false;
	let leading = true;
	for (const line of lines) {
		const trimmed = line.trim();
		if (fence) {
			out.push(line);
			if (trimmed.startsWith(fence) && trimmed.replace(/[`~]/g, '') === '') fence = undefined;
			continue;
		}
		if (inComment) {
			if (trimmed.endsWith('*/}')) inComment = false;
			continue;
		}
		if (leading && (trimmed === '' || /^import\s/.test(trimmed))) continue;
		leading = false;
		if (trimmed.startsWith('{/*')) {
			if (!trimmed.endsWith('*/}')) inComment = true;
			continue;
		}
		const open = /^(`{3,}|~{3,})/.exec(trimmed);
		if (open) fence = open[1];
		out.push(line);
	}
	return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function toMarkdown(entry: CollectionEntry<'docs'>): string {
	const header = [`# ${entry.data.title}`];
	if (entry.data.description) header.push('', `> ${entry.data.description}`);
	if (entry.data.upstream) {
		header.push(
			'',
			`Source: ${entry.data.upstream.url} (MIT License, Copyright 2022 saltyAom). Adapted by ${SITE.name}, an unofficial community project.`
		);
	}
	return `${header.join('\n')}\n\n${stripMdxSyntax(entry.body ?? '')}\n`;
}

export const GET: APIRoute<{ entry: CollectionEntry<'docs'> }> = ({ props }) =>
	new Response(toMarkdown(props.entry), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
