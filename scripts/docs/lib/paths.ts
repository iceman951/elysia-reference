import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const paths = {
	root: ROOT,
	/** Local checkout of the upstream documentation repository (git-ignored). */
	upstreamCheckout: path.join(ROOT, '.cache', 'upstream', 'elysiajs-documentation'),
	/** Starlight content collection. Imported pages live here next to local pages. */
	contentDocs: path.join(ROOT, 'src', 'content', 'docs'),
	/** Generated data consumed by the site at build time. */
	generatedDir: path.join(ROOT, 'src', 'generated'),
	manifest: path.join(ROOT, 'src', 'generated', 'upstream-manifest.json'),
	/** Upstream assets copied by the importer, served from `/upstream/`. */
	publicUpstream: path.join(ROOT, 'public', 'upstream'),
	reportsDir: path.join(ROOT, 'reports'),
	migrationReportMd: path.join(ROOT, 'reports', 'migration-report.md'),
	migrationReportJson: path.join(ROOT, 'reports', 'migration-report.json'),
	syncSummaryMd: path.join(ROOT, 'reports', 'sync-summary.md'),
	checkReportMd: path.join(ROOT, 'reports', 'check-report.md'),
	thirdPartyDir: path.join(ROOT, 'third-party', 'elysia-documentation'),
	distDir: path.join(ROOT, 'dist'),
};

/** Repository-relative POSIX path, used in reports and manifests. */
export function rel(absolutePath: string): string {
	return path.relative(ROOT, absolutePath).split(path.sep).join('/');
}

export function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}
