# Requirements Document

## Introduction

"Don't Look Away" is a browser-based psychological horror coding game built with React, TypeScript, and Vite for Kiroween 2026 (Costume Contest category). The player repairs a broken JavaScript function while a presence called the Watcher builds tension. When the player switches away from the browser tab and returns, the Watcher may apply one curated change to the player's code. The first playable version applies at most one successful Mutation per round. Later Absences in the same round still cost sanity. The player wins by passing every test and loses when the sanity meter reaches zero. The results screen reveals what the Watcher changed, if anything.

Status: approved, including final clarifications on audio opt-in, skipped Mutations, streamed worker results, snapshot failure, cleanup, and sanity property tests.

This document covers the first playable version. Mutations are deterministic. Visual direction: dark charcoal background, restrained red accents, readable code, subtle CRT effects, and an unsettling Watcher presence.

Scope constraints for the repository: the existing README.md, LICENSE, and .gitignore are preserved, and the .kiro directory remains tracked in Git.

### Provisional Settings

The following values are PROVISIONAL playtest settings. They may change after playtesting, and any change must be applied consistently across this document:

- Sanity drain: 1 point every 2 seconds while the tab is visible.
- Warning thresholds: `calm` 71-100, `uneasy` 41-70, `distressed` 21-40, `critical` 0-20.
- Run_Timeout: 3000 milliseconds.
- Keyboard shortcuts: Ctrl+Enter or Cmd+Enter runs tests, and Escape releases the Tab key trap in the Code_Editor.
- Code_Editor limit: 100,000 characters.
- Test_Case count: 4 to 8 per Challenge.
- Absence cost: 10 sanity points per Absence.
- Noticed duration: 3 seconds.
- Audio master volume cap: 50% of the maximum output level.

All gameplay settings in this list live in one central Game_Config module, as required by Requirement 21, so that playtesting changes touch a single location.

### Out of Scope

Runtime AI-generated mutations and camera or eye tracking are future features and are out of scope for this version. This version runs entirely in the browser with deterministic Mutations and detects absence only through the Page Visibility API.

## Glossary

- **Game**: The complete browser application, "Don't Look Away".
- **Game_Controller**: The component that owns the game state machine and coordinates all other components.
- **Game_State**: One of four values: `ready`, `playing`, `won`, `lost`. The values `won` and `lost` are terminal outcomes.
- **Game_Event**: Any input to the Game_Controller that may change game state, including a start activation, a Sanity_Meter drain tick, an Absence end, a test run result, a visibility change, and a restart activation.
- **Round**: One play session, beginning when the Game_State changes from `ready` to `playing` and ending when the Game_State reaches `won` or `lost`, or when the player restarts.
- **Round_Id**: An identifier assigned by the Game_Controller to each Round. The Round_Id differs for every Round within a page lifetime. When a Round ends or the player restarts, the Round_Id is invalidated immediately and synchronously (the active-round token changes in the same Game_Event processing step), so that late callbacks, timers, worker messages, and visibility events tagged with the ended Round_Id become no-ops.
- **Game_Config**: The single central configuration module holding every configurable gameplay setting listed under Provisional Settings.
- **Resource_Release**: The release of timers, listeners, Execution_Workers, and audio nodes during normal React effect cleanup. Resource_Release is distinct from invalidation, which is immediate.
- **Start_Screen**: The screen shown in the `ready` state, containing instructions, a start control, and the Mute_Control.
- **Play_Screen**: The screen shown in the `playing` state, containing the code editor, test panel, sanity meter, Mute_Control, and Watcher.
- **Results_Screen**: The screen shown in the `won` and `lost` states.
- **Skip_Link**: The first focusable element on each screen, which moves keyboard focus to the main content of the screen that is currently displayed.
- **Code_Editor**: The editable, syntax-highlighted JavaScript editing area.
- **Challenge**: A JavaScript function with a description and a fixed list of Test_Cases that the player must fix.
- **Reference_Solution**: A correct implementation of the Challenge function, kept as a test fixture that is used only by development-time automated tests.
- **Test_Case**: A single input and expected output pair with a display name.
- **Test_Runner**: The component that creates an Execution_Worker when a run starts, sends player code to it, accumulates the Test_Results streamed by the worker for the current run, and terminates the worker when the run ends. All player code runs off the main thread.
- **Execution_Worker**: The Web Worker that runs player code and Test_Cases and streams one message per completed Test_Case. Every message in both directions carries the Round_Id and the Run_Id. An Execution_Worker exists only while a run is in progress.
- **Run_Timeout**: The maximum duration of 3000 milliseconds that a single test run may take.
- **Test_Result**: The outcome of one Test_Case: `pass`, `fail`, `error`, or `timeout`, with a message.
- **Run_Id**: A monotonically increasing integer assigned to each test run. Every test run and its Test_Results are tagged with both the Run_Id and the Round_Id of the Round in which the run started.
- **Current_Result**: The accumulated Test_Results of a test run whose Round_Id equals the current Round_Id, whose Run_Id equals the latest assigned Run_Id, and which is not marked stale. A Current_Result may be partial while the run is in progress, and is complete once the run has received or filled in a Test_Result for every Test_Case.
- **Sanity_Meter**: The indicator of the player's remaining sanity, an integer from 0 to 100.
- **Warning_Level**: One of `calm` (sanity 71-100), `uneasy` (41-70), `distressed` (21-40), `critical` (0-20). Every integer from 0 to 100 maps to exactly one Warning_Level.
- **Watcher**: The antagonist entity, presented as a visual presence on the Play_Screen.
- **Mutation**: A predefined, curated transformation of the player's code applied by the Watcher.
- **Mutation_Engine**: The component that selects and applies Mutations.
- **Mutation_Sequence**: The ordered list of candidate Mutations defined for the Challenge. This version defines exactly 3 candidates.
- **Absence**: A period in the `playing` state during which the page's visibility state, as reported by the Page Visibility API, is `hidden`.
- **Code_Snapshot**: A stored copy of the player's code taken immediately before a Mutation is applied.
- **Audio_Manager**: The component that plays sound effects and ambient audio.
- **Mute_Control**: The interactive control that toggles audio between muted and unmuted. Its label is "Enable sound" while audio is off and "Mute sound" while audio is on. Audio is off after every page load, and enabling sound is the player's explicit opt-in, performed by a single activation of the control.
- **Reduced_Motion_Preference**: The user's `prefers-reduced-motion: reduce` operating system or browser setting.
- **CRT_Effect**: A subtle visual overlay simulating scanlines, vignette, and slight flicker.

## Requirements

### Requirement 1: Game State Machine

**User Story:** As a player, I want the game to move through clear phases, so that I always know whether I am waiting, playing, winning, or losing.

#### Acceptance Criteria

