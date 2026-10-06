/* Deployment sanity: every file index.html references exists, every element id used by main.js exists in the HTML,
 * and no source file uses network resources. Run: node tests/verify_files.js */
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let pass = 0; const bad = [];
const ok = (n, c) => { if (c) pass++; else bad.push(n); };
for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (/^(data:|https?:|mailto:)/.test(m[1])) { ok('no external resource: ' + m[1], !/^https?:/.test(m[1])); continue; }
  ok('referenced file exists: ' + m[1], fs.existsSync(path.join(root, m[1])));
}
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const dup = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).filter((x, i, a) => a.indexOf(x) !== i);
ok('no duplicate ids: ' + dup.join(','), dup.length === 0);
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const dynamic = new Set(['sel-dev']);
for (const m of main.matchAll(/\$\('([a-z0-9-]+)'\)/g)) {
  const id = m[1];
  const made = ['preset-', 'chip-', 'pnl-', 'ttl-', 'lg-', 'rd-', 'cv-'].some(pre => id.startsWith(pre)) || dynamic.has(id);
  ok('main.js id exists in HTML or is built at runtime: ' + id, ids.has(id) || made);
}
for (const f of ['circuits', 'sim', 'theory', 'schematic', 'plots', 'main']) {
  const src = fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8');
  ok(f + '.js does not fetch anything', !/fetch\(|XMLHttpRequest|import\(|WebSocket/.test(src));
}
console.log(`file checks: ${pass} passed, ${bad.length} failed`);
bad.forEach(b => console.log('  FAIL ' + b));
process.exit(bad.length ? 1 : 0);
