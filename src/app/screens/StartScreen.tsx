import { useEffect, useRef } from 'react';
import { useGame } from '../GameProvider';
import { useSound } from '../AudioProvider';
import { MuteControl } from '../../components/MuteControl';
import { SkipLink } from '../../components/SkipLink';
import { normalizeConfig } from '../../core/config';
import type { GameConfig } from '../../core/config';
import '../../styles/screens.css';

export const START_TITLE = "Don't Look Away";
export const INSTRUCTIONS_ERROR = 'The instructions could not be loaded.';
export const TECHNICAL_SUMMARY = 'Technical details';
export const SOUND_OFF_TEXT = 'Sound is off. Use Enable sound to turn it on.';
export const SOUND_ON_TEXT = 'Sound is on. Use Mute sound to turn it off.';

/** Limitation statement (Req 2.7, 16.8); must be <= 200 characters. */
export const LIMITATION_STATEMENT =
  'Not a secure code runner: your code runs in this browser without a sandbox. Run only code you type yourself in this session.';

export interface StartContent {
  /** Exactly three concise gameplay rules. */
  rules: readonly string[];
  /** Implementation details and execution limitations (inside "Technical details"). */
  technical: readonly string[];
}

export function formatTimeout(ms: number): string {
  return ms >= 1000 && ms % 1000 === 0 ? `${ms} ms (${ms / 1000} seconds)` : `${ms} ms`;
}

export function buildRules(config: Pick<GameConfig, 'absenceCost'>): string[] {
  return [
    'Fix the function before sanity reaches zero.',
    `Leaving the tab costs ${config.absenceCost} sanity and may change your code.`,
    'The Watcher can change your code once per round.',
  ];
}

export function buildTechnical(config: Pick<GameConfig, 'runTimeoutMs'>): string[] {
  return [
    'Tab detection uses only the browser\u2019s Page Visibility API: it notices when the page becomes hidden or visible, for example when you switch tabs or minimize the window. It may not detect every window switch; another window that stays visible next to this one may not be noticed.',
    'No camera, eye tracking or gaze detection is used or claimed.',
    'Your code runs in a Web Worker in your browser. This keeps the page responsive but is not a security sandbox.',
    LIMITATION_STATEMENT,
    `A run times out after ${formatTimeout(config.runTimeoutMs)}.`,
    'The Watcher\u2019s change is deterministic: it comes from a short, curated list, not from chance or from watching you.',
  ];
}

export function buildStartContent(config: GameConfig = normalizeConfig()): StartContent {
  return { rules: buildRules(config), technical: buildTechnical(config) };
}

const nonEmpty = (s: unknown): boolean => typeof s === 'string' && s.trim().length > 0;

/** Missing-content guard (Req 2.10): three rules, technical details, and a limitation statement <= 200 chars. */
export function instructionsAvailable(content: StartContent = buildStartContent()): boolean {
  return (
    Boolean(START_TITLE) &&
    Boolean(content) &&
    Array.isArray(content.rules) &&
    content.rules.length === 3 &&
    content.rules.every(nonEmpty) &&
    Array.isArray(content.technical) &&
    content.technical.length >= 1 &&
    content.technical.every(nonEmpty) &&
    LIMITATION_STATEMENT.length <= 200
  );
}

export interface StartScreenProps {
  /** Overridable for tests; defaults to content built from the game config. */
  instructions?: StartContent;
}

export function StartScreen({ instructions }: StartScreenProps) {
  const { dispatch, config } = useGame();
  const { soundOn } = useSound();
  const beginRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const content = instructions ?? buildStartContent(config);
  const ok = instructionsAvailable(content);

  useEffect(() => {
    beginRef.current?.focus();
  }, []);

  return (
    <div className="screen start-screen">
      <SkipLink targetId="main" onActivate={() => mainRef.current?.focus()} />
      <header className="screen-header">
        <span className="screen-brand">DON&apos;T LOOK AWAY</span>
        <MuteControl />
      </header>
      <main id="main" ref={mainRef} className="screen-main" tabIndex={-1}>
        <h1>{START_TITLE}</h1>
        {ok ? (
          <>
            <ol className="start-rules">
              {content.rules.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ol>
            <p className="start-sound" role="status">
              {soundOn ? SOUND_ON_TEXT : SOUND_OFF_TEXT}
            </p>
            <details className="start-technical" id="technical-details">
              <summary>{TECHNICAL_SUMMARY}</summary>
              <ul className="start-technical__list">
                {content.technical.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
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