1. THE Game_Controller SHALL maintain exactly one Game_State at a time, chosen from `ready`, `playing`, `won`, and `lost`.
2. WHEN the Game finishes loading, THE Game_Controller SHALL set the Game_State to `ready`.
3. WHEN the player activates the start control on the Start_Screen while the Game_State is `ready`, THE Game_Controller SHALL transition the Game_State from `ready` to `playing` and assign a new Round_Id.
4. THE Game_Controller SHALL process Game_Events one at a time, in the order in which the Game_Controller receives them, and SHALL complete the processing of each Game_Event before processing the next.
5. WHEN a Current_Result in which every Test_Case has a Test_Result of `pass` is processed while the Game_State is `playing` and the Sanity_Meter value is greater than 0, THE Game_Controller SHALL transition the Game_State from `playing` to `won`.
6. IF a Current_Result in which every Test_Case has a Test_Result of `pass` is processed while the Game_State is `playing` and the Sanity_Meter value is already 0, THEN THE Game_Controller SHALL transition the Game_State from `playing` to `lost` and SHALL NOT transition it to `won`.
7. WHEN the Sanity_Meter value reaches 0 through the processing of a drain tick or Absence end while the Game_State is `playing`, THE Game_Controller SHALL transition the Game_State from `playing` to `lost` as part of processing that Game_Event, so that a passing result processed afterward cannot produce `won`.
8. WHILE the Game_State is `won` or `lost`, THE Game_Controller SHALL treat the outcome as final, and no later Game_Event, including a late test result, a drain tick, or a visibility change, SHALL change the Game_State, the Sanity_Meter value, or the displayed outcome, other than a restart.
9. WHEN the player activates the restart control while the Game_State is `won` or `lost`, THE Game_Controller SHALL transition the Game_State to `ready`, reset the Sanity_Meter to its initial value, invalidate the current Round_Id, and clear all Test_Results from the previous Round.
10. IF a transition is requested other than `ready` to `playing`, `playing` to `won`, `playing` to `lost`, `won` to `ready`, or `lost` to `ready`, THEN THE Game_Controller SHALL reject the transition, keep the current Game_State unchanged, and leave the displayed screen unchanged.
11. WHEN the Game_State changes, THE Game_Controller SHALL render only the screen that corresponds to the new Game_State, and SHALL stop displaying the screen of the previous Game_State, in the same render commit as the change.
12. WHILE the Game_State is `won` or `lost`, THE Game_Controller SHALL ignore test run submissions and Sanity_Meter changes, and keep the Game_State unchanged.

### Requirement 2: Start Screen

**User Story:** As a player, I want an introduction with instructions, so that I understand the rules before I begin.

#### Acceptance Criteria

1. WHILE the Game_State is `ready`, THE Start_Screen SHALL display the game title, instructions, the Mute_Control, and a start control, all visible without scrolling at viewport sizes of 1024x768 pixels or larger.
2. WHILE the Game_State is `ready`, THE Start_Screen SHALL state that the goal is to pass every test before sanity reaches zero.
3. WHILE the Game_State is `ready`, THE Start_Screen SHALL state that the Game detects when the page becomes hidden or visible again through the browser's Page Visibility API, for example when the player switches to another browser tab or minimizes the window, and that returning from such an absence may cause the Watcher to change the code.
4. WHILE the Game_State is `ready`, THE Start_Screen SHALL state that the Watcher changes the code at most once per round, and that each later absence in the same round still reduces sanity.
5. WHILE the Game_State is `ready`, THE Start_Screen SHALL state that the Game does not use a camera or eye tracking, and that switching to another window that remains visible alongside the Game may not be detected.
6. WHILE the Game_State is `ready`, THE Start_Screen SHALL state that audio is off, including after a page reload, until the player turns it on with one activation of the "Enable sound" Mute_Control.
7. WHILE the Game_State is `ready`, THE Start_Screen SHALL state that the player's code runs in the browser without a security sandbox and that the player should enter only code they trust.
8. WHEN the Start_Screen is displayed, THE Game_Controller SHALL move keyboard focus to the start control.
9. WHEN the player activates the start control by mouse click, the Enter key, or the Space key, THE Game_Controller SHALL change the Game_State from `ready` to `playing` and hide the Start_Screen in the same render commit.
10. IF the Start_Screen fails to render any of the required content in criteria 1 to 7, THEN THE Game_Controller SHALL keep the start control disabled and display an error message indicating that the instructions could not be loaded.
11. THE Game SHALL NOT use a camera, microphone, or eye tracking, and THE Start_Screen SHALL NOT claim to detect eye gaze, camera input, or every window switch.

### Requirement 3: Challenge Definition

**User Story:** As a player, I want a clear JavaScript challenge with defined tests, so that I know what a correct solution looks like.

#### Acceptance Criteria

1. THE Game SHALL provide exactly one Challenge containing a description of 1 to 500 characters, a function name of 1 to 50 characters that is a valid JavaScript identifier, starter code of 1 to 5,000 characters, and between 4 and 8 Test_Cases.
2. THE Game SHALL define each Test_Case with a name of 1 to 80 characters that is unique within the Challenge, a set of input arguments, and an expected return value.
3. THE Game SHALL treat the Reference_Solution as a test fixture used only by development-time automated tests, SHALL NOT display the Reference_Solution in the player UI, and the production bundle need not include the Reference_Solution.
4. WHEN the Game loads, THE Game SHALL NOT execute the Reference_Solution or the starter code, so that loading the Game does not depend on running any Challenge code.
5. WHEN the Play_Screen is displayed, THE Play_Screen SHALL show the full Challenge description and the name of every Test_Case without requiring scrolling or interaction beyond the page's normal scroll.
6. WHEN a new game begins, THE Code_Editor SHALL contain the Challenge starter code, replacing any prior editor content.

### Requirement 4: Code Editor

**User Story:** As a player, I want to edit JavaScript with syntax highlighting, so that I can read and change the code comfortably.

#### Acceptance Criteria

1. WHILE the Game_State is `playing`, THE Code_Editor SHALL accept text input and display the current code with JavaScript syntax highlighting.
2. THE Code_Editor SHALL render code in a monospace font with a contrast ratio of at least 4.5:1 between code text and the editor background.
3. WHILE the Game_State is `won` or `lost`, THE Code_Editor SHALL prevent text modification, retain the current code visible and unchanged, and remain readable and scrollable.
4. THE Code_Editor SHALL expose an accessible name of 1 to 100 characters that identifies it as the code editor to assistive technologies.
5. WHEN the player presses Escape while the Code_Editor has focus, THE Code_Editor SHALL release the Tab key trap so that the next Tab key press moves focus to the next focusable element after the Code_Editor in document order.
6. WHEN the player changes the code, THE Game_Controller SHALL record the new code as the current code before processing the next Game_Event.
7. WHILE the Code_Editor has focus and the Tab key trap is active, THE Code_Editor SHALL insert an indentation into the code when the player presses Tab, and SHALL NOT move focus.
8. IF the player pastes or types code that makes the total length exceed 100,000 characters, THEN THE Code_Editor SHALL reject the excess input, keep the previously accepted code unchanged, and display an indication that the limit was reached.

### Requirement 5: Test Execution in a Web Worker

**User Story:** As a player, I want to run my code against tests without freezing the page, so that I can get feedback even if my code loops forever.

