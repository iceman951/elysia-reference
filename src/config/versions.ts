/**
 * Version metadata model.
 *
 * Each entry is a documentation set for one ElysiaJS release line. Content for the
 * set lives under `src/content/docs/<pathPrefix>` and is imported from the upstream
 * branch named in `upstream.branch`. Only versions with maintained content are
 * listed: the version selector stays hidden while there is a single version.
 *
 * Adding a version (e.g. once Elysia 2 documentation is published upstream):
 * 1. add an entry here with its own `pathPrefix` (the current set keeps `''`),
 * 2. add an import target for its upstream branch (see docs/SYNC_STRATEGY.md),
 * 3. move the previous set under its own prefix when the current version changes.
 */

export interface DocVersion {
	/** Stable id referenced by the `docVersion` frontmatter field. */
	id: string;
	label: string;
	status: 'current' | 'maintained' | 'preview' | 'archived';
	/** Content directory below `src/content/docs/`; `''` is the site root. */
	pathPrefix: string;
	upstream: { repository: string; branch: string };
	/**
	 * Why this documentation set is believed to apply to this version. Never
	 * invented: it must cite verifiable upstream evidence.
	 */
	evidence: string;
}

export const versions: DocVersion[] = [
	{
		id: '1.x',
		label: 'Elysia 1.x',
		status: 'current',
		pathPrefix: '',
		upstream: { repository: 'https://github.com/elysiajs/documentation', branch: 'main' },
		evidence:
			'The upstream documentation repository pins the `elysia` dependency it uses to type-check code examples (recorded in the import manifest), and its release notes describe Elysia 2 as a beta.',
	},
];

export const currentVersion: DocVersion = versions.find((version) => version.status === 'current') ?? versions[0]!;

export function getVersion(id: string | undefined): DocVersion | undefined {
	return id ? versions.find((version) => version.id === id) : undefined;
}

/** A selector is only useful when more than one version has maintained content. */
export const showVersionSelector = versions.filter((version) => version.status !== 'archived').length > 1;
