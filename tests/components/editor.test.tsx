import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import {
  External,
  armedTabKeymap,
  createEditorExtensions,
  readOnlyExtension,
} from '../../src/components/editorExtensions';
import { CodeEditor } from '../../src/components/CodeEditor';

// Minimal geometry stubs; CodeMirror measures ranges under jsdom.
if (typeof Range !== 'undefined') {
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects ??= (() => [] as unknown as DOMRectList) as never;
  Range.prototype.getBoundingClientRect ??= (() => rect as DOMRect) as never;
}

function make(opts: { maxLength?: number; readOnly?: boolean; doc?: string } = {}) {
  const cbs = { onUserChange: vi.fn(), onRun: vi.fn(), onLimit: vi.fn() };
  const ext = createEditorExtensions({ maxLength: opts.maxLength ?? 10, readOnly: opts.readOnly, ...cbs });
  const state = EditorState.create({ doc: opts.doc ?? '', extensions: ext.extensions });
  return { cbs, ext, state };
}

const hasTabTrap = (state: EditorState) => state.facet(keymap).some((g) => g.includes(indentWithTab));

describe('length filter (state level)', () => {
  it('rejects an insert that pushes past the limit and calls onLimit', () => {
    const { cbs, state } = make({ maxLength: 5, doc: 'abc' });
    const next = state.update({ changes: { from: 3, insert: 'defg' } }).state;
    expect(next.doc.toString()).toBe('abc');
    expect(cbs.onLimit).toHaveBeenCalledTimes(1);
  });

  it('accepts a change that lands exactly at the limit', () => {
    const { cbs, state } = make({ maxLength: 5, doc: 'abc' });
    const next = state.update({ changes: { from: 3, insert: 'de' } }).state;
    expect(next.doc.toString()).toBe('abcde');
    expect(cbs.onLimit).not.toHaveBeenCalled();
  });

  it('rejects a paste-sized insert and the over-100,000 default scenario', () => {
    const max = 100_000;
    const { cbs, state } = make({ maxLength: max, doc: 'x'.repeat(max - 1) });
    expect(state.update({ changes: { from: 0, insert: 'yy' } }).state.doc.length).toBe(max - 1);
    expect(state.update({ changes: { from: 0, insert: 'y'.repeat(50_000) } }).state.doc.length).toBe(max - 1);
    expect(state.update({ changes: { from: 0, insert: 'y' } }).state.doc.length).toBe(max);
    expect(cbs.onLimit).toHaveBeenCalledTimes(2);
  });

  it('lets External replacements through', () => {
    const { state } = make({ maxLength: 3 });
    const next = state.update({ changes: { from: 0, insert: 'longer' }, annotations: External.of(true) }).state;
    expect(next.doc.toString()).toBe('longer');
  });
});

describe('readOnly (state level)', () => {
  it('sets EditorState.readOnly when requested', () => {
    expect(make({ readOnly: true }).state.readOnly).toBe(true);
    expect(make().state.readOnly).toBe(false);
  });

  it('can be toggled through the compartment', () => {
    const { ext, state } = make();
    const ro = state.update({ effects: ext.readOnly.reconfigure(readOnlyExtension(true)) }).state;
    expect(ro.readOnly).toBe(true);
  });

  it('blocks user typing in a view when read-only', () => {
    const { state } = make({ readOnly: true, doc: 'abc' });
    const view = new EditorView({ state, parent: document.body });
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(view.state.doc.toString()).toBe('abc');
    view.destroy();
  });
});

describe('Escape/Tab compartment', () => {
  it('Escape releases the Tab trap and blur re-arms it', () => {
    const { state } = make();
    const view = new EditorView({ state, parent: document.body });
    expect(hasTabTrap(view.state)).toBe(true);
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    expect(hasTabTrap(view.state)).toBe(false);
    view.contentDOM.dispatchEvent(new FocusEvent('blur'));
    expect(hasTabTrap(view.state)).toBe(true);
    view.destroy();
  });

  it('reconfigure with armedTabKeymap restores the trap', () => {
    const { ext, state } = make();
    const released = state.update({ effects: ext.tabKeys.reconfigure([]) }).state;
    expect(hasTabTrap(released)).toBe(false);
    expect(hasTabTrap(released.update({ effects: ext.tabKeys.reconfigure(armedTabKeymap()) }).state)).toBe(true);
  });
});

describe('External annotation and onUserChange', () => {
  it('external replace does not call onUserChange; user edits do', () => {
    const { cbs, state } = make({ maxLength: 50, doc: 'abc' });
    const view = new EditorView({ state, parent: document.body });
    view.dispatch({ changes: { from: 0, to: 3, insert: 'new' }, annotations: External.of(true) });
    expect(cbs.onUserChange).not.toHaveBeenCalled();
    view.dispatch({ changes: { from: 3, insert: '!' } });
    expect(cbs.onUserChange).toHaveBeenCalledWith('new!');
    view.destroy();
  });
});

describe('CodeEditor (jsdom)', () => {
  const props = { code: 'hello', readOnly: false, maxLength: 100, onChange: () => {}, onRun: () => {} };

  it('mounts with aria-label "Code editor" on the contenteditable', () => {
    const { container } = render(<CodeEditor {...props} />);
    const el = container.querySelector('.cm-content');
    expect(el?.getAttribute('contenteditable')).toBe('true');
    expect(el?.getAttribute('aria-label')).toBe('Code editor');
    expect(container.textContent).toContain('hello');
  });

  it('Escape then Tab does not preventDefault', () => {
    const { container } = render(<CodeEditor {...props} />);
    const el = container.querySelector('.cm-content') as HTMLElement;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    const tab = new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true });
    el.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });
});
