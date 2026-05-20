---
version: alpha
name: DJ Webview
description: >
  Design system for the DJ (dbt-json) VS Code extension webviews.
  IDE-native, dense, dark-first UI built with React 19, Tailwind CSS 3, and
  Headless UI. Tokens mirror the CSS variables in web/src/main.css; runtime
  values are swapped via the data-theme attribute on <html> across four themes
  (coder-dark, coder-light, web-dark, web-light). Hex values in this file
  reflect the dark-theme resolution; light-theme counterparts are listed in
  the Colors prose below.
colors:
  primary: '#1484ff'
  primary-contrast: '#ffffff'
  secondary: '#ef8903'
  secondary-contrast: '#ffffff'
  success: '#25891c'
  success-contrast: '#ffffff'
  error: '#ef4444'
  error-contrast: '#ffffff'
  info: '#3b82f6'
  info-contrast: '#ffffff'
  warning: '#eab308'

  background: '#1e1e1e'
  background-contrast: '#ffffff'
  surface: '#3c3c3c'
  surface-contrast: '#e5e7eb'
  card: '#252526'
  border: '#383838'
  border-contrast: '#cccccc'

  list-item-hover: '#302f2f'
  hierarchy: '#d0bcff'

  tag: '#1a4e86'
  tag-contrast: '#cee5ff'

  tab: '#252426'
  tab-contrast: '#1a1a1a'
  tab-active: '#8265bd'

  switch-on: '#1e40af'
  switch-off: '#6b7280'

  message-info: '#172554'
  message-info-contrast: '#3b82f6'
  message-info-border: '#003474'
  message-error: '#331818'
  message-error-contrast: '#ef4444'
  message-error-border: '#4a0a0a'
  message-success: '#112217'
  message-success-contrast: '#1aab4c'
  message-success-border: '#0e4423'

  layer-source: '#2d5a3d'
  layer-source-contrast: '#d4edda'
  layer-staging: '#774c1e'
  layer-staging-contrast: '#decebb'
  layer-intermediate: '#535964'
  layer-intermediate-contrast: '#e5e7eb'
  layer-mart: '#735813'
  layer-mart-contrast: '#dcd1af'

  transform-raw: '#1e4a7a'
  transform-raw-contrast: '#c5d9f1'
  transform-passthrough: '#1e4a7a'
  transform-passthrough-contrast: '#c5d9f1'
  transform-renamed: '#92610a'
  transform-renamed-contrast: '#fde8c4'
  transform-derived: '#5b4b8a'
  transform-derived-contrast: '#d8d1e8'

typography:
  display:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 1.5rem
    fontWeight: 700
    lineHeight: 2rem
  h1:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 1.5rem
    fontWeight: 700
    lineHeight: 2rem
  h2:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 1.25rem
    fontWeight: 600
    lineHeight: 1.75rem
  h3:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.75rem
  body-lg:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5rem
  body-md:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  body-sm:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1rem
  label:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 600
    lineHeight: 1.5rem
  caption:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1rem
  tiny:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 0.625rem
    fontWeight: 500
    lineHeight: 1rem
  code:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.25rem

rounded:
  none: 0px
  sm: 2px
  DEFAULT: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px

spacing:
  px: 1px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px

