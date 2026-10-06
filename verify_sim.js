/* Engine verification: simulated numbers vs closed-form theory, power balance, KCL, structure.
 * Run:  node tests/verify_sim.js
 */
const { simulate, deviceStats, mean, rms } = require('../js/sim.js');
const { analyticVavg } = require('../js/theory.js');
const { circuitDef } = require('../js/circuits.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, got, want, tol, rel = true) {
  const err = rel ? Math.abs(got - want) / Math.max(Math.abs(want), 1e-9) : Math.abs(got - want);
  const ok = err <= tol;
  if (ok) pass++; else { fail++; failures.push(`${name}: got ${got.toFixed(5)} want ${want.toFixed(5)} (err ${err.toExponential(2)} > ${tol})`); }
}
function truth(name, cond) { if (cond) pass++; else { fail++; failures.push(name); } }

const base = { Vrms: 230, f: 50, alpha: 0, R: 20, L: 0, Linf: false, E: 0, fwd: false, device: 'diode' };
const ALL = [[1, 'HW'], [1, 'FW'], [1, 'DBR'], [1, 'TCR'], [3, 'HW'], [3, 'FW'], [3, 'DBR'], [3, 'TCR']];

/* 1. average output voltage vs closed form: R load and ideal-L load, every circuit, many α */
for (const [ph, topo] of ALL) {
  const controlled = topo === 'TCR';
  const alphas = controlled ? [0, 15, 30, 45, 60, 75, 90, 105, 120, 150, 170] : [0];
  const variants = [];
  for (const dev of (topo === 'HW' || topo === 'FW') ? ['diode', 'scr'] : ['diode']) {
    const al = (dev === 'scr' || controlled) ? alphas.length ? [0, 20, 30, 45, 60, 90, 120, 150] : [0] : [0];
    for (const a of al) variants.push({ dev, a });
  }
  for (const v of variants) {
    for (const load of [{ name: 'R', L: 0, Linf: false, fwd: false }, { name: 'L∞+FWD', L: 0, Linf: true, fwd: true }, { name: 'L∞', L: 0, Linf: true, fwd: false }]) {
      const cfg = { ...base, phases: ph, topo, device: v.dev, alpha: v.a, L: load.L, Linf: load.Linf, fwd: load.fwd, E: 0 };
      const th = analyticVavg(cfg);
      if (!th) continue;
      const r = simulate(cfg);
      // when theory predicts a negative / zero average with an ideal inductor there is no steady current; compare voltage anyway
      const tag = `${ph}φ ${topo}/${v.dev} α=${v.a} ${load.name}`;
      check('Vavg ' + tag, r.metrics.Vavg, th.value, 2e-3, false ? false : true);
    }
  }
}

/* 2. power balance:  P_in (from the sources) = R·Irms² + E·Iavg  for random loads */
const loads = [
  { R: 20, L: 0.045, E: 0 }, { R: 5, L: 0.01, E: 100 }, { R: 10, L: 0.2, E: 50 }, { R: 50, L: 0.002, E: 0 },
  { R: 8, L: 0, E: 60 }, { R: 15, L: 1.0, E: 0 }
];
for (const [ph, topo] of ALL) {
  for (const ld of loads) for (const fwd of [false, true]) {
    for (const a of (topo === 'TCR' ? [0, 40, 80, 110] : topo === 'DBR' ? [0] : [0, 50])) {
      const dev = (topo === 'HW' || topo === 'FW') && a > 0 ? 'scr' : 'diode';
      const cfg = { ...base, phases: ph, topo, device: dev, alpha: a, R: ld.R, L: ld.L, E: ld.E, fwd };
      const r = simulate(cfg);
      const m = r.metrics;
      const pload = ld.R * m.Irms * m.Irms + ld.E * m.Iavg;
      const tag = `${ph}φ ${topo}/${dev} α=${a} R=${ld.R} L=${ld.L} E=${ld.E} fwd=${fwd}`;
      if (m.Pin > 1) check('Pin vs R·Irms²+E·Iavg ' + tag, m.Pin, pload, 6e-3);
      check('Pout(vo·io) vs R·Irms²+E·Iavg ' + tag, m.Pout, pload, 6e-3);
      truth('converged ' + tag, r.converged);
    }
  }
}

