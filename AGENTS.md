# Repository Guidelines

## Project Structure & Module Organization

OpenOnyx is an Electron application with a React and TypeScript renderer. Renderer code lives in `src/`, organized into `components/`, `hooks/`, `utils/`, `lib/`, `types/`, and `styles/`. Electron main-process, preload, IPC, filesystem, and search code belongs in `electron/`. Tests are under `tests/`, with workflows in `tests/e2e/`. Runtime assets live in `public/`; packaging resources live in `build/`. Use `scripts/` for development and release tooling. `OO-Test-Vault/` is the repository-safe test vault. Do not edit generated `dist/`, `dist-electron/`, or `release/` output.

## Build, Test, and Development Commands

- `npm ci` installs the locked dependencies; use Node.js 22 or newer.
- `npm run dev` type-checks Electron, then starts Vite and Electron.
- `npm run build` compiles the renderer and Electron bundles.
- `npm run lint` performs the TypeScript no-emit validation.
- `npm test` runs the default Vitest suite once.
- `npm run test:watch` reruns affected tests during development.
- `npm run test:all-checks` runs the extended compatibility checks.
- `npm run package:linux` creates Linux packages in `release/`; equivalent Windows and macOS scripts are available.

## Coding Style & Naming Conventions

Use TypeScript/TSX with two-space indentation and preserve the quote style of the file being edited. Name React components and types in PascalCase, functions and variables in camelCase, hooks with a `use` prefix, and true constants in UPPER_SNAKE_CASE. Prefer explicit types at process and IPC boundaries and `import type` for type-only imports. Renderer code must access native capabilities through the preload API. Reuse Tailwind utilities and existing theme variables instead of hard-coded colors.

## Testing Guidelines

Vitest is the primary framework. Name tests `tests/<feature>.test.ts`; place multi-step application workflows in `tests/e2e/`. Add a regression test for every fixed bug and use jsdom only where browser APIs are needed. Run the targeted test first, then `npm test` and any relevant plugin or compatibility check. No numeric coverage threshold is enforced.

## Commit & Pull Request Guidelines

Follow the repository's focused Conventional Commit style, such as `feat: add cited search` or `fix(ipc): validate vault path`. Pull requests should explain user-visible behavior, link relevant issues, list verification commands, and include screenshots or recordings for UI changes. Note platform-specific packaging effects and keep generated artifacts, personal vault data, and secrets out of commits.

## Agent-Specific Instructions

Do not launch the application unless the user explicitly requests it. Starting it is permitted when the stated task is to monitor or diagnose live application logs.