components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 8px 16px
    typography: '{typography.body-md}'
  button-primary-disabled:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-contrast}'
    rounded: '{rounded.DEFAULT}'
  button-secondary:
    backgroundColor: '{colors.background}'
    textColor: '{colors.primary}'
    rounded: '{rounded.DEFAULT}'
    padding: 4px 8px
    typography: '{typography.body-sm}'
  button-error:
    backgroundColor: '#b91c1c'
    textColor: '{colors.primary-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 8px 16px
    typography: '{typography.body-md}'
  button-neutral:
    backgroundColor: '#4b5563'
    textColor: '{colors.primary-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 8px 16px
    typography: '{typography.body-md}'
  button-icon:
    backgroundColor: transparent
    textColor: '{colors.background-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 8px
  button-outline-icon:
    backgroundColor: transparent
    textColor: '{colors.primary}'
    rounded: '{rounded.DEFAULT}'
    padding: 8px
  button-link:
    backgroundColor: transparent
    textColor: '{colors.primary}'
    padding: 8px 16px
    typography: '{typography.body-md}'

  input-text:
    backgroundColor: '{colors.background}'
    textColor: '{colors.background-contrast}'
    rounded: '{rounded.lg}'
    padding: 0 12px
    height: 40px
    typography: '{typography.body-md}'
  input-text-focus:
    backgroundColor: '{colors.background}'
    textColor: '{colors.background-contrast}'
    rounded: '{rounded.lg}'
  input-text-error:
    backgroundColor: '{colors.background}'
    textColor: '{colors.background-contrast}'
    rounded: '{rounded.lg}'

  select-single:
    backgroundColor: '{colors.background}'
    textColor: '{colors.background-contrast}'
    rounded: '{rounded.md}'
    padding: 10px 64px 10px 12px
    height: 40px
    typography: '{typography.body-md}'
  select-option-focus:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-contrast}'

  checkbox:
    backgroundColor: '{colors.background}'
    textColor: '#3b82f6'
    rounded: '{rounded.DEFAULT}'
    size: 16px
  checkbox-checked:
    backgroundColor: '#3b82f6'
    textColor: '{colors.primary-contrast}'
    rounded: '{rounded.DEFAULT}'

  switch-track-on:
    backgroundColor: '{colors.switch-on}'
    rounded: '{rounded.full}'
    height: 24px
    width: 44px
  switch-track-off:
    backgroundColor: '{colors.switch-off}'
    rounded: '{rounded.full}'
    height: 24px
    width: 44px
  switch-thumb:
    backgroundColor: '{colors.background}'
    rounded: '{rounded.full}'
    size: 16px

  tag:
    backgroundColor: '{colors.tag}'
    textColor: '{colors.tag-contrast}'
    rounded: '{rounded.md}'
    padding: 4px 8px
    typography: '{typography.body-sm}'

  tab:
    backgroundColor: '{colors.tab}'
    textColor: '{colors.background-contrast}'
    padding: 8px 12px
  tab-selected:
    backgroundColor: '{colors.tab-contrast}'
    textColor: '{colors.background-contrast}'
    padding: 8px 12px

  alert-success:
    backgroundColor: '{colors.success}'
    textColor: '{colors.success-contrast}'
    rounded: '{rounded.md}'
    padding: 16px
  alert-error:
    backgroundColor: '{colors.error}'
    textColor: '{colors.error-contrast}'
    rounded: '{rounded.md}'
    padding: 16px
  alert-info:
    backgroundColor: '{colors.info}'
    textColor: '{colors.info-contrast}'
    rounded: '{rounded.md}'
    padding: 16px
  alert-warning:
    backgroundColor: '{colors.warning}'
    textColor: '#1f2937'
    rounded: '{rounded.md}'
    padding: 16px

  message-info:
    backgroundColor: '{colors.message-info}'
    textColor: '{colors.message-info-contrast}'
    rounded: '{rounded.lg}'
    padding: 16px
  message-error:
    backgroundColor: '{colors.message-error}'
    textColor: '{colors.message-error-contrast}'
    rounded: '{rounded.lg}'
    padding: 16px
  message-success:
    backgroundColor: '{colors.message-success}'
    textColor: '{colors.message-success-contrast}'
    rounded: '{rounded.lg}'
    padding: 16px

  card:
    backgroundColor: '{colors.card}'
    textColor: '{colors.background-contrast}'
    rounded: '{rounded.lg}'
    padding: 24px
  list-item:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.background-contrast}'
    rounded: '{rounded.md}'
    padding: 16px
  list-item-hover:
    backgroundColor: '{colors.list-item-hover}'
    textColor: '{colors.background-contrast}'
    rounded: '{rounded.md}'

  dialog:
    backgroundColor: '{colors.card}'
    textColor: '{colors.background-contrast}'
    rounded: '{rounded.lg}'
    padding: 24px
  tooltip:
    backgroundColor: '#1f2937'
    textColor: '{colors.primary-contrast}'
    rounded: '{rounded.lg}'
    padding: 6px
    typography: '{typography.body-sm}'
  popover-panel:
    backgroundColor: '{colors.background}'
    textColor: '{colors.background-contrast}'
    rounded: '{rounded.md}'

  stepper-step-current:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-contrast}'
    rounded: '{rounded.full}'
    size: 32px
  stepper-step-completed:
    backgroundColor: '{colors.success}'
    textColor: '{colors.primary-contrast}'
    rounded: '{rounded.full}'
    size: 32px
  stepper-step-pending:
    backgroundColor: '#d1d5db'
    textColor: '#4b5563'
    rounded: '{rounded.full}'
    size: 32px

  table-header:
    backgroundColor: transparent
    textColor: '{colors.background-contrast}'
    typography: '{typography.label}'
    padding: 14px 12px

  layer-badge-source:
    backgroundColor: '{colors.layer-source}'
    textColor: '{colors.layer-source-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 2px 8px
    typography: '{typography.tiny}'
  layer-badge-staging:
    backgroundColor: '{colors.layer-staging}'
    textColor: '{colors.layer-staging-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 2px 8px
    typography: '{typography.tiny}'
  layer-badge-intermediate:
    backgroundColor: '{colors.layer-intermediate}'
    textColor: '{colors.layer-intermediate-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 2px 8px
    typography: '{typography.tiny}'
  layer-badge-mart:
    backgroundColor: '{colors.layer-mart}'
    textColor: '{colors.layer-mart-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 2px 8px
    typography: '{typography.tiny}'

  transform-badge-raw:
    backgroundColor: '{colors.transform-raw}'
    textColor: '{colors.transform-raw-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 2px 8px
    typography: '{typography.tiny}'
  transform-badge-passthrough:
    backgroundColor: '{colors.transform-passthrough}'
    textColor: '{colors.transform-passthrough-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 2px 8px
    typography: '{typography.tiny}'
  transform-badge-renamed:
    backgroundColor: '{colors.transform-renamed}'
    textColor: '{colors.transform-renamed-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 2px 8px
    typography: '{typography.tiny}'
  transform-badge-derived:
    backgroundColor: '{colors.transform-derived}'
    textColor: '{colors.transform-derived-contrast}'
    rounded: '{rounded.DEFAULT}'
    padding: 2px 8px
    typography: '{typography.tiny}'