#### Acceptance Criteria

1. WHILE the Game_State is `playing`, THE Play_Screen SHALL display a Run Tests button.
2. WHEN the player activates the Run Tests button and no test run is in progress, THE Test_Runner SHALL assign a new Run_Id that is unique within the session, tag the run with the current Round_Id, create a new Execution_Worker for that run, and send the current code, the Run_Id, and the Round_Id to the Execution_Worker.
3. THE Execution_Worker SHALL execute the player's code and every Test_Case outside the main thread, so that no player code or Test_Case runs on the main thread.
4. WHEN the Execution_Worker completes a Test_Case, THE Execution_Worker SHALL send one message containing the Test_Result of that Test_Case (with a status of `pass`, `fail`, `error`, or `timeout`), the Run_Id, and the Round_Id, so that each Test_Case produces exactly one message, and a zero-based integer test index within the Challenge's Test_Case range, and THE Test_Runner SHALL accumulate these Test_Results for the current run by test index and SHALL treat the run as complete when it holds exactly one Test_Result for each Test_Case.
5. IF a Test_Case throws an exception or the player's code fails to parse, THEN THE Test_Runner SHALL record a Test_Result of `error` containing the error message, and SHALL continue executing the remaining Test_Cases when the failure is a Test_Case exception, or record `error` for every Test_Case when the player's code fails to parse.
6. IF a run exceeds the Run_Timeout of 3000 milliseconds, THEN THE Test_Runner SHALL terminate the Execution_Worker, keep the Test_Results already received for that run, record a Test_Result of `timeout` for each Test_Case without a result, and keep no idle Execution_Worker, so that the next run creates a fresh Execution_Worker.
7. WHILE a test run is in progress, THE Play_Screen SHALL disable the Run Tests button and display a visible in-progress indicator, and WHEN the run ends with results, error, or timeout, THE Play_Screen SHALL re-enable the Run Tests button and remove the indicator by the next render.
8. THE Execution_Worker SHALL send messages as structured-cloneable data containing no functions or DOM references, and every message sent in either direction SHALL carry the Round_Id and the Run_Id.
9. WHEN the Test_Runner receives a message, THE Test_Runner SHALL validate the Round_Id and Run_Id carried in that message against the current Round_Id and the current run's Run_Id before dispatching the message, and SHALL NOT substitute captured Round_Id or Run_Id values for the received values. IF the message's own Round_Id does not match the current Round_Id, or its own Run_Id does not match the Run_Id of the current run, THEN THE Test_Runner SHALL discard the message without changing the displayed Test_Results, the Sanity_Meter, or the Game_State.
10. IF the Execution_Worker cannot be created or reports a worker-level error, THEN THE Test_Runner SHALL record a Test_Result of `error` for each Test_Case without a result, THE Play_Screen SHALL display an error message indicating that tests could not run, and THE Play_Screen SHALL re-enable the Run Tests button.
11. WHEN the Test_Runner processes a Current_Result, THE Game_Controller SHALL use that result for display, and SHALL NOT use any result that is not a Current_Result for display or win evaluation.
12. WHEN a run completes, times out, becomes stale, or fails, or WHEN the Round ends, THE Test_Runner SHALL terminate that run's Execution_Worker, so that no idle Execution_Worker remains alive.
13. THE Game_Controller SHALL evaluate a win only once a run is complete (every test index received exactly once) and every one of its Test_Results is `pass`, and SHALL NOT evaluate a partial Current_Result for the `won` transition.
14. WHEN the Test_Runner receives a per-test result for the current run, THE Test_Runner SHALL validate that the test index is an integer within the Challenge's Test_Case range, and SHALL ignore a result whose test index is out of range, not an integer, or already received for that run, without changing the displayed Test_Results, the Sanity_Meter, or the Game_State.
15. THE Execution_Worker script SHALL be resolved relative to the module that constructs it, and SHALL load and run in both the Vite development server and the production build.

### Requirement 6: Individual Test Results Display

**User Story:** As a player, I want to see the result of each test separately, so that I know exactly what to fix.

#### Acceptance Criteria

1. WHEN a Test_Result is received for the current run, THE Play_Screen SHALL display progressively, for every Test_Case in the run, its name, its Test_Result status (or "not run" until a Test_Result is received), and a message, with each Test_Case shown as its own separate entry in the same order as the Test_Case definitions, for as long as that run is current.
2. WHEN a Test_Result is `fail`, THE Play_Screen SHALL display the expected value and the actual value for that Test_Case within the same entry, truncating any value longer than 500 characters to its first 500 characters followed by a visible truncation indicator.
3. IF a Test_Result is `error` or `timeout`, THEN THE Play_Screen SHALL display the expected value and an indication that no actual value was produced, together with a message describing the cause.
4. THE Play_Screen SHALL convey each Test_Result status through visible text or an icon with a text alternative, in addition to color, so that the status is identifiable when color is not perceivable.
5. WHEN a run completes or times out and its Current_Result is displayed, THE Play_Screen SHALL announce the number of passing tests out of the total number of Test_Cases (for example, "3 of 5 tests passed") to assistive technology through a polite live region within 1 second of the results being displayed, exactly once per run.
6. WHILE no Current_Result has been received in the current Round, THE Play_Screen SHALL display each Test_Case with its name and a status of "not run".
7. WHEN the first Test_Result of a new current run is received after a previous Current_Result was displayed, THE Play_Screen SHALL replace all previously displayed Test_Result statuses, messages, and expected and actual values with the results of the new run, showing "not run" for each Test_Case that has no Test_Result yet.

### Requirement 7: Stale Result Handling

**User Story:** As a player, I want results to match the code I see, so that I am never misled by outdated test output.

#### Acceptance Criteria

1. WHEN the code in the editor changes while a test run is in progress, THE Test_Runner SHALL mark that run as stale before the next Game_Event is processed.
2. WHEN a Mutation is applied while a test run is in progress, THE Test_Runner SHALL mark that run as stale before the next Game_Event is processed.
3. WHEN the Test_Runner receives a message whose own Run_Id differs from the latest assigned Run_Id, or whose own Round_Id differs from the current Round_Id, THE Test_Runner SHALL discard that message, leave the displayed results unchanged, and display no error to the player.
4. WHEN the Test_Runner receives a message for a run marked as stale, THE Test_Runner SHALL discard that message and leave the displayed results unchanged.
5. WHEN the code in the editor changes after a Current_Result is displayed, THE Play_Screen SHALL mark the displayed results as outdated by the next render, and SHALL keep the displayed results visible with a visible outdated indicator until a new Current_Result is received.
6. IF the Test_Runner discards a message because the run is stale, because the Run_Id differs from the latest assigned Run_Id, or because the Round_Id differs from the current Round_Id, THEN THE Game_Controller SHALL NOT evaluate that message for the `won` transition and SHALL keep the current Game_State unchanged.
7. WHEN a run is marked stale, THE Test_Runner SHALL invalidate that run immediately so that every later message, timer callback, and result from that run is a no-op, SHALL terminate the associated Execution_Worker during React effect cleanup, and SHALL re-enable the Run Tests button by the next render.
8. WHEN the Test_Runner marks a run as stale, THE Test_Runner SHALL NOT start a new run automatically, and SHALL start a new run only when the player activates the Run Tests button.

