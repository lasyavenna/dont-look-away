import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { MutationRecord } from '../core/types';
import { cutLines } from '../core/mutations';
import { setWound, woundMarker } from './woundMarker';
import {
  External,
  LIMIT_MESSAGE,
  TAB_HINT,
  createEditorExtensions,
  readOnlyExtension,
  type EditorExtensions,
} from './editorExtensions';

export interface CodeEditorProps {
  /** Source of truth for the document. Differences from the editor are applied as External changes. */
  code: string;
  wound?: MutationRecord | null;
  readOnly: boolean;
  maxLength: number;
  /** Called only for user edits. */
  onChange: (code: string) => void;
  onRun: () => void;
}

export interface CodeEditorHandle {
  focus: () => void;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { code, wound = null, readOnly, maxLength, onChange, onRun },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const extRef = useRef<EditorExtensions | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  // Latest callbacks, so the view is created once.
  const cb = useRef({ onChange, onRun });
  cb.current = { onChange, onRun };
  const initial = useRef({ code, readOnly, maxLength });

  useImperativeHandle(ref, () => ({ focus: () => viewRef.current?.focus() }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ext = createEditorExtensions({
      maxLength: initial.current.maxLength,
      readOnly: initial.current.readOnly,
      onUserChange: (c) => {
        setLimitReached(false);
        cb.current.onChange(c);
      },
      onRun: () => cb.current.onRun(),
      onLimit: () => setLimitReached(true),
    });
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: initial.current.code, extensions: [...ext.extensions, woundMarker] }),
    });
    viewRef.current = view;
    extRef.current = ext;
    return () => {
      view.destroy();
      viewRef.current = null;
      extRef.current = null;
    };
  }, []);

  // External replacement (e.g. a Mutation); not echoed as a user change.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== code) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: code },
        annotations: External.of(true),
      });
      setLimitReached(false);
    }
  }, [code]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cut = wound ? cutLines(wound) : null;
    const currentLines = view.state.doc.toString().split('\n');
    const changedIndex = cut ? currentLines.findIndex((line) => line.trim() === cut.after.trim()) : -1;
    const line = cut ? Math.min(changedIndex >= 0 ? changedIndex + 1 : cut.line, view.state.doc.lines) : null;
    view.dispatch({ effects: setWound.of(line === null ? null : view.state.doc.line(line).from) });
  }, [wound]);

  useEffect(() => {
    const view = viewRef.current;
    const ext = extRef.current;
    if (!view || !ext) return;
    view.dispatch({ effects: ext.readOnly.reconfigure(readOnlyExtension(readOnly)) });
  }, [readOnly]);

  return (
    <div className="code-editor">
      <div ref={hostRef} className="code-editor__host" style={{ minHeight: '16rem', maxHeight: '60vh', overflow: 'hidden' }} />
      <p className="code-editor__hint" style={{ color: 'var(--muted, #b4b4bc)' }}>
        {TAB_HINT}
      </p>
      <p role="status" aria-live="polite" className="code-editor__limit">
        {limitReached ? LIMIT_MESSAGE : ''}
      </p>
    </div>
  );
});
