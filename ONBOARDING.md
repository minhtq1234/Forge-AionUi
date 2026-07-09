# Onboarding — AionUi

This guide gets a coding agent (Codex, or any assistant without a native "skill"
system) productive in this repo quickly. Humans can read it too, but it is written
for agents: terse, imperative, and pointing at the canonical sources instead of
duplicating them.

## 1. Read these first, in order

1. **[AGENTS.md](AGENTS.md)** — the canonical project guide. Everything below is a
   fast index into it; **AGENTS.md wins on any conflict.**
2. **[CONTRIBUTING.md](CONTRIBUTING.md)** — required before you open a PR.
3. **[readme.md](readme.md)** — what the product is and how to run it.

`CLAUDE.md` only imports `AGENTS.md` (`@AGENTS.md`) for Claude Code — there is no
separate content there. `AGENTS.md` is the file you (Codex) load automatically.

## 2. How "skills" work for you

The repo's detailed workflows live as skill files under `.claude/skills/`. Claude
Code _invokes_ these through a skill system. **You do not have that mechanism — so
read the `SKILL.md` file directly, as plain Markdown, when its trigger applies.**

| Workflow     | Read this file                         | When                                                                  |
| ------------ | -------------------------------------- | --------------------------------------------------------------------- |
| architecture | `.claude/skills/architecture/SKILL.md` | Creating files/modules, deciding where code goes, reviewing structure |
| i18n         | `.claude/skills/i18n/SKILL.md`         | Adding/changing user-facing text; touching `locales/` or i18n config  |
| testing      | `.claude/skills/testing/SKILL.md`      | Writing tests, changing runtime behavior, claiming something works    |
| bump-version | `.claude/skills/bump-version/SKILL.md` | Bumping the app version / cutting a release                           |

## 3. The one rule you cannot break: process boundaries

This is an Electron app with two process types whose APIs must never mix:

| Process  | Path                             | Restriction     |
| -------- | -------------------------------- | --------------- |
| Main     | `packages/desktop/src/process/`  | No DOM APIs     |
| Renderer | `packages/desktop/src/renderer/` | No Node.js APIs |

Cross-process calls go through the IPC bridge (`packages/desktop/src/preload/`).
Shared, side-effect-free code lives in `packages/desktop/src/common/`. See the
**Architecture** section of [AGENTS.md](AGENTS.md#architecture) for details.

## 4. Hard blockers (a PR is rejected for any of these)

- Mixing main/renderer APIs, or unsafe IPC usage.
- TypeScript errors, `any`, or implicit returns (strict mode is on).
- New or changed user-facing text without i18n keys (no hardcoded strings).
- Raw interactive HTML (`<button>`, `<input>`, `<select>`, …) in new UI — use
  `@arco-design/web-react` components and `@icon-park/react` icons.
- Failing tests, or changed behavior with no focused test.

## 5. Conventions cheat-sheet

- **Naming**: components PascalCase; utilities and hooks camelCase (`useX`); type
  and constants files camelCase (values inside constants use `UPPER_SNAKE_CASE`).
- **CSS**: prefer UnoCSS utilities, CSS Modules for complex styles; **semantic
  color tokens only** — never hardcoded color values.
- **TypeScript**: path aliases `@/*`, `@process/*`, `@renderer/*`; prefer `type`
  over `interface`.
- **Directory size**: aim for ≤ 10 direct children per directory.

Full detail is in [AGENTS.md](AGENTS.md); this is only a reminder.

## 6. Dev loop

```bash
bun run lint:fix       # auto-fix lint (oxlint)
bun run format         # auto-format (oxfmt)
bunx tsc --noEmit      # typecheck
bun run test           # run tests (Vitest)
```

If you touch `packages/desktop/src/renderer/`, `locales/`, or the i18n config, also:

```bash
bun run i18n:types
node scripts/check-i18n.js
```

## 7. Committing & pushing

- **Do not push unless you were explicitly asked to.**
- When you do push, use **`just push`**, never `git push`. It runs
  lint → format-check → typecheck → i18n-check → test, then pushes; a failing step
  aborts. Judge success by **exit code**, not output volume — the repo has many
  pre-existing lint _warnings_ that are not failures.
- Commits and PR titles use Conventional Commits: `<type>(<scope>): <subject>`
  (`feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `chore`, `test`, `ci`, `build`).
- Fill in the PR body from `.github/pull_request_template.md`; check only what you
  actually verified.
- **Never add AI signatures** (`Co-Authored-By`, "Generated with …", etc.) to
  commits or PRs.

---

Stuck? `AGENTS.md` is the source of truth and the `.claude/skills/*/SKILL.md` files
are the deep dives. Read those before guessing.