---

# Overview

DJ Webview is the React 19 + Tailwind frontend rendered inside VS Code
webviews for the DJ (dbt-json) extension. It powers seven primary surfaces:
ModelCreate / SourceCreate wizards, the Home route, QueryView, ModelRun,
ModelTest, LightdashPreviewManager, and three lineage canvases (DataExplorer,
ModelLineage, ColumnLineage).

The aesthetic is **IDE-native developer tooling**: dense data over
decoration, sharp affordances, restrained color, dark-first. The UI must feel
like a first-class extension of the host editor, never a marketing site, and
must defer to VS Code's chrome (font, scrollbars, theme intent).

Three principles drive every visual decision:

- **Honor the host.** Adopt VS Code's color mode automatically by reading the
  `vscode-dark` / `vscode-light` body class; in standalone web mode, fall back
  to `prefers-color-scheme`. Switching is centralized in
  `web/src/context/environment.tsx` via the `data-theme` attribute on
  `<html>`.
- **Information density first.** Tables, lineage graphs, and JSON-driven
  forms are the primary content. Spacing, type, and elevation are tuned for
  scannability, not airiness.
- **One way to do each thing.** A single Button component owns seven
  semantic variants; one InputText, one SelectSingle, one Switch. Custom
  one-off styling is a code smell.

## Colors

The palette is encoded as CSS custom properties in
[web/src/main.css](src/main.css) and exposed to Tailwind via
[web/tailwind.config.js](tailwind.config.js). Components reference the
_semantic_ names (`bg-primary`, `text-background-contrast`,
`bg-surface`) rather than raw hex values, so a single set of class names
renders correctly across all four themes (`coder-dark`, `coder-light`,
`web-dark`, `web-light`).

### Brand colors (theme-invariant)

These four colors carry the same hex value in every theme:

- **Primary (`#1484ff`)** — the single driver for interaction. Buttons,
  active tabs, focus rings, switches in light mode, hyperlinks.
- **Secondary (`#ef8903`)** — accent for highlights and secondary CTAs;
  use sparingly.
- **Success (`#25891c`)** — confirmation states, completed stepper marks.
- **Warning (`#eab308`)** — non-blocking caution alerts.

`Error` deliberately differs by mode: it is `#b00020` (deep red) in light
themes for legibility on white, and `#ef4444` (lighter red) in dark themes.

### Theme modes — light vs dark resolution

Every variable below is defined in `main.css` under both
`html[data-theme='*-light']` and `html[data-theme='*-dark']`. The YAML
front matter uses the dark resolution; the table is the authoritative
mapping for the runtime.

