import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

function git(args: string[], cwd?: string): string {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 256 * 1024 * 1024,
	}).trim();
}

export function isCommitSha(ref: string): boolean {
	return /^[0-9a-f]{40}$/i.test(ref);
}

export interface UpstreamCheckout {
	dir: string;
	commit: string;
	commitDate: string;
}

/**
 * Ensures `dir` contains a checkout of `gitUrl` at `ref` (a branch name or a full
 * commit SHA). Uses a blob-less partial clone; file contents are fetched on demand.
 */
export async function checkoutUpstream(options: {
	dir: string;
	gitUrl: string;
	ref: string;
	offline?: boolean;
}): Promise<UpstreamCheckout> {
	const { dir, gitUrl, ref } = options;
	if (!existsSync(path.join(dir, '.git'))) {
		if (options.offline) throw new Error(`No upstream checkout at ${dir}; run without --offline first.`);
		await mkdir(path.dirname(dir), { recursive: true });
		git(['clone', '--quiet', '--filter=blob:none', '--no-checkout', gitUrl, dir]);
	}
	let commit: string;
	if (options.offline) {
		commit = git(['rev-parse', '--verify', `${isCommitSha(ref) ? ref : `origin/${ref}`}^{commit}`], dir);
	} else {
		git(['fetch', '--quiet', '--filter=blob:none', 'origin', ref], dir);
		commit = git(['rev-parse', '--verify', `${isCommitSha(ref) ? ref : 'FETCH_HEAD'}^{commit}`], dir);
	}
	git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--force', '--detach', commit], dir);
	const commitDate = git(['show', '-s', '--format=%cI', commit], dir);
	return { dir, commit, commitDate };
}

/** Latest commit SHA of a remote branch, without touching the local checkout. */
export function remoteHead(gitUrl: string, branch: string): string {
	const output = git(['ls-remote', gitUrl, `refs/heads/${branch}`]);
	const sha = output.split(/\s+/)[0];
	if (!sha || !isCommitSha(sha)) throw new Error(`Could not resolve ${branch} on ${gitUrl}`);
	return sha;
}

/** Date of the last commit touching each file below `pathspec` (ISO 8601). */
export function lastModifiedDates(dir: string, commit: string, pathspec: string): Map<string, string> {
	const output = git(['log', '--format=%x00%cI', '--name-only', commit, '--', pathspec], dir);
	const dates = new Map<string, string>();
	for (const record of output.split('\0')) {
		const lines = record.split('\n').map((line) => line.trim()).filter(Boolean);
		const date = lines.shift();
		if (!date) continue;
		for (const file of lines) if (!dates.has(file)) dates.set(file, date);
	}
	return dates;
}

export interface ChangedFile {
	status: string;
	path: string;
	previousPath?: string;
}

export function changedFiles(dir: string, from: string, to: string, pathspec: string): ChangedFile[] {
	const output = git(['diff', '--name-status', '-M', from, to, '--', pathspec], dir);
	if (!output) return [];
	return output.split('\n').map((line) => {
		const [status = '', first = '', second] = line.split('\t');
		if (second !== undefined) return { status: status[0] ?? status, path: second, previousPath: first };
		return { status, path: first };
	});
}

export interface CommitInfo {
	sha: string;
	date: string;
	subject: string;
}

export function commitsBetween(dir: string, from: string, to: string, pathspec: string): CommitInfo[] {
	const output = git(['log', '--format=%H%x09%cI%x09%s', `${from}..${to}`, '--', pathspec], dir);
	if (!output) return [];
	return output.split('\n').map((line) => {
		const [sha = '', date = '', ...subject] = line.split('\t');
		return { sha, date, subject: subject.join('\t') };
	});
}

/** Ensures `commit` exists locally (fetching it if needed). */
export function ensureCommit(dir: string, commit: string): void {
	try {
		git(['cat-file', '-e', `${commit}^{commit}`], dir);
	} catch {
		git(['fetch', '--quiet', '--filter=blob:none', 'origin', commit], dir);
	}
}
