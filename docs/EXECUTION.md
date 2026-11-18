# Code execution: scope and limitations

## Purpose and scope

Don't Look Away runs the JavaScript the player types in the editor against a fixed set of test cases. This document describes how that code runs and what the design does and does not protect against.

## Security model

A Web Worker keeps the page responsive. It is **not a security sandbox**.

Player code running in the worker can:

- make network requests (`fetch`, `XMLHttpRequest`, `WebSocket`);
- use browser APIs that are available in workers;
- consume CPU and memory until the worker is terminated.

The game is intended for running **only code typed by the player in the same session**. Do not paste code from untrusted parties into the editor.

## Run timeout

The Run_Timeout is **3000 milliseconds** by default. It can be changed for playtesting through Game_Config (`runTimeoutMs`).

When a run exceeds the timeout:

- the worker is terminated;
- tests that have no result are reported as `timeout`;
- results that already completed are kept;
- the player sees the notice "Run timed out".

## How code runs

- Each run creates a new module worker (`src/worker/createExecutionWorker.ts`). The worker exists only for that run and is terminated afterward: on completion, on timeout, when the run becomes stale (for example the code changes), and when the round ends.
- The worker compiles the player's code once per run with `new Function`, prefixed with `"use strict"` (`src/core/execute.ts`). It then calls the target function for each test with a deep clone of the arguments.
- The worker posts one `result` message per test as it finishes, then a `done` message. An unexpected exception posts `fatal`.
- Every message carries `roundId` and `runId`, so the main thread ignores messages from stale runs.
- A synchronous infinite loop cannot be interrupted from inside the worker. It stops only when the main thread terminates the worker.

## Limitations

- Memory is not capped. A payload can exhaust memory before the timeout fires.
- The worker shares the page's origin, so it can fetch same-origin resources.
- The game enforces no Content Security Policy.
- `terminate()` relies on the browser's implementation.
- A malicious payload could still make network requests or exhaust memory before the timeout.

## The Watcher

The Watcher's mutations to the code are deterministic string replacements. Mutated code is never executed on the main thread. It runs only in the per-run worker described above.

## Verification

Run `npm run verify:build` to check the production build.
