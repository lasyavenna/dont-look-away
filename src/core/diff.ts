export type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string };

/** Largest n*m for which the LCS table is built; above it the middle is remove-all/add-all. */
const MAX_LCS_CELLS = 4_000_000;

/**
 * Line diff. Text is split on "\n", so joining the lines with "\n" reproduces the
 * input exactly (the empty string is one empty line; a trailing newline is a final empty line).
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  let start = 0;
  const minLen = Math.min(a.length, b.length);
  while (start < minLen && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: 'same', text: a[i] });

  const n = endA - start;
  const m = endB - start;

  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) {
    for (let i = start; i < endA; i++) out.push({ kind: 'remove', text: a[i] });
    for (let j = start; j < endB; j++) out.push({ kind: 'add', text: b[j] });
  } else {
    // lcs[i][j] = LCS length of a[start+i..endA) and b[start+j..endB)
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          a[start + i] === b[start + j]
            ? lcs[(i + 1) * w + j + 1] + 1
            : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        out.push({ kind: 'same', text: a[start + i] });
        i++;
        j++;
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
        out.push({ kind: 'remove', text: a[start + i] });
        i++;
      } else {
        out.push({ kind: 'add', text: b[start + j] });
        j++;
      }
    }
    while (i < n) out.push({ kind: 'remove', text: a[start + i++] });
    while (j < m) out.push({ kind: 'add', text: b[start + j++] });
  }

  for (let i = endA; i < a.length; i++) out.push({ kind: 'same', text: a[i] });
  return out;
}

export const newFromDiff = (d: DiffLine[]): string =>
  d
    .filter((l) => l.kind !== 'remove')
    .map((l) => l.text)
    .join('\n');

export const oldFromDiff = (d: DiffLine[]): string =>
  d
    .filter((l) => l.kind !== 'add')
    .map((l) => l.text)
    .join('\n');
