# dont-look-away
A psychological horror coding game where looking away lets the Watcher alter your code. Built with Kiro for Kiroween 2026.

## Play the game

**[Play Don't Look Away](https://dont-look-away.vercel.app/)** in your browser. No install is needed. Sound is off until you choose to enable it.

## What this is

Don't Look Away is a browser-based psychological horror coding game, made with Kiro for Kiroween 2026 in the Costume Contest category. You fix a small JavaScript function while your sanity drains. If you look away, the Watcher changes your code.

## Requirements

A current Node.js LTS and npm. For `npm run verify:build`, a system install of Google Chrome (or set `CHROME_PATH`).

## Install and run

```sh
npm install
npm run dev
```

Open the URL that Vite prints, normally http://localhost:5173.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server. |
| `npm run build` | Type-check, then produce a production build in `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run test` | Run the test suite once. |
| `npm run typecheck` | Run the TypeScript compiler without emitting files. |
| `npm run verify:build` | Build, then check the game in a real browser. |

`npm run verify:build` drives your system Google Chrome through `playwright-core` (set `CHROME_PATH` to use a different Chrome binary). To check a dev server that is already running, skip the build:

```sh
VERIFY_URL=http://localhost:5173 node scripts/verify-build.mjs --no-build
```

## How to play

1. Fix the function before sanity reaches zero.
2. Leaving the tab costs sanity and may change your code.
3. The Watcher can change your code once per round.

- Fix `brightestCandle` so all 5 tests pass.
- Click **Run Tests** or press Ctrl+Enter (Cmd+Enter on macOS).
- Press Escape, then Tab, to leave the editor. A skip link at the top of each screen jumps to the main content.
- Sanity drains over time. The meter and on-screen text escalate through three warning levels: uneasy, distressed, and critical.
- The Watcher changes your code at most once per round, after you return from being away.
- The Results screen shows what changed. Choose **Look again** to start a new round.

## Privacy and detection

- Tab detection uses only the Page Visibility API. It notices when you switch tabs or minimize the window. It may not detect another window that stays visible beside this one.
- No camera, eye tracking, or gaze detection is used or claimed. Nothing leaves your browser.
- Sound is opt-in and off by default. It is off again after a page reload. Use **Enable sound** to turn it on and **Mute sound** to turn it off. The preference is not stored.
- Reduced-motion preferences are respected, and the game is fully playable with the keyboard.

## Playtest query overrides (dev only)

Query parameters can override game tuning, but only when running `npm run dev` (`import.meta.env.DEV`) or when a build is made with `VITE_PLAYTEST=1`. A normal production build ignores them. Example:

```
http://localhost:5173/?drainMs=300&absenceCost=40
```

Supported keys: `drainMs`, `drainAmount`, `absenceCost`, `runTimeoutMs`, `noticedMs`, `editorMax`, `volume`, and `order` (a comma-separated candidate order). Numeric values that are not valid numbers are ignored, and results are normalized to safe ranges. See [docs/PLAYTEST.md](docs/PLAYTEST.md) for the playtest guide.

## Code execution limitation

Your code runs in a Web Worker in your browser. This keeps the page responsive, but it is not a security sandbox. Run only code you type yourself in this session. Details are in [docs/EXECUTION.md](docs/EXECUTION.md).

## Project structure

- `src/core/`: pure game logic (config, reducer, sanity, mutations, diff, execution protocol).
- `src/app/`: React providers, hooks, and screens (Start, Play, Results).
- `src/components/`: editor, test panel, sanity meter, Watcher, and other UI pieces.
- `src/worker/`: the code-execution Web Worker.
- `src/audio/`: opt-in sound.
- `src/styles/`: CSS.
- `tests/`: unit and property-based tests.
- `scripts/`: build verification scripts.
- `docs/`: execution and playtest notes.

## Spec

The requirements, design, and task list live in `.kiro/specs/dont-look-away`.
