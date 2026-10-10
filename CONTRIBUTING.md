# Contributing to Elysia Reference

Thank you for helping. Elysia Reference is an unofficial community project; please keep that framing in everything you
write.

## Where does my change belong?

| Problem | Where to fix it |
| --- | --- |
| Wrong, outdated or unclear documentation content | Upstream: [elysiajs/documentation](https://github.com/elysiajs/documentation). It reaches this site with the next sync. |
| A page converted incorrectly (broken tabs, lost content, wrong link) | Here: the converter in `scripts/docs/`, plus a test. |
| Navigation, design, search, accessibility | Here: `src/config/navigation.ts`, `src/components/`, `src/styles/`. |
| A page in the wrong sidebar group | Here: `src/config/navigation.ts`. |
| A new API reference entry | Here: `src/content/docs/reference/` (see below). |

**Never edit files that carry an `upstream` frontmatter block by hand.** They are regenerated on every sync, and
`pnpm docs:check` fails when a generated file differs from the import output. Fix the converter or the upstream
source instead.

## Setup

```sh
pnpm install
pnpm dev
```

Requirements are listed in the [README](README.md#requirements).

## Before opening a pull request

```sh
pnpm verify
```

runs the type check, unit tests, content checks, the build and the built-site checks. CI runs the same steps.

## Changing the converter

The pipeline is described in [docs/CONTENT_PIPELINE.md](docs/CONTENT_PIPELINE.md). When you change it:

1. Add or update a test in `tests/convert.test.ts` (end-to-end conversion of a small fixture) or the module's unit
   tests. Tests use `node:test`; no extra dependencies.
2. Re-run the import against the recorded commit: `pnpm docs:import`.
3. Review the content diff (`git diff src/content/docs`) and the change in `reports/migration-report.md`.
4. Commit the converter change together with the regenerated content, manifest and report.

Rules for conversions:

- Preserve wording, API descriptions and code examples exactly. Only syntax may change.
- Anything that cannot be converted must remain visible to readers (as a link or notice) and be reported with its
  original source. Never drop content silently.
- Prefer structured transformations (mdast, HTML tokens) over regular expressions on Markdown text.
- Keep output deterministic: the same upstream commit must produce byte-identical files.

## Editorial decisions

Decisions that are not mechanical live in `scripts/docs/import.config.ts` and must include a reason:

- skipped upstream pages,
- assets that are not mirrored (artwork, logos, photos of people, third-party content),
- link aliases for dead upstream links (only when the intended target is unambiguous).

## Navigation

`src/config/navigation.ts` defines the sidebar. When upstream adds a page, it appears under "Other Pages" and
`pnpm docs:check` reports it until it is placed in a group. Labels should follow the upstream sidebar unless they
contain a typo.

## API reference entries

Start from `src/content/docs/reference/_template.mdx`. An entry may be marked `status: verified` only when:

- `verifiedAgainst` names an exact published version (for example `elysia@1.4.28`),
- `source` is a permalink to the exact lines in the tagged source,
- the signature is copied verbatim from that source,
- every behavior statement is backed by that source or by the official documentation.

Otherwise use `status: unverified`. Do not describe behavior you have not verified.

## Commit messages

Use short, imperative subjects (`converter: keep video sources together`, `nav: add Cron plugin`). Upstream syncs use
`docs: sync upstream documentation to <commit>`.

## Code style

TypeScript strict mode (`astro/tsconfigs/strictest`) with `erasableSyntaxOnly`: scripts run directly on Node.js type
stripping, so no enums, namespaces or parameter properties. Tabs for indentation, single quotes.
