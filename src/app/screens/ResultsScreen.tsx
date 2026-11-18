import { ROOMS } from '../../core/challenge';
import { useEffect, useRef } from 'react';
import '../../styles/results.css';
import { useGame } from '../GameProvider';
import { DiffView } from '../../components/DiffView';
import { SkipLink } from '../../components/SkipLink';

export const RESULTS_MAIN_ID = 'main-content';

export function ResultsScreen() {
  const { state, dispatch } = useGame();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Idempotent, so StrictMode's setup-cleanup-setup is harmless.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const won = state.phase === 'won';
  const nextRoom = won && state.roomIndex < ROOMS.length - 1;
  const applied = state.round?.applied ?? null;
  const mutationCount = applied ? 1 : 0;

  return (
    <div className="results-screen">
      <SkipLink targetId={RESULTS_MAIN_ID} />
      <header className="results-header">
        <p className="results-title">Don&apos;t Look Away</p>
      </header>
      <main id={RESULTS_MAIN_ID} className="results-main" tabIndex={-1}>
        <h1 ref={headingRef} tabIndex={-1} className="results-heading">
          {won ? 'You won' : 'You lost'}
        </h1>
        <p>{nextRoom ? 'One door opens. The Watcher follows.' : won ? 'Both rooms cleared. You escaped the Watcher.' : `Room ${state.roomIndex + 1} claimed you.`}</p>
        <dl className="results-stats">
          <div>
            <dt>Final sanity</dt>
            <dd>{Math.round(state.sanity.value)}</dd>
          </div>
          <div>
            <dt>Mutations applied</dt>
            <dd>{mutationCount}</dd>
          </div>
        </dl>
        <section aria-label="What the Watcher changed" className="results-reveal">
          {applied === null ? (
            <p>The Watcher changed nothing.</p>
          ) : (
            <>
              <p>{applied.description}</p>
              <DiffView before={applied.snapshot} after={applied.resultingCode} />
            </>
          )}
        </section>
        {nextRoom && (
          <button type="button" className="results-restart" onClick={() => dispatch({ type: 'NEXT_ROOM' })}>
            Enter room 2
          </button>
        )}
        <button type="button" className="results-restart" onClick={() => dispatch({ type: 'RESTART' })}>
          Look again
        </button>
      </main>
      <footer className="results-footer">
        <p>Everything runs in your browser.</p>
      </footer>
    </div>
  );
}
