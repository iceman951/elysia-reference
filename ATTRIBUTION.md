# Attribution

Elysia Reference is independent community documentation. It is not affiliated with or endorsed by the ElysiaJS
maintainers.

## ElysiaJS documentation

Most documentation pages of this site are adapted from the official ElysiaJS documentation.

| | |
| --- | --- |
| Project | ElysiaJS documentation |
| Repository | <https://github.com/elysiajs/documentation> |
| Published at | <https://elysiajs.com> |
| Authors | saltyAom and the [ElysiaJS documentation contributors](https://github.com/elysiajs/documentation/graphs/contributors) |
| License | MIT — full text in [`third-party/elysia-documentation/LICENSE`](third-party/elysia-documentation/LICENSE) |
| Copyright notice | Copyright 2022 saltyAom |
| Imported commit | recorded in [`third-party/elysia-documentation/SOURCE.md`](third-party/elysia-documentation/SOURCE.md) and `src/generated/upstream-manifest.json` |

### What is covered

- Pages under `src/content/docs/` whose frontmatter contains an `upstream` block (written by `pnpm docs:import`).
- Files under `public/upstream/` (diagrams, screenshots, charts and product videos copied from the upstream `docs/public`
  directory).

Each imported page links to its official counterpart and ends with a source notice that names the upstream file and the
exact commit. The upstream copyright notice and permission notice are reproduced in full on the site's
[Attribution & licensing](src/content/docs/project/attribution.mdx) page.

### Modifications

Imported pages are converted mechanically from VitePress Markdown to Starlight MDX: container, tab, card and code-block
syntax is converted; Twoslash setup code and type-query markers (hidden on the official site) are removed; interactive
Vue widgets are replaced by links to the official page; HTML comments and Vue `<script setup>` blocks are removed;
internal links are rewritten. Wording, API descriptions and code examples are not edited. Every lossy step is listed in
[`reports/migration-report.md`](reports/migration-report.md).

### Assets that are not copied

Brand assets (the ElysiaJS logo), mascot and character artwork, illustrations, photographs of people, third-party logos
and social-media content are not mirrored, even when they are stored in the upstream repository, because their rights
may differ from the documentation text. Release-note cover artwork is omitted; other such images are linked on the
official site. The exclusion rules live in `scripts/docs/import.config.ts` and the affected files are listed in the
migration report.

## This project

- Source code and locally authored pages (the homepage, `src/content/docs/project/` and
  `src/content/docs/reference/`): MIT License, see [`LICENSE`](LICENSE).
- The logo and visual design of Elysia Reference are original and unrelated to ElysiaJS branding.

## Third-party software

The site is built with open-source tools, used under their licenses:

- [Astro](https://github.com/withastro/astro) and [Starlight](https://github.com/withastro/starlight) — MIT
- [Pagefind](https://github.com/CloudCannon/pagefind) — MIT
- [Expressive Code](https://github.com/expressive-code/expressive-code) — MIT
- [unified](https://github.com/unifiedjs/unified), remark and mdast utilities — MIT
- [MDX](https://github.com/mdx-js/mdx) — MIT
