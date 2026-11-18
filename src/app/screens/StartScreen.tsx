import { useEffect, useRef } from 'react';
import { useGame } from '../GameProvider';
import '../../styles/screens.css';

export const START_TITLE = "Don't Look Away";
export const INSTRUCTIONS_ERROR = 'The instructions could not be loaded.';

/** Limitation statement (Req 2.7, 16.8); must be <= 200 characters. */
export const LIMITATION_STATEMENT =
  'Not a secure code runner: your code runs in this browser without a sandbox. Run only code you type yourself in this session.';

/** Instruction content as data so the missing-content guard is real (Req 2.10). */
export const INSTRUCTIONS: readonly string[] = [
  'Fix the function. Pass every test before your sanity reaches zero.',
  'The game detects when this page becomes hidden or visible again, using the browser\u2019s Page Visibility API, for example when you switch to another tab or minimize the window. Coming back may let the Watcher change your code.',
  'The Watcher changes the code at most once per round. Each later absence in the same round still costs sanity.',
  'No camera or eye tracking is used. Another window that stays visible next to this one may not be detected.',
  'Sound is off, including after a page reload, until you turn it on with one press of the \u201cEnable sound\u201d control.',
  LIMITATION_STATEMENT,
];

export function instructionsAvailable(items: readonly string[] = INSTRUCTIONS): boolean {
  return (
    Boolean(START_TITLE) &&
    items.length >= 6 &&
    items.every((s) => typeof s === 'string' && s.trim().length > 0) &&
    LIMITATION_STATEMENT.length <= 200
  );
}

export interface StartScreenProps {
  /** Overridable for tests; defaults to the built-in instructions. */
  instructions?: readonly string[];
}

export function StartScreen({ instructions = INSTRUCTIONS }: StartScreenProps) {
  const { dispatch } = useGame();
  const beginRef = useRef<HTMLButtonElement>(null);
  const ok = instructionsAvailable(instructions);

  useEffect(() => {
    beginRef.current?.focus();
  }, []);

  return (
    <div className="screen start-screen">
      {/* Skip link and Mute_Control are added in Milestone D. */}
      <header className="screen-header">
        <span className="screen-brand">DON&apos;T LOOK AWAY</span>
      </header>
      <main id="main" className="screen-main" tabIndex={-1}>
        <h1>{START_TITLE}</h1>
        {ok ? (
          <>
            <p className="start-goal">{instructions[0]}</p>
            <ul className="start-list">
              {instructions.slice(1).map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </>
        ) : (
          <p role="alert" className="start-error">
            {INSTRUCTIONS_ERROR}
          </p>
        )}
        <button
          ref={beginRef}
          type="button"
          className="begin-button"
          disabled={!ok}
          onClick={() => dispatch({ type: 'START' })}
        >
          Begin
        </button>
      </main>
      <footer className="screen-footer">Tab-switch detection only. Nothing leaves your browser.</footer>
    </div>
  );
}

export default StartScreen;
