# Designer Brief — Apply the Forge Design System to AionUi

Status: draft for handoff. Prepared 2026-07-07. Owner: [stakeholder].
Companion to [../security/forge-adoption-decisions.md](../security/forge-adoption-decisions.md)
(this work is decision **D3, Layer 1** — rebrand + curate).

**Update (2026-07-07):** the Forge design system has been received (token CSS,
brand assets, guidelines) and **covers both light and dark**. §6 below is
**pre-filled with a proposed mapping** (light **and** dark) from the Forge tokens
onto AionUi's theme variables — the designer's job is to **validate and refine**
it, not build it from scratch, and to confirm the scope note in §0.

---

## 0. One decision to confirm (it bounds the work)

### D-B. This is a visual rebrand, not a product transplant

The Forge DS describes **VNG's agentic financial-reporting product** (report canvas
beside the chat, ECharts, doc/dashboard/infographic outputs, VND finance data).
AionUi is a **general-purpose agent chat app**. Applying the DS makes AionUi _look_
like Forge; it does **not** add Forge's reporting canvas, chart language, or finance
flows. Those are product/engineering scope beyond this brief. Confirm the intent is
"Forge-branded AionUi shell" for now, with the reporting product as later work.

_Dark mode:_ the Forge DS covers dark via its **dark-ground palette** (`--dark-900…600`,
`--dark-fg*`) with accents kept saturated — mapped in §6 alongside light. So AionUi's
light **and** dark themes are both in scope and both specified by the DS.

---

## 1. TL;DR for the designer

Forge is being built on top of **AionUi**, an open-source desktop AI-agent app
(Electron + React). We have a Forge **design system** already; your job is to **map
it onto AionUi's tokenized theming layer** (light + dark), validate the proposed
mapping in §6, deliver the brand assets, and specify the type/spacing/icon work the
token layer can't absorb (§7).

AionUi's colors are driven by **CSS variables** through a documented token system,
and it supports a **runtime theme JSON** — so the core deliverable is a **token
map**, not redrawn screens.

---

## 2. Context & constraints

- **Platform:** desktop app (macOS/Windows/Linux, Electron). Not a website.
- **Component library:** built on **Arco Design** (`@arco-design/web-react`) — we're
  keeping it. Restyle via tokens/overrides, don't rebuild primitives.
