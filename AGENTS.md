# Repository Guidelines

## Project Structure & Module Organization
Campus Dashboard is a client-rendered Nuxt 3/Vue 3 application.

- `pages/`, `components/`, and `layouts/` define routes and UI.
- `composables/`, `utils/`, and `plugins/` hold state, helpers, and browser integrations; `workers/` runs clock, timer, and weather jobs.
- `public/` contains icons, PWA assets, and audio; `arduino-sender/` contains sensor firmware.
- `cloudflare/video-api/` contains the API Worker, tests, and D1 migrations. `functions/api/[[path]].ts` proxies Pages requests. Read the Worker’s nested `AGENTS.md` before editing that directory.

## Build, Test, and Development Commands
Use Yarn 4.4.1 for the frontend and npm for the Worker. Example container shell (Node 20 matches CI):

```sh
docker run --rm -it -p 3000:3000 -p 8787:8787 -v "$PWD":/app -w /app node:20 bash
corepack enable
```

From the repository root:

- `yarn install`: install dependencies and prepare Nuxt.
- `yarn dev --host 0.0.0.0`: start frontend development on port 3000.
- `yarn build` / `yarn preview`: build and preview production output.
- `yarn generate`: generate static output; `BASE_URL=/cp-dashboard/ yarn generate` matches CI.

From `cloudflare/video-api/`:

- `npm ci`: install Worker dependencies.
- `npm run dev -- --ip 0.0.0.0`: start the local API on port 8787.
- `npm test -- --run`: run tests once.
- `npm run cf-typegen`: regenerate types after changing Wrangler bindings.

## Coding Style & Naming Conventions
Use TypeScript, Vue `<script setup lang="ts">`, and two-space frontend indentation. Match surrounding quote and semicolon styles. Use kebab-case Vue filenames, `.client.*` for browser-only modules, `useX` for new composables, camelCase functions, and PascalCase types. Reuse Tailwind/daisyUI styles. No root lint/format scripts exist; Worker `.editorconfig` and `.prettierrc` specify tabs, single quotes, semicolons, and 140-column lines.

## Testing Guidelines
Worker tests use Vitest with the Cloudflare test plugin. Add regression cases as `test/*.spec.ts` with descriptive `describe`/`it` names; no coverage threshold is configured. The frontend has no automated suite: build/generate and manually check affected routes, timer/audio, responsiveness, and settings persistence. Nuxt builds disable automatic type checking.

## Commit & Pull Request Guidelines
History uses imperative English subjects (`Add …`, `Fix …`) and optional scope tags (`[clock] …`), often with Japanese descriptions. Keep commits focused. PRs should explain changes, link relevant issues, report validation, and include screenshots for UI changes.

## Configuration & Security
`NUXT_PUBLIC_VIDEO_API_BASE` overrides the API URL; `BASE_URL` sets the application prefix. Keep credentials out of Git and preserve Access authentication and role checks.