| Token (CSS var)                    | Light                     | Dark            | Role                            |
| ---------------------------------- | ------------------------- | --------------- | ------------------------------- |
| `--color-background`               | `#ffffff`                 | `#1e1e1e`       | App canvas                      |
| `--color-background-contrast`      | `#242424`                 | `#ffffff`       | Default text                    |
| `--color-surface`                  | `#f1f1f3`                 | `#3c3c3c`       | Subtle inset surfaces           |
| `--color-surface-contrast`         | `#242424`                 | `#e5e7eb`       | Text on surface                 |
| `--color-card`                     | `#f9fafb`                 | `#252526`       | Elevated panels, dialogs        |
| `--color-border`                   | `#cccccc`                 | `#383838`       | Default divider                 |
| `--color-border-contrast`          | `#383838`                 | `#cccccc`       | Strong divider                  |
| `--color-error`                    | `#b00020`                 | `#ef4444`       | Destructive / invalid           |
| `--color-list-item-hover`          | `#ededed`                 | `#302f2f`       | List row hover                  |
| `--color-tag`                      | `#cee5ff`                 | `#1a4e86`       | Tag chip background             |
| `--color-tag-contrast`             | `#1a4e86`                 | `#cee5ff`       | Tag chip text                   |
| `--color-tab`                      | `#faf8ff`                 | `#252426`       | Inactive tab strip              |
| `--color-tab-contrast`             | `#f1f1f166` (translucent) | `#1a1a1a`       | Active tab body                 |
| `--color-tab-active`               | `#8265bd`                 | `#8265bd`       | Active tab indicator            |
| `--color-switch-on`                | `#1484ff`                 | `#1e40af`       | Switch track (on)               |
| `--color-switch-off`               | `#d1d5db`                 | `#6b7280`       | Switch track (off)              |
| `--color-hierarchy`                | `#432c7a`                 | `#d0bcff`       | Column lineage hierarchy stroke |
| `--color-message-info`             | `#eff6ff`                 | `#172554` @ 85% | Info message bg                 |
| `--color-message-info-contrast`    | `#2563eb`                 | `#3b82f6`       | Info message fg                 |
| `--color-message-info-border`      | `#8aa2d8`                 | `#003474`       | Info message border             |
| `--color-message-error`            | `#fee2e2` @ 75%           | `#331818` @ 85% | Error message bg                |
| `--color-message-error-contrast`   | `#bc2121`                 | `#ef4444`       | Error message fg                |
| `--color-message-error-border`     | `#f89191`                 | `#4a0a0a`       | Error message border            |
| `--color-message-success`          | `#edfdf2`                 | `#112217`       | Success message bg              |
| `--color-message-success-contrast` | `#027e2d`                 | `#1aab4c`       | Success message fg              |
| `--color-message-success-border`   | `#6ae594`                 | `#0e4423`       | Success message border          |

### Domain palettes — Lineage views only

Two sealed palettes are reserved for the data-explorer / model-lineage /
column-lineage canvases. They must **not** appear elsewhere in the
product.

#### Layer badges (model-type stratification)

Used by node chips in [DataExplorer](src/pages/DataExplorer/) and
[ModelLineage](src/pages/ModelLineage/) to signal a model's position in
the dbt DAG.

| Layer        | Light bg / fg         | Dark bg / fg          | Meaning                           |
| ------------ | --------------------- | --------------------- | --------------------------------- |
| Source       | `#d4edda` / `#1b4332` | `#2d5a3d` / `#d4edda` | `stg_select_source`, raw upstream |
| Staging      | `#d5b899` / `#532d05` | `#774c1e` / `#decebb` | `stg_*` models                    |
| Intermediate | `#c4c9d1` / `#282828` | `#535964` / `#e5e7eb` | `int_*` models                    |
| Mart         | `#f3dc68` / `#43390b` | `#735813` / `#dcd1af` | `mart_*` models                   |

#### Transformation badges (column lineage)

Used by [ColumnLineage](src/pages/ColumnLineage/) to classify how a
column was produced.

| Transform   | Light bg / fg         | Dark bg / fg          | Meaning                         |
| ----------- | --------------------- | --------------------- | ------------------------------- |
| Raw         | `#c5d9f1` / `#2c5282` | `#1e4a7a` / `#c5d9f1` | Source column, untransformed    |
| Passthrough | `#c5d9f1` / `#143b61` | `#1e4a7a` / `#c5d9f1` | Selected verbatim from upstream |
| Renamed     | `#fde8c4` / `#4d3505` | `#92610a` / `#fde8c4` | Selected with alias             |
| Derived     | `#d8d1e8` / `#553c9a` | `#5b4b8a` / `#d8d1e8` | Computed expression             |

## Typography

UI copy uses the host system stack (`ui-sans-serif`, `system-ui`,
`sans-serif`) so the webview blends into VS Code; code blocks and inline
code use `ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`.
There are no custom web fonts and no font loading at runtime.

