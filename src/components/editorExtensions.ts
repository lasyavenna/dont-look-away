import { Annotation, Compartment, EditorState, type Extension, type Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/** Marks transactions that replace the document from outside (not a user edit). */
export const External = Annotation.define<boolean>();

export const EDITOR_ARIA_LABEL = 'Code editor';
export const TAB_HINT = 'Esc then Tab leaves the editor';
export const LIMIT_MESSAGE = 'Limit reached: the code cannot be longer than the maximum length.';

export interface EditorCallbacks {
  /** Called only for user edits (typing, paste, undo), never for External replacements. */
  onUserChange: (code: string) => void;
  onRun: () => void;
  onLimit: () => void;
}

export interface EditorExtensionsOptions extends EditorCallbacks {
  maxLength: number;
  readOnly?: boolean;
}

export interface EditorExtensions {
  extensions: Extension[];
  tabKeys: Compartment;
  readOnly: Compartment;
}

export const armedTabKeymap = (): Extension => keymap.of([indentWithTab]);
export const releasedTabKeymap = (): Extension => keymap.of([]);
export const readOnlyExtension = (value: boolean): Extension => [
  EditorState.readOnly.of(value),
  EditorView.editable.of(true), // stays focusable and scrollable; edits are blocked by readOnly
];

/**
 * Rejects the whole transaction when the resulting document would exceed maxLength.
 * External replacements pass so the editor never diverges from game state.
 */
export function createLengthFilter(maxLength: number, onLimit: () => void): Extension {
  return EditorState.transactionFilter.of((tr: Transaction) => {
    if (tr.docChanged && !tr.annotation(External) && tr.newDoc.length > maxLength) {
      onLimit();
      return [];
    }
    return tr;
  });
}

/** Text colors use no red; each is at least 4.5:1 on the charcoal background. */
export const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--syntax-keyword, #a9bcd8)' },
  { tag: [t.string, t.regexp], color: 'var(--syntax-string, #b8c9a8)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syntax-number, #d3c28f)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syntax-comment, #9a9aa3)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--syntax-function, #e4e4e8)' },
  { tag: [t.operator, t.punctuation], color: 'var(--syntax-punct, #b4b4bc)' },
]);

export const darkTheme: Extension = EditorView.theme(
  {
    '&': {
      color: 'var(--fg, #e4e4e8)',
      backgroundColor: 'var(--editor-bg, var(--bg, #141416))',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: 'var(--fg, #e4e4e8)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg, #e4e4e8)' },
    '&.cm-focused': { outline: '2px solid var(--focus, #e4e4e8)', outlineOffset: '1px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
      { backgroundColor: 'var(--selection, #3a4254)' },
  },
  { dark: true },
);

/** Builds all editor extensions. Pure of DOM, so it can be exercised with EditorState alone. */
export function createEditorExtensions(opts: EditorExtensionsOptions): EditorExtensions {
  const tabKeys = new Compartment();
  const readOnly = new Compartment();
  const extensions: Extension[] = [
    history(),
    javascript(),
    syntaxHighlighting(darkHighlight),
    darkTheme,
    createLengthFilter(opts.maxLength, opts.onLimit),
    keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          opts.onRun();
          return true;
        },
      },
      {
        key: 'Escape',
        run: (view) => {
          view.dispatch({ effects: tabKeys.reconfigure(releasedTabKeymap()) });
          return true;
        },
      },
    ]),
    // Placed before the default keymap so Tab indents while armed.
    tabKeys.of(armedTabKeymap()),
    keymap.of([...historyKeymap, ...defaultKeymap]),
    readOnly.of(readOnlyExtension(opts.readOnly ?? false)),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': EDITOR_ARIA_LABEL, 'aria-multiline': 'true' }),
    EditorView.domEventHandlers({
      blur: (_e, view) => {
        view.dispatch({ effects: tabKeys.reconfigure(armedTabKeymap()) });
      },
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) {
        opts.onUserChange(u.state.doc.toString());
      }
    }),
  ];
  return { extensions, tabKeys, readOnly };
}
