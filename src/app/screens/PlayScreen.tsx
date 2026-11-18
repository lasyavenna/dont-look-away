import { useCallback, useEffect, useRef } from 'react';
import { useGame } from '../GameProvider';
import { CHALLENGE } from '../../core/challenge';
import { CodeEditor } from '../../components/CodeEditor';
import type { CodeEditorHandle } from '../../components/CodeEditor';
import { TestPanel } from '../../components/TestPanel';
import { SanityMeter } from '../../components/SanityMeter';
import { MuteControl } from '../../components/MuteControl';
import { Watcher } from '../../components/Watcher';
import { SkipLink } from '../../components/SkipLink';
import { useWarningLevel, LEVEL_TEXT } from '../hooks/useWarningLevel';
import '../../styles/play.css';
import '../../styles/levels.css';

export function PlayScreen() {
  const { state, dispatch, config, requestRun } = useGame();
  const level = useWarningLevel();
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
    <div className={`play-screen level-${level}`}>
      <SkipLink targetId="main" label="Skip to code editor" onActivate={() => editorRef.current?.focus()} />
      <header className="play-screen__header">
        <SanityMeter value={state.sanity.value} level={level} />
        <MuteControl />
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
        <Watcher />
      </main>
      <p className="play-screen__warning" role="status" aria-live="polite" data-testid="level-warning">
        {LEVEL_TEXT[level]}
      </p>
      <div role="status" aria-live="polite" className="play-screen__notice">
        {state.notice === 'watcherChanged' ? 'The Watcher changed your code.' : ''}
      </div>
      <footer className="play-screen__footer">
        <small>Ctrl/Cmd+Enter runs the tests.</small>
      </footer>
    </div>
  );
}
