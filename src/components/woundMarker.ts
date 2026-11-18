import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** A position is mapped through edits, so inserting lines above a cut cannot move its marker away. */
export const setWound = StateEffect.define<number | null>();
export const woundMarker = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(markers, transaction) {
    let next = markers.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setWound)) continue;
      next = effect.value === null
        ? Decoration.none
        : Decoration.set([Decoration.line({
            attributes: { class: 'cm-wound', 'data-watcher-cut': 'true' },
          }).range(transaction.state.doc.lineAt(Math.min(effect.value, transaction.state.doc.length)).from)]);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
