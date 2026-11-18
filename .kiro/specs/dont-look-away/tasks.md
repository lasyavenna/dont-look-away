# Implementation Plan: Don't Look Away

## Overview

The plan builds the game in five milestones. Milestone A creates the project, the Challenge fixtures, and the pure core in `src/core`. Milestone B adds the editor, the real Web Worker runner, the store and controller, win/loss handling, and restart. Milestone C adds Page Visibility detection, the Absence cost, Mutations, and the Results reveal. Milestone D adds the horror visuals, audio, and accessibility. Milestone E verifies the production build in a real browser, adds documentation, and closes with a playtest checklist.

Implementation language: TypeScript (strict), React 19, Vite, Vitest, fast-check, CodeMirror 6, as fixed by the design. Each milestone ends with a checkpoint task.

## Tasks

- [x] 1. Milestone A: Setup, challenge fixtures, and core game logic
  - [x] 1.1 Scaffold Vite + React + TypeScript (strict) without touching existing repository files
    - Scaffold into a temporary directory outside the repository, then copy only new files (`package.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/**`, `tests/**`). Never copy `README.md`, `LICENSE`, or `.gitignore` from the scaffold.
    - Set `"strict": true`; set `<html lang="en">`; set `worker: { format: 'es' }` in `vite.config.ts`.
    - Install React 19, CodeMirror 6 packages (`@codemirror/state`, `view`, `commands`, `language`, `lang-javascript`), Vitest, fast-check, React Testing Library, `@testing-library/user-event`, jsdom. Commit the lockfile.
    - Add scripts `dev`, `build` (`npm run typecheck && vite build`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`). Each must exit non-zero on failure.
    - Record checksums of `README.md`, `LICENSE`, and `.gitignore` before and after, and confirm they are unchanged.
    - _Requirements: 21.1, 21.2, 21.3, 21.5, 21.9, 21.10, 18.13_

  - [x] 1.2 Append-only `.gitignore` update and `.kiro` tracking check
    - Add only missing lines (for example `node_modules/`, `dist/`) to the end of `.gitignore`. Do not modify or remove any existing line, and do not add a pattern that matches `.kiro`.
    - Verify `git check-ignore .kiro` and `git check-ignore .kiro/specs/dont-look-away/tasks.md` report no match, and `git ls-files .kiro` lists the spec files.
    - Verify with `git diff .gitignore` that the diff contains only added lines.
    - _Requirements: 21.3, 21.4, 21.7, 21.8_

  - [x] 1.3 Create core types, worker protocol, and cleanup registry
    - Create `src/core/types.ts` (`Phase`, `WarningLevel`, `TestResult`, `Run`, `Round`, `GameState`, `GameEvent`, `StepResult`, `CoreDeps`, `MutationRecord`, `SkipReason`).
    - Create `src/core/protocol.ts` with `MainToWorker`, `WorkerToMain`, and the `isWorkerToMain` shape guard (known status, integer index, ids present).
    - Create `src/core/registry.ts` with `createRegistry()` returning idempotent cleanup callbacks that never throw and a working `activeCount()` and `disposeAll()`.
    - _Requirements: 5.8, 15.7, 15.9, 22.1_

  - [x] 1.4 Implement the Game_Config module
    - Create `src/core/config.ts` with `GameConfig`, `DEFAULT_CONFIG` (drain 2000 ms and 1 point, absence cost 10, thresholds 71/41/21, run timeout 3000, editor limit 100,000, noticed 3000 ms, volume cap 0.5, test count 4 to 8, candidate order `off-by-one`, `flipped-comparison`, `lost-name`).
    - Implement `normalizeConfig` (merge and clamp, never throws) and `parseConfigOverrides` (pure, ignores unknown keys and bad values, the core never reads `location`).
    - _Requirements: 21.11, 19.14, 8.2, 8.3, 5.6, 4.8, 10.4, 3.1_

  - [x]* 1.5 Write property test for config normalization
    - **Property 17: Config normalization always yields a valid config**
    - Add unit tests for default values and clamping edge cases.
    - **Validates: Requirements 21.11, 19.14**

  - [x] 1.6 Create the Challenge definition and the test-only Reference_Solution
    - Create `src/core/challenge.ts` with the `brightestCandle` description, function name, the exact starter code from the design (with `>=`), and exactly 5 Test_Cases (`no candles`, `a single flame`, `brightest in the middle`, `brightest at the end`, `ties go to the first candle`) with the args and expected values from the design.
    - Create `tests/fixtures/referenceSolution.ts` identical to the starter except `>` instead of `>=`. Nothing under `src/` may import it.
    - Loading the app must not execute the starter or the reference.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_

  - [x] 1.7 Implement display formatting and the shared test execution module
    - Create `src/core/format.ts`: `truncateForDisplay` (500 characters plus visible indicator), `serializeValue` (cycle-safe, handles `undefined`, `NaN`, `Infinity`, `bigint`, functions, always returns a string), `deepEqual`.
    - Create `src/core/execute.ts`: `runTestCases` compiles once with `new Function` in strict mode, reports `error` for every test on a parse failure or missing function, runs each test with deep-cloned args, continues after a thrown test, and calls `onResult` once per test with its zero-based index.
    - _Requirements: 5.3, 5.4, 5.5, 5.8, 6.2, 6.3_

  - [x]* 1.8 Write property test and unit tests for formatting and execution
    - **Property 15: Display truncation**
    - Unit tests: truncation at 499, 500, 501 characters; parse error gives `error` for all tests; a throwing test does not stop later tests; one result per test with correct index.
    - **Validates: Requirements 5.8, 6.2**

  - [x] 1.9 Implement the Mutation_Engine and the three candidates
    - Create `src/core/mutations.ts` with `replaceFirst`, the exact three `CandidateMutation` entries from the design (`off-by-one`, `flipped-comparison`, `lost-name`, with targets, replacements, and descriptions), and `attemptMutation(code, candidates, save, maxLength)`.
    - Skip reasons are exactly `target-missing`, `transform-failed`, `no-change`, `size-limit`. A `size-limit` skip stores no snapshot. A snapshot save that returns false or throws cancels the whole attempt with no later candidate tried. No randomness.
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.11, 12.12, 12.16, 12.17, 13.1, 13.2_

  - [x] 1.10 Implement the line diff
    - Create `src/core/diff.ts` with `diffLines` (common prefix and suffix strip, line LCS on the middle, fallback to remove-all/add-all when `n*m > 4_000_000`), `newFromDiff`, and `oldFromDiff`.
    - _Requirements: 13.5, 13.6, 22.7_

  - [x] 1.11 Implement sanity and warning-level functions
    - Create `src/core/sanity.ts` with `applyDrain`, `applyAbsenceCost` (both floor at 0), `warningLevelFor` (returns `null` for non-integers and values outside 0 to 100, `critical` for 0 to 20 using config thresholds), and the `severity` map.
    - _Requirements: 8.2, 8.3, 8.5, 9.1, 9.9, 22.2_

  - [x]* 1.12 Write property test for warning levels
    - **Property 1: Warning level is total and monotonic**
    - Add unit boundary tests for 0, 20, 21, 40, 41, 70, 71, 100 and invalid inputs (NaN, -1, 101, 50.5).
    - **Validates: Requirements 9.1, 9.9, 22.2, 22.3**

  - [x]* 1.13 Write property tests and unit tests for the Mutation_Engine
    - **Property 9: Mutation determinism and purity**
    - **Property 11: Snapshot failure cancels the attempt**
    - Unit tests for each skip reason, `size-limit` distinct from `no-change`, and first-success stops the attempt.
    - **Validates: Requirements 12.7, 12.8, 12.11, 22.6, 12.16, 13.1, 13.2**

  - [x]* 1.14 Write property test and unit tests for the diff
    - **Property 12: Diff round trip**
    - Unit tests for empty strings, trailing newlines, and the large-input fallback.
    - **Validates: Requirements 13.5, 13.6, 22.7**

  - [x]* 1.15 Write property test for the cleanup registry
    - **Property 14: Cleanup callbacks are idempotent and complete**
    - **Validates: Requirements 15.7, 15.9**

  - [x] 1.16 Write development-time fixture validation tests
    - Create `tests/fixtures/fixtures.test.ts` running through `runTestCases`. Fixture validation runs only in tests and never at load time.
    - Check Challenge field limits (description 1 to 500, function name a valid identifier of 1 to 50, starter 1 to 5,000, 4 to 8 tests, unique names of 1 to 80 characters).
    - Check the starter passes at least one and fails at least one test, and that starter and reference share the leading comments and differ only by `>=` versus `>`.
    - Assert the exact design table: reference passes all 5; starter P,P,P,P,F; reference + `off-by-one` P,F,P,F,P; + `flipped-comparison` P,P,F,F,F; + `lost-name` E,E,E,E,E.
    - For each candidate, check the target occurs in both starter and reference, the mutated reference compiles, and at least one test fails. A failure here is a fixture defect.
    - _Requirements: 3.1, 3.2, 22.14, 22.15, 22.16, 12.1, 12.12_

  - [x] 1.17 Implement the core reducer: phases, rounds, drain, code changes
    - Create `src/core/reducer.ts` with `initialState(config)` and `step(state, event, config, deps)` returning `{ state, outcome }` (`applied`, `discarded`, `rejected`).
    - Handle `START` (only from `ready`: new round id, sanity 100, starter code), `RESTART` (only from `won`/`lost`: `initialState` with id counters carried forward, `activeRoundId` null), `DRAIN_TICK` (drain, reaching 0 gives `lost` in the same step), and `CODE_CHANGED`.
    - Set `activeRoundId` to `null` in the same step as any transition to `won`, `lost`, or `ready`. Reject disallowed transitions. Discard tagged events with a non-matching round id. A second `RESTART` is rejected.
    - Leave hooks for run events and visibility events (added in Milestones B and C). Events not yet handled return `discarded` with the state unchanged.
    - _Requirements: 1.1, 1.2, 1.3, 1.7, 1.8, 1.9, 1.10, 1.12, 8.1, 8.2, 8.6, 14.2, 14.3, 14.6, 14.8, 15.1, 15.11, 22.9_

  - [x]* 1.18 Write property tests for the state machine
    - **Property 3: Only permitted transitions occur**
    - **Property 4: Terminal outcomes are final**
    - **Property 13: Restart restores the initial state**
    - Unit tests: double `RESTART`, `START` outside `ready`, drain reaching 0 gives `lost`, ids never repeat after restart.
    - **Validates: Requirements 1.1, 1.3, 1.8, 1.9, 1.10, 1.12, 14.2, 14.3, 14.6, 14.8, 22.8, 22.9, 22.10**

  - [x] 1.19 Write the layering boundary test
    - Create `tests/boundaries.test.ts` that scans `src/core/**` for imports of `react`, `react-dom`, `src/app`, `src/audio`, and for `window`, `document`, `navigator`, and web storage identifiers, and scans `src/**` for imports from `tests/`.
    - _Requirements: 22.1, 3.3_

- [x] 2. Checkpoint A - Ensure all tests pass
  - Run `npm run test`, `npm run typecheck`, and `npm run build`. Ensure all tests pass, ask the user if questions arise.

- [x] 3. Milestone B: Editor, real worker test runner, win/loss, and restart
  - [x] 3.1 Build the CodeMirror 6 editor component
    - Create `src/components/CodeEditor.tsx` with JavaScript highlighting, the dark theme from CSS variables, and the accessible name "Code editor".
    - Tab trap in a compartment: Tab indents; Escape swaps to an empty keymap so the next Tab leaves the editor; the trap re-arms on blur. Show the hint "Esc then Tab leaves the editor".
    - A transaction filter rejects any change that would exceed `editorMaxLength` (including paste), keeps the accepted code, and shows a polite "limit reached" status.
    - `Mod-Enter` calls `onRun` (the reducer ignores it while a run is active).
    - External replacement from `state.code` uses an `External` annotation so it is not echoed as a user change. A `readOnly` compartment is set in `won`/`lost`, keeping the editor readable and scrollable.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 12.10, 18.4, 18.6_

  - [x]* 3.2 Write editor tests
    - State-level tests for the length filter (rejects over 100,000), read-only, Escape/Tab compartment toggling, and the external-replace annotation.
    - jsdom view tests limited to mount, `aria-label`, and Escape then Tab not preventing default.
    - _Requirements: 4.3, 4.4, 4.5, 4.7, 4.8_

  - [x] 3.3 Extend the reducer with run handling and ordered win/loss
    - Handle `RUN_REQUESTED` (only in `playing` with no running run; assign a monotonic `runId`), `RUN_RESULT`, `RUN_DONE`, `RUN_ABORT`, `RUN_TIMEOUT`, `RUN_FAILED`.
    - `RUN_RESULT` is accepted only when its own `roundId` equals `activeRoundId`, its own `runId` equals the latest run, the run is `running`, the index is an integer in range, and the index is new. Everything else is `discarded` with no state change.
    - A run is `complete` only when every index was received once and `RUN_DONE` was accepted. Missing indices at `RUN_DONE` become `error`. Timeout keeps received results and fills the rest with `timeout`. Failure fills the rest with `error` and sets `runError`.
    - Win evaluation happens only in the step that completes a run with all `pass`: `won` when sanity is above 0, `lost` when sanity is 0. Partial, timed-out, failed, and stale runs never win.
    - `CODE_CHANGED` marks a running run `stale` in the same step and flags displayed results `outdated`. The first result of a new run replaces the displayed results.
    - Run events never change sanity. Events in `won`/`lost` change nothing.
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.12, 5.2, 5.4, 5.6, 5.9, 5.10, 5.11, 5.13, 5.14, 6.1, 6.6, 6.7, 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.4, 14.9, 15.10, 22.13, 22.21_

  - [x]* 3.4 Write property test for ordered win and loss
    - **Property 5: Ordered-event win and loss**
    - **Validates: Requirements 1.5, 1.6, 1.7, 5.13, 22.11, 22.21**

  - [x]* 3.5 Write property test for stale, foreign, and ended-round events
    - **Property 6: Stale, foreign, and ended-round events are no-ops**
    - **Validates: Requirements 5.9, 7.3, 7.4, 7.6, 14.9, 15.1, 15.10, 15.11, 22.13, 22.18, 22.20**

  - [x]* 3.6 Write property test for staling a running run
    - **Property 7: Code change or mutation stales a running run**
    - Cover `CODE_CHANGED` here. The Mutation case is exercised after Milestone C task 5.1.
    - **Validates: Requirements 7.1, 7.2, 7.7, 12.14**

  - [x]* 3.7 Write property test for timeouts
    - **Property 8: Timeout keeps received results and fills the rest**
    - **Validates: Requirements 5.4, 5.6, 6.1, 22.19**

  - [x]* 3.8 Write property test for index validation
    - **Property 16: Run indices are validated and a win needs every index exactly once**
    - **Validates: Requirements 5.4, 5.13, 5.14, 22.21**

  - [x] 3.9 Implement the real Execution_Worker and its factory
    - Create `src/worker/execution.worker.ts` with the `onmessage` handler that streams one `result` message per test, then `done`, and posts `fatal` on an unexpected exception. Every message carries `roundId` and `runId` and is structured-cloneable.
    - Create `src/worker/createExecutionWorker.ts` in the same directory with the only `new Worker(new URL('./execution.worker.ts', import.meta.url), { type: 'module' })` in the codebase, and export the `WorkerLike` and `WorkerFactory` types.
    - _Requirements: 5.3, 5.4, 5.5, 5.8, 5.15, 21.12_

  - [x]* 3.10 Write worker handler tests
    - Call the handler against a stub `self`: one `result` per test, then `done` with the right count, parse failure gives `error` for all, a throwing test continues, all messages carry the run's ids.
    - _Requirements: 5.4, 5.5, 5.8_

  - [x] 3.11 Implement the game store with an ordered event queue
    - Create `src/app/store.ts` with `createGameStore(config, deps)`: FIFO queue, synchronous drain loop through `step`, a single subscriber notification after the queue is empty, no re-entrant dispatch, `getActiveRoundId()`, and an idempotent `detach()`.
    - `detach()` never disposes the store or changes phase, sanity, code, or `activeRoundId`. While `playing` with a running run it dispatches `RUN_ABORT`. In `ready` it does nothing.
    - _Requirements: 1.4, 15.3, 15.11, 15.13, 7.7_

  - [x]* 3.12 Write store tests
    - Events process in order, one at a time. A dispatch from a subscriber is queued. The store stays usable after `detach()`. `detach()` in `ready` is a no-op. `detach()` in `playing` with a running run stales it and keeps the round.
    - _Requirements: 1.4, 15.13_

  - [x] 3.13 Implement resource helpers and the `useTestRun` hook
    - Create `src/app/resources.ts` (`addTimeout`, `addInterval`, `addListener`, `addWorker`, `addAudioNode`) built on the core registry.
    - Create `src/app/hooks/useTestRun.ts`: one effect keyed by `[roundId, runId, status==='running']` that creates the worker through the injected `WorkerFactory` only while a run is running, posts the run, and starts the `runTimeoutMs` timer that dispatches `RUN_TIMEOUT` with captured ids at most once.
    - `onmessage` validates shape with `isWorkerToMain` and dispatches events carrying the message's OWN `roundId` and `runId`, never captured ones. A factory throw, `onerror`, `onmessageerror`, or a `fatal` message dispatches `RUN_FAILED`.
    - Cleanup clears the timer, sets `onmessage` to null, and terminates the worker (a throwing `terminate()` is swallowed). No idle worker remains.
    - _Requirements: 5.2, 5.6, 5.9, 5.10, 5.12, 7.7, 14.7, 15.2, 15.4, 15.7, 15.12_

  - [x]* 3.14 Write runner tests with a fake worker
    - Streaming one message per test; wrong `runId`/`roundId` discarded; late message after stale discarded; timeout under fake timers keeps received results; factory throw; worker `onerror`; worker terminated exactly once on complete, timeout, stale, and round end; a second run creates a new worker; `onmessage` nulled on cleanup; out-of-range, fractional, and duplicate indices ignored; all results without `done` do not win; a throwing `terminate()` does not break a restart.
    - _Requirements: 5.4, 5.6, 5.9, 5.10, 5.12, 5.14, 14.7, 15.2, 15.4_

  - [x] 3.15 Implement `GameProvider`, `useDrain`, and the app entry point
    - Create `src/app/GameProvider.tsx` that creates the store once with a lazy `useState` initializer, reads it through `useSyncExternalStore`, accepts `config` and `workerFactory` props, and applies dev-only query overrides (`import.meta.env.DEV || VITE_PLAYTEST === '1'`). Its only effect calls `store.detach()` on cleanup.
    - Create `src/app/hooks/useDrain.ts`: while `playing` and not `absenceActive`, register an interval of `drainIntervalMs` dispatching `DRAIN_TICK` with the captured round id.
    - Create `src/main.tsx` rendering `<StrictMode>`.
    - _Requirements: 8.2, 8.7, 15.3, 15.8, 15.13, 21.11_

  - [x] 3.16 Build the Start screen
    - Create `src/app/screens/StartScreen.tsx` with the title, instructions covering Requirements 2.2 to 2.7 (goal, Page Visibility detection, once-per-round change with later absences still costing sanity, no camera or eye tracking and other visible windows may not be detected, sound off including after reload, not a secure code runner with a limitation statement of at most 200 characters), and the Begin button focused on mount.
    - Disable Begin and show "The instructions could not be loaded." if required content is missing. Activation by click, Enter, or Space dispatches `START`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 16.8, 1.3, 19.4_

  - [x] 3.17 Build the TestPanel, SanityMeter, and Play screen
    - Create `src/components/TestPanel.tsx`: one entry per Test_Case in definition order with name, status text (or "not run"), message, expected and actual values for `fail`, expected plus "no actual value" for `error`/`timeout`, an "outdated" badge, a "Run timed out" message, and "Tests could not run." on failure.
    - Create `src/components/SanityMeter.tsx` (`role="meter"`, `aria-label="Sanity"`, min 0, max 100, `aria-valuenow`, visible integer, fill `value%`).
    - Create `src/app/screens/PlayScreen.tsx`: challenge description, all test names, editor, Run Tests button (disabled with a visible in-progress indicator while a run is running, enabled again by the next render), and `Mod-Enter` wiring through `useTestRun`.
    - _Requirements: 3.5, 5.1, 5.7, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 7.5, 8.8, 8.9, 8.10, 18.5_

  - [x] 3.18 Build the Results screen and restart control
    - Create `src/app/screens/ResultsScreen.tsx` showing the outcome (`won`/`lost`), the final sanity integer, the number of Mutations applied (0 or 1), and an enabled "Look again" restart control that dispatches `RESTART`. The diff reveal is added in Milestone C.
    - _Requirements: 13.4, 14.1, 14.2, 1.9_

  - [x] 3.19 Wire `App` and the screen switch
    - Create `src/App.tsx` and `ScreenSwitch` that render exactly one screen from `state.phase` in one commit. Make `Run Tests`, restart, and start flows work end to end with the real store.
    - After restart the editor shows the unmodified starter code and no previous results.
    - _Requirements: 1.2, 1.11, 2.9, 3.6, 14.3, 14.4_

  - [x] 3.20 Write the StrictMode setup-cleanup-setup test
    - Create `tests/components/strictMode.test.tsx` with `<StrictMode><GameProvider workerFactory={fake}><App/></GameProvider></StrictMode>` and fake timers.
    - Click Begin and assert `playing`. Advance 2 s and assert the meter shows 99. Click Run Tests, stream five passing results and `done` from the fake worker, and assert the win Results screen. Click restart and assert `ready`.
    - A second case unmounts and remounts the hooks on one store with `store.detach()` in between while `playing` with a running run, and asserts the run becomes `stale`, Run Tests is re-enabled, and the round continues.
    - Assert StrictMode leaves one interval and zero idle workers after mount, and zero resources after unmount.
    - _Requirements: 15.8, 15.13, 22.22, 15.3_

  - [x]* 3.21 Write screen component tests
    - One screen per phase; Start focus on Begin; Run button disabled while running; outdated badge; per-test streaming display replacing the previous run; meter role and `aria-valuenow`; late result after restart discarded; double restart activation restarts once.
    - _Requirements: 1.11, 2.8, 5.7, 6.1, 6.7, 7.5, 8.9, 14.8_

- [x] 4. Checkpoint B - Ensure all tests pass
  - Run `npm run test`, `npm run typecheck`, and `npm run build`. Confirm the worker asset is emitted in `dist/assets`. Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Milestone C: Visibility detection, mutation, sanity, and results reveal
  - [ ] 5.1 Extend the reducer with Absences, the Absence cost, and one Mutation per round
    - Handle `VISIBILITY_HIDDEN` (start an Absence only in `playing` with none active; a second hidden event joins the existing one) and `VISIBILITY_VISIBLE` (ignored when no Absence is active or the phase is not `playing`).
    - On an ended Absence, in one step: apply the Absence cost (floor 0, regardless of Mutation state); if sanity reaches 0 move to `lost` with no Mutation; otherwise, if `round.applied` is null, call `attemptMutation` in `candidateOrder` with `deps.saveSnapshot` and `editorMaxLength`.
    - On success, replace the code, record the snapshot and result, mark a running run `stale`, set `notice` to `watcherChanged`. On all-skipped or cancelled, leave the code unchanged and record `lastAttemptSkipped`. Bump `noticedSeq` and `absenceEndSeq` on every ended Absence in `playing`. Support `NOTICED_EXPIRED` with a matching seq.
    - An Absence in progress when the round ends is discarded with no cost and no Mutation. The Absence duration never matters.
    - _Requirements: 8.3, 8.7, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 12.2, 12.3, 12.4, 12.5, 12.6, 12.13, 12.14, 12.15, 12.16, 12.17, 13.1, 13.2, 13.3, 7.2_

  - [ ]* 5.2 Write property test for bounded sanity including Absences
    - **Property 2: Sanity stays bounded and changes only through allowed events**
    - Also extend the Property 5 sequence generator with Absence ends so a sanity-zero Absence end yields `lost` and never `won`.
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 22.4, 22.5, 22.12, 1.7**

  - [ ]* 5.3 Write property test for one Mutation per round
    - **Property 10: At most one Mutation per round and ordered retry**
    - Also extend Property 7 coverage: an applied Mutation stales a running run in the same step.
    - **Validates: Requirements 12.2, 12.3, 12.4, 12.5, 12.6, 12.12, 12.15, 12.17, 22.12, 22.17, 7.2, 12.14**

  - [ ]* 5.4 Write reducer unit tests for Absence edge cases
    - Duplicate `VISIBILITY_HIDDEN`; `VISIBILITY_VISIBLE` without an Absence; Absence discarded when the round ends; Absence cost reaching 0 gives `lost` without a Mutation; a failing `saveSnapshot` cancels and a later Absence retries; all candidates skipped then a later success; `size-limit` skip then the next candidate; second Absence costs sanity but applies no second Mutation; a run in progress becomes `stale` on a Mutation.
    - _Requirements: 11.5, 11.6, 11.8, 11.9, 12.6, 12.16, 12.17, 13.2_

  - [ ] 5.5 Implement `useVisibility` and wire it into the Play screen
    - Create `src/app/hooks/useVisibility.ts`: while `playing`, register a `visibilitychange` listener through the registry and dispatch `VISIBILITY_HIDDEN`/`VISIBILITY_VISIBLE` tagged with the captured round id. Use only `document.visibilityState` (no camera, no focus heuristics).
    - Confirm drain pauses during an Absence and resumes when visible. Wire the hook into `PlayScreen`.
    - _Requirements: 11.1, 11.10, 8.7, 15.1, 15.3, 15.8_

  - [ ] 5.6 Implement `useNoticed` and the Watcher-changed notification
    - Create `src/app/hooks/useNoticed.ts`: an effect keyed by `noticedSeq` that sets a `noticedDurationMs` timer dispatching `NOTICED_EXPIRED {roundId, seq}`. A later Absence end supersedes the earlier one. The timer is cleared on cleanup and is a no-op once the round ends.
    - Add a polite status region on `PlayScreen` with "The Watcher changed your code." and no identifier, description, target, or changed lines.
    - _Requirements: 10.4, 10.5, 10.6, 12.13, 15.5, 15.6_

  - [ ] 5.7 Implement `DiffView` and the Results reveal
    - Create `src/components/DiffView.tsx` rendering `diffLines(snapshot, resultingCode)` with `-`, `+`, and two-space text markers plus color.
    - In `ResultsScreen`: when a Mutation was applied, show its description and exactly one comparison; otherwise show "The Watcher changed nothing." and no comparison. A cancelled attempt is never shown. Move focus to the Results `h1` once rendered.
    - _Requirements: 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 14.3_

  - [ ]* 5.8 Write DiffView and Results component tests
    - Markers `-`/`+`/space; one comparison only; "changed nothing" with no diff; the restart clears snapshot and records; focus on the `h1`.
    - _Requirements: 13.5, 13.6, 13.7, 13.8, 14.3_

  - [ ]* 5.9 Write the Absence flow integration test
    - With a fake worker and fake timers: hidden then visible gives sanity minus 10, one Mutation, the code in the editor replaced, a running run staled with Run Tests re-enabled, the notification shown, and the noticed timer superseded by a second Absence. Add a StrictMode case that plays a tab switch.
    - _Requirements: 8.3, 10.5, 11.3, 11.4, 12.10, 12.13, 12.14, 7.2, 7.8_

- [ ] 6. Checkpoint C - Ensure all tests pass
  - Run `npm run test`, `npm run typecheck`, and `npm run build`. Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Milestone D: Horror visuals, audio, and accessibility
  - [ ] 7.1 Add style tokens and base layout
    - Create `src/styles/tokens.css` (charcoal `--bg` with relative luminance at most 0.02, exactly one red `--accent`, text, focus, font tokens, per-level CRT and Watcher variables) and `src/styles/app.css` (grid layouts that fit 1024x768 with no horizontal scroll up to 3840 px).
    - Bundle the monospace font as `woff2` with a system monospace fallback and no external font hosts. Red intensity uses only the one accent token.
    - _Requirements: 20.1, 20.4, 20.5, 20.6, 2.1, 4.2_

  - [ ] 7.2 Implement the CRT overlay
    - Create `src/components/CrtOverlay.tsx` and CSS: fixed full-viewport overlay with `aria-hidden`, `pointer-events: none`, scanlines (alpha 0.03 to 0.08 by level), a vignette, and a 6 s flicker keyframe. Render it from the app root.
    - _Requirements: 20.2, 20.3, 9.3, 9.8, 17.1_

  - [ ] 7.3 Implement the Watcher SVG
    - Create `src/components/Watcher.tsx` and CSS: an inline SVG in its own grid cell with `aria-hidden="true"` and `focusable="false"`, a 6 s gaze keyframe toward the editor, and the `watcher--noticed` appearance (wide eyes, red iris ring, mouth slit) bound to `round.noticedActive`. It clears in the same commit when the phase leaves `playing`. No network requests for images.
    - Add the Watcher to `PlayScreen`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8, 9.4, 9.5_

  - [ ] 7.4 Implement Warning_Level treatments
    - Create a `useWarningLevel` hook that keeps the previous level when `warningLevelFor` returns `null`. Apply per-level CSS classes on `PlayScreen` that replace the previous level's treatment in one commit: meter red at `uneasy`; text "It is watching your hands." at 1rem and Watcher opacity 0.75 at `distressed`; text "Do not look away." at 1.5rem, red vignette, and Watcher opacity 1.0 at `critical`, including at sanity 0. Intensities increase monotonically.
    - Add a polite live region announcing the level text once per change.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.9, 8.10_

  - [ ] 7.5 Implement reduced-motion support
    - Create `src/app/hooks/useReducedMotion.ts` using `matchMedia('(prefers-reduced-motion: reduce)')` with a `change` listener; return `true` if `matchMedia` is unavailable or throws. Provide the value through `GameProvider`.
    - When set: no CRT flicker, static gaze toward the editor, no shake or glitch, a static "noticed" swap, and levels distinguished by text, meter border style, Watcher opacity, and the `critical` vignette. A mid-play change applies by the next render without resetting game state.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 10.3_

  - [ ]* 7.6 Write tests for warning treatments and reduced motion
    - Level class swap in one commit; level text announced once per change; invalid sanity keeps the previous level; the `matchMedia` change flips treatment with game state intact; `matchMedia` throwing gives reduced motion; Watcher noticed class lifecycle with fake timers.
    - _Requirements: 9.2, 9.6, 9.9, 10.4, 10.5, 10.6, 17.4, 17.6_

  - [ ] 7.7 Implement the Audio_Manager
    - Create `src/audio/audioManager.ts` using the Web Audio API only. No `AudioContext` before `enable()`. `enable()` creates and resumes the context and unmutes in the same call. One master `GainNode` at `min(cfg.volumeCap, 0.5)`.
    - Sounds: ambient drone, Watcher cue on Absence end (0.6 s sweep plus noise burst), `critical` tension loop. `mute()` zeroes gain, stops and disconnects nodes, and suspends the context immediately. `silenceAll()` for round changes. A context failure is caught silently and leaves sound off.
    - _Requirements: 19.2, 19.3, 19.7, 19.11, 19.12, 19.13, 19.14, 19.15, 14.5_

  - [ ] 7.8 Implement `MuteControl`, the in-memory sound preference, and `useAudio`
    - Create `src/components/MuteControl.tsx`: `<button aria-pressed>` labeled "Enable sound" or "Mute sound", rendered on the Start and Play screens. One activation of "Enable sound" enables sound.
    - Hold `soundOn` in an in-memory provider above the screens so `RESTART` keeps it; it always starts `false` on page load and is never written to any storage. Create `useAudio` subscribing to `absenceEndSeq`, the warning level, and `soundOn`, releasing audio nodes in effect cleanup. `START` never touches audio.
    - _Requirements: 19.1, 19.3, 19.4, 19.5, 19.6, 19.8, 19.9, 19.10, 14.5, 14.6_

  - [ ]* 7.9 Write audio tests
    - `AudioContext` constructor spy: zero calls on load, zero on Begin, one on "Enable sound"; stored values do not enable sound; no call to `Storage.prototype.setItem` when enabling, muting, or restarting; the preference survives restart in memory and is off after remount; context failure keeps gameplay working with no error message; the master gain never exceeds 0.5; the Watcher cue fires once per Absence end only when sound is on; the tension loop stops when the level leaves `critical`.
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.8, 19.9, 19.10, 19.11, 19.12, 19.13, 19.14_

  - [ ] 7.10 Implement accessibility structure and focus management
    - Create `src/components/SkipLink.tsx` and `LiveRegions.tsx`. Every screen gets exactly one `header`, one `main`, one `footer`, one `h1`, and the Skip_Link as the first focusable element. The Skip_Link targets the current screen's `main` (the `h1` on Start, the Code_Editor on Play, `main` on Results) and never targets the editor on other screens.
    - Focus management keyed on `phase`: Begin on Start, the `h1` on Play and Results. Polite live regions: test summary ("3 of 5 tests passed", once per completed or timed-out run), warning level, Watcher notice, and editor limit.
    - Add `:focus-visible` rings of at least 3 px with at least 3:1 contrast, no positive `tabindex`, and a tab order that matches reading order.
    - _Requirements: 18.1, 18.2, 18.3, 18.7, 18.8, 18.9, 18.10, 18.11, 18.12, 6.5, 9.6, 2.8, 13.8_

  - [ ]* 7.11 Write accessibility component tests
    - Landmark counts and a single `h1` on every screen; Skip_Link first and its target per screen; no positive `tabindex`; "3 of 5 tests passed" announced exactly once per run; Mute control label and `aria-pressed`; keyboard-only start, run, and restart.
    - _Requirements: 18.3, 18.7, 18.8, 18.9, 18.10, 18.11, 18.12, 6.5, 19.6_

  - [ ]* 7.12 Write a token contrast unit test
    - Compute relative luminance and contrast from `tokens.css` values: `--bg` luminance at most 0.02, text on `--bg` at least 4.5:1, focus on `--bg` at least 3:1, and exactly one red accent defined.
    - _Requirements: 20.1, 4.2, 18.2, 9.7_

- [ ] 8. Checkpoint D - Ensure all tests pass
  - Run `npm run test`, `npm run typecheck`, and `npm run build`. Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Milestone E: Production-build verification and documentation
  - [ ] 9.1 Implement the real-browser build verification script
    - Create `scripts/verify-build.mjs` and add the `verify:build` npm script. Add Playwright as a dev dependency (headless Chromium).
    - The script builds (unless `--no-build`), asserts `dist/assets` holds a non-empty worker script referenced by the main bundle, starts `vite preview` on a free port as a child process (stopped on exit), and supports `VERIFY_URL` for a dev server.
    - Flow against the REAL worker: click Begin, Run Tests with the starter and assert the worker asset returned 200 with 4 passing and 1 failing tests within the Run_Timeout. Replace the code with `function brightestCandle(c) { while (true) {} }`, Run Tests, and assert that during the run a `requestAnimationFrame` counter keeps advancing and the sanity meter keeps updating, that after about 3000 ms every test shows `timeout`, Run Tests is re-enabled, and no worker is alive. Then replace the code with the correct fix (`>`), Run Tests, and assert a fresh worker streams five passes and the Results screen shows a win.
    - Also assert zero requests to other origins (no backend, no external fonts, audio, or images), no horizontal scroll at 1024 and 3840 px viewports, and no bounding-box overlap between the Watcher and the editor, test results, and controls.
    - Exit non-zero with an error identifying the failing step, and leave source files unchanged.
    - _Requirements: 5.3, 5.6, 5.7, 5.12, 5.15, 7.7, 10.1, 20.4, 20.5, 21.9, 21.10, 21.12_

  - [ ] 9.2 Run the build verification against both the production preview and the dev server
    - Run `npm run verify:build` (production build plus `vite preview`) and fix any failure.
    - Start the dev server in a separate terminal with `npm run dev` (a long-running process that the developer starts manually), then run `VERIFY_URL=http://localhost:5173 node scripts/verify-build.mjs --no-build`. Both modes must pass.
    - _Requirements: 5.15, 21.12, 5.6_

  - [ ] 9.3 Write `docs/EXECUTION.md`
    - Create the file new (append a new section if it already exists) covering: purpose and scope; a Web Worker keeps the page responsive and is not a security sandbox; player code in the worker can make network requests, use worker-scoped browser APIs, and consume CPU and memory until termination; only code typed by the player in the same session is supported; the Run_Timeout is 3000 milliseconds; on timeout the worker is terminated, tests without a result are reported `timeout`, and the player is informed; how code runs (`new Function` in a per-run module worker, a synchronous infinite loop stops only through termination).
    - Do not touch README.md in this step.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

  - [ ] 9.4 Update `README.md` deliberately (append-only)
    - As a separate step after scaffolding, append player-facing setup and gameplay sections (install, `npm run dev`, `npm run build`, `npm run test`, `npm run typecheck`, `npm run verify:build`, how to play, Page Visibility-only detection, no camera or eye tracking, sound opt-in, playtest query overrides in dev) and a link to `docs/EXECUTION.md`.
    - Preserve all existing README content. Confirm with `git diff README.md` that there are only added lines.
    - _Requirements: 21.6, 16.9, 2.11_

  - [ ]* 9.5 Write a documentation content test
    - Assert `docs/EXECUTION.md` contains the required statements (not a sandbox, network access, only same-session code, 3000 ms, termination and `timeout` reporting) and that `README.md` links to it.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.9_

  - [ ] 9.6 Create the final manual playtest checklist
    - Create `docs/PLAYTEST.md` with the manual checks from the design: tab switch and minimize (cost, one Mutation, cue, noticed Watcher), mid-round reduced-motion toggle, code contrast at every level with CRT and vignette, `while(true){}` responsiveness and recovery, keyboard-only full round including Escape then Tab, sound opt-in and off after reload and opt-in surviving restart, playtest query overrides (for example `?drainMs=300&absenceCost=40`), and screen reader announcement timing.
    - Only create the checklist file. Running the playtest is outside this plan.
    - _Requirements: 8.3, 10.4, 12.13, 17.4, 18.1, 19.1, 19.10, 20.3, 21.11_

  - [ ] 9.7 Verify the repository constraints at the end
    - Confirm `README.md` and `LICENSE` have no deleted lines and `.gitignore` has only added lines (`git diff`). Confirm `git check-ignore .kiro` reports no match and `git ls-files .kiro` lists every spec file.
    - Confirm no file under `src/` imports `tests/fixtures/referenceSolution.ts`, and that the production bundle does not contain the reference solution text.
    - _Requirements: 3.3, 21.3, 21.4, 21.7, 21.8_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Run `npm run test`, `npm run typecheck`, `npm run build`, and `npm run verify:build`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. The fixture validation test (1.16), the boundary test (1.19), the StrictMode test (3.20), and the build verification (9.1, 9.2) are not optional because the requirements mandate them (Requirements 22.1, 22.14 to 22.16, 22.22, 21.12).
- Each task cites granular requirement criteria for traceability. Property tests cite the design's property numbers.
- The reducer is built in three steps: phases and drain (1.17), run handling and win/loss ordering (3.3), and Absences and Mutations (5.1). Properties 2 and 10 and the Property 5 and 7 Absence and Mutation cases are therefore tested after 5.1.
- Milestone E task 9.2 includes a dev-server run. The dev server is a long-running process and must be started manually in a separate terminal.
- Visual quality, real audio output, real tab-visibility behavior, and screen reader timing are covered by the manual checklist (9.6), not by automation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.6", "1.7", "1.9", "1.10"] },
    { "id": 3, "tasks": ["1.5", "1.8", "1.11", "1.13", "1.14", "1.15", "1.16", "3.1", "3.9"] },
    { "id": 4, "tasks": ["1.12", "1.17", "3.2", "3.10"] },
    { "id": 5, "tasks": ["1.18", "1.19", "3.3"] },
    { "id": 6, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.8", "3.11", "5.1"] },
    { "id": 7, "tasks": ["3.12", "3.13", "3.15", "5.2", "5.3", "5.4"] },
    { "id": 8, "tasks": ["3.14", "3.16", "3.17", "3.18"] },
    { "id": 9, "tasks": ["3.19", "5.5", "5.7"] },
    { "id": 10, "tasks": ["3.20", "3.21", "5.6", "5.8"] },
    { "id": 11, "tasks": ["5.9", "7.1", "7.5", "7.7"] },
    { "id": 12, "tasks": ["7.2", "7.3", "7.12"] },
    { "id": 13, "tasks": ["7.4"] },
    { "id": 14, "tasks": ["7.6", "7.8"] },
    { "id": 15, "tasks": ["7.9", "7.10"] },
    { "id": 16, "tasks": ["7.11", "9.1", "9.3", "9.6"] },
    { "id": 17, "tasks": ["9.2", "9.4"] },
    { "id": 18, "tasks": ["9.5", "9.7"] }
  ]
}
```
