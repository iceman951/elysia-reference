import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function sha256(content: string | Buffer): string {
	return createHash('sha256').update(content).digest('hex');
}

export async function readText(file: string): Promise<string> {
	return readFile(file, 'utf8');
}

export async function readJson<T>(file: string): Promise<T | undefined> {
	if (!existsSync(file)) return undefined;
	return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** Writes a file only when its content changed, so re-imports produce clean diffs. */
export async function writeIfChanged(file: string, content: string | Buffer): Promise<boolean> {
	if (existsSync(file)) {
		const current = await readFile(file);
		const next = typeof content === 'string' ? Buffer.from(content) : content;
		if (current.equals(next)) return false;
	}
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content);
	return true;
}

export async function writeJson(file: string, data: unknown): Promise<boolean> {
	return writeIfChanged(file, `${JSON.stringify(data, null, '\t')}\n`);
}

/** Recursively lists files below `dir`, returning paths relative to `dir` (POSIX separators). */
export async function listFiles(
	dir: string,
	options: { ignoreDirs?: (relDir: string) => boolean } = {}
): Promise<string[]> {
	const out: string[] = [];
	async function walk(current: string, relDir: string): Promise<void> {
		const entries = await readdir(current, { withFileTypes: true });
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (options.ignoreDirs?.(relPath)) continue;
				await walk(path.join(current, entry.name), relPath);
			} else if (entry.isFile()) {
				out.push(relPath);
			}
		}
	}
	if (existsSync(dir)) await walk(dir, '');
	return out;
}

/** Minimal glob matcher supporting `*` (within a segment) and `**` (any depth). */
export function globToRegExp(glob: string): RegExp {
	let re = '';
	for (let i = 0; i < glob.length; i++) {
		const char = glob[i]!;
		if (char === '*') {
			if (glob[i + 1] === '*') {
				re += '.*';
				i++;
				if (glob[i + 1] === '/') i++;
			} else {
				re += '[^/]*';
			}
		} else if (char === '?') {
			re += '[^/]';
		} else {
			re += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${re}$`);
}

export function matchesAnyGlob(value: string, globs: readonly string[]): boolean {
	return globs.some((glob) => globToRegExp(glob).test(value));
}
