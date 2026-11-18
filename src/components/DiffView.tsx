import { diffLines, type DiffLine } from '../core/diff';

const MARKER: Record<DiffLine['kind'], string> = { same: '  ', add: '+ ', remove: '- ' };
const LABEL: Record<DiffLine['kind'], string> = { same: '', add: 'added: ', remove: 'removed: ' };

export interface DiffViewProps {
  before: string;
  after: string;
}

export function DiffView({ before, after }: DiffViewProps) {
  const lines = diffLines(before, after);
  return (
    <pre className="diff-view" tabIndex={0} role="region" aria-label="Code changes (scrollable)">
      {lines.map((line, i) => (
        <code key={i} className={`diff-line diff-${line.kind}`}>
          {LABEL[line.kind] ? <span className="visually-hidden">{LABEL[line.kind]}</span> : null}
          <span className="diff-marker">{MARKER[line.kind]}</span>
          {line.text}
          {'\n'}
        </code>
      ))}
    </pre>
  );
}
