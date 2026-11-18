import { useEffect, useRef } from 'react';
import '../../styles/results.css';
import { useGame } from '../GameProvider';
import { DiffView } from '../../components/DiffView';

export const RESULTS_MAIN_ID = 'main-content';

export function ResultsScreen() {
  const { state, dispatch } = useGame();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Idempotent, so StrictMode's setup-cleanup-setup is harmless.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const won = state.phase === 'won';
  const applied = state.round?.applied ?? null;
  const mutationCount = applied ? 1 : 0;

  return (
    <div className="results-screen">
      <header className="results-header">
        <p className="results-title">Don&apos;t Look Away</p>
      </header>
      <main id={RESULTS_MAIN_ID} className="results-main">
        <h1 ref={headingRef} tabIndex={-1} className="results-heading">
          {won ? 'You won' : 'You lost'}
        </h1>
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