| Role      | Tailwind utility                    | Size / line-height  | Weight | Where it appears                                                          |
| --------- | ----------------------------------- | ------------------- | ------ | ------------------------------------------------------------------------- |
| Display   | `text-2xl font-bold`                | 1.5rem / 2rem       | 700    | Page hero (`Home.tsx`)                                                    |
| H1        | `text-2xl`                          | 1.5rem / 2rem       | 700    | Wizard step titles                                                        |
| H2        | `text-xl`                           | 1.25rem / 1.75rem   | 600    | Card / panel headers                                                      |
| H3        | `text-lg`                           | 1.125rem / 1.75rem  | 600    | Sub-section headers                                                       |
| Body LG   | `text-base`                         | 1rem / 1.5rem       | 400    | Long-form descriptions                                                    |
| Body MD   | `text-sm`                           | 0.875rem / 1.25rem  | 400    | Default UI body                                                           |
| **Label** | `text-sm/6 font-semibold leading-6` | 0.875rem / 1.5rem   | 600    | All form field labels (`InputText`, `SelectSingle`, `TagInput`, `Switch`) |
| Body SM   | `text-xs`                           | 0.75rem / 1rem      | 400    | Captions, helper text, table cells                                        |
| Tiny      | `text-tiny`                         | 0.625rem / 1rem     | 500    | Layer / transform badges                                                  |
| Code      | `font-mono`                         | 0.8125rem / 1.25rem | 400    | `CodeBlock`, inline `<code>`                                              |

The **label** style is canonical for any input-adjacent text — see
[InputText.tsx](src/elements/InputText.tsx) and replicated in
`SelectSingle`, `TagInput`, `ButtonGroup`. Errors use `text-error text-xs
italic`; helper descriptions use `text-sm/6`.

Two font weights per screen is the practical maximum; only escalate to a
third (e.g. `font-bold` for an emphasised number in a metric tile) when
information hierarchy demands it.

## Layout

Webviews are constrained by VS Code panel/tab dimensions, so the layout
strategy is **fluid by default**, container-query aware where the same
component renders in both side-panel and full-tab contexts. Container
queries are wired in via `@tailwindcss/container-queries` (see
[tailwind.config.js](tailwind.config.js)).

- **Spacing scale** — Tailwind's 4px base scale. Common steps used in this
  codebase: `gap-2` (8px), `gap-4` (16px), `p-2` (8px), `p-4` (16px),
  `p-6` (24px), `space-y-6` for stacked dialog content. Half-steps (`p-3`,
  `gap-3`) are acceptable for input internals only.
- **Form inputs** — fixed 40px (`h-10`) height for `InputText` and
  `SelectSingle`; switches are 24px tall (`h-6 w-11`); checkboxes are 16px
  (`size-4`). Buttons are 32px tall (`py-2 px-4`) by default and 28px
  (`py-1 px-2`) for the secondary variant.
- **ModelCreate wizard layout** — `main.css` declares
  `--header-height: 56px` and `--stepper-height: 61px` and uses
  `calc(100vh - var(--header-height) - var(--stepper-height))` to keep the
  wizard locked to viewport height with `overflow-y: hidden`. The
  `live-preview` pane subtracts a further `--heading-height (36px)`,
  `--select-button-height (52px)`, and two `--gap-height (16px)` to keep
  the SQL preview pane scrollable but trimmed to the available space.
- **Diff views** — split mode uses a 2-column CSS grid with `subgrid`
  inheritance for header/content alignment (see `.diff-view-split` in
  `main.css`).
- **Lineage canvases** use `@xyflow/react` with `@dagrejs/dagre` layout;
  React Flow controls drag/zoom, so dropdowns inside nodes (e.g.
  `SelectSingle`) explicitly stop event propagation on `mousedown`,
  `mouseup`, `dblclick`, and `wheel` to prevent the canvas from
  hijacking interaction.
- **Z-index ladder** — `z-10` for inline overlays (suggestion lists),
  `z-50` for popovers and route-level dialogs, `z-[9999]` for
  combobox / tooltip panels that must escape React Flow stacking
  contexts. Do not invent intermediate values.

## Elevation & Depth

Depth is conveyed primarily by **tonal layering and 1px borders**, not by
shadows. This matches VS Code's flat aesthetic and avoids visual noise in
dense data views.

- **Layer 0 — App canvas:** `bg-background` (no shadow, no border).
- **Layer 1 — Inset surfaces:** `bg-surface` for list rows, button-group
  backgrounds, number stepper cells.
- **Layer 2 — Cards & elevated panels:** `bg-card` with `rounded-lg`; no
  shadow in the default panel context.
- **Rings over shadows for inputs:** focus and error states use
  `ring-1 ring-inset` / `focus:ring-2 ring-primary` / `ring-error` rather
  than box-shadow halos.
- **Modal layer (overlays only):** `DialogBox` is the single component
  permitted to use `shadow-xl` together with a `bg-black/75` backdrop and
  an explicit border tint by variant (`border-red-500/50`,
  `border-yellow-500/50`, `border-blue-500/50`).
