import { useCallback, useEffect, useRef } from 'react';
import { useGame } from '../GameProvider';
import { cutLines } from '../../core/mutations';
import { ROOMS, roomAt } from '../../core/challenge';
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
  const room = roomAt(state.roomIndex);
  const challenge = room.challenge;
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

  const wound = state.round?.applied && !state.round.woundResolved ? state.round.applied : null;
  const cut = wound ? cutLines(wound) : null;
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
          <p className="room-label">Room {state.roomIndex + 1} of {ROOMS.length} · {room.name}</p>
          <h1 ref={h1Ref} tabIndex={-1}>
            Repair {challenge.functionName}
          </h1>
          <p className="play-screen__description">{challenge.description}</p>
          <TestPanel tests={challenge.tests} displayRun={state.displayRun} resultsOutdated={state.resultsOutdated} />
        </section>
        <section className="play-screen__editor" aria-label="Code editor">
          {cut && (
            <section className="wound" aria-label="Unrepaired Watcher cut">
              <p role="status">The Watcher left a cut. Repair the marked line.</p>
              <pre tabIndex={0} aria-label="Watcher cut before and after">
                <code className="diff-line diff-remove">- {cut.before}{'\n'}</code>
                <code className="diff-line diff-add">+ {cut.after}</code>
              </pre>
            </section>
          )}
          <CodeEditor
            ref={editorRef}
            code={state.code}
            wound={wound}
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
