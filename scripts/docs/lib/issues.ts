/**
 * Conversion issues collected while importing upstream pages.
 *
 * - `error`:   content could not be converted reliably; needs maintainer action.
 * - `warning`: content was converted with a known loss (e.g. an interactive widget
 *              replaced by a link) or the upstream source itself is defective
 *              (e.g. a link to a page that does not exist).
 * - `info`:    an expected, lossless or intentional transformation, recorded for
 *              transparency (e.g. removed `<script setup>` blocks).
 */
export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
	severity: IssueSeverity;
	/** Stable machine-readable category, e.g. `unsupported-component`. */
	code: string;
	message: string;
	/** Upstream path relative to the repository root, e.g. `docs/essential/route.md`. */
	file?: string | undefined;
	/** 1-based line in the upstream file, when known. */
	line?: number | undefined;
	/** Original upstream source for unsupported or removed elements. */
	source?: string | undefined;
}

export class IssueCollector {
	readonly issues: Issue[] = [];
	private readonly file: string | undefined;

	constructor(file?: string) {
		this.file = file;
	}

	add(issue: Issue): void {
		const entry: Issue = { severity: issue.severity, code: issue.code, message: issue.message };
		const file = issue.file ?? this.file;
		if (file !== undefined) entry.file = file;
		if (issue.line !== undefined) entry.line = issue.line;
		if (issue.source !== undefined) entry.source = issue.source;
		if (entry.source !== undefined && entry.source.length > 4000) {
			entry.source = `${entry.source.slice(0, 4000)}\n… (truncated)`;
		}
		this.issues.push(entry);
	}

	error(code: string, message: string, extra: Partial<Issue> = {}): void {
		this.add({ ...extra, severity: 'error', code, message });
	}

	warn(code: string, message: string, extra: Partial<Issue> = {}): void {
		this.add({ ...extra, severity: 'warning', code, message });
	}

	info(code: string, message: string, extra: Partial<Issue> = {}): void {
		this.add({ ...extra, severity: 'info', code, message });
	}
}

export function countBySeverity(issues: readonly Issue[]): Record<IssueSeverity, number> {
	const counts: Record<IssueSeverity, number> = { error: 0, warning: 0, info: 0 };
	for (const issue of issues) counts[issue.severity]++;
	return counts;
}