### Requirement 8: Sanity Meter

**User Story:** As a player, I want a sanity meter, so that I feel pressure and can see how close I am to losing.

#### Acceptance Criteria

1. WHEN the Game_State becomes `playing`, THE Sanity_Meter SHALL be set to 100 in the same render commit as the transition.
2. WHILE the Game_State is `playing` and the browser tab is visible, THE Sanity_Meter SHALL decrease by 1 point every 2 seconds (±100 milliseconds), with a minimum value of 0.
3. WHEN an Absence ends while the Game_State is `playing`, THE Sanity_Meter SHALL decrease by 10 points, with a minimum value of 0, regardless of whether a Mutation was applied in the current Round.
4. WHEN a test run starts, completes, fails, errors, or times out, THE Sanity_Meter SHALL keep its current value, so that running tests never changes the Sanity_Meter value.
5. THE Sanity_Meter SHALL decrease only through the timed drain defined in criterion 2 and the Absence cost defined in criterion 3.
6. WHILE the Game_State is not `playing`, THE Sanity_Meter SHALL hold its current value and ignore decreases from the time-based drain and Absence end.
7. WHILE the browser tab is hidden, THE Sanity_Meter SHALL hold its current value, and THE Sanity_Meter SHALL resume the 2-second decrease interval when the tab becomes visible.
8. WHEN the Sanity_Meter value changes, THE Sanity_Meter SHALL update its displayed integer value (0 to 100) and a visual bar whose filled proportion equals value/100 by the next render.
9. WHEN the Sanity_Meter value changes, THE Sanity_Meter SHALL expose to assistive technology an accessible name of "Sanity" and a current value equal to the integer value, with a minimum of 0 and a maximum of 100.
10. WHEN the Sanity_Meter value reaches 0 while the Game_State is `playing`, THE Sanity_Meter SHALL display the value 0 and a bar with 0% fill until the transition to `lost` renders the Results_Screen.

### Requirement 9: Escalating Visual Warnings

**User Story:** As a player, I want the screen to grow more disturbing as my sanity falls, so that I feel the danger rising.

#### Acceptance Criteria

1. WHEN the Sanity_Meter value changes, THE Game SHALL compute the Warning_Level from the Sanity_Meter value using the ranges defined in the Glossary, so that the Warning_Level is `critical` for every integer value from 0 to 20.
2. WHEN the Warning_Level changes, THE Play_Screen SHALL apply the visual treatment associated with the new Warning_Level and remove the visual treatment of the previous Warning_Level in the same render commit.
3. WHILE the Warning_Level is `uneasy`, THE Play_Screen SHALL display the red accent on the Sanity_Meter and the CRT_Effect at a higher intensity than at the Warning_Level `calm`, and at a lower intensity than at `distressed`.
4. WHILE the Warning_Level is `distressed`, THE Play_Screen SHALL display a text warning and render the Watcher at a higher opacity than at `uneasy` and a lower opacity than 100%.
5. WHILE the Warning_Level is `critical`, THE Play_Screen SHALL display a text warning in a larger font size than the `distressed` text warning, display a red vignette around the screen edges, and render the Watcher at 100% opacity, including while the Sanity_Meter value is 0 and the Play_Screen remains displayed.
6. WHEN the Warning_Level changes, THE Play_Screen SHALL announce the new Warning_Level text to assistive technology through a polite live region exactly once per change.
7. THE Play_Screen SHALL keep the Code_Editor text at the contrast ratio defined in Requirement 4 at every Warning_Level, including while the red vignette and CRT_Effect are displayed.
8. THE Game SHALL NOT render any flashing content that exceeds 3 flashes in any one-second period.
9. IF the Sanity_Meter value is outside the range 0 to 100 or is not a number, THEN THE Game SHALL retain the current Warning_Level and the current visual treatment.

### Requirement 10: Watcher Presence

**User Story:** As a player, I want an unsettling Watcher on screen, so that I feel observed while I work.

#### Acceptance Criteria

1. WHILE the Game_State is `playing`, THE Play_Screen SHALL display the Watcher as a visual element whose bounding box has 0 px of overlap with the bounding boxes of the Code_Editor, the test results, and every control.
2. WHILE the Game_State is `playing` and the Reduced_Motion_Preference is not set, THE Watcher SHALL animate its gaze toward the Code_Editor in a continuous loop with a cycle duration between 4 and 10 seconds.
3. WHILE the Game_State is `playing` and the Reduced_Motion_Preference is set, THE Watcher SHALL display a static gaze directed toward the Code_Editor with no animation.
4. WHEN an Absence ends, THE Watcher SHALL change to a "noticed" appearance that differs from its default appearance in at least one visible attribute (shape, color, or eye state), and SHALL revert to the default appearance 3 seconds (±100 ms) after the Absence ends.
5. IF a second Absence ends while the "noticed" appearance is still displayed, THEN THE Watcher SHALL restart the 3-second "noticed" duration from the time of the second Absence ending.
6. WHEN the Game_State changes from `playing` to any other state, THE Watcher SHALL stop displaying the "noticed" appearance in the same render commit as the change.
7. THE Watcher SHALL be hidden from assistive technology, so that it is not announced, focusable, or included in the accessibility tree.
8. THE Watcher SHALL be rendered with CSS or inline SVG and SHALL NOT issue any network requests for image resources.

### Requirement 11: Tab-Switch Detection

**User Story:** As a player, I want the game to notice when I look away, so that the Watcher can respond.

#### Acceptance Criteria

1. WHILE the Game_State is `playing`, THE Game_Controller SHALL listen for Page Visibility API changes.
2. WHEN the document visibility becomes `hidden` while the Game_State is `playing` and no Absence is active, THE Game_Controller SHALL start an Absence when the visibility change is processed.
3. WHEN the document visibility becomes `visible` while an Absence is active and the Game_State is `playing`, THE Game_Controller SHALL end the Absence, apply the Absence cost defined in Requirement 8, and, IF no Mutation has been applied in the current Round, request exactly one Mutation attempt from the Mutation_Engine, all as part of processing that visibility change.
4. IF a Mutation has already been applied in the current Round when an Absence ends, THEN THE Game_Controller SHALL apply the Absence cost defined in Requirement 8 and SHALL request no further Mutation.
5. IF the Game_State is not `playing` when the document visibility changes, THEN THE Game_Controller SHALL ignore the change, leaving the Absence state unchanged and requesting no Mutation.
6. IF the document visibility becomes `hidden` while an Absence is already active, THEN THE Game_Controller SHALL treat the event as part of the existing Absence and SHALL NOT start a second Absence.
7. WHEN an Absence ends, THE Game_Controller SHALL treat the Absence identically regardless of its duration, including durations from 0 milliseconds to the maximum duration the browser reports.
8. IF the Game_State transitions to `won` or `lost` during an Absence, THEN THE Game_Controller SHALL discard the Absence without applying the Absence cost or requesting a Mutation, including when the document visibility later becomes `visible`.
9. IF the document visibility becomes `visible` while no Absence is active, THEN THE Game_Controller SHALL ignore the event and request no Mutation.
10. THE Game_Controller SHALL detect Absences only through the Page Visibility API, and SHALL NOT use a camera, eye tracking, window focus heuristics, or any other source to detect Absences.

