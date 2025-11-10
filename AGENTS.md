# Repository Guidelines

## Project Structure & Module Organization
- `src/app/service.ts` bootstraps the Binance stream listener and notification pipeline.
- `src/binance`, `src/orders`, `src/positions`, and `src/notifications` hold domain services and adapters; keep new modules within these feature folders.
- `src/tests` contains Vitest suites named `*.test.ts`; mirror the source tree when adding coverage.
- Runtime configs live in `config/`, with `position-rules.json.example` as the template—copy and customize without committing secrets.
- Compiled output is written to `dist/`; never edit generated files directly.

## Build, Test, and Development Commands
- `npm run dev` launches the service via `tsx` with live reload for quick iterations.
- `npm run build` type-checks and emits JavaScript to `dist/`.
- `npm start` performs a clean build before starting the compiled service (`node dist/app/service.js`).
- `npm test` runs the Vitest suite once; use `npm run test:watch` for interactive feedback.

## Coding Style & Naming Conventions
- The codebase is TypeScript-first with `NodeNext` modules; prefer named exports and explicit types for public APIs.
- Follow the prevailing two-space indentation, single quotes, and trailing commas where diff-friendly.
- Use lowerCamelCase for variables/functions, PascalCase for classes/types, and descriptive file names (e.g., `orderStreamClient.ts`).
- Run `npm run build` before committing to catch type or casing regressions enforced by `tsconfig.json`.

## Testing Guidelines
- Write unit tests with Vitest; place them under `src/tests` using the `*.test.ts` suffix.
- When introducing services, add focused tests that stub Binance connectors and assert notification payloads.
- Aim to cover edge cases around retry logic, aggregation, and position validation timers; document non-trivial scenarios in test descriptions.

## Commit & Pull Request Guidelines
- Recent history favors concise subject lines, often in Chinese, with optional numbered details (`1.`, `2.`) or clauses separated by `；`; mirror this style for consistency.
- Each commit should encapsulate a logical change and include fixes or tests together.
- PRs should summarize behavior changes, link relevant issues, and note how tests were run (`npm test`, manual Binance sandbox run, etc.); attach screenshots for notification UI tweaks.

## Security & Configuration Tips
- Never commit real API keys or Feishu webhook URLs—load them from environment variables consumed by `appConfig`.
- Validate custom rule files with `npm test` before deploy; malformed JSON will surface through the configuration loaders early.

## 使用中文回复我
