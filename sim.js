/* sim.js — steady-state time-domain simulation of the rectifier circuits.
 *
 * Model: ideal sources and ideal switches (no source impedance, no overlap, no forward drop),
 * series R-L-E load, optional freewheeling diode across the load.
 * Method: fixed-step simulation (7200 steps per cycle = 0.05°) with an exact exponential update of the
 * load inductor current for each step; devices commutate by comparing node voltages, thyristors need a
 * gate pulse, and the whole thing is repeated cycle after cycle (with Aitken extrapolation) until the
 * inductor current repeats from one cycle to the next (periodic steady state).
 */
(function (root) {
  'use strict';
  const C = typeof require !== 'undefined' ? require('./circuits.js') : root.RL.circuits;

  const tableCache = {};
  function unitTable(def, N) {
    const key = def.key + ':' + N;
    if (tableCache[key]) return tableCache[key];
    const nk = def.nodes.length;
    const U = Array.from({ length: nk }, () => new Float64Array(N));
    for (let n = 0; n < N; n++) {
      const th = (n + 0.5) * 2 * Math.PI / N;
      const u = def.u(th, 1);
      for (let k = 0; k < nk; k++) U[k][n] = u[k];
    }
    tableCache[key] = U;
    return U;
  }

  const mean = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
  const rms = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); };

  /* complex DFT coefficient of harmonic h of a one-cycle sample vector (samples at mid-step angles) */
  function dftH(x, h) {
    const N = x.length; let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const a = h * (n + 0.5) * 2 * Math.PI / N;
      re += x[n] * Math.cos(a); im += x[n] * Math.sin(a);
    }
    return { amp: 2 / N * Math.hypot(re, im), phase: Math.atan2(im, re) };
  }
  function spectrum(x, H) {
    const out = [mean(x)];
    for (let h = 1; h <= H; h++) out.push(dftH(x, h).amp);
    return out;
  }

  function simulate(cfg) {
    const def = C.circuitDef(cfg.phases, cfg.topo, cfg.device);
    const N = cfg.steps || 7200;
    const nd = def.devices.length, nk = def.nodes.length;
    const Vm = Math.SQRT2 * cfg.Vrms;
    const alpha = def.controlled ? cfg.alpha : 0;
    const R = Math.max(cfg.R, 1e-3);
    const E = Math.max(cfg.E || 0, 0);
    const Linf = !!cfg.Linf;
    const L = Linf ? Infinity : Math.max(cfg.L || 0, 0);
    const hasFwd = !!cfg.fwd;
    const T = 1 / cfg.f, dt = T / N, dth = 360 / N;
    const Ut = unitTable(def, N);

    const dev = def.devices;
    const fire = dev.map(d => (d.nat + alpha) % 360);
    const gw = def.gateWidth;
    const isDiode = dev.map(d => d.kind === 'diode');
    const tops = [], bots = [];
    dev.forEach((d, i) => (d.group === 'top' ? tops : bots).push(i));
    const bridge = def.bridge;

    const on = new Uint8Array(nd);
    const u = new Float64Array(nk);
    let iL = 0;

    function initLatches() {
      on.fill(0);
      for (let k = 0; k < nk; k++) u[k] = Ut[k][0];
      let bt = -1, v = -Infinity;
      tops.forEach(d => { if (u[dev[d].node] > v) { v = u[dev[d].node]; bt = d; } });
      if (bt >= 0) on[bt] = 1;
      if (bridge) {
        let bb = -1; v = Infinity;
        bots.forEach(d => { if (u[dev[d].node] < v) { v = u[dev[d].node]; bb = d; } });
        if (bb >= 0) on[bb] = 1;
      }
    }

    /* one electrical cycle; when rec is given every sample is stored */
    function cycle(rec) {
      for (let n = 0; n < N; n++) {
        const th = (n + 0.5) * dth;
        for (let k = 0; k < nk; k++) u[k] = Vm * Ut[k][n];

        // device enable / selection
        let bt = -1, vt = -Infinity;
        for (let q = 0; q < tops.length; q++) {
          const d = tops[q];
          const g = ((th - fire[d] + 720) % 360) < gw;
          if (isDiode[d] || on[d] || g) {
            const val = u[dev[d].node] + (on[d] ? 1e-9 : 0);
            if (val > vt) { vt = val; bt = d; }
          }
        }
        let bb = -1, vb = Infinity;
        if (bridge) {
          for (let q = 0; q < bots.length; q++) {
            const d = bots[q];
            const g = ((th - fire[d] + 720) % 360) < gw;
            if (isDiode[d] || on[d] || g) {
              const val = u[dev[d].node] - (on[d] ? 1e-9 : 0);
              if (val < vb) { vb = val; bb = d; }
            }
          }
        }
        const haveT = bt >= 0, haveB = bridge ? bb >= 0 : true;
        const vP0 = haveT ? u[dev[bt].node] : NaN;
        const vN0 = bridge ? (haveB ? u[dev[bb].node] : NaN) : 0;
        const voc = (haveT && haveB) ? vP0 - vN0 : NaN;

        // operating mode: 0 idle, 1 conducting through devices, 2 freewheeling diode
        let mode = 0;
        const cond = Linf ? true : (L > 0 ? iL > 1e-12 : false);
        if (L > 0 || Linf) {
          if (cond) {
            if (hasFwd && !(voc >= 0)) mode = 2;
            else if (haveT && haveB) mode = 1;
            else mode = 0; // cannot happen in a consistent state; current is forced to zero below
          } else if (haveT && haveB && voc > E) mode = 1;
        } else if (haveT && haveB && voc > E) mode = 1;

        let vo, P, Nn;
        if (mode === 1) {
          vo = voc; P = vP0; Nn = vN0;
          on.fill(0); on[bt] = 1; if (bridge) on[bb] = 1;
        } else {
          if (mode === 2) { on.fill(0); vo = 0; }
          else { vo = E; if (!(Linf)) on.fill(0); }
          if (!bridge) { P = vo; Nn = 0; }
          else {
            let mt = 0, mb = 0;
            for (let q = 0; q < tops.length; q++) mt += u[dev[tops[q]].node];
            for (let q = 0; q < bots.length; q++) mb += u[dev[bots[q]].node];
            mt /= tops.length; mb /= bots.length;
            P = (mt + mb) / 2 + vo / 2; Nn = P - vo;
          }
        }

        // current update
        let iNew, ioRec, frac = 1;
        if (Linf) { iNew = 1; ioRec = 1; }
        else if (L > 0) {
          if (mode === 0) { iNew = 0; ioRec = 0; iL = 0; }
          else {
            const Iinf = (vo - E) / R, a = Math.exp(-R * dt / L);
            iNew = Iinf + (iL - Iinf) * a;
            if (iNew <= 0) {
              frac = iL > 0 ? iL / (iL - iNew) : 0;
              ioRec = iL * frac / 2; iNew = 0; on.fill(0);
            } else ioRec = (iL + iNew) / 2;
          }
        } else {
          iNew = mode === 1 ? (vo - E) / R : 0; ioRec = iNew;
          if (mode !== 1) on.fill(0);
        }

        if (rec) {
          rec.vo[n] = vo; rec.io[n] = ioRec; rec.P[n] = P; rec.N[n] = Nn;
          rec.mode[n] = mode; rec.bt[n] = mode === 1 ? bt : -1; rec.bb[n] = mode === 1 && bridge ? bb : -1;
          for (let k = 0; k < nk; k++) rec.u[k][n] = u[k];
          for (let d = 0; d < nd; d++) rec.on[d][n] = (mode === 1 && (d === bt || d === bb)) ? 1 : 0;
          for (let d = 0; d < nd; d++) {
            const g = ((th - fire[d] + 720) % 360) < gw;
            rec.gate[d][n] = !isDiode[d] && g ? 1 : 0;
          }
        }
        if (!Linf) iL = iNew;
      }
    }

    function newRec() {
      const f = () => new Float64Array(N);
      return {
        vo: f(), io: f(), P: f(), N: f(),
        mode: new Uint8Array(N), bt: new Int8Array(N), bb: new Int8Array(N),
        u: Array.from({ length: nk }, f),
        on: Array.from({ length: nd }, () => new Uint8Array(N)),
        gate: Array.from({ length: nd }, () => new Uint8Array(N))
      };
    }

    const warnings = [];
    let cycles = 0, converged = true, periodErr = 0;
    let rec = newRec();

    if (Linf) {
      initLatches();
      cycle(null); cycle(null); cycles = 2;
      cycle(rec); cycles++;
    } else {
      const hist = [];
      const maxCycles = 900;
      converged = false;
      while (cycles < maxCycles) {
        const start = iL;
        cycle(null); cycles++;
        const err = Math.abs(iL - start);
        if (err < 1e-9 + 1e-8 * Math.abs(iL)) { converged = true; break; }
        hist.push(iL);
        if (hist.length === 3) {
          const d1 = hist[1] - hist[0], d2 = hist[2] - hist[1];
          if (Math.abs(d2) > 1e-14 && d1 * d2 > 0 && Math.abs(d2) < Math.abs(d1)) {
            const xs = hist[2] - d2 * d2 / (d2 - d1);
            if (isFinite(xs) && xs >= 0) iL = xs;
          }
          hist.length = 0;
        }
      }
      const start = iL;
      cycle(rec); cycles++;
      periodErr = Math.abs(iL - start);
      if (!converged && periodErr < 1e-6 * Math.max(1, Math.abs(iL))) converged = true;
      if (!converged) warnings.push('Steady state not fully reached; results are approximate.');
    }

    /* ---- post-processing ---- */
    const theta = new Float64Array(N);
    for (let n = 0; n < N; n++) theta[n] = (n + 0.5) * dth;

    let io = rec.io, Id = 0;
    if (Linf) {
      const Vavg0 = mean(rec.vo);
      Id = (Vavg0 - E) / R;
      if (Id <= 1e-9) {
        Id = 0;
        warnings.push('With an ideal inductor the average output voltage (' + Vavg0.toFixed(1) + ' V) cannot exceed E, so no steady load current flows.');
      }
      io = new Float64Array(N).fill(Id);
    }
    const devI = dev.map((d, i) => {
      const a = new Float64Array(N);
      const on_ = rec.on[i];
      if (Linf) { for (let n = 0; n < N; n++) a[n] = on_[n] ? Id : 0; }
      else for (let n = 0; n < N; n++) a[n] = on_[n] ? io[n] : 0;
      return a;
    });
    const ifwd = new Float64Array(N);
    for (let n = 0; n < N; n++) ifwd[n] = rec.mode[n] === 2 ? io[n] : 0;
    if (Linf && Id === 0) { for (let d = 0; d < nd; d++) devI[d].fill(0); }

    // device voltages (anode − cathode)
    const devV = dev.map((d, i) => {
      const a = new Float64Array(N);
      const uk = rec.u[d.node], on_ = rec.on[i];
      if (d.group === 'top') for (let n = 0; n < N; n++) a[n] = on_[n] ? 0 : uk[n] - rec.P[n];
      else for (let n = 0; n < N; n++) a[n] = on_[n] ? 0 : rec.N[n] - uk[n];
      return a;
    });
    const vfwd = new Float64Array(N);
    for (let n = 0; n < N; n++) vfwd[n] = rec.mode[n] === 2 ? 0 : rec.N[n] - rec.P[n];

    // node currents drawn from the sources and the channel currents
    const nodeI = Array.from({ length: nk }, () => new Float64Array(N));
    dev.forEach((d, i) => {
      const s = d.group === 'top' ? 1 : -1, ni = nodeI[d.node];
      for (let n = 0; n < N; n++) ni[n] += s * devI[i][n];
    });
    const channels = def.channels.map(ch => {
      const a = new Float64Array(N);
      ch.terms.forEach(([k, s]) => { for (let n = 0; n < N; n++) a[n] += s * nodeI[k][n]; });
      return { name: ch.name, label: ch.label || ch.name, data: a };
    });
    const plotSources = def.plotSources.map(ps => ({ name: ps.name, data: rec.u[ps.k] }));

    /* ---- metrics ---- */
    const Vavg = mean(rec.vo), Vrms = rms(rec.vo);
    const Iavg = mean(io), Irms = rms(io);
    let pout = 0, pin = 0;
    for (let n = 0; n < N; n++) {
      pout += rec.vo[n] * io[n];
      for (let k = 0; k < nk; k++) pin += rec.u[k][n] * nodeI[k][n];
    }
    pout /= N; pin /= N;
    const ch0 = channels[0].data;
    const IsRms = rms(ch0), Is0 = mean(ch0);
    const vref = plotSources[0].data;
    const c1 = dftH(ch0, 1), v1 = dftH(vref, 1);
    const dpf = c1.amp > 1e-12 ? Math.cos(c1.phase - v1.phase) : 1;
    const thd = c1.amp > 1e-9 ? Math.sqrt(Math.max(IsRms * IsRms - Is0 * Is0 - c1.amp * c1.amp / 2, 0)) / (c1.amp / Math.SQRT2) : 0;
    let S = 0; channels.forEach(ch => { S += cfg.Vrms * rms(ch.data); });
    const pf = S > 1e-12 ? pin / S : 0;
    let Imin = Infinity, Imax = -Infinity;
    for (let n = 0; n < N; n++) { if (io[n] < Imin) Imin = io[n]; if (io[n] > Imax) Imax = io[n]; }
    let conduction;
    if (Linf) conduction = 'ideal';
    else conduction = Imin > 1e-6 * Math.max(Imax, 1e-9) ? 'continuous' : 'discontinuous';

    const metrics = {
      Vavg, Vrms, Iavg, Irms, Pout: pout, Pin: pin,
      eff: pin > 1e-9 ? pout / pin : 0,
      ripple: Vavg > 1e-9 ? Math.sqrt(Math.max(Vrms * Vrms - Vavg * Vavg, 0)) / Vavg : NaN,
      formFactor: Vavg > 1e-9 ? Vrms / Vavg : NaN,
      Imin, Imax, IsRms, Is0, Is1rms: c1.amp / Math.SQRT2, thd, dpf, pf, S, conduction,
      Vm, cycles, periodErr
    };

    return {
      cfg, def, N, theta, T, dth,
      vo: rec.vo, io, ifwd, vfwd, P: rec.P, N_: rec.N, mode: rec.mode, bt: rec.bt, bb: rec.bb,
      u: rec.u, devI, devV, devOn: rec.on, gate: rec.gate, nodeI,
      channels, plotSources, metrics, warnings, converged, Id
    };
  }

  function deviceStats(res, i) {
    const I = res.devI[i], V = res.devV[i], on = res.devOn[i];
    let n = 0, vmin = 0, vmax = 0, ip = 0;
    for (let k = 0; k < on.length; k++) {
      n += on[k];
      if (V[k] < vmin) vmin = V[k];
      if (V[k] > vmax) vmax = V[k];
      if (I[k] > ip) ip = I[k];
    }
    return { avg: mean(I), rms: rms(I), peak: ip, piv: -vmin, pfv: vmax, angle: n * res.dth };
  }

  const api = { simulate, deviceStats, spectrum, dftH, mean, rms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RL = root.RL || {}; root.RL.sim = api; }
})(typeof window !== 'undefined' ? window : globalThis);
