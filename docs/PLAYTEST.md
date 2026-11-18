# Manual playtest checklist

This checklist covers behavior that automated jsdom tests cannot judge: real browser visibility, real audio, visual quality, and assistive technology timing. Status is recorded honestly. Each item has exactly one status: `passed`, `failed`, or `untested`.

Evidence legend:

- **Headless Chromium**: `scripts/verify-build.mjs` drove system Google Chrome (headless, through playwright-core). It was run twice against the production preview (84/84 checks) and twice against the dev server at `http://localhost:5173` (79/79). This was automated, not performed by a human.
- **jsdom**: covered by automated jsdom tests only. A real browser has not been used for this item.
- **Not verified**: no check of any kind has covered the real-browser behavior.

## How to run

1. Production preview: `npm run build`, then `npm run preview`.
2. Dev server (needed for query overrides): `npm run dev`, then open `http://localhost:5173/`.
3. Automated browser check: `node scripts/verify-build.mjs` (see the script header for options).

## Checklist

| # | Check | What to do | What to expect | Requirements | Status | Evidence / notes |
|---|-------|-----------|----------------|--------------|--------|------------------|
| 1 | Tab switch and minimize | Start a round. Switch to another browser tab for a few seconds, return. Repeat by minimizing the window. | Each Absence costs 10 sanity (default). Exactly one Mutation is applied per round. A cue plays on return. The Watcher shows the noticed state briefly. | 8, 10, 11, 12, 13 | `untested` | Covered by automated jsdom tests only (simulated `visibilitychange`); real browser untested. |
| 2 | Mid-round reduced-motion toggle | During a round, toggle the OS "reduce motion" setting. | Animation and flicker stop (or resume) at once. Game state, sanity and code are unchanged. | 17 | `untested` | Covered by automated jsdom tests only (`matchMedia` change); real browser untested. |
| 3 | Code contrast at every level, with CRT and vignette | Play (or use overrides) through calm, uneasy, distressed and critical. Read the code in the editor at each level. | Code stays readable at 4.5:1 or better. The CRT overlay and critical vignette do not obscure it. | 4.2, 9, 20 | `untested` | Token contrast is measured automatically in `tests/styles/tokens.test.ts`. No human visual check was made. An agent viewed three screenshots at calm and critical only; distressed was not viewed. |
| 4 | `while(true){}` responsiveness and recovery | Replace the function body with `while(true){}` and click Run Tests. Then restore working code and run again. | The page stays responsive. The run times out at about 3000 ms, all 5 tests show `timeout`, and Run Tests re-enables. A fresh run then works. | 5.3, 5.6, 5.7, 5.12 | `passed` | Headless Chromium, production preview and dev server. Timed out at about 3037 to 3066 ms. `requestAnimationFrame` kept advancing (+182 frames) and sanity ticked 100 to 99. All 5 tests were `timeout` and Run Tests was re-enabled. Automated, not human. |
| 5 | Keyboard-only full round | Using only the keyboard: Begin, edit code, Run Tests, finish, restart. | Every step is reachable and operable. Focus rings are visible. Focus lands where expected on each screen. | 2.8, 2.9, 4, 18 | `untested` | Covered by automated jsdom tests only; the full round in a real browser is untested. Enter and Space on Technical details were verified in real Chromium (item 11). |
| 6 | Escape then Tab in the editor | Focus the editor, press Tab (inserts indentation), press Escape, press Tab. | Tab indents while trapped. After Escape, the next Tab moves focus to the next focusable element. | 4.5, 4.7, 18 | `untested` | Covered by automated jsdom tests only; real browser untested. |
| 7 | Sound opt-in | Load the page. Confirm sound is off. Press Enable sound once. | Label changes to Mute sound. Audio is audible. The Start screen sound line matches the state. | 2.6, 19 | `untested` | Covered by automated jsdom tests only. Audible output and the AudioContext autoplay policy were not checked in real Chrome. |
| 8 | Sound off after reload; opt-in survives restart | Enable sound, reload the page (expect off). Enable sound again, finish a round, press restart. | After reload, sound is off. After restart, sound is still on. The preference is not stored. | 2.6, 14.5, 19 | `untested` | Covered by automated jsdom tests only; real browser untested. |
| 9 | Playtest query overrides | Dev server only: open `/?drainMs=300&absenceCost=40`. Check the drain rate (about 3 per second at 1 per 300 ms) and the Start rule text ("costs 40 sanity"). Also open `/?drainMs=150`. | Overrides apply in dev (or in a `VITE_PLAYTEST=1` build). A normal production build ignores them. | 8, 21 | `untested` | `drainMs` alone: `passed` in headless Chrome. An agent used `?drainMs=150` against the dev server while taking Milestone D screenshots. `absenceCost` and the other keys (`drainAmount`, `runTimeoutMs`, `noticedMs`, `editorMax`, `volume`, `order`) are covered by automated unit tests only; the combined `?drainMs=300&absenceCost=40` URL was not run in a real browser. The row status is `untested` because the combination is incomplete. |
| 10 | Screen reader announcement timing | With a screen reader on, run tests and cross warning levels. | "3 of 5 tests passed" is announced once, within 1 second of results. Level text and Watcher notices are announced once per change. | 6.5, 9, 10, 18 | `untested` | Live region content and count are covered by automated jsdom tests only. No screen reader was used. |
| 11 | Start screen at 1024x768, Technical details | Open at 1024x768. Check the whole Start screen is visible without scrolling. Focus Technical details and press Enter, then Space. Expand it and scroll. | Collapsed: no vertical scroll, Begin visible. Enter and Space toggle it. Expanded content scrolls vertically only. | 2.1, 2.3 | `passed` | Headless Chromium, production preview and dev server. Scroll height 768, Begin bottom 516.9. Real Enter and Space key presses toggled open and closed. Expanded scrollHeight 988, no horizontal overflow. Automated, not human. |
| 12 | Layout at 1024 and 3840 | Open Start, Play and Results at 1024 and 3840 wide. | No horizontal overflow. The Watcher overlaps none of the editor, test results or controls. | 10, 20 | `passed` | Headless Chromium, production preview and dev server. No horizontal overflow on any screen at either width. Watcher overlapped nothing at either size. Automated, not human. |
| 13 | Starter code: 4 pass, 1 fail | Start a round and click Run Tests without editing. | 4 tests pass and 1 fails. | 3, 5, 6 | `passed` | Headless Chromium, production preview and dev server. Automated, not human. |
| 14 | Fresh run wins after a timeout | After a timeout (item 4), enter a correct solution and run. | A new worker runs and all tests pass, giving the win. | 1.5, 5.6 | `passed` | Headless Chromium, production preview and dev server. A fresh worker won after the timeout. Automated, not human. |
| 15 | Workers released | Observe live Workers after a run, after a timeout, and after a win. | No idle Execution_Worker remains. | 5.12, 15 | `passed` | Headless Chromium with Worker constructor instrumentation: 0 live workers after the starter run, after the timeout and after the win. Automated, not human. |
| 16 | Zero cross-origin requests | Load and play with the network panel open. | Every request is same-origin. | 21 | `passed` | Headless Chromium recorded zero cross-origin requests. Automated, not human. |
| 17 | Reference fixture excluded from production | Inspect the production bundle. | No `tests/` or `referenceSolution` module is in the bundle. | 3.3 | `passed` | Import-graph check in `scripts/verify-build.mjs` found no `tests/` or `referenceSolution` module in the production bundle. Automated. |
| 18 | Other browsers | Repeat the checks above in Firefox and Safari. | Same results as Chrome. | n/a | `untested` | Only Chrome was used. |

## How to record results

1. Run the item as described in a real browser, with a person at the keyboard where the item calls for one.
2. Set the status to exactly one of `passed`, `failed` or `untested`. Use `untested` for anything you did not actually observe.
3. In Evidence / notes, say how it was verified (browser and version, production preview or dev server, automated script or human) and add numbers or a screenshot path where useful.
4. If an item fails, set `failed`, describe what happened, and open a follow-up. Do not edit the expected result to match.
5. Do not mark an item `passed` on the strength of jsdom tests alone. Say "covered by automated jsdom tests only" instead and leave it `untested`.

## Known limitations

- All `passed` entries come from automated headless Chromium runs, not from a human playtest.
- Real tab switching and minimizing, OS reduced-motion toggling, real audio output, screen reader timing, and human visual judgement of readability under the CRT overlay and vignette have not been verified in a real browser.
- Only Chrome was used. Firefox and Safari are untested.
- Query overrides work only in `npm run dev` or in a build made with `VITE_PLAYTEST=1`.
- A Web Worker is not a security sandbox. See [EXECUTION.md](EXECUTION.md).
