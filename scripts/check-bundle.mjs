// Production import-graph check (Req 22.x / design "Build verification").
// Verifies via the real Rollup module graph (not text search) that the test-only
// Reference_Solution fixture and anything under /tests/ never enters the production bundle,
// and that no src module imports from tests/.
//
// Usage: node scripts/check-bundle.mjs   (also imported by scripts/verify-build.mjs)
import { build } from 'vite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isForbidden = (id) => /[\\/]tests[\\/]/.test(id) || /referenceSolution/i.test(id);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

export async function checkBundleGraph() {
  const parsed = new Map(); // id -> importedIds
  const collector = {
    name: 'collect-module-graph',
    moduleParsed(info) {
      parsed.set(info.id, [...info.importedIds, ...info.dynamicallyImportedIds]);
    },
  };
  const result = await build({
    root,
    logLevel: 'silent',
    plugins: [collector],
    worker: { format: 'es', plugins: () => [collector] },
    build: { write: false, emptyOutDir: false, rollupOptions: {} },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output ?? []);
  const chunks = outputs.filter((o) => o.type === 'chunk');
  const bundledIds = new Set();
  for (const c of chunks) for (const id of Object.keys(c.modules ?? {})) bundledIds.add(id);
  for (const c of chunks) for (const id of c.moduleIds ?? []) bundledIds.add(id);

  const forbiddenInBundle = [...bundledIds].filter(isForbidden);
  const forbiddenInGraph = [...parsed.keys()].filter(isForbidden);
  // Edges from a non-test module to a forbidden module.
  const badEdges = [];
  for (const [id, imports] of parsed) {
    if (isForbidden(id)) continue;
    for (const imp of imports) if (isForbidden(imp)) badEdges.push(`${id} -> ${imp}`);
  }
  // Static scan of src import specifiers as a second line of defence.
  const srcDir = join(root, 'src');
  const spec = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;
  const scanHits = [];
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(spec)) {
      const s = m[1];
      if (/(^|\/)tests(\/|$)/.test(s) || /referenceSolution/i.test(s)) scanHits.push(`${file.slice(root.length + 1)}: ${s}`);
    }
  }
  const srcModules = [...bundledIds].filter((id) => id.includes(`${sep}src${sep}`) || id.includes('/src/')).length;
  return {
    chunkCount: chunks.length,
    bundledModuleCount: bundledIds.size,
    srcModulesBundled: srcModules,
    graphModuleCount: parsed.size,
    forbiddenInBundle,
    forbiddenInGraph,
    badEdges,
    scanHits,
    ok:
      bundledIds.size > 0 &&
      srcModules > 0 &&
      forbiddenInBundle.length === 0 &&
      forbiddenInGraph.length === 0 &&
      badEdges.length === 0 &&
      scanHits.length === 0,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await checkBundleGraph();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