### Requirement 12: Deterministic Code Mutations

**User Story:** As a player, I want the Watcher's change to be curated and predictable in design, so that the change feels deliberate and the game is testable.

#### Acceptance Criteria

1. THE Mutation_Sequence SHALL contain exactly 3 candidate Mutations in a fixed order, each with a unique identifier (1 to 64 characters), a description (1 to 200 characters), a target text, and a transformation of the code.
2. WHEN the Mutation_Engine receives a Mutation attempt, THE Mutation_Engine SHALL try the candidates in Mutation_Sequence order, SHALL stop after the first candidate that is applied successfully, and SHALL apply at most one Mutation per attempt.
3. THE Mutation_Engine SHALL apply at most one Mutation in each Round, and WHEN a Mutation has been applied in the current Round, THE Mutation_Engine SHALL apply no further Mutation in that Round.
4. IF a candidate's target text is not present in the current code, THEN THE Mutation_Engine SHALL skip that candidate for that attempt only, record its identifier as skipped with the skip reason `target-missing`, and try the next candidate in the same attempt.
5. IF the transformation of a candidate fails, or produces code identical to the input, THEN THE Mutation_Engine SHALL leave the code unchanged, skip that candidate for that attempt only, record its identifier as skipped with the skip reason `transform-failed` (transformation failure) or `no-change` (identical output), and try the next candidate in the same attempt.
6. IF every candidate in the Mutation_Sequence is skipped in an attempt, THEN THE Mutation_Engine SHALL leave the code unchanged, record that no Mutation was applied, SHALL NOT notify the player of a code change, and SHALL retry all candidates, in Mutation_Sequence order, on each later Absence in the same Round until one Mutation has been applied.

7. THE Mutation_Engine SHALL select the same candidate on every game when the current code and the Round's applied-Mutation state are the same.
8. THE Mutation_Engine SHALL NOT use random values to select or apply a Mutation.
9. WHEN a Mutation is applied, THE Mutation_Engine SHALL record the Mutation identifier, the Code_Snapshot taken immediately before the Mutation, and the resulting code.
10. WHEN the Mutation_Engine applies a Mutation, THE Code_Editor SHALL display the resulting code by the next render.
11. THE Mutation_Engine SHALL apply each Mutation as a pure function of the current code and return identical output for identical input, with no dependence on time, prior requests, or external state.
12. THE Mutation_Engine SHALL ensure each applied Mutation changes at least 1 line of the code, so that a line-by-line comparison of the code before and after the Mutation shows at least 1 differing line.
13. WHEN a Mutation is applied, THE Play_Screen SHALL display a notification by the next render stating that the Watcher changed the code, without including the Mutation identifier, description, target text, or the changed lines.
14. WHEN a Mutation is applied while a test run is in progress, THE Test_Runner SHALL mark that run as stale, as defined in Requirement 7.
15. WHILE no Mutation has succeeded in the current Round, THE Mutation_Engine SHALL treat every candidate as eligible on every attempt, and WHEN one Mutation has succeeded in the current Round, THE Mutation_Engine SHALL make no further Mutation attempt in that Round.
16. IF the Mutation_Engine cannot store the Code_Snapshot for a candidate, THEN THE Mutation_Engine SHALL cancel that attempt without trying later candidates in the same attempt, as defined in Requirement 13, and SHALL allow a later Absence in the same Round to make a new attempt.
17. IF applying a candidate would make the resulting code exceed the Code_Editor size limit defined in Game_Config, THEN THE Mutation_Engine SHALL leave the code unchanged, store no Code_Snapshot for that candidate, skip that candidate for that attempt only, record its identifier as skipped with the skip reason `size-limit`, which is distinct from `no-change`, `target-missing`, and `transform-failed`, and try the next candidate in the same attempt.

### Requirement 13: Pre-Mutation Snapshot and Results Reveal

**User Story:** As a player, I want to see exactly what the Watcher changed at the end, so that I can understand how the game affected my work.

#### Acceptance Criteria

1. WHEN a Mutation is applied, THE Mutation_Engine SHALL store the Code_Snapshot, containing the full editor text as it was immediately before the Mutation, before replacing the code.
2. IF the Mutation_Engine cannot store the Code_Snapshot, THEN THE Mutation_Engine SHALL leave the code unchanged, cancel that Mutation attempt without trying later candidates in the same attempt, SHALL NOT count the Mutation as applied or as skipped-permanent, SHALL NOT include that Mutation in the Results_Screen comparison, and SHALL make a new attempt on a later Absence in the same Round.
3. THE Game_Controller SHALL retain the Code_Snapshot of the current Round, if a Mutation was applied, until the player activates the restart control.
4. WHILE the Game_State is `won` or `lost`, THE Results_Screen SHALL display the outcome (`won` or `lost`), the final sanity value as an integer, and the number of Mutations applied, which is either 0 or 1.
5. WHILE the Game_State is `won` or `lost` and a Mutation was applied, THE Results_Screen SHALL display the Mutation's description and one line-by-line comparison of the Code_Snapshot and the code that resulted from that Mutation, and SHALL display no other comparison.
6. THE Results_Screen SHALL mark each removed line with a "-" text marker and each added line with a "+" text marker, in addition to any color, and SHALL show unchanged lines without either marker.
7. WHILE the Game_State is `won` or `lost` and no Mutation was applied, THE Results_Screen SHALL display a message stating that the Watcher changed nothing, and SHALL NOT display any comparison.
8. WHEN the Results_Screen is displayed, THE Game_Controller SHALL move keyboard focus to the Results_Screen heading once the heading is rendered.

### Requirement 14: Restart

**User Story:** As a player, I want to restart cleanly, so that a new attempt is not affected by the previous one.

#### Acceptance Criteria

