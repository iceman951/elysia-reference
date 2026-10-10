import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { listFiles, readText } from './fs-utils.ts';
import { paths } from './paths.ts';

export interface ContentFile {
	/** Repository-relative path, e.g. `src/content/docs/essential/route.mdx`. */
	file: string;
	/** Starlight entry id / slug (`essential/route`, `` for the homepage). */
	slug: string;
	frontmatter: Record<string, unknown>;
	body: string;
	source: string;
}

/** Slug exactly as Starlight's docs loader derives it (`a/index.mdx` → `a`). */
export function slugOfContentPath(relativePath: string): string {
	const withoutExt = relativePath.replace(/\.mdx?$/, '');
	if (withoutExt === 'index') return '';
	return withoutExt.replace(/\/index$/, '');
}

export async function readContentFiles(): Promise<ContentFile[]> {
	const files = (await listFiles(paths.contentDocs)).filter(
		(file) => /\.mdx?$/.test(file) && !file.split('/').some((segment) => segment.startsWith('_'))
	);
	const result: ContentFile[] = [];
	for (const file of files) {
		const source = await readText(path.join(paths.contentDocs, file));
		const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
		const frontmatter = match ? ((parseYaml(match[1]!) ?? {}) as Record<string, unknown>) : {};
		result.push({
			file: `src/content/docs/${file}`,
			slug: slugOfContentPath(file),
			frontmatter,
			body: match ? source.slice(match[0].length) : source,
			source,
		});
	}
	return result;
}

/** Yields `[lineNumber, line]` for lines outside fenced code blocks and MDX comments. */
export function* proseLines(body: string): Generator<[number, string]> {
	const lines = body.split('\n');
	let fence: string | undefined;
	let inComment = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!;
		const trimmed = line.trim();
		if (fence) {
			if (trimmed.startsWith(fence) && trimmed.replace(/[`~]/g, '') === '') fence = undefined;
			continue;
		}
		if (inComment) {
			if (trimmed.includes('*/}')) inComment = false;
			continue;
		}
		if (trimmed.startsWith('{/*')) {
			if (!trimmed.includes('*/}')) inComment = true;
			continue;
		}
		const open = /^(`{3,}|~{3,})/.exec(trimmed);
		if (open) {
			fence = open[1];
			continue;
		}
		yield [index + 1, line];
	}
}