- **Menu / popover layer:** dropdowns and tooltip panels use
  `shadow-lg ring-1` to lift above the canvas, never `shadow-xl`.

The Tailwind shadow scale (`shadow-sm`, `shadow`, `shadow-md`,
`shadow-lg`, `shadow-xl`, `shadow-2xl`, `shadow-inner`) is available, but
in practice only `shadow-sm`, `shadow-lg`, and `shadow-xl` should appear
in new code, and only in the contexts above.

## Shapes

A **two-radius system** keeps the language coherent: 4px for chips and
buttons, 8px for containers, full radius for circles. Sharp corners are
reserved for tab strips and table headers, where alignment to a hard grid
matters.

| Token     | px   | Tailwind       | Use                                                                    |
| --------- | ---- | -------------- | ---------------------------------------------------------------------- |
| `none`    | 0    | `rounded-none` | Tab strip, table header row, code block edges                          |
| `sm`      | 2    | `rounded-sm`   | Rare; legacy compatibility only                                        |
| `DEFAULT` | 4    | `rounded`      | Buttons, layer / transform badges, small chips, alerts                 |
| `md`      | 6    | `rounded-md`   | Inputs, select, tags, popover panels, list items                       |
| `lg`      | 8    | `rounded-lg`   | Cards, dialogs, messages, tooltips, switch cards                       |
| `xl`      | 12   | `rounded-xl`   | Reserved (currently unused)                                            |
| `full`    | 9999 | `rounded-full` | Switch tracks/thumbs, stepper step circles, spinner, progress bar fill |

Shape rules are absolute: a button is always `rounded` (4px), an input is
always `rounded-md` or `rounded-lg`, a dialog is always `rounded-lg`. Do
not mix radii within the same component.

## Components

Every component lives in [web/src/elements/](src/elements/) and is
exported from [src/elements/index.ts](src/elements/index.ts). Components
wrap Headless UI primitives (`@headlessui/react`) so accessibility, focus
management, and keyboard behaviour come for free — preserve those
wrappers when extending.

### Button — [Button.tsx](src/elements/Button.tsx)

Single component, seven variants. `loading` swaps the label for a
`<Spinner size={10} />` and disables the button.

| Variant             | Background      | Text                    | Border / ring                    | Notes                                          |
| ------------------- | --------------- | ----------------------- | -------------------------------- | ---------------------------------------------- |
| `primary` (default) | `bg-primary`    | `text-primary-contrast` | none                             | `py-2 px-4`, supports leading icon             |
| `secondary`         | `bg-background` | `text-primary`          | `ring-1 ring-inset ring-primary` | `py-1 px-2 text-xs font-semibold`, `shadow-sm` |
| `error`             | `bg-red-700`    | `text-white`            | hover `bg-red-600`               | Confirmation in destructive flows              |
| `neutral`           | `bg-gray-600`   | `text-white`            | hover `bg-gray-700`              | Cancel actions in `DialogBox`                  |
| `iconButton`        | transparent     | hover `text-primary`    | none                             | `p-2 rounded`, gap-1, optional trailing label  |
| `outlineIconButton` | transparent     | `text-primary`          | `border border-primary`          | `p-2 rounded`, icon + label                    |
| `link`              | transparent     | inherits                | none                             | `text-sm font-medium`, no padding by default   |

All variants support `fullWidth`, `disabled` (`opacity-50 cursor-not-allowed`),
and `loading`.

### Input controls

- **`InputText`** — labelled text input. 40px tall, `rounded-lg`,
  `ring-1 ring-[#D9D9D9] dark:ring-[#4A4A4A]`, focus `ring-2 ring-primary`,
  error `ring-2 ring-error`. Errors render as italic `text-error text-xs`
  beneath the field. Always pair with a `Label` (semibold, 14px / 24px
  line-height) and an optional `Tooltip` icon to the right of the label.
- **`SelectSingle`** — combobox built on Headless UI `Combobox`. 40px
  tall, `rounded-md`, `ring-1`, options panel uses `bg-background
rounded-md shadow-lg ring-1 ring-background-contrast ring-opacity-5
z-[9999]`. Focused options highlight with `bg-primary
text-primary-contrast`; selected items show a trailing `CheckIcon`.
  Stops React Flow event propagation when used inside lineage canvases.
- **`SelectMulti`** — multi-select combobox; same chrome as `SelectSingle`,
  with chips inside the trigger.
- **`Checkbox`** — 16px square, `rounded`, focus outline 2px primary at
  `outline-offset-2`. Checked state uses `bg-blue-500 border-blue-500`
  with white check icon; indeterminate state shows `MinusIcon`.
