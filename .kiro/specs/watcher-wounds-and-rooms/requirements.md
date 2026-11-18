# Two-room amendment

This amendment supersedes the original single-challenge scope, transient-only
mutation feedback, and tab-only trigger below.

- Keep the changed line's before/after comparison visible during play until
  its original line is restored or the room is cleared. Mark the editor line
  and map the marker through edits.
- A two-second pointer/touch or Space/Enter hold on the Watcher requests the
  same cost and mutation behavior as a tab return. Early release, blur, page
  hiding, and unmount cancel an unfinished hold. Key repeat cannot retrigger it.
- Preserve one successful cut per room. Later holds and tab returns still cost
  sanity. A penalty reaching zero ends the room before mutation.
- Winning room one unlocks exactly one additional room, with a new function,
  five tests, and three new curated cuts. Starting it creates a fresh round
  token, resets sanity to 100, and clears prior run/mutation state.
- Restart returns to room one. Results retain the completed room's cut history.


# Two-room implementation amendment

- `roomIndex` selects the challenge and its hand-written candidate mutations.
  `NEXT_ROOM` is accepted only after winning room one. It starts room two
  with a new monotonically increasing round token and fresh resources.
- `LOOK_AWAY` and `VISIBILITY_VISIBLE` share the reducer's penalty/cut branch.
  The Watcher button completes a hold after 2000 ms, cancels on release/blur/
  hidden state/unmount, and ignores held-key repeats.
- A mutation record supplies a compact line pair during play. Restoration
  is tracked separately from the retained historical snapshot. A CodeMirror
  state field maps a line decoration through edits.
- Both workers and timeout result filling use the selected room's fixtures.
  Old-room callbacks remain subject to the existing round/run token checks.
- New regression tests cover hold duration/cancellation, wound persistence,
  marker mapping, room progression, fixture validation, and stale room events.


Validation status

354 automated tests, type-checking, and the production build pass.
The Vercel branch preview was tested in connected Chrome. Two-second Space/Enter\nholds applied each room's own cut, the wound survived notice expiry, repairing\nthe line cleared the marker, and both rooms were won in sequence. Restart\nreturned to room one. At 1024×768 the start screen fit and the wound layout had\nno horizontal overflow. The standalone headless verification script could not\nrun because Chromium cannot start in this workspace.