1. WHILE the Game_State is `won` or `lost`, THE Results_Screen SHALL display a restart control that is visible and enabled.
2. WHEN the player activates the restart control, THE Game_Controller SHALL transition the Game_State to `ready` and render the Start_Screen in the same render commit.
3. WHEN the player activates the restart control, THE Game_Controller SHALL reset the Sanity_Meter to 100, restore the Challenge starter code to its original unmodified content, clear all Test_Results, clear the Code_Snapshot, clear the applied and skipped Mutation records, clear any active Absence, and invalidate the current Round_Id, so that each collection holds 0 entries.
4. WHEN the player activates the restart control, THE Game_Controller SHALL invalidate the ended Round immediately, SHALL release any running Execution_Worker during React effect cleanup, and SHALL discard any pending messages, so that no result from that run, or from any earlier Round, is displayed or recorded after the restart.
5. WHEN the player activates the restart control, THE Audio_Manager SHALL silence all playing sounds immediately, by invalidating the ended Round so that sound callbacks become no-ops, and SHALL release its audio nodes during React effect cleanup.
6. WHEN the restart completes, THE Game SHALL hold a state equal to the state produced by a first load of the Game, including Game_State `ready`, Sanity_Meter 100, and 0 Test_Results, Code_Snapshots, Mutation records, and active Absences, with the exception of the sound preference held in memory for the current page, which the restart SHALL NOT reset.
7. IF the Execution_Worker run cannot be terminated, THEN THE Game_Controller SHALL discard that run's results, complete the restart, and ignore any later output from that run.
8. WHEN the player activates the restart control more than once before the restart completes, THE Game_Controller SHALL perform the restart once.
9. WHEN the Test_Runner receives a result whose Round_Id belongs to a Round that ended before the restart, THE Test_Runner SHALL discard the result and leave the Game_State, the Sanity_Meter, and the displayed Test_Results unchanged.

### Requirement 15: Resource Cleanup

**User Story:** As a developer, I want all workers, timers, and listeners cleaned up, so that the game does not leak resources or act on stale state.

#### Acceptance Criteria

1. WHEN the Game_State leaves `playing`, THE Game_Controller SHALL invalidate the ended Round immediately, in the same Game_Event processing step as the transition, so that every later sanity timer callback, Page Visibility event, Watcher timer callback, Run_Timeout callback, audio callback, and worker message tagged with the ended Round_Id is a no-op that changes no Game_State, Sanity_Meter value, or displayed value.
2. WHEN the Game_State leaves `playing`, THE Test_Runner SHALL terminate any active Execution_Worker during React effect cleanup, so that zero Execution_Worker instances remain after cleanup, and SHALL discard any message the worker produces after invalidation.
3. WHEN the Game_Controller component unmounts, THE Game_Controller SHALL clear every timer, remove every event listener, terminate every Execution_Worker, and release every audio node during React effect cleanup, so that zero timers, listeners, workers, and audio nodes registered by the Game remain active after cleanup, and no state update occurs after unmount.
4. WHEN the Run_Timeout expires or a run completes, THE Test_Runner SHALL clear the Run_Timeout timer and terminate the Execution_Worker during React effect cleanup, and SHALL ensure the Run_Timeout callback runs at most once per run.
5. WHEN the Watcher "noticed" appearance ends, THE Watcher SHALL clear its appearance timer during React effect cleanup.
6. WHEN the Game_State leaves `playing`, THE Watcher SHALL invalidate its appearance timer callback immediately, so that the callback is a no-op, and SHALL clear the timer during React effect cleanup.
7. THE Game SHALL register each timer, listener, Execution_Worker, and audio node through a function that returns a cleanup callback, so that calling every returned callback leaves zero timers, listeners, workers, and audio nodes registered by the Game.
8. WHILE React StrictMode double-invokes effects in development, THE Game SHALL leave exactly one active instance of each required timer, listener, and audio node, and of the Execution_Worker for each run in progress, after mount, and exactly zero of each after unmount.
9. IF a cleanup callback is invoked more than once or after its resource has already been cleared, THEN THE Game SHALL complete without throwing an error and without altering any other active timer, listener, worker, or audio resource.
10. WHEN the Game_State leaves `playing`, THE Test_Runner SHALL discard any message that arrives later and is tagged with the ended Round's Round_Id, so that no late message changes the Game_State or any displayed value.
11. WHEN a Round ends or restarts, THE Game_Controller SHALL change the active-round token synchronously, so that a late callback, timer, worker message, or visibility event that captured the previous Round_Id performs no action.
12. THE Test_Runner SHALL create an Execution_Worker only when a run starts and SHALL terminate it when the run completes, times out, becomes stale, or the Round ends, so that no idle Execution_Worker is kept alive.
13. WHILE React StrictMode runs effect setup, cleanup, and setup again in development, THE Game SHALL remain fully functional after the cycle, and the Game_Controller store SHALL NOT be permanently disposed by a cleanup that React follows with a re-setup, so that the player can start a Round and play it after the cycle.

### Requirement 16: Execution Limitations Documentation

**User Story:** As a developer or player, I want the execution limits stated plainly, so that I understand the game is not a secure code runner.

#### Acceptance Criteria

1. THE Game SHALL include documentation in `docs/EXECUTION.md` containing a statement that a Web Worker provides main-thread responsiveness and is not a security sandbox.
2. THE documentation SHALL state that player code in the Execution_Worker can make network requests, access worker-scoped browser APIs, and consume CPU and memory until the Run_Timeout terminates the run.
3. THE documentation SHALL state that the Game is intended for running only code that the player types in the same session, and that code from other sources, including pasted code from untrusted parties, is not supported.
4. THE documentation SHALL state that the Run_Timeout is 3000 milliseconds.
5. THE documentation SHALL describe the termination behavior: when a run exceeds the Run_Timeout of 3000 milliseconds, the Execution_Worker is terminated, tests without a result are reported as `timeout`, and the player is informed that the run timed out.
6. THE Game SHALL place the execution documentation in a new file named `docs/EXECUTION.md` and SHALL NOT overwrite, modify, or remove any existing content in README.md when creating that file.
7. IF `docs/EXECUTION.md` already exists when the documentation is added, THEN THE Game SHALL preserve its existing content and append the documentation as a new section.
8. THE Start_Screen SHALL display a limitation statement of at most 200 characters, as required by Requirement 2, that states the Game is not a secure code runner and that only code the player types in the same session should be run.
9. WHERE README.md is later updated under Requirement 21, THE README.md MAY link to `docs/EXECUTION.md`, and `docs/EXECUTION.md` SHALL remain the location of the execution limitations.

### Requirement 17: Reduced Motion Support

**User Story:** As a player sensitive to motion, I want animations reduced, so that I can play comfortably.

#### Acceptance Criteria

1. WHILE the Reduced_Motion_Preference is set, THE Game SHALL render CRT_Effect flicker and Watcher gaze animation as static, with zero frame-to-frame change in brightness, opacity, position, or scale of those elements.
2. WHILE the Reduced_Motion_Preference is set, THE Game SHALL replace screen shake, glitch, and flashing effects with static visual treatments that cause no more than 3 luminance changes in any 1-second period and no displacement of any on-screen element.
3. WHILE the Reduced_Motion_Preference is set, THE Game SHALL convey each Warning_Level by both a text label and a static visual change that differs from the visual state of every other Warning_Level.
4. WHEN the Reduced_Motion_Preference changes during play, THE Game SHALL apply the new preference by the next render, without a page reload, and without resetting game state, current Warning_Level, or player progress.
5. WHEN the Game starts, THE Game SHALL initialize the Reduced_Motion_Preference from the operating system or browser reduced-motion setting.
6. IF the Reduced_Motion_Preference cannot be determined, THEN THE Game SHALL treat the preference as set.

### Requirement 18: Keyboard Navigation and Accessibility

