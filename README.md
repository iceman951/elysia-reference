# Elysia Reference

**A clearer, structured reference for ElysiaJS.**

Elysia Reference is an unofficial, independent, community-maintained documentation site for
[ElysiaJS](https://elysiajs.com). It republishes the official documentation with a documentation-first design and
navigation, keeps it in sync with the official repository through reviewed pull requests, and adds a small, strictly
verified API reference.

> **Unofficial project.** Independent community documentation. Not affiliated with or endorsed by the ElysiaJS
> maintainers. The authoritative documentation is at [elysiajs.com](https://elysiajs.com).

## What is in this repository

| Path | Contents |
| --- | --- |
| `src/content/docs/` | Site content. Imported pages carry an `upstream` frontmatter block; everything else is local. |
| `src/content/docs/project/`, `src/content/docs/reference/`, `index.mdx`, `404.md` | Locally authored pages. |
| `src/config/` | Site settings, navigation (information architecture), SEO policy, version registry. |
| `src/components/` | Starlight overrides (header, page title, footer, edit link) and site components. |
| `src/generated/upstream-manifest.json` | Import manifest: upstream commit, every imported page and asset, hashes, issue counts. |
| `public/upstream/` | Media mirrored from the upstream repository. |
| `scripts/docs/` | Import, sync and check commands, and the VitePress → Starlight converter. |
| `scripts/examples/` | Smoke tests that run selected documentation examples against Elysia. |
| `tests/` | Unit and consistency tests (`node:test`). |
| `reports/` | Migration report (committed) and per-run reports (ignored). |
| `third-party/elysia-documentation/` | Upstream license and source notice. |
| `docs/` | Project documentation (architecture, pipeline, sync, deployment). |

## Technology

- [Astro](https://astro.build) 7 and [Starlight](https://starlight.astro.build) 0.42, static output only
- TypeScript in strict mode; scripts run directly on Node.js type stripping (no build step)
- Markdown/MDX processed by Astro's default Sätteri processor; code blocks by Expressive Code
- [Pagefind](https://pagefind.app) search (built into Starlight)
- pnpm, Node.js 24 LTS (`.node-version`)
- Cloudflare Pages for hosting, GitHub Actions for CI and upstream synchronization

There is no server, database, analytics or third-party script.

## Requirements

- Node.js ≥ 22.18 (24 LTS recommended; see `.node-version`)
- pnpm 10 (`corepack enable` or `npm install -g pnpm@10`; the exact version is in `package.json` → `packageManager`)
- git (for `docs:import` / `docs:sync`)
- Bun, only for `pnpm examples:smoke`

## Installation and local development

```sh
pnpm install
pnpm dev          # http://localhost:4321
```

The imported content is committed, so the site runs without contacting the upstream repository.

## Production build

```sh
pnpm build        # static site in dist/
pnpm preview      # serve dist/ locally
```

Set `SITE_URL` to the public origin for production builds (it is used for canonical URLs, the sitemap and
`robots.txt`); see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Quality checks

```sh
pnpm typecheck        # astro check + tsc (strict)
pnpm test             # converter, parser, config and manifest-consistency tests
pnpm docs:check       # content checks: manifest, attribution, leftover VitePress syntax, navigation, links, assets
pnpm build
pnpm docs:check --dist  # built-site checks: every internal link/anchor/asset, canonical policy, a11y basics
pnpm verify           # all of the above in order
pnpm examples:smoke   # runs selected documented examples with Bun against the pinned Elysia version
```

## Importing the official documentation

```sh
pnpm docs:import                 # rebuild from the commit recorded in the manifest (reproducible)
pnpm docs:import --ref <sha>     # import a specific upstream commit or branch
```

The importer clones [elysiajs/documentation](https://github.com/elysiajs/documentation) into `.cache/upstream/`,
converts every eligible page to Starlight MDX, mirrors permitted media, and writes the manifest and
[`reports/migration-report.md`](reports/migration-report.md). It never overwrites locally authored files or generated
files that were edited by hand. Details: [docs/CONTENT_PIPELINE.md](docs/CONTENT_PIPELINE.md).

## Keeping up with upstream

```sh
pnpm docs:sync    # move to the latest upstream commit and write reports/sync-summary.md
```

A weekly GitHub Actions workflow runs the sync, validates the result and opens (or updates) a pull request.
Nothing is published until that pull request is reviewed and merged. Details: [docs/SYNC_STRATEGY.md](docs/SYNC_STRATEGY.md).

## Deployment

The site deploys to Cloudflare Pages with its Git integration: production from `main`, previews for pull requests,
build command `pnpm build`, output directory `dist`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Current import

The latest import status (upstream commit, imported and skipped pages, conversion issues) is in
[`reports/migration-report.md`](reports/migration-report.md) and on the site's *Migration Status* page.

## License and attribution

- **Imported documentation** (pages with `upstream` frontmatter, files in `public/upstream/`): adapted from the ElysiaJS
  documentation by saltyAom and contributors, MIT License, Copyright 2022 saltyAom. The full license is in
  [`third-party/elysia-documentation/LICENSE`](third-party/elysia-documentation/LICENSE).
- **This project's code and locally authored content**: MIT License, see [`LICENSE`](LICENSE).
- Brand assets, mascot artwork and other media with unclear rights are not copied. See [ATTRIBUTION.md](ATTRIBUTION.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Content errors belong in the
[official documentation repository](https://github.com/elysiajs/documentation); conversion, navigation and site
problems belong here.
