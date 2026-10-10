# Architecture

Elysia Reference is a static Astro + Starlight site. Most of its content is generated from the official ElysiaJS
documentation by an import pipeline that runs outside the site build.

```
github.com/elysiajs/documentation (VitePress)
        │  git (pinned commit)
        ▼
scripts/docs/import.ts ──► src/content/docs/**/*.mdx   (imported pages, `upstream` frontmatter)
   │                       public/upstream/**           (mirrored media)
   │                       src/generated/upstream-manifest.json
   │                       reports/migration-report.{md,json}
   │                       third-party/elysia-documentation/{LICENSE,SOURCE.md}
   ▼
astro build (Starlight) ──► dist/  ──► Cloudflare Pages
```

The import is a development-time step: its output is committed and reviewed. The production build never contacts the
upstream repository, so a broken or unreachable upstream cannot break a deploy.

## Site

### Content collection

All pages live in the Starlight `docs` collection (`src/content.config.ts`). The schema extends Starlight's frontmatter
with:

| Field | Meaning |
| --- | --- |
| `upstream.path`, `upstream.url` | Present on imported pages only: upstream source file and official page URL. Its presence is what marks a page as imported. |
| `docVersion` | Documentation set the page belongs to (`src/config/versions.ts`). |
| `release` | Version label, date and author of release notes. |
| `api` | Verification status of API reference entries. |

Imported pages keep the URL path of the official site (`/essential/route` → `/essential/route/`), so readers can move
between the two sites. Locally authored pages live under `project/` and `reference/`, which do not exist upstream.

### Starlight customization

Only documented extension points are used:

| Mechanism | Used for |
| --- | --- |
| `components` overrides | `SiteTitle` (adds the "Unofficial" label), `PageTitle` (breadcrumbs, version/source metadata, Markdown export), `Footer` (source notice and disclaimer), `EditLink` (imported pages link to the upstream source file). Each wraps the default component. |
| `routeMiddleware` (`src/routeData.ts`) | Canonical URL, `og:url` and `robots` per page from the SEO policy. |
| `sidebar` | Built from `src/config/navigation.ts` and the manifest. |
| `customCss` | `src/styles/theme.css`: colour tokens and a few content styles. |
| Content components | `Tabs`, `TabItem`, `CardGrid`, `LinkCard`, `Badge`, `Icon`, `Aside` from Starlight; three small local components for imported content (`InteractiveNotice`, `TutorialNotice`, `TutorialBadge`). |

Markdown is rendered by Astro 7's default Sätteri processor, configured with smart punctuation off so that `--flag`,
quotes and ellipses appear exactly as upstream (VitePress does not apply typographic replacements). Sätteri does not
run remark/rehype plugins; everything the content needs (image dimensions, heading-friendly badges) is therefore
resolved at import time.

### Static endpoints

- `/md/<slug>.md` — Markdown export of every page, used by "Copy as Markdown" (`src/pages/md/[...slug].ts`).
  Served with `X-Robots-Tag: noindex` (`public/_headers`).
- `/robots.txt` — allows crawling only on production deployments (`src/pages/robots.txt.ts`).
- `/sitemap-index.xml` — `@astrojs/sitemap`, filtered by the SEO policy.

The only client-side JavaScript beyond Starlight's own (search, tabs, theme) is the 20-line copy button.

### Information architecture

`src/config/navigation.ts` maps imported and local pages into task-oriented groups derived from the upstream sidebar:
Getting Started, Core Concepts, Patterns, Type Safety, OpenAPI & Observability, Testing, Runtimes & Deployment, Eden,
Plugins, Integrations, Internals, API Reference, Interactive Tutorial (text), Release Notes, Articles, About This Project.
The tutorial, release-note and article groups are generated from the manifest (upstream tutorial order; versions
newest first). `buildSidebar()` drops entries whose page no longer exists and appends pages that are not listed to an
"Other Pages" group, so an upstream change can neither break the build nor hide a page; `docs:check` reports both.

Breadcrumbs are derived from the same sidebar data.

### SEO policy

`src/config/seo.ts` decides per page:

| Page kind | Canonical | Indexing | Sitemap |
| --- | --- | --- | --- |
| Imported | official page on elysiajs.com | allowed | excluded |
| Local | self | allowed | included |
| Any page on preview/development deployments | (as above) | `noindex` | empty |

Imported pages are substantially copied, so they point search engines to the official page instead of competing with
it. Overrides per slug are supported for pages that become independently written. The canonical policy is verified on
the built HTML by `docs:check --dist`.

### Versions

`src/config/versions.ts` is the version registry. Each documentation set has an id (`1.x`), label, status, content
directory prefix and upstream branch. Today there is one set at the site root; release notes carry their own version
instead. The registry and the `docVersion` field let a second set (for example Elysia 2.x) be added under its own
prefix without restructuring; the version selector is only shown when more than one set is maintained. The evidence
for the current label (the `elysia` range the upstream docs pin for type-checking their examples) is recorded in the
manifest at import time.

## Import pipeline

Described in detail in [CONTENT_PIPELINE.md](CONTENT_PIPELINE.md). Modules:

| Module | Role |
| --- | --- |
| `scripts/docs/import.config.ts` | Editorial decisions: skipped pages, asset policy, link aliases. |
| `scripts/docs/lib/upstream.ts` | git: partial clone, fetch/checkout at a commit, diffs and logs. |
| `scripts/docs/lib/discover.ts` | Page discovery, upstream `srcExclude`, upstream sidebar and tutorial order. |
| `scripts/docs/lib/convert/preprocess.ts` | VitePress block rules → placeholders (fence-aware line scanner). |
| `scripts/docs/lib/convert/stitch.ts` | Rebuilds HTML/Vue element trees around Markdown nodes. |
| `scripts/docs/lib/convert/transform.ts` | Component mapping, links, images, code blocks. |
| `scripts/docs/lib/convert/code.ts` | Fence metadata, Twoslash, Shiki notations → Expressive Code. |
| `scripts/docs/lib/convert/index.ts` | Per-page orchestration, headings/anchors, MDX serialization. |
| `scripts/docs/lib/assets.ts` | Asset policy, dimensions, mirroring. |
| `scripts/docs/lib/literal.ts`, `html.ts`, `slug.ts` | Safe JS-literal parser, lenient HTML tokenizer, VitePress/Astro slug algorithms. |
| `scripts/docs/sync.ts` | Upstream comparison and change summary. |
| `scripts/docs/check.ts` | Source and built-site validation. |

## Key decisions

- **Generated content is committed.** Reviewable diffs, reproducible builds, no upstream dependency at deploy time.
- **Ownership by manifest.** The importer only writes or deletes files recorded in the previous manifest and refuses
  to overwrite generated files edited by hand, so local work is never lost silently.
- **MDX output for every imported page.** Uniform handling of components; the serializer escapes MDX-sensitive text.
  Every generated file is compiled during import, and an invalid page is not written.
- **Twoslash is rendered as static code.** Running Twoslash would require type-checking every example against the
  full Elysia dependency tree at build time. The code shown is exactly what the official site displays; the hover type
  information is not reproduced (reported per page).
- **Interactive widgets link to the official site.** Playgrounds and the in-browser tutorial need the official Vue
  runtime. Charts whose data is literal are rendered as tables instead.
- **Node.js type stripping for scripts.** No transpiler or extra dependency; `erasableSyntaxOnly` enforces compatible
  syntax.
- **No custom search, no server.** Pagefind (bundled with Starlight) indexes the static output.