**User Story:** As a keyboard user, I want to play the entire game without a mouse, so that the game is accessible.

#### Acceptance Criteria

1. THE Game SHALL make every interactive control reachable and operable using only the Tab, Shift+Tab, Enter, Space, Escape, and arrow keys, with no action requiring a pointing device.
2. WHEN an interactive element receives keyboard focus, THE Game SHALL display a focus indicator at least 2 pixels thick with a contrast ratio of at least 3:1 against adjacent colors.
3. THE Game SHALL order Tab focus on each screen to match the visual reading order (left to right, top to bottom), with no positive `tabindex` values.
4. WHILE the Game_State is `playing`, WHEN the player presses Ctrl+Enter or Cmd+Enter in the Code_Editor, THE Test_Runner SHALL start one test run.
5. IF the Test_Runner is already running a test when the player presses Ctrl+Enter or Cmd+Enter, THEN THE Game SHALL ignore the key press and keep the current test run unchanged.
6. WHILE the Code_Editor has keyboard focus, WHEN the player presses Escape, THE Game SHALL release the Tab key from the Code_Editor so the next Tab press moves focus to the next focusable element.
7. WHEN a screen loads, THE Game SHALL make the Skip_Link the first focusable element on that screen.
8. WHEN the player activates the Skip_Link while the Start_Screen is displayed, THE Game SHALL move keyboard focus to the main content region of the Start_Screen, starting at its heading.
9. WHEN the player activates the Skip_Link while the Play_Screen is displayed, THE Game SHALL move keyboard focus to the Code_Editor.
10. WHEN the player activates the Skip_Link while the Results_Screen is displayed, THE Game SHALL move keyboard focus to the main content region of the Results_Screen.
11. THE Skip_Link SHALL target the `main` landmark of the screen that is currently displayed, and SHALL NOT target the Code_Editor while any screen other than the Play_Screen is displayed.
12. THE Game SHALL provide on every screen exactly one level-one heading and the landmarks `header`, `main`, and `footer`, with exactly one `main` landmark.
13. THE Game SHALL set the page language attribute to a valid BCP 47 language code on the root HTML element.

### Requirement 19: Audio

**User Story:** As a player, I want optional ambient and effect sounds that stay off until I turn them on, so that I can add atmosphere without being surprised by noise.

#### Acceptance Criteria

1. WHEN the page loads, THE Audio_Manager SHALL start with sound off and THE Mute_Control SHALL display the label "Enable sound" and the off state, including after a page reload, so that the Game never shows sound as on before a player gesture in the current page.
2. WHILE sound is off and the player has not activated the Mute_Control in the current page, THE Audio_Manager SHALL NOT create or resume an audio context and SHALL produce no audio output.
3. WHEN the player activates the "Enable sound" Mute_Control once, THE Audio_Manager SHALL create or resume the audio context in that click handler and unmute in the same action, so that sound is enabled without a second activation.
4. WHEN the player activates the start control, THE Audio_Manager SHALL NOT create or resume an audio context, and activating the start control SHALL NOT by itself enable sound.
5. THE Start_Screen and the Play_Screen SHALL each display the Mute_Control, so that the player can opt in to sound before play begins.
6. THE Mute_Control SHALL display the label "Enable sound" while sound is off and "Mute sound" while sound is on, SHALL expose its current state (off or on) to assistive technology, and SHALL update the label and exposed state by the next render after each state change.
7. WHEN the player activates the "Mute sound" Mute_Control, THE Audio_Manager SHALL produce zero audio output from all sounds, including the Watcher cue and the looping tension sound, in the same action as the activation.
8. THE Game SHALL preserve the sound opt-in preference in memory across round restarts within the current page, so that a restart does not turn sound off or require a second activation of the Mute_Control.
9. THE Game SHALL NOT write the sound preference to any persistent or session storage.
10. WHEN the page is reloaded, THE Audio_Manager SHALL keep sound off, SHALL NOT create an audio context, and THE Mute_Control SHALL display "Enable sound" until the player activates it once, and one activation SHALL enable sound.
11. IF the browser fails to create an audio context, THEN THE Game SHALL continue to operate with all gameplay functions available, produce no audio, and display no error message to the player.
12. WHEN an Absence ends, IF the Audio_Manager is not muted, THEN THE Audio_Manager SHALL start one Watcher cue as part of processing the Absence end.
13. WHILE the Warning_Level is `critical` and the Audio_Manager is not muted, THE Audio_Manager SHALL play a looping tension sound, and THE Audio_Manager SHALL silence the looping tension sound immediately when the Warning_Level leaves `critical` or the Audio_Manager becomes muted, and SHALL release the audio nodes during React effect cleanup.
14. THE Audio_Manager SHALL set its initial master volume to no more than 50% of the maximum output level, and no sound SHALL exceed that level unless the player explicitly changes the volume.
15. THE Game SHALL generate all audio using the Web Audio API or bundled assets, and SHALL NOT request audio from any external host.

### Requirement 20: Visual Direction

**User Story:** As a player, I want a cohesive, restrained horror look, so that the game feels atmospheric without hurting readability.

#### Acceptance Criteria

1. THE Game SHALL render all background and accent colors from a single central set of style tokens, using one dark charcoal background color (relative luminance of 0.02 or less) and exactly one red accent color.
2. THE Game SHALL render the CRT_Effect as an overlay that intercepts zero pointer events and zero keyboard events, so that every interactive control beneath it responds to clicks, taps, and key presses.
3. WHILE the CRT_Effect is displayed, THE Game SHALL keep the contrast ratio of code text at or above the minimum value defined in Requirement 4, measured on the rendered output with the overlay applied.
4. WHEN the viewport width is between 1024 pixels and 3840 pixels inclusive, THE Game SHALL render with a document width equal to the viewport width, so that no horizontal scrollbar appears.
5. THE Game SHALL load all fonts from system fonts or fonts bundled with the Game, and SHALL issue zero font requests to external hosts.
6. IF a bundled font fails to load, THEN THE Game SHALL render text in a system monospace font, and SHALL keep all text visible and unclipped.

### Requirement 21: Project Setup and Repository Constraints

**User Story:** As a developer, I want the project scaffolded with the specified stack and safe repository handling, so that existing files and the spec remain intact.

#### Acceptance Criteria

