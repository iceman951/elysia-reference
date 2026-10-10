/**
 * The import manifest (`src/generated/upstream-manifest.json`) records exactly
 * what was imported from which upstream commit. It is committed to the repository,
 * consumed by the site at build time (attribution, SEO policy, navigation labels)
 * and used by `docs:sync` / `docs:check` to detect drift and local edits.
 *
 * It is deterministic: re-importing the same commit produces an identical file.
 */
import type { IssueSeverity } from './issues.ts';

export type PageSection = 'docs' | 'tutorial' | 'release-notes' | 'articles';

export interface ManifestPage {
	/** Upstream path relative to the upstream repository root. */
	source: string;
	sourceSha256: string;
	/** Generated file relative to this repository root. */
	output: string;
	outputSha256: string;
	/** Starlight entry id / URL path without slashes. */
	slug: string;
	title: string;
	upstreamUrl: string;
	section: PageSection;
	/** Navigation label and grouping as declared upstream (sidebar or tutorial index). */
	upstreamNav?: { group: string; subgroup?: string; label: string; order: number };
	/** Date of the last upstream commit touching the source file. */
	lastModified?: string;
	release?: { versionLabel?: string; date?: string; author?: string };
	status: 'imported' | 'imported-with-warnings' | 'failed';
	issues: Record<IssueSeverity, number>;
	/** Excluded from Pagefind search, mirroring upstream `search: false`. */
	searchable: boolean;
}

export interface ManifestAsset {
	source: string;
	output: string;
	url: string;
	bytes: number;
	sha256: string;
	width?: number;
	height?: number;
	referencedBy: string[];
}

export interface ManifestExcludedAsset {
	source: string;
	status: 'excluded' | 'missing';
	reason: string;
	referencedBy: string[];
}

export interface Manifest {
	schemaVersion: 1;
	generator: string;
	upstream: {
		name: string;
		repository: string;
		branch: string;
		commit: string;
		commitDate: string;
		siteUrl: string;
		license: string;
		licenseSha256: string;
		versionEvidence?: { package: string; range: string; source: string };
	};
	docVersion: string;
	summary: {
		discovered: number;
		imported: number;
		importedWithWarnings: number;
		failed: number;
		skipped: number;
		issues: Record<IssueSeverity, number>;
		assetsMirrored: number;
		assetsNotMirrored: number;
		assetsMissing: number;
	};
	pages: ManifestPage[];
	skipped: { source: string; reason: string }[];
	ignoredFiles: { source: string; reason: string }[];
	assets: ManifestAsset[];
	assetsNotMirrored: ManifestExcludedAsset[];
}

export const MANIFEST_GENERATOR = 'scripts/docs/import.ts';