- **`RadioGroup`** — two variants: `standard` (native radios with labels)
  and `button-group` (segmented control where the active option uses
  `bg-primary text-primary-contrast rounded-md`).
- **`Switch`** — Headless UI switch. `base` size = `h-6 w-11` track with
  16px thumb; `sm` = `h-4 w-7` track with 12px thumb. `bg-switch-on` /
  `bg-switch-off`. Optional label position left or right.
- **`SwitchCard`** — `Switch` wrapped in a `p-6 border-2 border-neutral
rounded-lg bg-background` card; used for grouped settings.
- **`TagInput`** — chip-style input with `predefinedTags` autocomplete.
  Tags use the `bg-tag text-tag-contrast rounded-md` style and remove
  with `XMarkIcon`. Container is `rounded-lg ring-1`, mirrors
  `InputText` focus + error rings.
- **`NumberStepper`** — `−` / `+` buttons sandwiching a numeric display;
  buttons are `w-8 h-8` `bg-surface` with `border` and `rounded-l` /
  `rounded-r` corners; disabled buttons drop to `opacity-50`.
- **`ButtonGroup`** — segmented control: stacked column on small screens
  (rounded top/bottom), pill row on `lg+` (rounded-full); active option
  carries `bg-primary text-primary-contrast shadow`.

### Feedback & messaging

- **`Alert`** — full-bleed banner. Variants: `success` (default), `error`,
  `warning`, `info`. Each pulls `bg-${variant}` and
  `text-${variant}-contrast` plus a leading `CheckCircleIcon` (success /
  info / warning) or `XCircleIcon` (error). `rounded-md`, `p-4`.
- **`Message`** — softer informational block; variants `info` (default),
  `error`, `success`. Uses the dedicated `--color-message-*` tokens for
  background, text, and border, and is rounded-lg with `border` and
  `p-4`.
- **`DialogBox`** — modal confirm/discard dialog with three intent
  variants (`error` default / `warning` / `info`). `max-w-lg`, `bg-card`,
  `rounded-lg`, `shadow-xl`, `ring-1 ring-surface/20`, variant-tinted
  border. Backdrop `bg-black/75 fixed inset-0`. Optional `showDetails`
  exposes a collapsible technical details list.
- **`Tooltip`** — hover-triggered popover anchored bottom (or bottom
  start). Panel: `bg-gray-800 text-white text-xs p-1.5 rounded-lg
break-words max-w-[20rem]` with `shadow-lg ring-1 ring-black
ring-opacity-5`. Open delay 150ms, close delay 200ms.
- **`Popover`** — generic Headless UI popover wrapper for menus and
  panels; default panel chrome is `bg-background border border-border
rounded-md shadow-lg z-50`.
- **`Spinner`** — dual-arc SVG animated via `animate-spin`. Outer ring
  uses `text-primary-contrast`, inner arc uses `text-primary`. Default
  size 24px / stroke 5; the loading state inside `Button` shrinks to
  `size={10}`.
- **`Progress`** — overflow-hidden track with `bg-primary-contrast` fill;
  height `h-2`, `rounded-full`. Pair with optional `label` above and
  `caption` below.

### Navigation & structure

- **`Tab`** — Headless UI `TabGroup`. Tab strip uses `bg-tab` with each
  tab `px-3 py-2` and a 2px transparent bottom border that becomes
  `border-tab-active` (`#8265bd`) when selected; the selected tab also
  flips its background to `bg-tab-contrast`. Panels render in a `p-4
bg-tab-contrast` container.
- **`Stepper`** — horizontal indicator. Each step is a 32px
  (`w-8 h-8 rounded-full`) circle: pending = `bg-gray-300 text-gray-600`,
  current = `bg-primary text-white`, completed = `bg-green-500 text-white`
  with a `CheckIcon`. Connectors are 2px (`h-0.5`) bars: completed =
  `bg-green-500`, in-progress = `bg-primary`, pending = `bg-gray-500`.
- **`Box`** — neutral div wrapper with two opt-in variants: `padded`
  (`p-2`) and `bordered` (`border-2 border-solid p-2 rounded-md`).
- **`ListItem`** — `p-4 bg-surface text-background-contrast rounded-md
flex justify-between`; optional trailing `XMarkIcon` for removal.
- **`EditableList`** — drag-reorderable list (`@hello-pangea/dnd`) of
  `ListItem`s.