/* 3. KCL: Σ top-device currents = load current − FWD current; Σ bottom = same */
for (const [ph, topo] of ALL) {
  const cfg = { ...base, phases: ph, topo, device: topo === 'TCR' ? 'scr' : 'diode', alpha: 40, L: 0.05, E: 20, fwd: true };
  const r = simulate(cfg);
  let worst = 0;
  for (let n = 0; n < r.N; n++) {
    let st = 0, sb = 0;
    r.def.devices.forEach((d, i) => { if (d.group === 'top') st += r.devI[i][n]; else sb += r.devI[i][n]; });
    worst = Math.max(worst, Math.abs(st + r.ifwd[n] - r.io[n]));
    if (r.def.bridge) worst = Math.max(worst, Math.abs(sb + r.ifwd[n] - r.io[n]));
  }
  truth(`KCL ${ph}φ ${topo} worst=${worst.toExponential(2)}`, worst < 1e-9);
}

/* 4. device conduction angles, ideal diodes with ideal L (L∞) */
for (const [ph, topo] of ALL) {
  if (topo === 'TCR') continue;
  const cfg = { ...base, phases: ph, topo, Linf: true, L: 0, fwd: false };
  if (topo === 'HW' && ph === 1) continue; // single device would conduct always
  const r = simulate(cfg);
  const def = r.def;
  const want = 360 / (def.bridge ? (ph === 1 ? 2 : 3) : def.pulses);
  def.devices.forEach((d, i) => check(`${ph}φ ${topo} ${d.id} conduction angle`, deviceStats(r, i).angle, want, 2e-3));
  const Id = r.metrics.Iavg;
  def.devices.forEach((d, i) => check(`${ph}φ ${topo} ${d.id} avg current = Id·angle/360`, deviceStats(r, i).avg, Id * want / 360, 4e-3));
}

/* 5. ripple-free load current: source-current figures of merit */
{
  const r = simulate({ ...base, phases: 1, topo: 'DBR', Linf: true });
  check('1φ bridge L∞: Is rms = Id', r.metrics.IsRms, r.metrics.Iavg, 2e-3);
  check('1φ bridge L∞: THD = 48.34%', r.metrics.thd, Math.sqrt(Math.PI ** 2 / 8 - 1), 3e-3);
  check('1φ bridge L∞: PF = 2√2/π', r.metrics.pf, 2 * Math.SQRT2 / Math.PI, 3e-3);
  check('1φ bridge L∞: DPF = 1', r.metrics.dpf, 1, 1e-3);
}
{
  const a = 40, r = simulate({ ...base, phases: 1, topo: 'TCR', device: 'scr', alpha: a, Linf: true });
  check('1φ TCR L∞: DPF = cos α', r.metrics.dpf, Math.cos(a * Math.PI / 180), 3e-3);
  check('1φ TCR L∞: PF = 0.9 cos α', r.metrics.pf, 2 * Math.SQRT2 / Math.PI * Math.cos(a * Math.PI / 180), 4e-3);
}
{
  const r = simulate({ ...base, phases: 3, topo: 'DBR', Linf: true });
  check('3φ bridge L∞: Is rms = √(2/3) Id', r.metrics.IsRms, Math.sqrt(2 / 3) * r.metrics.Iavg, 3e-3);
  check('3φ bridge L∞: THD = 31.08%', r.metrics.thd, Math.sqrt(Math.PI ** 2 / 9 - 1), 4e-3);
  check('3φ bridge L∞: PF = 3/π', r.metrics.pf, 3 / Math.PI, 4e-3);
  check('3φ bridge diode Vavg = 2.34 Vs', r.metrics.Vavg, 2.3399 * 230, 1e-3);
}
{
  const a = 50, r = simulate({ ...base, phases: 3, topo: 'TCR', device: 'scr', alpha: a, Linf: true });
  check('3φ TCR L∞: DPF = cos α', r.metrics.dpf, Math.cos(a * Math.PI / 180), 4e-3);
  check('3φ TCR L∞: PF = (3/π)cos α', r.metrics.pf, 3 / Math.PI * Math.cos(a * Math.PI / 180), 5e-3);
}

