# Content pipeline

`pnpm docs:import` converts the official ElysiaJS documentation (VitePress) into Starlight MDX. This document
describes what it does, why, and how to extend it.

```sh
pnpm docs:import                    # re-import the commit recorded in the manifest (reproducible)
pnpm docs:import --ref <sha|branch> # import another upstream commit
pnpm docs:import --offline          # use the existing checkout without fetching
pnpm docs:import --dry-run          # convert and report, write nothing
pnpm docs:import --force            # also overwrite generated files that were edited by hand
```

Exit code 1 means a page failed to convert or a file conflict was found; both are listed in the report.

## 1. Retrieval

`scripts/docs/lib/upstream.ts` keeps a blob-less partial clone of
[elysiajs/documentation](https://github.com/elysiajs/documentation) in `.cache/upstream/` (git-ignored), fetches the
requested ref and checks out the exact commit. The commit SHA and date are recorded in the manifest. Per-file
last-modified dates come from `git log` and become each page's `lastUpdated` date.

## 2. Discovery

`scripts/docs/lib/discover.ts` lists every `.md` file under `docs/`, ignoring `.vitepress/`, `components/` and
`public/`. Pages are skipped when they match the upstream `srcExclude` setting (read from `.vitepress/config.ts`) or a
rule in `import.config.ts`; each skip has a written reason in the report. Non-page files in content directories (for
example tutorial `data.ts` files or the excluded `migrate/*.txt` drafts) are listed as well.

The upstream sidebar (`.vitepress/config.ts`) and the tutorial table of contents
(`docs/components/xiao/table-of-content.ts`) are read with a small, non-evaluating JavaScript literal parser
(`literal.ts`) to record each page's upstream group, label and order.

Version evidence: the `elysia` dependency range in the upstream `package.json` (used there to type-check examples) is
recorded in the manifest.

## 3. Conversion

Each page goes through these stages (`scripts/docs/lib/convert/`):

1. **Frontmatter** — YAML is parsed. `title` comes from the page's first `# H1` (the visible title upstream), else from
   the frontmatter title without the ` - ElysiaJS` suffix. `description` comes from the VitePress `head` meta tags.
   `search: false` becomes `pagefind: false`; `editLink: false` becomes `editUrl: false`.
2. **Pre-pass** (`preprocess.ts`) — a fence-aware line scanner that reproduces the VitePress block rules CommonMark does
   not have: `::: name` containers, component HTML blocks (`<Tab …>`, `<Playground`, `<template v-slot:…>` start a
   block that runs to the next blank line and may span lines or interrupt a paragraph), and `<script setup>` / `<style>`
   blocks (removed and reported). These constructs are replaced by one-line placeholder tags. The scanner also tracks
   which inline HTML lines start an HTML block, exactly like markdown-it.
3. **Parse** — `remark-parse` + `remark-gfm` (single-tilde strikethrough off, as in markdown-it).
4. **Stitch** (`stitch.ts`) — raw HTML fragments are tokenized (`html.ts`, which accepts Vue attribute syntax) and the
   element tree is rebuilt around the Markdown nodes between an opening and a closing tag, the same structure Vue sees.
   Containers are rebuilt the same way. Unclosed or unmatched tags are reported.
5. **Transform** (`transform.ts`) — component mapping, links, images and code (below).
6. **Headings** — the first H1 is removed (Starlight renders the title) and any component in it moves to a paragraph;
   further H1s become H2s. Upstream (VitePress) and local (Sätteri) heading IDs are computed for every heading so
   anchors can be rewritten. Whitespace before trailing badges is removed so IDs stay clean.
7. **Links** (second pass, across all pages) — see below.
8. **Serialize** — `mdast-util-to-markdown` with the GFM, MDX and directive extensions writes MDX that escapes `{`, `<`
   and other syntax-sensitive text. JSX attribute values are protected against entity decoding. The output is compiled
   with `@mdx-js/mdx`; a page that does not compile is not written.

### Mapping

| Upstream | Output |
| --- | --- |
| `::: tip/info/warning/danger [title]` | `:::tip/note/caution/danger[title]` Starlight asides |
| `::: note` (not a VitePress container) | `:::note` aside, reported as an upstream defect |
| `::: details [title]` | `<details><summary>` |
| `::: code-group` | `<Tabs>` with one `<TabItem>` per code block (label from `[label]`); synced when the labels are package managers. A second `::: code-group` inside an open group closes it (upstream typo), and non-code content follows the tabs, where VitePress also shows it. |
| `<Tab :names :tabs id>` + `<template v-slot:x>` | `<Tabs syncKey={id}>` with `<TabItem>`s in `tabs` order |
| `<Deck>` / `<Card title href>` | `<CardGrid>` / `<LinkCard>` (body → description) |
| `<Badge type text>` | Starlight `<Badge variant text>` |
| `<DocLink href>` | Markdown link |
| `<TutorialBadge>` / `<TutorialLink>` | Link badge / link card to the official interactive tutorial |
| `<Editor>` (tutorial) | Text lesson with `<TutorialNotice>`; `<template #answer>` → `<details>` "Show answer" |
| `<Blog>` (release layout) | Unwrapped; author/date → frontmatter; cover artwork omitted |
| `<Chart :items>` | Table built from the literal data in `<script setup>` (parsed, never executed) |
| `<Playground>`, `<Benchmark>`, `<JIT>`, `<Preview>` | `<InteractiveNotice>` linking to the official page; original markup kept in an MDX comment |
| `<AronaBanner>` (AI assistant) | Removed (reported) |
| Lucide icons in text | Starlight `<Icon>` or text |
| HTML elements | JSX elements; Vue bindings (`:x`, `@x`, `v-*`) removed and reported; `<iframe>` → link |
| Unknown tags (e.g. `<string>` typed in prose) | Literal text, reported |
| HTML comments | Removed (not rendered upstream); source in the report |

### Code blocks

- `lang [title]` → `lang title="title"`; titles use VitePress' greedy `\[(.*)\]` extraction.
- `twoslash` blocks are shown as the official site displays them: code above `// ---cut---` and below
  `// ---cut-after---`, compiler flags (`// @noErrors`, `// @errors: …`) and queries (`// ^?`, `// ^|`) are removed.
  `// @filename:` markers outside cut regions stay, as Twoslash shows them. Type hovers are not reproduced.
- Shiki notations `// [!code ++]`, `// [!code --]`, `[!code highlight]` (any comment style, with `:n` ranges, Shiki v3
  matching) become Expressive Code `ins={…}`, `del={…}` and `mark={…}`; other notations are removed and reported.
- `{1,3-5}` line highlights are passed through (same syntax in Expressive Code).

### Links and anchors

Upstream links use several spellings (`/essential/handler`, `/essential/handler.html#derive`, `/eden/overview.md`,
relative paths, absolute `https://elysiajs.com/…`). Each is resolved against the full upstream page list:

- imported page → local URL with a trailing slash; the anchor is mapped from the VitePress slug to the local heading ID
  (for example `#typebox-elysia-t` → `#typebox-elysiat`);
- page that exists upstream but is not imported → absolute URL on the official site;
- file in `docs/public` → asset handling;
- route generated by the upstream build (such as `/llms.txt` and `/llms-full.txt`, listed in `generatedRoutes` in
  `import.config.ts`) → absolute official URL with an informational note;
- nothing matches → absolute official URL, reported as `broken-link` (dead upstream link). `linkAliases` in
  `import.config.ts` can repair one when the intended target is unambiguous.

Anchors that match no heading or HTML `id` are reported as `broken-anchor` and kept unchanged.

### Assets

Only files referenced by imported pages are considered. They are copied to `public/upstream/<original path>` unless
excluded by `import.config.ts`:

- brand assets, logos, mascot/character artwork, illustrations, third-party content (path rules),
- individually reviewed files (`reviewedExclusions`, e.g. a personal photograph),
- release-note cover images declared by the `<Blog>` layout.

Excluded images are replaced by a link to the image on the official site (covers are omitted). Image dimensions are
written into the MDX (`width`/`height`) to avoid layout shift. Missing files are reported.

## 4. Output and safety rules

- Imported pages are written to `src/content/docs/<upstream path>.mdx` with a generated-file comment and an `upstream`
  frontmatter block.
- The importer writes or deletes only files listed in the previous manifest. A file at a target path that the manifest
  does not know, or a generated file whose hash differs from the recorded output (edited by hand), is reported as a
  conflict and left untouched unless `--force` is given.
- Pages removed upstream are deleted only if unmodified.
- Mirrored assets no longer referenced are removed from `public/upstream/` (a directory owned by the importer).
- Output is deterministic: no timestamps, stable ordering, `writeIfChanged`.

## 5. Manifest and report

`src/generated/upstream-manifest.json` records the upstream commit, license hash, version evidence, every page
(source and output hashes, slug, title, official URL, section, upstream navigation, issue counts, search flag),
every mirrored and excluded asset, skipped pages and ignored files. The site reads it for attribution, the sidebar,
the SEO policy and the Migration Status page.

`reports/migration-report.md` (summary) and `reports/migration-report.json` (every issue with the original source) are
committed. Issue severities:

| Severity | Meaning |
| --- | --- |
| error | Content could not be converted reliably; must be fixed. |
| warning | Converted with a known loss (e.g. interactive widget → link), or a defect in the upstream source (dead link). |
| info | Expected, intentional transformation recorded for transparency (removed script blocks, Twoslash markers, comments). |

## 6. Validation

`pnpm docs:check` validates the generated content (see the header of `scripts/docs/check.ts`); with `--dist` it
checks every internal link, anchor and asset in the built HTML. Known upstream anchor defects from the migration
report are warnings; any other broken link is an error.

## Extending the converter

To support a new upstream component:

1. Add a handler to `HANDLERS` in `transform.ts` (flow and phrasing modes) or, for widgets that cannot be rendered,
   add it to `INTERACTIVE_COMPONENTS`.
2. Register any new local component in `COMPONENT_MODULES` and create it under `src/components/imported/`.
3. Add a test to `tests/convert.test.ts`, run `pnpm docs:import`, and review the diff and the report.
