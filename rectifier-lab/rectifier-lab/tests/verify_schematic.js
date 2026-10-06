/* Schematic verification.
 *  1. Connectivity read back from the drawn geometry == hand-written netlist of the simulated model
 *  2. Layout sanity: no wire through a component, no overlapping/dangling wires, orthogonal wires only
 *  3. Every conduction state the simulator produces has a closed, drawable current loop
 * Run:  node tests/verify_schematic.js
 */
const S = require('../js/schematic.js');
const C = require('../js/circuits.js');
const { simulate } = require('../js/sim.js');

let pass = 0, fail = 0; const failures = [];
const truth = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); } };

const ALL = [[1, 'HW'], [1, 'FW'], [1, 'DBR'], [1, 'TCR'], [3, 'HW'], [3, 'FW'], [3, 'DBR'], [3, 'TCR']];
const loads = [
  { L: 0, Linf: false, E: 0 }, { L: 0.045, Linf: false, E: 0 }, { L: 0, Linf: true, E: 0 },
  { L: 0.045, Linf: false, E: 40 }, { L: 0, Linf: false, E: 40 }, { L: 0, Linf: true, E: 40 }
];
const norm = nets => nets.map(n => n.slice().sort().join('|')).sort();

for (const [ph, topo] of ALL) {
  for (const dev of (topo === 'HW' || topo === 'FW') ? ['diode', 'scr'] : ['diode']) {
    for (const ld of loads) for (const fwd of [false, true]) {
      const cfg = { phases: ph, topo, device: dev, Vrms: 230, f: 50, alpha: 40, R: 20, L: ld.L, Linf: ld.Linf, E: ld.E, fwd };
      const tag = `${ph}φ ${topo}/${dev} L=${ld.L}${ld.Linf ? '∞' : ''} E=${ld.E} fwd=${fwd}`;
      const sch = S.buildSchematic(cfg);
      const def = sch.def;
      const want = norm(C.netlist(def, cfg, fwd));
      const got = norm(S.extractNets(sch));
      const missing = want.filter(x => !got.includes(x)), extra = got.filter(x => !want.includes(x));
      truth('nets ' + tag, !missing.length && !extra.length, 'missing=' + JSON.stringify(missing) + ' extra=' + JSON.stringify(extra));
      const prob = S.checkLayout(sch);
      truth('layout ' + tag, prob.length === 0, prob.join('; '));
      const svg = S.renderSVG(sch);
      truth('svg balanced ' + tag, (svg.match(/<svg/g) || []).length === 1 && svg.endsWith('</svg>') && !/NaN|undefined/.test(svg));
      // every pin the simulator relies on exists
      def.devices.forEach(d => truth(`pins ${d.id} ${tag}`, sch.pins.has(d.id + '.a') && sch.pins.has(d.id + '.k')));
    }
  }
}

/* routes for every state that occurs during a cycle */
for (const [ph, topo] of ALL) {
  for (const a of [0, 35, 75, 110, 150]) {
    for (const fwd of [false, true]) {
      const dev = topo === 'TCR' ? 'scr' : (a > 0 ? 'scr' : 'diode');
      if ((topo === 'DBR') && a > 0) continue;
      const cfg = { phases: ph, topo, device: dev, Vrms: 230, f: 50, alpha: a, R: 10, L: 0.03, Linf: false, E: 0, fwd };
      const sch = S.buildSchematic(cfg);
      const r = simulate(cfg);
      const seen = new Set();
      for (let n = 0; n < r.N; n += 3) {
        const kt = r.bt[n] >= 0 ? r.def.devices[r.bt[n]].id : null;
        const kb = r.bb[n] >= 0 ? r.def.devices[r.bb[n]].id : null;
        const f = r.mode[n] === 2;
        const k = kt + '|' + kb + '|' + f;
        if (seen.has(k) || (!kt && !f)) continue;
        seen.add(k);
        const route = S.routeFor(sch, { kt, kb, fwd: f, primSign: 1 });
        const tag = `${ph}φ ${topo} α=${a} fwd=${fwd} state ${k}`;
        truth('route ok ' + tag, route.ok && route.segs.length > 0);
        if (kt) truth('route has devices ' + tag, route.els.has(kt) && (!kb || route.els.has(kb)));
        if (f) truth('route has DF ' + tag, route.els.has('DF'));
        // loop must pass through the load
        truth('route through load ' + tag, route.els.has('R'));
      }
    }
  }
}

/* direction sanity: in the 1-phase bridge pair (T1,T2) current must leave the source "+" pin */
{
  const cfg = { phases: 1, topo: 'DBR', device: 'diode', Vrms: 230, f: 50, alpha: 0, R: 20, L: 0, Linf: false, E: 0, fwd: false };
  const sch = S.buildSchematic(cfg);
  const r12 = S.routeFor(sch, { kt: 'D1', kb: 'D2', fwd: false });
  const r34 = S.routeFor(sch, { kt: 'D3', kb: 'D4', fwd: false });
  // source + pin is at x=234 (left); in the first pair the lead into the circuit starts leftwards: wire from (234,230) to (150,230)
  const has = (r, x1, x2) => r.segs.some(s => s.y1 === 230 && s.y2 === 230 && s.x1 === x1 && s.x2 === x2);
  truth('1φ bridge D1/D2: current leaves source + toward leg A', has(r12, 234, 150));
  truth('1φ bridge D1/D2: current returns into source − from leg B', has(r12, 370, 286));
  truth('1φ bridge D3/D4: current leaves source − toward leg B', has(r34, 286, 370));
  truth('1φ bridge D3/D4: current returns into source + from leg A', has(r34, 150, 234));
  // load always flows top → bottom
  const down = r => r.segs.filter(s => s.x1 === 650).every(s => s.y2 >= s.y1);
  truth('load current flows top→bottom (pair 1)', down(r12));
  truth('load current flows top→bottom (pair 2)', down(r34));
}

console.log(`schematic checks: ${pass} passed, ${fail} failed`);
if (fail) { failures.slice(0, 40).forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
