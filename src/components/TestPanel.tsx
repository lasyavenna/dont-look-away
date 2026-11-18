import type { Run, TestResult, TestStatus } from '../core/types';
import type { TestCase } from '../core/challenge';

export interface TestPanelProps {
  tests: readonly TestCase[];
  /** Last run whose results are shown. */
  displayRun: Run | null;
  resultsOutdated: boolean;
}

const STATUS_TEXT: Record<TestStatus, string> = {
  pass: '✓ pass',
  fail: '✗ fail',
  error: '! error',
  timeout: '⏱ timeout',
};

function statusFor(result: TestResult | undefined, run: Run | null): { text: string; key: string } {
  if (result) return { text: STATUS_TEXT[result.status], key: result.status };
  if (run && run.status === 'running') return { text: '… running', key: 'running' };
  return { text: 'not run', key: 'idle' };
}

export function TestPanel({ tests, displayRun, resultsOutdated }: TestPanelProps) {
  const byIndex = new Map<number, TestResult>();
  for (const r of displayRun?.results ?? []) byIndex.set(r.index, r);

  const finished = displayRun && (displayRun.status === 'complete' || displayRun.status === 'timedOut');
  const announcement = finished
    ? `${displayRun.results.filter((r) => r.status === 'pass').length} of ${tests.length} tests passed`
    : '';

  return (
    <section className="test-panel" aria-labelledby="test-panel-heading">
      <h2 id="test-panel-heading" className="test-panel__heading">
        Tests
        {resultsOutdated && displayRun ? <span className="test-panel__badge">outdated</span> : null}
      </h2>
      <p role="status" aria-live="polite" className="test-panel__live">
        {announcement}
      </p>
      {displayRun?.status === 'timedOut' ? <p className="test-panel__notice">Run timed out</p> : null}
      {displayRun?.status === 'failed' ? <p className="test-panel__notice">Tests could not run.</p> : null}
      <ul className="test-panel__list">
        {tests.map((t, i) => {
          const result = byIndex.get(i);
          const st = statusFor(result, displayRun);
          return (
            <li key={i} className={`test-panel__item test-panel__item--${st.key}`}>
              <span className="test-panel__name">{t.name}</span>{' '}
              <span className="test-panel__status">{st.text}</span>
              {result ? (
                <div className="test-panel__detail">
                  {result.message ? <p className="test-panel__message">{result.message}</p> : null}
                  <p>
                    Expected: <code>{result.expectedText}</code>
                  </p>
                  <p>
                    {result.actualText === null ? (
                      'no actual value'
                    ) : (
                      <>
                        Actual: <code>{result.actualText}</code>
                      </>
                    )}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