- **Icons:** AionUi currently uses **IconPark** (`@icon-park/react`); the **Forge DS
  specifies Lucide** (1.5–1.8px stroke, rounded caps) plus unicode glyphs for chrome
  (`+ ↑ ▾ ⋮ ✕ ⚑ ↻ ✓`) and **no emoji**. For fidelity this is an **icon-set swap
  (IconPark → Lucide)** — a larger, separate effort than color theming. Decide:
  swap to Lucide (`lucide-react`), or keep IconPark restyled to ~1.6px weight as an
  approximation. The Forge **mark** is the one true brand asset (don't redraw it).
- **Copy:** internationalized (i18n keys) — not freely editable in mockups.
- **Appearance:** both **light and dark** — both are specified by the DS (§6).

---

## 3. Scope

**In scope:** validate/refine the §6 color mapping (**light + dark**); deliver brand
assets (§6d); type + spacing/radius/shadow specs (§7); redline the key screens (§5)
to confirm the mapping reads in context in both appearances.

**Out of scope (unless separately requested):** new features/screens/IA; replacing
Arco or IconPark; the hosted/web deployment (Forge is desktop-only, decision D1);
Forge's reporting-product UX (see D-B); copywriting.

---

## 4. How theming works in AionUi (the seams you hand off to)

Colors flow through three layers; you work at Layer 1.

1. **Token values (plug in here):**
   [`styles/themes/default-color-scheme.css`](../../packages/desktop/src/renderer/styles/themes/default-color-scheme.css)
   — every CSS variable, light (`:root`) + dark blocks.
2. **Semantic → utility mapping:** [`uno.config.ts`](../../uno.config.ts) — which
   UnoCSS class uses which variable (reference only).
3. **TS constants & legacy hex map:**
   [`styles/colors.ts`](../../packages/desktop/src/renderer/styles/colors.ts).
4. **Component overrides:** [`styles/arco-override.css`](../../packages/desktop/src/renderer/styles/arco-override.css).

**Runtime theme JSON — the ideal handoff shape** (from
[`docs/theming/tokens.md`](../../docs/theming/tokens.md)):

```json
{
  "id": "forge-light",
  "name": "Forge",
  "appearance": "light",
  "tokens": { "--primary": "#F05A22", "--brand": "#374EA2", "--bg-base": "#EDEEF1", "--text-primary": "#14181F" }
}
```

---

## 5. Surfaces to review

`pages/`: **login** (logo/wordmark), **conversation** (primary UX — message list,
SendBox, slash/@ menus, markdown/code), **settings** (forms, modals, appearance),
**team**, **cron**, **guid** (onboarding), and **TestShowcase** (built-in component
gallery — use as your coverage checklist). Component groups: `agent`, `base`,
`chat`, `layout`, `media`, `settings`, `workspace`.

---

## 6. Proposed token mapping (validate & refine)

Forge values taken from `tokens/colors.css`. Mappings marked **⚠︎ judgment** need a
designer decision; the rest are direct.

> **Dark values source note.** The DS **readme** describes the dark theme
> (`data-theme="dark"`, luminance-inverted) but the referenced token file
> **`tokens/dark.css` was NOT in the delivered folder**, and its exact values don't
> appear elsewhere in the DS. The dark values below are taken from the readme's
> **prose** (anchor values only). **Obtain `tokens/dark.css` for the exact per-step
> ramps** before finalizing — treat every dark value here as provisional.
> (Do NOT use the infographic `colors-dark.card.html` palette — that's share/output
> ground, a different thing.)

### 6a. Brand & interactive

| AionUi token                             | → Forge **light**           | → Forge **dark**               | Notes                                                                                                                                             |
| ---------------------------------------- | --------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--primary` (actions, links, focus fill) | **`--forge-500` `#F05A22`** | **`#F05A22`** (unchanged)      | Orange is the **one constant across both themes** per the readme.                                                                                 |
| `--brand`                                | **`--navy-500` `#374EA2`**  | **`#4E63C0`** (navy lightened) | Readme: navy lightens on dark so fills/text hold contrast.                                                                                        |
| `--aou-6` (brand base)                   | **`#374EA2`**               | **`#4E63C0`**                  | ⚠︎ `--aou-1…10` ramp must be **derived** (Forge navy ships few steps); **invert** for dark per AionUi convention. Exact steps ← `tokens/dark.css`. |
| focus ring                               | **navy `--ring-focus`**     | navy (lightened)               | ⚠︎ Forge focus ring is navy, not orange.                                                                                                           |

### 6b. Surfaces & borders

| AionUi token                 | → Forge **light**               | → Forge **dark**              | Notes                                                                                      |
| ---------------------------- | ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `--bg-base` (app canvas)     | **`--surface-app` `#EDEEF1`**   | **`#0B0E14`** (deep backdrop) | ⚠︎ Light = cool-grey canvas / cream working / white cards; dark values ← `tokens/dark.css`. |
| `--bg-1` (working surface)   | **`--cream-100` `#FAF6EE`**     | between `#0B0E14`–`#1E2536`   | exact ← dark.css                                                                           |
| `--bg-2` (rail/sidebar)      | **`--cream-200` `#F6F0E4`**     | between `#0B0E14`–`#1E2536`   | exact ← dark.css                                                                           |
| card / raised surface        | **`--surface-card` `#FFFFFF`**  | **`#1E2536`** (cards/pages)   | Light cards are white.                                                                     |
| `--bg-hover` / `--bg-active` | derive from cream/ink           | derive from dark ramp         | ⚠︎ per mode.                                                                                |
| `--border-base`              | **`--border` `#DCDFE4`**        | dark hairline ← dark.css      | Readme: borders do more of the separating on dark.                                         |
| border on cream              | **`--cream-border` `#EAE1D3`**  | —                             | Warm border, light only.                                                                   |
| `--border-light`             | **`--border-subtle` `#ECEEF1`** | dark hairline ← dark.css      |                                                                                            |

### 6c. Text

| AionUi token              | → Forge **light**     | → Forge **dark**                         |
| ------------------------- | --------------------- | ---------------------------------------- |
| `--text-primary`          | `--ink-900` `#14181F` | cool **light** ink ramp top (← dark.css) |
| `--text-secondary`        | `--ink-600` `#5B6472` | light ramp step ← dark.css               |
| `--text-tertiary` / muted | `--ink-500` `#8A93A1` | light ramp step ← dark.css               |
| `--text-disabled`         | `--ink-300` `#C6CDD6` | light ramp step ← dark.css               |

> Readme: on dark the **ink ramp inverts to a cool light ramp** and **tints go
> dark-translucent** — get the exact steps from `tokens/dark.css`.

### 6c-2. Semantic state

| AionUi token | → Forge **light**      | → Forge **dark** | Notes                                                                                   |
| ------------ | ---------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `--success`  | `--pos-500` `#058B57`  | brightened       | Readme: semantic hues brighten on dark; exact ← dark.css. `--pos-400 #03CA77` for dots. |
| `--danger`   | `--neg-500` `#D64541`  | brightened       |                                                                                         |
| `--info`     | `--info-500` `#29A7DE` | brightened       |                                                                                         |
| `--warning`  | `--warn-500` `#E0A800` | brightened       |                                                                                         |

> Also available in the DS to map where AionUi has slots: tint bg/border pairs
> (`--forge-tint-*`, `--navy-tint-*`, `--pos-tint-*`, `--neg-tint-*`), gradients
> (`--forge-gradient`, `--sun-gradient`), and warm mono meta (`--warm-500`).

### 6d. Brand assets (provided — wire in, don't design)

From `forge-brand/`: `forge-mark.svg`, `forge-mark-ink.svg`, `forge-mark-white.svg`,
`forge-lockup-horizontal.svg`, and `favicon/forge-{16…512}.png`.

- Login/sidebar logo → lockup (horizontal) + mark; pick ink vs white per surface.
- **App icon**: dev generates `.icns`/`.ico`/`.png` from `forge-512.png` or a mark
  SVG master. Confirm the icon should be the mark on its brand background.

---

## 7. Non-color work the token layer can't fully absorb

- **Typography (needs CSS work + font bundling).** Forge type: **Manrope**
  (display/UI/numerals, 400–800, tight tracking), **Source Sans 3** (body), **IBM
  Plex Mono** (eyebrows/labels/data, uppercase wide tracking). AionUi only lightly
  tokenizes type, so this is real CSS work, plus:
  - **Bundle the three fonts locally.** The DS `fonts.css` pulls them from Google
    Fonts via `@import` — **do not ship that in the desktop app** (offline use,
    privacy, and it will violate a tightened CSP). Vendor the woff2 files and
    `@font-face` them locally.
  - Deliver the type scale to apply (`tokens/typography.css` has it: hero 40 / h1
    38 / h2 30 / h3 23 / body 15 / sm 13.5, plus tracking + tabular numerals).
- **Radius & spacing.** DS provides full scales (`radius.css`: 5→22px + pill;
  `spacing.css`: 4px grid). AionUi tokenizes these only partially — provide the
  scale; dev maps what's tokenized and does the rest in CSS.
- **Shadows.** DS `shadows.css` is distinctive (ink-tinted negative-spread + 1px
  contact; orange `--shadow-brand` glow on primary actions). Not a token swap —
  apply via component overrides.
- **Icons — IconPark → Lucide.** For fidelity the DS wants Lucide line icons
  (1.5–1.8px stroke). AionUi's icons are IconPark, imported per-component, so a full
  swap is a code-level effort (remap each icon usage), not a theming change. Scope
  this as its own task; interim option is to keep IconPark restyled to ~1.6px.

> **Good news on the dark mechanism:** the DS flips dark via `data-theme="dark"`
> overriding base tokens — this maps cleanly onto AionUi's own light/dark CSS-variable
> blocks in `default-color-scheme.css`. No per-component work either side; it's a
> token-value swap once `tokens/dark.css` values are in hand.

- **Hard-coded hex.** Some AionUi surfaces still carry literal hex (hence
  `colors.ts`'s hex→token map + a `MIGRATION.md`). A few spots won't recolor until
  migrated — log them for dev, don't work around them.

---

## 8. Deliverable & handoff format

1. **Validated Forge light + dark themes** — as two runtime theme JSON objects (§4)
   or a filled §6 table with both columns. _Starter files already generated from this
   mapping (application deferred):_ [`forge-themes/`](forge-themes/) — the designer
   validates/refines these rather than starting blank.
2. **Type spec + the 3 woff2 font files** (or confirmation to source them), per §7.
3. **Radius/spacing/shadow spec** for the CSS-level work.
4. **Brand assets** already provided (§6d) — confirm which logo variant per surface.
5. Optional: annotated redlines of the §5 screens (esp. conversation + TestShowcase).

Please **don't** deliver full-screen Figma redraws as the primary artifact — we're
restyling an existing app, not rebuilding it.

---

## 9. Inputs / open items

- [x] Forge design system — received (tokens, brand assets, guidelines).
- [ ] **`tokens/dark.css`** — referenced by the DS readme but **missing from the
      delivered folder**. Needed for exact dark ramp values (§6 dark columns are
      provisional from readme prose until then).
- [ ] **Icon-set decision**: swap IconPark → Lucide (fidelity, larger effort) vs.
      keep IconPark restyled.
- [ ] **Decision D-B**: confirm scope is "Forge-branded AionUi shell," reporting
      product later.
- [ ] The 3 webfonts as bundle-able woff2 (or OK to self-source from Google Fonts).
- [ ] Icon-set decision: keep IconPark (restyle) vs. adopt a Forge icon set.
- [ ] A running AionUi build (or screen recordings of §5) so the designer sees live
      states.

---

## 10. Acceptance criteria

- Validated Forge **light + dark** themes covering all §6 families, applied to AionUi.
- TestShowcase + conversation screen read as Forge in **both appearances**, with
  **WCAG AA** text contrast (verify the mapped values — e.g. orange `#F05A22` on
  white and on the `#0B111C` dark ground; ink and dark-fg ramps are fine).
- Fonts bundled locally (no Google `@import` in the shipped app).
- Brand assets wired at required formats/resolutions.
- Anything in the DS that couldn't be expressed via tokens is listed as explicit
  follow-up, not silently dropped.

---

### Assumptions in this brief

Written from inspecting both the AionUi codebase and the delivered Forge DS
(light + dark). The §6 mappings are my proposals for the designer to validate — the
⚠︎ judgment rows (brand ramp derivation + dark inversion, surface cream/grey/white
vs. dark-ground assignment, focus-ring color, orange-on-dark contrast) are the ones
most likely to need their eye. Assumes shell-rebrand scope (D-B) until you say
otherwise.
