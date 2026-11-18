import { useCallback, useEffect, useRef } from 'react';
import { useGame } from '../GameProvider';
import { CHALLENGE } from '../../core/challenge';
import { CodeEditor } from '../../components/CodeEditor';
import type { CodeEditorHandle } from '../../components/CodeEditor';
import { TestPanel } from '../../components/TestPanel';
import { SanityMeter } from '../../components/SanityMeter';
import '../../styles/play.css';

export function PlayScreen() {
  const { state, dispatch, config, requestRun } = useGame();
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const editorRef = useRef<CodeEditorHandle>(null);

  useEffect(() => {
    h1Ref.current?.focus();
  }, []);

  const roundId = state.activeRoundId;
  const onChange = useCallback(
    (code: string) => {
      if (roundId !== null) dispatch({ type: 'CODE_CHANGED', roundId, code });
    },
    [dispatch, roundId],
  );

  const running = state.run?.status === 'running';

  return (
    <div className="play-screen">
      <header className="play-screen__header">
        <SanityMeter value={state.sanity.value} />
      </header>
      <main id="main" className="play-screen__main">
        <section className="play-screen__side">
          <h1 ref={h1Ref} tabIndex={-1}>
            Repair {CHALLENGE.functionName}
          </h1>
          <p className="play-screen__description">{CHALLENGE.description}</p>
          <TestPanel tests={CHALLENGE.tests} displayRun={state.displayRun} resultsOutdated={state.resultsOutdated} />
        </section>
        <section className="play-screen__editor" aria-label="Code editor">
          <CodeEditor
            ref={editorRef}
            code={state.code}
            readOnly={false}
            maxLength={config.editorMaxLength}
            onChange={onChange}
            onRun={requestRun}
          />
          <button type="button" className="play-screen__run" onClick={requestRun} disabled={running}>
            {running ? 'Running…' : 'Run Tests'}
          </button>
        </section>
      </main>
      <footer className="play-screen__footer">
        <small>Ctrl/Cmd+Enter runs the tests.</small>
      </footer>
    </div>
  );
}