1. THE Game SHALL be implemented using React, TypeScript in strict mode (the `strict` compiler option enabled), and Vite.
2. THE Game SHALL provide npm scripts for starting the development server, creating a production build, running tests in a single non-watch run, and type-checking, where each script exits with code 0 on success and a non-zero code on failure.
3. WHEN the project is scaffolded, THE scaffolding process SHALL NOT overwrite, delete, or truncate README.md, LICENSE, or .gitignore, so that each file retains all of its pre-scaffold content, with .gitignore changes permitted only as described in criterion 4.
4. IF a scaffolding step would change .gitignore, THEN THE scaffolding process SHALL append new entries only, and SHALL NOT remove or modify any existing line.
5. IF a scaffolding step would overwrite README.md or LICENSE, THEN THE scaffolding process SHALL skip that step.
6. WHERE the player-facing setup and gameplay instructions are added to README.md, THE addition SHALL be performed as an explicit, separate step after scaffolding, SHALL append or edit README.md deliberately, and SHALL preserve existing README.md content unless the user explicitly approves its removal.
7. THE repository SHALL keep the `.kiro` directory and all files within it tracked in Git, so that `git ls-files .kiro` lists every file in that directory.
8. THE repository SHALL NOT include any .gitignore pattern that matches the `.kiro` directory or any file within it, so that `git check-ignore .kiro` reports no match.
9. THE Game SHALL run entirely in the browser, and WHEN the Game is running, THE Game SHALL make zero network requests to any backend service for game logic or state, other than requests for its own static assets.
10. IF a script from criterion 2 fails, THEN THE script SHALL report the failure through a non-zero exit code and an error output identifying the failing step, and SHALL leave the source files unchanged.
11. THE Game SHALL define the sanity drain interval and amount, the Absence cost, the Warning_Level thresholds, the Run_Timeout, the Code_Editor size limit, the Test_Case count range, the noticed duration, and the audio volume cap as configurable values in the single Game_Config module, and SHALL read each of these values only from Game_Config.
12. WHEN the production build is created, THE build SHALL emit the Execution_Worker script as a built asset that the production Game loads and runs, and a build verification step SHALL confirm that the emitted worker asset exists and starts.

### Requirement 22: Testability of Core Logic

**User Story:** As a developer, I want the core logic isolated from the UI, so that correctness can be verified with automated tests.

#### Acceptance Criteria

1. THE Game SHALL implement the Game_State transitions, ordered Game_Event handling, Warning_Level computation, sanity calculations, Mutation_Engine, and diff computation as pure functions or modules that import no React module and reference no DOM global (including `window` and `document`), so that each can be executed and tested in a Node.js environment without a browser or DOM.
2. THE Game SHALL compute exactly one Warning_Level for each integer Sanity_Meter value from 0 to 100 inclusive, and SHALL compute `critical` for the Sanity_Meter value 0.
3. FOR ALL pairs of integer Sanity_Meter values A and B where 0 ≤ A < B ≤ 100, THE Game SHALL compute a Warning_Level for A whose severity is greater than or equal to the severity of the Warning_Level for B.
4. FOR ALL sequences of 0 to 1,000 Game_Events, including start and restart events (each of which resets the Sanity_Meter to 100), applied from the initial Game_State, THE Sanity_Meter value SHALL remain between 0 and 100 inclusive after every event in the sequence.
5. FOR ALL sequences of 0 to 1,000 Game_Events that include test run starts and results, THE Sanity_Meter value SHALL change only through drain ticks, Absence ends while the Game_State is `playing`, and the reset to 100 on start or restart, so that running tests never changes the Sanity_Meter value.
6. FOR ALL code strings of 0 to 10,000 characters, applying the same Mutation twice to the same input SHALL produce byte-identical outputs (determinism).
7. FOR ALL pairs of code strings of 0 to 10,000 characters each, WHEN the diff computation is applied to a Code_Snapshot and the resulting code, THEN reconstructing the new code from that diff and the Code_Snapshot SHALL produce a string identical to the resulting code (round-trip property).
8. FOR ALL sequences of 0 to 1,000 Game_State events applied from the initial Game_State, THE Game_Controller SHALL produce only transitions permitted by Requirement 1.
9. IF an event is not permitted by Requirement 1 in the current Game_State, THEN THE Game_Controller SHALL leave the Game_State unchanged and SHALL indicate to the caller that the event was rejected.
10. FOR ALL sequences of 0 to 1,000 Game_Events, once the Game_State is `won` or `lost`, THE Game_Controller SHALL keep that Game_State for every subsequent event other than a restart.
11. FOR ALL states in which the Sanity_Meter value is 0 and the Game_State is `playing`, WHEN a Current_Result with every Test_Result `pass` is processed, THE Game_Controller SHALL produce `lost`, and FOR ALL states with a Sanity_Meter value greater than 0, THE Game_Controller SHALL produce `won`.
12. FOR ALL sequences of 0 to 1,000 Game_Events containing any number of Absence ends in one Round, THE Mutation_Engine SHALL apply at most 1 Mutation, and each Absence end processed while the Game_State is `playing` SHALL reduce the Sanity_Meter by 10 points with a floor of 0, and each Absence event processed while the Game_State is not `playing` SHALL leave the Sanity_Meter value, the Game_State, and the Mutation records unchanged.
13. FOR ALL test results tagged with a Round_Id that differs from the current Round_Id, THE Game_Controller SHALL discard the results, leaving the Game_State, the Sanity_Meter, and the displayed Test_Results unchanged.
14. THE project SHALL include a development-time automated test over the Challenge fixtures that validates, for each candidate Mutation in the Mutation_Sequence, that applying the candidate to the Reference_Solution produces a solution that remains syntactically valid JavaScript and fails at least one existing Test_Case, and that the unchanged Reference_Solution passes every Test_Case.
15. IF a candidate Mutation fails the validation in criterion 14, THEN THE project SHALL treat that failure as a defect in the fixtures, and the automated test SHALL fail.
16. THE project SHALL validate the Challenge fixtures in development-time automated tests only, checking the field limits and unique Test_Case names defined in Requirement 3, that the starter code fails at least 1 Test_Case and passes at least 1 Test_Case, and that the Reference_Solution passes every Test_Case, and THE Game SHALL NOT perform these validations at load time.
17. FOR ALL sequences of Absence ends in one Round in which no Mutation has succeeded, THE Mutation_Engine SHALL retry the candidates in Mutation_Sequence order on each Absence end, and FOR ALL sequences in which a Mutation has succeeded, THE Mutation_Engine SHALL make no further attempt in that Round.
18. FOR ALL Game_Event sequences in which a Round ends or restarts, THE Game_Controller SHALL treat every later callback, timer, worker message, and visibility event tagged with the ended Round_Id as a no-op that leaves the Game_State, the Sanity_Meter value, and the displayed Test_Results unchanged.
19. FOR ALL sequences of streamed Test_Result messages for a run, WHEN the run times out, THE Test_Runner SHALL keep every Test_Result received before the timeout and SHALL mark each remaining Test_Case as `timeout`, and FOR ALL such sequences THE Game_Controller SHALL evaluate a win only for a complete run in which every Test_Result is `pass`.
20. FOR ALL received worker messages, THE Test_Runner SHALL dispatch a message only when its own Round_Id equals the current Round_Id and its own Run_Id equals the current run's Run_Id, and SHALL ignore every message with a duplicate or out-of-range test index.
21. FOR ALL sequences of per-test results for a run, THE Game_Controller SHALL produce a win only when every test index of the Challenge has been received exactly once and every result is `pass`.
22. WHEN React StrictMode runs effect setup, cleanup, and setup again in development, THE project SHALL include an automated test that, after the cycle, starts a Round and plays it (a drain tick, a test run, and a restart each take effect).
