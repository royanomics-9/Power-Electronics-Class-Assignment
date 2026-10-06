/* main.js — state, controls, animation loop and exports. */
(function () {
  'use strict';
  const RL = window.RL;
  const C = RL.circuits, Sim = RL.sim, Th = RL.theory, Sch = RL.schematic, P = RL.plots;
  const $ = id => document.getElementById(id);

  const DEFAULTS = { phases: 1, topo: 'TCR', device: 'diode', Vrms: 230, f: 50, alpha: 45, R: 20, Lmh: 45, Linf: false, E: 0, fwd: false, dev: '' };
  const LIMITS = {
    Vrms: [10, 1000], f: [10, 400], alpha: [0, 180], R: [0.1, 1000], Lmh: [0, 5000], E: [0, 1000]
  };
  const CYCLE_SECONDS = 8;

  let st = Object.assign({}, DEFAULTS);
  let res = null, sch = null, cfg = null;
  let cursor = 0, hover = null, playing = false, speed = 1, dragging = false, needsDraw = true;
  let flowG = null, svgEl = null, lastRouteKey = '', lastLiveIdx = -1;
  let hidden = {};
  let panels = [], specVo = null, specIs = null;

  /* ------------------------------------------------------------------ helpers */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const minus = s => s.replace(/-/g, '−');
  function fmt(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (d === undefined) d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3;
    return minus(v.toFixed(d));
  }
  const fmt1 = v => (Math.abs(v) < 0.05 ? '0.0' : fmt(v, 1));
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }
  const effDevice = () => st.topo === 'DBR' ? 'diode' : st.topo === 'TCR' ? 'scr' : st.device;
  function makeCfg() {
    return {
      phases: st.phases, topo: st.topo, device: effDevice(), Vrms: st.Vrms, f: st.f, alpha: st.alpha,
      R: st.R, L: st.Lmh / 1000, Linf: st.Linf, E: st.E, fwd: st.fwd
    };
  }

  /* ------------------------------------------------------------------ URL state */
  function toHash() {
    return new URLSearchParams({
      p: st.phases, t: st.topo, d: st.device, V: st.Vrms, f: st.f, a: st.alpha, R: st.R, L: st.Lmh,
      Li: st.Linf ? 1 : 0, E: st.E, F: st.fwd ? 1 : 0
    }).toString();
  }
  function fromHash() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return;
    const p = new URLSearchParams(h), num = (k, key) => { const v = parseFloat(p.get(k)); if (isFinite(v)) st[key] = clamp(v, LIMITS[key][0], LIMITS[key][1]); };
    if (p.get('p') === '1' || p.get('p') === '3') st.phases = parseInt(p.get('p'), 10);
    if (['HW', 'FW', 'DBR', 'TCR'].includes(p.get('t'))) st.topo = p.get('t');
    if (p.get('d') === 'diode' || p.get('d') === 'scr') st.device = p.get('d');
    num('V', 'Vrms'); num('f', 'f'); num('a', 'alpha'); num('R', 'R'); num('L', 'Lmh'); num('E', 'E');
    if (p.has('Li')) st.Linf = p.get('Li') === '1';
    if (p.has('F')) st.fwd = p.get('F') === '1';
  }
  let hashTimer = null;
  function saveHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => { try { history.replaceState(null, '', '#' + toHash()); } catch (e) { /* ignore */ } }, 250);
  }

  /* ------------------------------------------------------------------ presets */
  const PRESETS = [
    { id: 'r', label: 'Resistive load', set: { R: 20, Lmh: 0, Linf: false, E: 0, fwd: false } },
    { id: 'rl', label: 'RL load, current keeps flowing', set: { R: 20, Lmh: 100, Linf: false, E: 0, fwd: false } },
    { id: 'linf', label: 'Ideal inductor, ripple-free current', set: { R: 20, Lmh: 0, Linf: true, E: 0, fwd: false } },
    { id: 'rle', label: 'Battery charging (R, L and E)', set: { R: 5, Lmh: 20, Linf: false, E: 100, fwd: false } },
    { id: 'dcm', label: 'Discontinuous current, α = 90°', ctl: true, set: { alpha: 90, R: 20, Lmh: 20, Linf: false, E: 0, fwd: false } },
    { id: 'fwd', label: 'Freewheeling diode, RL load, α = 60°', ctl: true, set: { alpha: 60, R: 20, Lmh: 100, Linf: false, E: 0, fwd: true } },
    { id: 'neg', label: 'Negative average output, α = 120°, L → ∞', ctl: true, set: { alpha: 120, R: 20, Lmh: 0, Linf: true, E: 0, fwd: false } }
  ];
  function buildPresets() {
    const box = $('presets'); box.innerHTML = '';
    PRESETS.forEach(p => {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'preset-' + p.id; b.textContent = p.label;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        Object.assign(st, p.set);
        if (p.ctl && (st.topo === 'HW' || st.topo === 'FW')) st.device = 'scr';
        syncControls(); schedule(); toast('Preset: ' + p.label);
      });
      box.appendChild(b);
    });
  }
  function presetActive(p) {
    const keys = Object.keys(p.set);
    return keys.every(k => (k === 'Linf' || k === 'fwd') ? st[k] === p.set[k] : Math.abs(st[k] - p.set[k]) < 1e-9);
  }

  /* ------------------------------------------------------------------ controls */
  const NUMS = [
    { key: 'Vrms', num: 'in-V', rg: 'rg-V' },
    { key: 'f', num: 'in-f' },
    { key: 'alpha', num: 'in-alpha', rg: 'rg-alpha' },
    { key: 'R', num: 'in-R', rg: 'rg-R' },
    { key: 'Lmh', num: 'in-L', rg: 'rg-L' },
    { key: 'E', num: 'in-E', rg: 'rg-E' }
  ];
  function setVal(el, v) { const s = String(Math.round(v * 1000) / 1000); if (el.value !== s) el.value = s; }
  function syncControls() {
    const def = C.circuitDef(st.phases, st.topo, effDevice());
    document.querySelectorAll('.cm').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.phase === st.phases && b.dataset.topo === st.topo)));
    NUMS.forEach(n => {
      setVal($(n.num), st[n.key]);
      if (n.rg) { const r = $(n.rg); r.value = clamp(st[n.key], +r.min, +r.max); }
    });
    $('f50').setAttribute('aria-pressed', String(st.f === 50)); $('f60').setAttribute('aria-pressed', String(st.f === 60));
    $('chk-Linf').checked = st.Linf; $('chk-fwd').checked = st.fwd;
    $('in-L').disabled = st.Linf; $('rg-L').disabled = st.Linf;
    // device type
    const eff = effDevice(), fixed = st.topo === 'DBR' || st.topo === 'TCR';
    $('dev-diode').setAttribute('aria-pressed', String(eff === 'diode')); $('dev-scr').setAttribute('aria-pressed', String(eff === 'scr'));
    $('dev-diode').disabled = fixed; $('dev-scr').disabled = fixed;
    $('dev-hint').textContent = fixed ? (st.topo === 'DBR' ? 'The diode bridge is built from diodes.' : 'The thyristor bridge is built from thyristors.') : (eff === 'scr' ? 'Thyristors: the firing angle sets the output.' : 'Diodes conduct as soon as they are forward biased.');
    // alpha
    const ctl = def.controlled;
    $('in-alpha').disabled = !ctl; $('rg-alpha').disabled = !ctl;
    $('alpha-hint').textContent = ctl ? alphaHint(def) : 'No gate control with diodes, so α = 0. Choose Thyristor to control the output.';
    $('v-hint').textContent = def.sourceNote + ' · Vm = ' + fmt(Math.SQRT2 * st.Vrms, 1) + ' V';
    PRESETS.forEach(p => {
      const b = $('preset-' + p.id);
      b.disabled = !!p.ctl && st.topo === 'DBR';
      b.setAttribute('aria-pressed', String(!b.disabled && presetActive(p)));
    });
  }
  function alphaHint(def) {
    if (def.phases === 1) return 'α is counted from the zero crossing of the supply voltage.';
    if (def.bridge) return 'α is counted from the natural firing point, 30° after the zero crossing of each phase voltage.';
    if (def.pulses === 3) return 'α is counted from the natural firing point, 30° after the zero crossing of each phase voltage.';
    return 'α is counted from the natural firing point, 60° after the zero crossing of each half-winding voltage.';
  }

  function bindControls() {
    NUMS.forEach(n => {
      const num = $(n.num), rg = n.rg ? $(n.rg) : null;
      num.addEventListener('input', () => {
        const v = parseFloat(num.value);
        if (!isFinite(v)) return;
        st[n.key] = clamp(v, LIMITS[n.key][0], LIMITS[n.key][1]);
        if (rg) rg.value = clamp(st[n.key], +rg.min, +rg.max);
        refreshDerived(); schedule();
      });
      num.addEventListener('change', () => { setVal(num, st[n.key]); });
      if (rg) rg.addEventListener('input', () => {
        st[n.key] = clamp(parseFloat(rg.value), LIMITS[n.key][0], LIMITS[n.key][1]);
        setVal(num, st[n.key]); refreshDerived(); schedule();
      });
    });
    $('f50').addEventListener('click', () => { st.f = 50; syncControls(); schedule(); });
    $('f60').addEventListener('click', () => { st.f = 60; syncControls(); schedule(); });
    $('chk-Linf').addEventListener('change', e => { st.Linf = e.target.checked; syncControls(); schedule(); });
    $('chk-fwd').addEventListener('change', e => { st.fwd = e.target.checked; syncControls(); schedule(); });
    $('dev-diode').addEventListener('click', () => { st.device = 'diode'; syncControls(); schedule(); });
    $('dev-scr').addEventListener('click', () => { st.device = 'scr'; syncControls(); schedule(); });
    document.querySelectorAll('.cm').forEach(b => b.addEventListener('click', () => {
      const wasFixed = st.topo === 'DBR' || st.topo === 'TCR';
      st.phases = +b.dataset.phase; st.topo = b.dataset.topo;
      if (wasFixed && (st.topo === 'HW' || st.topo === 'FW')) st.device = 'diode';
      syncControls(); schedule();
    }));
    $('btn-defaults').addEventListener('click', () => { st = Object.assign({}, DEFAULTS); syncControls(); schedule(); toast('Parameters reset'); });
    $('btn-theme').addEventListener('click', () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); });
    $('btn-link').addEventListener('click', copyLink);
    $('btn-csv').addEventListener('click', exportCSV);
    $('btn-png').addEventListener('click', exportPNG);
    $('btn-svg').addEventListener('click', exportSVG);

    // transport
    $('btn-play').addEventListener('click', () => setPlaying(!playing));
    $('btn-prev').addEventListener('click', () => { setPlaying(false); moveCursor(-5); });
    $('btn-next').addEventListener('click', () => { setPlaying(false); moveCursor(5); });
    $('btn-reset-theta').addEventListener('click', () => { setPlaying(false); setCursorIdx(0); });
    $('rg-theta').addEventListener('input', e => { setPlaying(false); setCursorIdx(parseFloat(e.target.value) / 360 * res.N); });
    $('rg-speed').addEventListener('input', e => { speed = parseFloat(e.target.value); $('out-speed').textContent = speed + '×'; });

    // tabs
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => { x.setAttribute('aria-selected', String(x === t)); $(x.getAttribute('aria-controls')).hidden = x !== t; });
      if (t.id === 'tab-spectrum') drawSpectra();
    }));

    document.addEventListener('keydown', e => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') return;
      if (e.target && e.target.isContentEditable) return;
      if (e.code === 'Space' && tag === 'BUTTON') return; // a focused button handles Space itself
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
      else if (e.code === 'ArrowRight') { setPlaying(false); moveCursor(5); }
      else if (e.code === 'ArrowLeft') { setPlaying(false); moveCursor(-5); }
    });
    window.addEventListener('resize', () => { panels.forEach(p => p.panel.invalidate()); needsDraw = true; drawSpectra(); });
    if (window.ResizeObserver) new ResizeObserver(() => { panels.forEach(p => p.panel.invalidate()); needsDraw = true; drawSpectra(); }).observe($('wave-grid'));
  }
  function refreshDerived() {
    const def = C.circuitDef(st.phases, st.topo, effDevice());
    $('v-hint').textContent = def.sourceNote + ' · Vm = ' + fmt(Math.SQRT2 * st.Vrms, 1) + ' V';
    PRESETS.forEach(p => { const b = $('preset-' + p.id); b.setAttribute('aria-pressed', String(!b.disabled && presetActive(p))); });
  }

  /* ------------------------------------------------------------------ theme */
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('rl-theme', t); } catch (e) { /* ignore */ }
    $('btn-theme').textContent = t === 'dark' ? 'Light theme' : 'Dark theme';
    if (res) { buildPlots(); buildSpectra(); needsDraw = true; }
  }
  function initTheme() {
    let t = null;
    try { t = localStorage.getItem('rl-theme'); } catch (e) { /* ignore */ }
    if (!t) t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    $('btn-theme').textContent = t === 'dark' ? 'Light theme' : 'Dark theme';
  }

  /* ------------------------------------------------------------------ recompute */
  let pending = false;
  function schedule() {
    if (pending) return; pending = true;
    requestAnimationFrame(() => { pending = false; recompute(); saveHash(); });
  }

  function recompute() {
    cfg = makeCfg();
    res = Sim.simulate(cfg);
    sch = Sch.buildSchematic(cfg);
    $('schem').innerHTML = Sch.renderSVG(sch);
    svgEl = $('schem').querySelector('svg'); flowG = svgEl.querySelector('.flow'); lastRouteKey = '';
    $('schem-title').textContent = res.def.title;
    const devIds = res.def.devices.map(d => d.id).concat(cfg.fwd ? ['DF'] : []);
    if (!devIds.includes(st.dev)) st.dev = devIds[0];
    buildWaveGrid(devIds);
    buildPlots(); buildSpectra(); renderResults(); renderTheory(); renderChecks();
    const w = $('warn');
    if (res.warnings.length) { w.hidden = false; w.textContent = res.warnings.join(' '); } else w.hidden = true;
    cursor = clamp(cursor, 0, res.N - 1);
    lastLiveIdx = -1; needsDraw = true;
  }

  /* ------------------------------------------------------------------ waveform panels */
  const PANEL_DEFS = [
    { id: 'supply', title: 'Supply voltage' },
    { id: 'vo', title: 'Output voltage vo' },
    { id: 'io', title: 'Load current io' },
    { id: 'is', title: 'Supply current' },
    { id: 'idev', title: 'Device current' },
    { id: 'vdev', title: 'Device voltage' },
    { id: 'gantt', title: 'Conduction and gate pulses' }
  ];
  function buildWaveGrid(devIds) {
    const grid = $('wave-grid');
    // build the DOM once; only the device select changes between circuits
    if (!grid.dataset.built) {
      grid.dataset.built = '1';
      PANEL_DEFS.forEach(d => {
        const el = document.createElement('div'); el.className = 'pnl'; el.id = 'pnl-' + d.id;
        el.innerHTML = '<div class="pnl-head"><h3 id="ttl-' + d.id + '">' + d.title + '</h3>' +
          (d.id === 'idev' ? '<label class="sr" for="sel-dev" style="position:absolute;left:-999px">Device</label><select id="sel-dev"></select>' : '') +
          '<div class="legend" id="lg-' + d.id + '"></div><div class="pnl-read" id="rd-' + d.id + '"></div></div>' +
          '<canvas class="cv' + (d.id === 'gantt' ? ' gantt' : '') + '" id="cv-' + d.id + '" aria-label="' + d.title + ' waveform"></canvas>';
        grid.appendChild(el);
      });
      const chips = $('chips');
      PANEL_DEFS.forEach(d => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.id = 'chip-' + d.id; b.textContent = d.title.replace(' and gate pulses', '');
        b.setAttribute('aria-pressed', 'true');
        b.addEventListener('click', () => {
          hidden[d.id] = !hidden[d.id];
          b.setAttribute('aria-pressed', String(!hidden[d.id])); $('pnl-' + d.id).hidden = !!hidden[d.id];
          panels.forEach(p => p.panel.invalidate()); needsDraw = true;
        });
        chips.appendChild(b);
      });
      $('sel-dev').addEventListener('change', e => { st.dev = e.target.value; buildPlots(); renderResults(); needsDraw = true; });
      // canvases
      panels = PANEL_DEFS.map(d => {
        const cv = $('cv-' + d.id);
        const panel = d.id === 'gantt' ? new P.GanttPanel(cv) : new P.LinePanel(cv);
        bindCanvas(cv, panel);
        return { id: d.id, cv, panel };
      });
      specVo = new P.BarPanel($('cv-spec-vo')); specIs = new P.BarPanel($('cv-spec-is'));
      bindBars(specVo, $('cv-spec-vo'), 'spec-vo-read', 'V'); bindBars(specIs, $('cv-spec-is'), 'spec-is-read', 'A');
    }
    const sel = $('sel-dev');
    sel.innerHTML = devIds.map(id => '<option value="' + id + '">' + id + (id === 'DF' ? ' (freewheeling)' : '') + '</option>').join('');
    sel.value = st.dev;
  }

  function bindCanvas(cv, panel) {
    const idxOf = e => panel.xToIndex(e.clientX - cv.getBoundingClientRect().left);
    cv.addEventListener('pointermove', e => { if (!res) return; hover = idxOf(e); if (dragging) setCursorIdx(hover); needsDraw = true; });
    cv.addEventListener('pointerleave', () => { hover = null; needsDraw = true; });
    cv.addEventListener('pointerdown', e => {
      if (!res) return; cv.setPointerCapture(e.pointerId); dragging = true; setPlaying(false); setCursorIdx(idxOf(e));
    });
    const up = () => { dragging = false; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }
  function bindBars(panel, cv, readId, unitStr) {
    cv.addEventListener('pointermove', e => {
      if (!panel.spec) return;
      const i = panel.hit(e.clientX - cv.getBoundingClientRect().left); panel.hover = i; panel.draw();
      const v = panel.spec.values[i], base = panel.spec.base;
      const hz = i * cfg.f;
      $(readId).textContent = (i === 0 ? 'DC' : 'h' + i + ' · ' + fmt(hz, 0) + ' Hz') + ' = ' + fmt(v, 2) + ' ' + unitStr + (i > 0 && base ? ' (' + fmt(100 * v / base, 1) + ' % of fundamental)' : '');
    });
    cv.addEventListener('pointerleave', () => { panel.hover = -1; panel.draw(); $(readId).textContent = 'hover a bar'; });
  }

  function devSeries() {
    if (st.dev === 'DF' && cfg.fwd) return { i: res.ifwd, v: res.vfwd };
    let k = res.def.devices.findIndex(d => d.id === st.dev);
    if (k < 0) k = 0; // selection is repaired in recompute(); never read a device that the current result does not have
    return { i: res.devI[k], v: res.devV[k] };
  }
  function legendHTML(items) { return items.map(s => '<span><i style="background:' + s.color + '"></i>' + s.name + '</span>').join(''); }

  function buildPlots() {
    if (!res) return;
    const T = P.theme(document.body), m = res.metrics, N = res.N;
    const get = id => panels.find(p => p.id === id).panel;
    const setP = (id, series, hlines) => {
      get(id).set({ N, series, hlines: hlines || [] });
      $('lg-' + id).innerHTML = legendHTML(series.map(s => ({ name: s.name, color: s.color })));
    };
    const phaseColor = i => T.vs[i];
    setP('supply', res.plotSources.map((s, i) => ({ name: s.name, color: phaseColor(i), data: s.data })));
    setP('vo', [{ name: 'vo', color: T.vo, data: res.vo }], [{ y: m.Vavg, label: 'Vavg ' + fmt(m.Vavg, 1) + ' V', color: T.vo }]);
    setP('io', [{ name: 'io', color: T.io, data: res.io }], [{ y: m.Iavg, label: 'Iavg ' + fmt(m.Iavg, 2) + ' A', color: T.io }]);
    setP('is', res.channels.map((c, i) => ({ name: c.label, color: phaseColor(i), data: c.data })));
    const ds = devSeries(), dm = Sim.mean(ds.i);
    setP('idev', [{ name: 'i(' + st.dev + ')', color: T.id, data: ds.i }], [{ y: dm, label: 'avg ' + fmt(dm, 2) + ' A', color: T.id }]);
    setP('vdev', [{ name: 'v(' + st.dev + ') anode − cathode', color: T.vd, data: ds.v }]);
    $('ttl-vdev').textContent = 'Device voltage, ' + st.dev;
    // conduction chart
    const rows = res.def.devices.map((d, i) => ({ label: d.id, color: T.bar, on: res.devOn[i], gate: d.kind === 'scr' ? res.gate[i] : null }));
    if (cfg.fwd) { const on = new Uint8Array(N); for (let n = 0; n < N; n++) on[n] = res.mode[n] === 2 ? 1 : 0; rows.push({ label: 'DF', color: T.fwd, on, gate: null }); }
    get('gantt').set({ N, rows });
    $('lg-gantt').innerHTML = '<span><i style="background:' + T.bar + '"></i>device conducting</span>' + (cfg.fwd ? '<span><i style="background:' + T.fwd + '"></i>freewheeling diode</span>' : '') + (res.def.controlled ? '<span>◤ gate pulse start</span>' : '');
    $('sel-dev').value = st.dev;
    panels.forEach(p => p.panel.invalidate());
  }

  function buildSpectra() {
    if (!res) return;
    const T = P.theme(document.body);
    const sv = Sim.spectrum(res.vo, 24), si = Sim.spectrum(res.channels[0].data, 25);
    specVo.set({ values: sv, color: T.vo, base: null });
    specIs.set({ values: si, color: T.vs[0], base: si[1] });
    $('spec-is-title').textContent = 'Supply current ' + res.channels[0].label;
  }
  function drawSpectra() { if (specVo && !$('pane-spectrum').hidden) { specVo.draw(); specIs.draw(); } }

  /* ------------------------------------------------------------------ cursor + animation */
  function setPlaying(p) {
    playing = p;
    const b = $('btn-play'); b.textContent = p ? 'Pause' : 'Play'; b.setAttribute('aria-label', p ? 'Pause animation' : 'Play animation');
    document.body.classList.toggle('paused', !p);
  }
  function setCursorIdx(i) { if (!res) return; cursor = ((i % res.N) + res.N) % res.N; needsDraw = true; }
  function moveCursor(deg) { setCursorIdx(Math.floor(cursor) + deg / 360 * res.N); }

  let lastTs = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000)); lastTs = ts;
    if (playing && res) { cursor = (cursor + dt * speed / CYCLE_SECONDS * res.N) % res.N; needsDraw = true; }
    if (needsDraw && res) { needsDraw = false; drawAll(); }
  }

  function drawAll() {
    const idx = Math.floor(cursor);
    panels.forEach(p => { if (!hidden[p.id]) p.panel.draw(idx, hover); });
    const at = hover !== null ? hover : idx;
    panelReadouts(at);
    if (idx !== lastLiveIdx) { updateLive(idx); updateSchematic(idx); lastLiveIdx = idx; }
    const th = (idx + 0.5) * 360 / res.N;
    const rg = $('rg-theta'); if (document.activeElement !== rg) rg.value = th;
    $('out-theta').textContent = th.toFixed(1) + '°';
  }

  function panelReadouts(i) {
    const v = a => fmt1(a[i]);
    const set = (id, s) => { $('rd-' + id).textContent = s; };
    set('supply', res.plotSources.map(s => s.name + ' ' + v(s.data)).join('  ') + ' V');
    set('vo', 'vo ' + v(res.vo) + ' V');
    set('io', 'io ' + fmt(res.io[i], 2) + ' A');
    set('is', res.channels.map(c => c.name + ' ' + fmt(c.data[i], 2)).join('  ') + ' A');
    const ds = devSeries();
    set('idev', fmt(ds.i[i], 2) + ' A');
    set('vdev', v(ds.v) + ' V');
    const on = [];
    res.def.devices.forEach((d, k) => { if (res.devOn[k][i]) on.push(d.id); });
    if (res.mode[i] === 2) on.push('DF');
    set('gantt', (hover !== null ? 'θ = ' + ((i + 0.5) * 360 / res.N).toFixed(1) + '°  ' : '') + (on.length ? on.join(' + ') : 'none'));
  }

  function conductingAt(i) {
    const list = [];
    res.def.devices.forEach((d, k) => { if (res.devOn[k][i]) list.push(d.id); });
    if (res.mode[i] === 2) list.push('DF');
    return list;
  }

  function updateLive(i) {
    const th = (i + 0.5) * 360 / res.N, t = th / 360 / cfg.f * 1000;
    const list = res.io[i] > 1e-9 ? conductingAt(i) : [];
    const rows = [
      ['Angle θ', th.toFixed(1) + '° · ' + t.toFixed(2) + ' ms'],
      ['Supply ' + res.plotSources.map(s => s.name).join(' / '), res.plotSources.map(s => fmt1(s.data[i])).join(' / ') + ' V'],
      ['Output voltage vo', fmt1(res.vo[i]) + ' V'],
      ['Load current io', fmt(res.io[i], 2) + ' A'],
      ['Supply ' + res.channels.map(c => c.name).join(' / '), res.channels.map(c => fmt(c.data[i], 2)).join(' / ') + ' A']
    ];
    let html = rows.map(r => '<div class="cell"><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>').join('');
    html += '<div class="cell"><dt>Conducting</dt><dd>' + (list.length ? list.map(x => '<span class="dv" style="margin-left:0;margin-right:4px">' + x + '</span>').join('') : 'none') + '</dd></div>';
    $('live').innerHTML = html;
    const pill = $('mode-pill');
    if (!list.length) { pill.textContent = 'Idle: no device conducts'; pill.className = 'mode'; }
    else if (list.includes('DF')) { pill.textContent = 'Freewheeling through DF'; pill.className = 'mode m2'; }
    else { pill.textContent = 'Conducting: ' + list.join(' + '); pill.className = 'mode m1'; }
  }

  function updateSchematic(i) {
    const live = res.io[i] > 1e-9;
    let kt = null, kb = null, fwd = false;
    if (live) {
      if (res.mode[i] === 2) fwd = true;
      else if (res.bt[i] >= 0) { kt = res.def.devices[res.bt[i]].id; if (res.bb[i] >= 0) kb = res.def.devices[res.bb[i]].id; }
    }
    const ch0 = res.channels[0].data[i];
    const primSign = sch.hasPrimary && kt ? (ch0 > 1e-9 ? 1 : ch0 < -1e-9 ? -1 : 0) : 0;
    const key = kt + '|' + kb + '|' + fwd + '|' + primSign;
    if (key === lastRouteKey) return;
    lastRouteKey = key;
    svgEl.querySelectorAll('.c.on').forEach(e => e.classList.remove('on'));
    let html = '';
    if (kt || fwd) {
      const route = Sch.routeFor(sch, { kt, kb, fwd, primSign });
      route.els.forEach(id => { const e = svgEl.querySelector('.c[data-id="' + id + '"]'); if (e) e.classList.add('on'); });
      route.segs.forEach(s => {
        html += '<line class="halo" x1="' + s.x1 + '" y1="' + s.y1 + '" x2="' + s.x2 + '" y2="' + s.y2 + '"/>';
      });
      route.segs.forEach(s => {
        html += '<line class="dash" x1="' + s.x1 + '" y1="' + s.y1 + '" x2="' + s.x2 + '" y2="' + s.y2 + '"/>';
      });
    }
    flowG.innerHTML = html;
  }

  /* ------------------------------------------------------------------ results / theory / checks */
  function devStats() {
    if (st.dev === 'DF' && cfg.fwd) {
      const I = res.ifwd, V = res.vfwd; let n = 0, pk = 0, vmin = 0;
      for (let k = 0; k < res.N; k++) { if (res.mode[k] === 2) n++; if (I[k] > pk) pk = I[k]; if (V[k] < vmin) vmin = V[k]; }
      return { avg: Sim.mean(I), rms: Sim.rms(I), peak: pk, piv: -vmin, angle: n * res.dth };
    }
    return Sim.deviceStats(res, res.def.devices.findIndex(d => d.id === st.dev));
  }
  function group(title, rows) {
    return '<h3>' + title + '</h3><dl class="kv">' + rows.map(r => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>';
  }
  function renderResults() {
    const m = res.metrics, ds = devStats(), th = Th.analyticVavg(cfg);
    const cond = { continuous: 'continuous', discontinuous: 'discontinuous', ideal: 'ideal, ripple-free' }[m.conduction];
    let html = group('Output (DC side)', [
      ['Average voltage Vavg', fmt(m.Vavg) + ' V'], ['RMS voltage Vrms', fmt(m.Vrms) + ' V'],
      ['Average current Iavg', fmt(m.Iavg) + ' A'], ['RMS current Irms', fmt(m.Irms) + ' A'],
      ['Voltage ripple factor', fmt(m.ripple, 3)], ['Form factor', fmt(m.formFactor, 3)],
      ['Load power', fmt(m.Pout, 1) + ' W'], ['Load current', cond]
    ]);
    if (m.conduction !== 'ideal') html = html.replace('</dl>', '<dt>Current ripple (peak to peak)</dt><dd>' + fmt(m.Imax - m.Imin) + ' A</dd></dl>');
    html += group('Supply side, ' + res.channels[0].name, [
      ['RMS current', fmt(m.IsRms) + ' A'], ['Fundamental (rms)', fmt(m.Is1rms) + ' A'], ['DC component', fmt(m.Is0) + ' A'],
      ['Current THD', fmt(100 * m.thd, 1) + ' %'], ['Displacement factor', fmt(m.dpf, 3)], ['Power factor', fmt(m.pf, 3)],
      ['Input power', fmt(m.Pin, 1) + ' W']
    ]);
    html += group('Device ' + st.dev, [
      ['Average current', fmt(ds.avg) + ' A'], ['RMS current', fmt(ds.rms) + ' A'], ['Peak current', fmt(ds.peak) + ' A'],
      ['Peak reverse voltage', fmt(ds.piv, 1) + ' V'], ['Conduction angle', fmt(ds.angle, 1) + '°']
    ]);
    if (th) {
      const err = Math.abs(m.Vavg - th.value) / Math.max(Math.abs(th.value), 1e-9) * 100;
      const ok = Math.abs(m.Vavg - th.value) < 0.003 * Math.max(Math.abs(th.value), 1) + 0.05;
      html += '<h3>Closed-form check</h3><dl class="kv"><dt>Vavg by formula</dt><dd>' + fmt(th.value) + ' V</dd><dt>Difference</dt><dd>' + fmt(err, 2) + ' % <span class="badge ' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'agrees' : 'differs') + '</span></dd></dl>';
    }
    $('results').innerHTML = html;
  }

  function renderTheory() {
    const def = res.def, notes = Th.notesFor(def), th = Th.analyticVavg(cfg), m = res.metrics;
    let cmp;
    if (th) {
      const err = (m.Vavg - th.value);
      cmp = '<dl class="kv"><dt>Basis</dt><dd>' + th.basis + '</dd><dt>Vavg from the formula</dt><dd>' + fmt(th.value, 2) + ' V</dd><dt>Vavg from the simulation</dt><dd>' + fmt(m.Vavg, 2) + ' V</dd><dt>Difference</dt><dd>' + fmt(err, 3) + ' V</dd></dl>';
    } else {
      cmp = '<p class="hint" style="margin:0">With a finite inductor or a back-emf the average depends on where the current dies out, so there is no simple closed form. The simulation solves the circuit directly. Use the Resistive load or Ideal inductor presets to compare against the formulas.</p>';
    }
    $('theory').innerHTML = '<div class="theory theory-grid"><div><h3>How this circuit works</h3><p>' + notes.how + '</p>' +
      '<h3 style="margin-top:18px">Standard results (ideal, Vm = peak of ' + (def.phases === 3 ? 'the phase' : 'the supply') + ' voltage)</h3><table><tbody>' +
      notes.rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '</tbody></table></div>' +
      '<div><h3>Model assumptions</h3><ul>' +
      '<li>Ideal sources with no impedance, so devices commutate instantly (no overlap angle).</li>' +
      '<li>Ideal devices: no forward drop and no leakage while blocking. In a bridge with no conducting path the blocking voltages assume equal leakage in every device.</li>' +
      '<li>A thyristor turns on when it is forward biased during its gate pulse (30° wide, 80° for the three-phase bridge so two devices can start together) and turns off when its current reaches zero or it is reverse biased.</li>' +
      '<li>The load is R, L and E in series. When no device conducts, the load voltage equals E.</li>' +
      '<li>Each plot is the periodic steady state: the simulation repeats until the inductor current is the same at the start and end of a cycle.</li></ul>' +
      '<div class="compare"><h3>Formula against simulation</h3>' + cmp + '</div></div></div>';
  }

  function runChecks() {
    const out = [], m = res.metrics, def = res.def;
    // 1 schematic vs model
    const norm = nets => nets.map(n => n.slice().sort().join('|')).sort();
    const want = norm(C.netlist(def, cfg, cfg.fwd)), got = norm(Sch.extractNets(sch));
    const sameNets = JSON.stringify(want) === JSON.stringify(got);
    const layout = Sch.checkLayout(sch);
    out.push({ ok: sameNets && !layout.length, title: 'Schematic matches the simulated circuit', detail: sameNets ? 'The wiring read back from the drawing gives the same ' + got.length + ' nets as the model, and no wire crosses a component.' : 'Drawing and model disagree.' });
    // 2 conduction sequence
    let bad = 0;
    for (let n = 0; n < res.N; n++) {
      let c = 0; for (let d = 0; d < def.devices.length; d++) c += res.devOn[d][n];
      const want1 = def.bridge ? 2 : 1;
      if (res.mode[n] === 1 ? c !== want1 : c !== 0) bad++;
    }
    out.push({ ok: bad === 0, title: 'Valid conduction pattern at every instant', detail: (def.bridge ? 'Exactly two devices (one per group) conduct, ' : 'Exactly one device conducts, ') + 'or none while idle or freewheeling.' + (bad ? ' Violations: ' + bad : '') });
    // 3 KCL
    let worst = 0;
    for (let n = 0; n < res.N; n++) {
      let s = 0; def.devices.forEach((d, k) => { if (d.group === 'top') s += res.devI[k][n]; });
      worst = Math.max(worst, Math.abs(s + res.ifwd[n] - res.io[n]));
    }
    out.push({ ok: worst < 1e-6, title: 'Current balance at the output node', detail: 'Device currents plus freewheeling current equal the load current; worst residual ' + worst.toExponential(1) + ' A.' });
    // 4 power balance
    const pl = cfg.R * m.Irms * m.Irms + cfg.E * m.Iavg;
    const perr = m.Pin > 1e-6 ? Math.abs(m.Pin - pl) / m.Pin : Math.abs(m.Pin - pl);
    out.push({ ok: perr < 0.01 || (m.Pin < 1e-6 && pl < 1e-6), title: 'Power balance', detail: 'Power drawn from the sources ' + fmt(m.Pin, 2) + ' W; R·Irms² + E·Iavg = ' + fmt(pl, 2) + ' W (difference ' + fmt(100 * perr, 2) + ' %).' });
    // 5 closed form
    const th = Th.analyticVavg(cfg);
    if (th) {
      const e = Math.abs(m.Vavg - th.value);
      out.push({ ok: e < 0.003 * Math.max(Math.abs(th.value), 1) + 0.05, title: 'Average output voltage against the closed form', detail: 'Formula ' + fmt(th.value, 2) + ' V, simulation ' + fmt(m.Vavg, 2) + ' V (' + th.basis + ').' });
    } else out.push({ ok: null, title: 'Average output voltage against the closed form', detail: 'No closed form exists for this load; use the Resistive or Ideal inductor presets.' });
    // 6 periodicity
    if (m.conduction === 'ideal') out.push({ ok: null, title: 'Periodic steady state', detail: 'The ideal inductor carries a constant current, so no settling is needed.' });
    else out.push({ ok: res.converged, title: 'Periodic steady state', detail: 'Reached after ' + m.cycles + ' simulated cycles; the inductor current repeats to within ' + m.periodErr.toExponential(1) + ' A.' });
    return out;
  }
  function renderChecks() {
    const list = runChecks();
    $('checks').innerHTML = '<div class="checks-list">' + list.map(c =>
      '<div class="check ' + (c.ok === null ? 'na' : c.ok ? 'ok' : 'bad') + '"><span class="st">' + (c.ok === null ? '–' : c.ok ? '✓' : '✗') + '</span><div><b>' + c.title + '</b><span>' + c.detail + '</span></div></div>').join('') + '</div>';
  }

  /* ------------------------------------------------------------------ exports */
  function download(name, blob) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportCSV() {
    const cols = [], head = ['theta_deg', 'time_ms'];
    res.plotSources.forEach(s => { head.push(s.name + '_V'); cols.push(s.data); });
    head.push('vo_V'); cols.push(res.vo); head.push('io_A'); cols.push(res.io);
    res.channels.forEach(c => { head.push(c.name + '_A'); cols.push(c.data); });
    res.def.devices.forEach((d, k) => { head.push('i_' + d.id + '_A'); cols.push(res.devI[k]); head.push('v_' + d.id + '_V'); cols.push(res.devV[k]); });
    if (cfg.fwd) { head.push('i_DF_A'); cols.push(res.ifwd); head.push('v_DF_V'); cols.push(res.vfwd); }
    const lines = ['# ' + res.def.title + ' | Vs=' + cfg.Vrms + ' V rms, f=' + cfg.f + ' Hz, alpha=' + (res.def.controlled ? cfg.alpha : 0) + ' deg, R=' + cfg.R + ' ohm, L=' + (cfg.Linf ? 'infinite' : (cfg.L * 1000) + ' mH') + ', E=' + cfg.E + ' V, freewheeling diode=' + (cfg.fwd ? 'yes' : 'no'), head.join(',')];
    for (let n = 0; n < res.N; n += 5) {
      const th = res.theta[n];
      lines.push([th.toFixed(3), (th / 360 / cfg.f * 1000).toFixed(5)].concat(cols.map(c => c[n].toFixed(5))).join(','));
    }
    download('rectifier-' + res.def.key + '.csv', new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    toast('CSV saved');
  }
  function exportSVG() {
    const style = '<style>.w,.st{fill:none;stroke:#14233a;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.st.fl{fill:#fff}.dot,.arrow{fill:#14233a}text{font-family:Arial,Helvetica,sans-serif;font-size:13px;fill:#0e1a29}.it{font-style:italic;font-family:Georgia,serif;font-size:15px}.src-lbl{font-style:italic;font-family:Georgia,serif;font-size:14px}.val-lbl{font-family:monospace;font-size:12px;fill:#47586b}.gate{font-size:10px;fill:#47586b}.sign{font-size:15px;font-weight:600}.dev-lbl{font-weight:600}.flow{display:none}</style><rect width="100%" height="100%" fill="#fff"/>';
    const markup = Sch.renderSVG(sch).replace(/(<svg[^>]*>)/, '$1' + style).replace(/ class="on"/g, '');
    const clean = markup.replace(/class="c ([^"]*?) on"/g, 'class="c $1"');
    download('schematic-' + res.def.key + '.svg', new Blob([clean], { type: 'image/svg+xml' }));
    toast('Schematic saved');
  }
  function exportPNG() {
    drawAll();
    const vis = panels.filter(p => !hidden[p.id]);
    if (!vis.length) { toast('Show at least one waveform panel'); return; }
    const titleH = 34 * (window.devicePixelRatio || 1), dpr = window.devicePixelRatio || 1;
    const w = Math.max.apply(null, vis.map(p => p.cv.width));
    const h = vis.reduce((s, p) => s + p.cv.height + titleH, titleH);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'), T = P.theme(document.body);
    ctx.fillStyle = T.surface; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = T.ink; ctx.font = '600 ' + 16 * dpr + 'px Georgia, serif'; ctx.textBaseline = 'middle';
    ctx.fillText(res.def.title + '  (Vs ' + cfg.Vrms + ' V, ' + cfg.f + ' Hz, α ' + (res.def.controlled ? cfg.alpha : 0) + '°, R ' + cfg.R + ' Ω, L ' + (cfg.Linf ? '∞' : cfg.L * 1000 + ' mH') + ', E ' + cfg.E + ' V)', 12 * dpr, titleH / 2);
    let y = titleH;
    vis.forEach(p => {
      ctx.font = '600 ' + 14 * dpr + 'px Georgia, serif'; ctx.fillStyle = T.ink;
      ctx.fillText($('ttl-' + p.id).textContent, 12 * dpr, y + titleH / 2);
      y += titleH; ctx.drawImage(p.cv, 0, y); y += p.cv.height;
    });
    cv.toBlob(b => { download('waveforms-' + res.def.key + '.png', b); toast('PNG saved'); });
  }
  function copyLink() {
    saveHash(); try { history.replaceState(null, '', '#' + toHash()); } catch (e) { /* ignore */ }
    const url = location.href;
    const done = () => toast('Link copied');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url, done));
    else fallbackCopy(url, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed: ' + text); }
    ta.remove();
  }

  /* ------------------------------------------------------------------ start */
  function init() {
    initTheme();
    fromHash();
    buildPresets();
    bindControls();
    syncControls();
    $('out-speed').textContent = speed + '×';
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    recompute();
    setPlaying(!reduce);
    requestAnimationFrame(frame);
    window.RL.app = { get state() { return st; }, get res() { return res; }, get cfg() { return cfg; }, setPlaying };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
