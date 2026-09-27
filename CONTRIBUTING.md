# Contributing

## Development environment

- Node.js 22+, pnpm 9.15.9, Python 3.12+, and `uv`.
- Install JavaScript dependencies with `pnpm install` and Chromium with `pnpm exec playwright install chromium`.
- Install the geometry worker with `uv sync --project python/glamour_cv --group dev`.

## Before committing

Run the same quality gates as CI:

```sh
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The workspace format, lint, and test scripts include Ruff and pytest in addition to Prettier, ESLint, and Vitest.

Add deterministic fixtures for behavior changes. Browser goldens and geometry integration checks use Playwright Chromium; do not compare screenshots captured from different OS/browser/font stacks as if they were equivalent. Python unit tests should keep generated images in pytest's temporary directory.

## Architecture

Put orchestration and visual contracts in `packages/core`. The CLI and MCP server must call those same core functions. Large image/vector payloads belong in the artifact store and MCP resources, not tool text. Keep schema changes versioned and retain provenance/confidence for supplied or inferred facts. Prefer measured deltas; represent unresolved conclusions as uncertainty. Keep source edits to the target application outside Glamour's transient override workflow.

## Commits and pull requests

Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `chore:`). Keep each commit focused; the commit-msg hook validates the subject and the pre-commit hook runs the complete workspace test suite. Pull requests should explain behavior, list verification commands and update the README when setup or product behavior changes. CI and CodeQL must pass before merge.

## Releases

Push a `vMAJOR.MINOR.PATCH` tag to create a GitHub Release. The release workflow repeats the complete CI quality gates, builds the workspace, and attaches a source archive for that exact commit. Releases are source distributions for this local MCP/CLI project; there is no hosted application runtime to deploy.