/* 6. textbook single-point checks (diodes, R load) */
const Vm = 230 * Math.SQRT2;
{
  let r = simulate({ ...base, phases: 1, topo: 'HW' });
  check('HW R: Vavg = Vm/π', r.metrics.Vavg, Vm / Math.PI, 1e-3);
  check('HW R: Vrms = Vm/2', r.metrics.Vrms, Vm / 2, 1e-3);
  check('HW R: RF = 1.21', r.metrics.ripple, 1.2113, 2e-3);
  check('HW R: η = 4/π² = 40.5%', (r.metrics.Vavg * r.metrics.Iavg) / (r.metrics.Vrms * r.metrics.Irms), 4 / (Math.PI ** 2), 2e-3);
  const st = deviceStats(r, 0);
  check('HW R: PIV = Vm', st.piv, Vm, 2e-3);
  check('HW R: conduction 180°', st.angle, 180, 2e-3);
  r = simulate({ ...base, phases: 1, topo: 'FW' });
  check('FW R: Vavg = 2Vm/π', r.metrics.Vavg, 2 * Vm / Math.PI, 1e-3);
  check('FW R: RF = 0.483', r.metrics.ripple, 0.4834, 2e-3);
  check('FW R: PIV = 2Vm', Math.max(deviceStats(r, 0).piv, deviceStats(r, 1).piv), 2 * Vm, 2e-3);
  r = simulate({ ...base, phases: 1, topo: 'DBR' });
  check('DBR R: PIV = Vm', Math.max(...r.def.devices.map((d, i) => deviceStats(r, i).piv)), Vm, 2e-3);
  r = simulate({ ...base, phases: 3, topo: 'HW' });
  check('3φ HW R: Vavg = 0.827 Vm', r.metrics.Vavg, 3 * Math.sqrt(3) * Vm / (2 * Math.PI), 1e-3);
  check('3φ HW R: PIV = √3 Vm', Math.max(...r.def.devices.map((d, i) => deviceStats(r, i).piv)), Math.sqrt(3) * Vm, 3e-3);
  r = simulate({ ...base, phases: 3, topo: 'FW' });
  check('3φ FW R: Vavg = 0.955 Vm', r.metrics.Vavg, 3 * Vm / Math.PI, 1e-3);
  check('3φ FW R: PIV = 2Vm', Math.max(...r.def.devices.map((d, i) => deviceStats(r, i).piv)), 2 * Vm, 3e-3);
  r = simulate({ ...base, phases: 3, topo: 'DBR' });
  check('3φ DBR R: PIV = √3 Vm', Math.max(...r.def.devices.map((d, i) => deviceStats(r, i).piv)), Math.sqrt(3) * Vm, 3e-3);
  check('3φ DBR R: Vrms = 1.6554 Vm', r.metrics.Vrms, 1.6554 * Vm, 1e-3);
}

/* 7. firing order / natural commutation reference: α = 0 thyristor == diode */
for (const [ph, topo] of [[1, 'HW'], [1, 'FW'], [3, 'HW'], [3, 'FW']]) {
  const a = simulate({ ...base, phases: ph, topo, device: 'diode', L: 0.05 });
  const b = simulate({ ...base, phases: ph, topo, device: 'scr', alpha: 0, L: 0.05 });
  check(`${ph}φ ${topo}: thyristor at α=0 equals diode (Vavg)`, b.metrics.Vavg, a.metrics.Vavg, 2e-3);
}
{
  const a = simulate({ ...base, phases: 1, topo: 'DBR', L: 0.05 });
  const b = simulate({ ...base, phases: 1, topo: 'TCR', alpha: 0, L: 0.05 });
  check('1φ bridge: TCR at α=0 equals DBR', b.metrics.Vavg, a.metrics.Vavg, 2e-3);
  const c = simulate({ ...base, phases: 3, topo: 'DBR', L: 0.05 });
  const d = simulate({ ...base, phases: 3, topo: 'TCR', alpha: 0, L: 0.05 });
  check('3φ bridge: TCR at α=0 equals DBR', d.metrics.Vavg, c.metrics.Vavg, 2e-3);
}

/* 8. inversion with back-emf: α=120°, E<0 not allowed in the model, so check negative-voltage region exists and Vavg<0 */
{
  const r = simulate({ ...base, phases: 3, topo: 'TCR', alpha: 120, Linf: true, E: 0 });
  truth('3φ TCR α=120° L∞ has negative average (inversion region)', r.metrics.Vavg < 0);
  check('3φ TCR α=120° L∞ Vavg = −0.5·Vd0', r.metrics.Vavg, -0.5 * 3 * Math.sqrt(3) * Vm / Math.PI, 2e-3);
}

/* 9. periodic steady state really is periodic, including a very large time constant */
{
  const r = simulate({ ...base, phases: 1, topo: 'DBR', R: 2, L: 2.0 });
  truth('large τ=1 s converged', r.converged && r.metrics.periodErr < 1e-6);
  const rr = simulate({ ...base, phases: 3, topo: 'TCR', alpha: 75, R: 10, L: 0.05, E: 100, fwd: true });
  truth('3φ TCR RLE converged', rr.converged);
}

/* 10. frequency scaling: 60 Hz, different Vrms */
{
  const r = simulate({ ...base, phases: 1, topo: 'FW', f: 60, Vrms: 120 });
  check('FW 60 Hz 120 V: Vavg', r.metrics.Vavg, 2 * 120 * Math.SQRT2 / Math.PI, 1e-3);
}

console.log(`engine checks: ${pass} passed, ${fail} failed`);
if (fail) { failures.slice(0, 60).forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