- **`Table`** — minimal data table: `min-w-full`; header row uses
  `border-b-2 border-b-background-contrast`, `py-3.5 pl-4 pr-3 text-left
text-sm font-semibold`. Body cells `whitespace-nowrap py-4 pl-4 pr-3
text-sm font-medium`.
- **`CodeBlock`** — `react-syntax-highlighter` with the `vs` (light) /
  `vs2015` (dark) HLJS theme, `1rem` padding. Supports `json`, `yaml`,
  `sql`, `bash`. Optional `wrapLines` and `showLineNumbers`. Inside
  `live-preview`, `final-preview`, `dbt-run-preview`, and
  `compiled-sql-preview` containers, `pre code` is reset to inherit
  colours and font (see `main.css`).
- **`DiffView`** — unified or split diff using the `diff` library; split
  view uses a CSS grid with `subgrid` to align headers and content.
- **`Icon`** — typed registry wrapper for SVGs imported via
  `vite-plugin-svgr`. Icons use `currentColor` so colour comes from
  Tailwind text utilities on the wrapping element.

### Domain-only components (lineage)

Layer badges and transformation badges are the only place the
domain-specific palettes appear. Both are 4px-rounded tiny pills with
`text-tiny` (10px) typography, `px-2 py-0.5` padding, and use the
`bg-layer-*` / `bg-transform-*` Tailwind utilities defined in
`tailwind.config.js`.

## Do's and Don'ts

### Do

- Do reference semantic tokens (`bg-primary`, `text-background-contrast`,
  `bg-surface`, `bg-card`) so the four themes resolve correctly. Hex
  literals are acceptable only when no semantic token exists (e.g.
  `ring-[#D9D9D9] dark:ring-[#4A4A4A]` in `InputText`).
- Do pair every contrast: text on `bg-primary` must use
  `text-primary-contrast`; text on `bg-tag` uses `text-tag-contrast`; and
  so on for the layer/transform palettes. Never compose
  `bg-primary text-background-contrast`.
- Do honor `data-theme` switching — components render once and adapt at
  runtime via CSS variables. Don't branch on theme in TS.
- Do respect WCAG AA (4.5:1) for body text and (3:1) for large/labels;
  the contrast pairs in this file have been chosen to meet AA.
- Do use Headless UI primitives (`Button`, `Combobox`, `Tab`, `Switch`,
  `Checkbox`, `Dialog`, `Popover`) and preserve their `data-[selected]`,
  `data-[checked]`, `data-[focus]`, `data-[disabled]` styling hooks.
- Do reuse the seven `Button` variants. New CTA styling goes inside
  `Button.tsx` as a new variant, never as bespoke classes at the call
  site.
- Do constrain shadows to `Spinner` containers (`shadow-sm`), popover and
  tooltip panels (`shadow-lg`), and modal dialogs (`shadow-xl`).
- Do stop event propagation on `mousedown`, `mouseup`, `dblclick`, and
  `wheel` for any interactive control rendered inside a React Flow
  canvas (`SelectSingle` is the reference implementation).
- Do place form labels above the field with `text-sm/6 font-semibold
leading-6`, and put a `Tooltip` icon inline to the right of the label
  for help text.

### Don't

- Don't introduce a fourth border-radius value or a third shadow tier.
  The shape and elevation systems above are closed.
- Don't apply heavy shadows for depth in dense data views — use tonal
  layers (`bg-background` → `bg-surface` → `bg-card`) and 1px borders.
- Don't use the layer (`source` / `staging` / `intermediate` / `mart`)
  or transformation (`raw` / `passthrough` / `renamed` / `derived`)
  palettes outside the `DataExplorer`, `ModelLineage`, and
  `ColumnLineage` views. They carry domain meaning that must not be
  diluted.
- Don't use raw Tailwind colour scales (`bg-blue-500`, `text-red-700`)
  for new UI. Existing usages — `Checkbox` (`bg-blue-500`), `Stepper`
  completed step (`bg-green-500`), `Button` `error` variant
  (`bg-red-700`), `Button` `neutral` variant (`bg-gray-600`),
  `DialogBox` backdrop tints — are grandfathered. New code maps the
  intent to a semantic token instead.
- Don't put more than two font weights on a single screen. Prefer size
  contrast over weight contrast.
- Don't use `font-bold` for body copy; reserve it for `Display` / `H1`.
- Don't bypass `Headless.Button`, `Combobox`, etc. with raw `<button>`
  / `<select>` elements unless the existing component truly cannot
  render the case — and then extend the component, don't fork it.
- Don't hard-code `light` or `dark` colour values. If you need a value
  the variable system doesn't yet expose, add the variable to
  `main.css` under both light and dark themes first.
- Don't override `vscode-editor-background` from React; the override in
  `main.css` is intentional and webview-scoped.
- Don't invent z-index values between the documented tiers (`z-10`,
  `z-50`, `z-[9999]`).
