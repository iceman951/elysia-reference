# Upstream synchronization

The official documentation changes continuously. This project follows it with a weekly, reviewed synchronization.

## Principles

1. **Upstream is the source of truth** for imported pages. Content fixes go upstream; this repository changes only
   how content is converted and presented.
2. **Review upstream changes before merging.** A sync produces a pull request. Configure `main` branch protection
   below to require review and passing checks before the Git integration deploys the merged content.
3. **Failures are loud.** A failed sync fails the workflow and opens (or comments on) an issue; partial content is never
   proposed as ready to merge.
4. **Local work is never overwritten silently.** Locally authored pages are not touched; hand-edited generated files
   are reported as conflicts.

## Commands

```sh
pnpm docs:sync                      # sync to the latest commit of the upstream main branch
pnpm docs:sync --ref <sha|branch>   # sync to a specific commit (also used to roll back)
pnpm docs:sync --dry-run            # show what would change; write nothing
```

`docs:sync`:

1. resolves the latest upstream commit (`git ls-remote`);
2. stops with "Already up to date" when it equals the commit recorded in the manifest;
3. otherwise runs the import at the new commit with the safety rules of `docs:import`;
4. writes `reports/sync-summary.md`: upstream commits and files changed under `docs/`, pages added/updated/removed
   here, issue count changes, **new conversion issues**, conflicts, and a review checklist;
5. sets `changed`, `commit`, `short_commit` and `ok` outputs when running in GitHub Actions;
6. exits with code 1 on conversion failures or conflicts.

## Weekly workflow

`.github/workflows/upstream-sync.yml` runs every Monday at 04:23 UTC and on demand (*Actions → Upstream sync → Run
workflow*, optionally with a branch or commit).

| Step | On failure |
| --- | --- |
| `pnpm docs:sync` | Job fails, issue "Upstream documentation sync failed" is opened or commented. No pull request. |
| Validation: type check, tests, `docs:check`, build, `docs:check --dist` | Pull request is opened as a **draft** with the failure noted, then the job fails and the issue is updated. |
| Open/update pull request on branch `automation/upstream-sync` | Job fails. |

Only generated paths are committed by the workflow: `src/content/docs` (imported files), `src/generated`,
`public/upstream`, `reports/migration-report.*` and `third-party/elysia-documentation`. Repeated runs update the same
pull request until it is merged.

Permissions are scoped to the job: `contents: write` (push the sync branch), `pull-requests: write`, `issues: write`.
The CI workflow is read-only.

### CI on sync pull requests

Pull requests created with the default `GITHUB_TOKEN` do not trigger other workflows, which is why the sync job runs
verification itself and reports the result in the pull request. The sync job does not run Bun example smoke tests.
To trigger both regular CI checks, add a repository secret `SYNC_TOKEN` containing a fine-grained personal access
token or GitHub App token with *Contents: read/write* and *Pull requests: read/write* on this repository. The workflow
uses it automatically when present. Cloudflare preview builds triggered by the push are unaffected either way.

In the `main` branch protection or ruleset, require one review and these GitHub Actions checks by their exact job
names in `.github/workflows/ci.yml`:

- `Type check, test, validate and build`
- `Example smoke tests (Bun)`

When these checks are required, configure `SYNC_TOKEN` so automated sync pull requests can produce them. The
validation summary posted by the sync job does not satisfy the required CI checks. Cloudflare's `pnpm verify`
build command independently gates deployment on verification; branch protection gates merges on both CI jobs.

## Reviewing a sync pull request

1. Read the summary: which upstream commits and pages changed.
2. Review the content diff of the changed pages; it should mirror the upstream diff.
3. Check **new conversion issues**. Interactive widgets, dead upstream links and missing anchors are expected
   warnings; errors are not.
4. New upstream pages appear under "Other Pages" until they are placed in `src/config/navigation.ts` — add them in the
   same pull request.
5. New images: confirm they are documentation figures. Artwork, logos, photos of people and third-party content must
   be added to the asset policy in `scripts/docs/import.config.ts`, then re-run `pnpm docs:import`.
6. Merge. Cloudflare Pages deploys `main`.

## Conflicts

| Conflict | Meaning | Resolution |
| --- | --- | --- |
| "edited locally since the last import" | A generated file was changed by hand. | Move the change into the converter (or upstream), then re-import; or re-run with `--force` to discard it. |
| "not managed by the importer" | A local file exists where upstream added a page. | Rename the local page, or decide which one wins and update the manifest by re-importing. |
| "removed upstream, but edited locally" | Upstream deleted a page whose generated file was changed. | Delete or adopt the file as a local page (remove its `upstream` frontmatter). |

## Converter changes vs. upstream changes

Keep them in separate pull requests when possible: a converter change re-imports the *recorded* commit
(`pnpm docs:import`), so its diff shows only conversion differences; a sync shows only upstream differences.

## Rolling back

```sh
pnpm docs:sync --ref <previous commit>
```

re-imports an older upstream commit through the same safety rules and produces a normal reviewable diff.

## Versions

The current documentation set (Elysia 1.x) is imported from upstream `main`. When the upstream repository publishes
documentation for another release line (for example Elysia 2) on a separate branch or directory:

1. add the version to `src/config/versions.ts` with its own content prefix and upstream branch;
2. extend the importer to process one target per version — today `import.config.ts` describes a single target
   (`upstream` + `docVersion`), and the output path, manifest and sync summary would each gain a version dimension;
3. sync each version independently; the version selector appears once two sets are maintained.

Release notes already describe Elysia 2 beta; they are labelled with the version they announce and do not change the
label of the documentation set.
