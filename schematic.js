/* schematic.js — circuit schematics as data, rendered to SVG.
 *
 * A schematic is a list of components (with named pins at exact coordinates) and wires (polylines).
 * Everything that is drawn can be read back:
 *   extractNets()  rebuilds the connectivity from the drawn geometry (union of coincident points),
 *                  so the tests can compare it with the hand-written netlist in circuits.js;
 *   routeFor()     finds the current loop for a given conduction state by walking the drawn wires,
 *                  which is what animates the current path (and fails loudly if a drawing is not connected);
 *   checkLayout()  looks for wires running through component bodies and overlapping wires.
 */
(function (root) {
  'use strict';
  const C = typeof require !== 'undefined' ? require('./circuits.js') : root.RL.circuits;

  const W = 740, H = 440;
  const key = p => p[0] + ',' + p[1];
  const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
  const f1 = n => (Math.round(n * 10) / 10).toString();
  function num(v, unitStr) {
    let s;
    if (v >= 100) s = String(Math.round(v)); else if (v >= 10) s = String(Math.round(v * 10) / 10); else s = String(Math.round(v * 100) / 100);
    return s + (unitStr ? ' ' + unitStr : '');
  }

  class Sch {
    constructor(def, cfg) {
      this.def = def; this.cfg = cfg; this.w = W; this.h = H;
      this.comps = []; this.wires = []; this.texts = []; this.arrows = [];
      this.pins = new Map();
      this.hasPrimary = false;
    }
    pin(name, p) { this.pins.set(name, p.slice()); }
    wire(id, pts, extra) { this.wires.push(Object.assign({ id, pts: pts.map(p => p.slice()) }, extra || {})); }
    rail(id, y, xs, extra) { for (let i = 0; i < xs.length - 1; i++) this.wire(id + i, [[xs[i], y], [xs[i + 1], y]], extra); }
    text(x, y, s, cls, anchor) { this.texts.push({ x, y, s, cls: cls || 'lbl', anchor: anchor || 'start' }); }
    diode(id, a, k, c, opts) {
      opts = opts || {};
      this.comps.push({ kind: 'diode', id, a, k, c, scr: !!opts.scr, gs: opts.gs || 1 });
      this.pin(id + '.a', a); this.pin(id + '.k', k);
      if (opts.label !== false) {
        const dx = opts.lx === undefined ? -16 : opts.lx, dy = opts.ly === undefined ? 4 : opts.ly;
        this.text(c[0] + dx, c[1] + dy, id, 'lbl dev-lbl', opts.anchor || 'end');
      }
    }
    acsrc(id, c, r, p, n, label, lp) {
      this.comps.push({ kind: 'acsrc', id, c, r, p, n });
      this.pin(id + '.p', p); this.pin(id + '.n', n);
      if (label) this.text(lp[0], lp[1], label, 'lbl src-lbl', lp[2] || 'middle');
    }
  }

  /* ------------------------------------------------------------------ load + freewheeling diode */
  function addLoad(S, x, yT, yB, fwdX) {
    const cfg = S.cfg, chain = C.loadChain(cfg);
    const lens = { R: 44, L: 56, E: 30 };
    const total = chain.reduce((s, e) => s + lens[e.name], 0);
    const gap = (yB - yT - total) / (chain.length + 1);
    let y = yT + gap, prev = [x, yT];
    chain.forEach((e, i) => {
      const top = [x, Math.round(y)], bot = [x, Math.round(y + lens[e.name])];
      S.wire('ld' + i, [prev, top]);
      S.comps.push({ kind: e.name === 'R' ? 'res' : e.name === 'L' ? 'ind' : 'bat', id: e.name, p1: top, p2: bot });
      S.pin(e.p1, top); S.pin(e.p2, bot);
      const val = e.name === 'R' ? 'R = ' + num(cfg.R, 'Ω') : e.name === 'L' ? (cfg.Linf ? 'L → ∞' : 'L = ' + num(cfg.L * 1000, 'mH')) : 'E = ' + num(cfg.E, 'V');
      S.text(x + 18, (top[1] + bot[1]) / 2 + 4, val, 'lbl val-lbl');
      prev = bot; y += lens[e.name] + gap;
    });
    S.wire('ld' + chain.length, [prev, [x, yB]]);
    S.loadTop = chain[0].p1; S.loadBot = chain[chain.length - 1].p2;
    S.loadX = x; S.yT = yT; S.yB = yB;
    // output voltage / current annotations
    S.text(x - 14, yT + 16, '+', 'lbl sign', 'end');
    S.text(x - 14, yB - 8, '−', 'lbl sign', 'end');
    S.text(x - 14, (yT + yB) / 2 + 4, 'vo', 'lbl it', 'end');
    S.arrows.push({ x: x - 56, y: yT, dir: 'r' });
    S.text(x - 56, yT - 12, 'io', 'lbl it', 'middle');
    if (cfg.fwd) {
      const k = [fwdX, yT + 70], a = [fwdX, yB - 70];
      S.diode('DF', a, k, [fwdX, (yT + yB) / 2], { label: false });
      S.wire('dfk', [[fwdX, yT], k]); S.wire('dfa', [a, [fwdX, yB]]);
      S.text(fwdX + 14, (yT + yB) / 2 + 4, 'DF', 'lbl dev-lbl');
    }
  }

  /* ------------------------------------------------------------------ the eight circuits */
  function buildSchematic(cfg) {
    const def = C.circuitDef(cfg.phases, cfg.topo, cfg.device);
    const S = new Sch(def, cfg);
    const scr = def.deviceType === 'scr';
    const id = n => def.devices[0].id.charAt(0) + n;
    const k = def.key;

    if (k === '1ph-HW') {
      S.acsrc('S0', [90, 240], 26, [90, 214], [90, 266], 'vs', [58, 244, 'end']);
      S.wire('sp', [[90, 214], [90, 110], [190, 110]]);
      S.diode(id(1), [190, 110], [290, 110], [240, 110], { scr, gs: 1, lx: 0, ly: -18, anchor: 'middle' });
      S.rail('P', 110, [290, 560, 650]);
      S.wire('sn', [[90, 266], [90, 370], [560, 370]]);
      S.rail('N', 370, [560, 650]);
      addLoad(S, 650, 110, 370, 560);
    } else if (k === '1ph-FW') {
      S.hasPrimary = true;
      S.acsrc('SRC', [48, 235], 24, [48, 211], [48, 259], 'vs', [18, 239, 'end']);
      S.wire('pp', [[48, 211], [48, 185], [104, 185]], { prim: true });
      S.wire('pn', [[48, 259], [48, 285], [104, 285]], { prim: true });
      S.comps.push({ kind: 'xfmr', id: 'TX', p1: [104, 185], p2: [104, 285], s1: [150, 130], ct: [150, 235], s2: [150, 340], cx1: 124, cx2: 130, sx: 150, px: 104 });
      ['p1', 'p2', 's1', 'ct', 's2'].forEach(n => S.pin('TX.' + n, { p1: [104, 185], p2: [104, 285], s1: [150, 130], ct: [150, 235], s2: [150, 340] }[n]));
      S.pin('SRC.p', [48, 211]); S.pin('SRC.n', [48, 259]);
      S.wire('w1', [[150, 130], [250, 130]]);
      S.wire('w2', [[150, 340], [250, 340]]);
      S.diode(id(1), [250, 130], [350, 130], [300, 130], { scr, gs: 1, lx: 0, ly: -18, anchor: 'middle' });
      S.diode(id(2), [250, 340], [350, 340], [300, 340], { scr, gs: -1, lx: 0, ly: 30, anchor: 'middle' });
      S.wire('pk', [[350, 130], [410, 130]]);
      S.wire('pj', [[350, 340], [410, 340], [410, 130]]);
      S.rail('P', 130, [410, 560, 650]);
      S.wire('ct', [[150, 235], [195, 235], [195, 395], [560, 395]]);
      S.rail('N', 395, [560, 650]);
      S.text(206, 227, 'N', 'lbl it');
      addLoad(S, 650, 130, 395, 560);
    } else if (k === '1ph-DBR' || k === '1ph-TCR') {
      S.acsrc('S0', [260, 230], 26, [234, 230], [286, 230], 'vs', [260, 196]);
      S.wire('wa', [[150, 230], [234, 230]]);
      S.wire('wb', [[286, 230], [370, 230]]);
      S.diode(id(1), [150, 230], [150, 90], [150, 160], { scr, gs: 1 });
      S.diode(id(4), [150, 370], [150, 230], [150, 300], { scr, gs: 1 });
      S.diode(id(3), [370, 230], [370, 90], [370, 160], { scr, gs: -1, lx: 16, anchor: 'start' });
      S.diode(id(2), [370, 370], [370, 230], [370, 300], { scr, gs: -1, lx: 16, anchor: 'start' });
      S.rail('P', 90, [150, 370, 560, 650]);
      S.rail('N', 370, [150, 370, 560, 650]);
      S.text(134, 224, 'A', 'lbl it', 'end');
      S.text(386, 224, 'B', 'lbl it');
      addLoad(S, 650, 90, 370, 560);
    } else if (k === '3ph-HW') {
      const rows = [200, 250, 300], xs = [230, 300, 370], lab = ['va', 'vb', 'vc'];
      rows.forEach((y, i) => {
        S.acsrc('S' + i, [90, y], 18, [108, y], [72, y], lab[i], [90, y - 23]);
        S.wire('r' + i, [[108, y], [xs[i], y]]);
        S.diode(id(i + 1), [xs[i], y], [xs[i], 100], [xs[i], 150], { scr, gs: -1, lx: 16, anchor: 'start' });
      });
      S.wire('nb', [[72, 200], [72, 250], [72, 300], [72, 370], [560, 370]]);
      S.rail('N', 370, [560, 650]);
      S.rail('P', 100, [230, 300, 370, 560, 650]);
      S.text(60, 362, 'n', 'lbl it', 'end');
      addLoad(S, 650, 100, 370, 560);
    } else if (k === '3ph-FW') {
      const rows = [140, 184, 228, 272, 316, 360], lab = ['va', '−vc', 'vb', '−va', 'vc', '−vb'];
      const xs = rows.map((_, i) => 196 + 62 * i);
      rows.forEach((y, i) => {
        S.acsrc('S' + i, [80, y], 15, [95, y], [65, y], null);
        S.text(104, y - 5, lab[i], 'lbl src-lbl');
        S.wire('r' + i, [[95, y], [xs[i], y]]);
        S.diode(id(i + 1), [xs[i], y], [xs[i], 90], [xs[i], 125], { scr, gs: -1, lx: 14, ly: 4, anchor: 'start' });
      });
      S.wire('nb', [[65, 140], [65, 184], [65, 228], [65, 272], [65, 316], [65, 360], [65, 410], [560, 410]]);
      S.rail('N', 410, [560, 650]);
      S.rail('P', 90, xs.concat([560, 650]));
      S.text(50, 404, 'n', 'lbl it', 'end');
      addLoad(S, 650, 90, 410, 560);
    } else { // 3-phase bridge
      const rows = [190, 235, 280], lx = [240, 320, 400], lab = ['va', 'vb', 'vc'];
      rows.forEach((y, i) => {
        S.acsrc('S' + i, [80, y], 15, [95, y], [65, y], null);
        S.text(108, y - 5, lab[i], 'lbl src-lbl');
        S.wire('r' + i, [[95, y], [lx[i], y]]);
      });
      S.wire('nb', [[65, 190], [65, 235], [65, 280]]);
      S.text(52, 238, 'n', 'lbl it', 'end');
      // top devices on phases a, b, c; bottom devices T4 (a), T6 (b), T2 (c)
      S.diode(id(1), [240, 190], [240, 80], [240, 135], { scr, gs: 1 });
      S.diode(id(3), [320, 235], [320, 80], [320, 150], { scr, gs: 1 });
      S.diode(id(5), [400, 280], [400, 80], [400, 170], { scr, gs: 1 });
      S.diode(id(4), [240, 390], [240, 190], [240, 350], { scr, gs: 1 });
      S.diode(id(6), [320, 390], [320, 235], [320, 350], { scr, gs: 1 });
      S.diode(id(2), [400, 390], [400, 280], [400, 345], { scr, gs: 1 });
      S.rail('P', 80, [240, 320, 400, 560, 650]);
      S.rail('N', 390, [240, 320, 400, 560, 650]);
      addLoad(S, 650, 80, 390, 560);
    }
    S.title = def.title;
    return S;
  }

  /* ------------------------------------------------------------------ geometry helpers */
  function leadSegs(c) {
    if (c.kind === 'diode') {
      const u = unit(c.a, c.k);
      return [[c.a, [c.c[0] - u[0] * 10, c.c[1] - u[1] * 10]], [[c.c[0] + u[0] * 10, c.c[1] + u[1] * 10], c.k]];
    }
    return [];
  }
  function bodyBox(c) {
    if (c.kind === 'diode') {
      const u = unit(c.a, c.k), n = [-u[1], u[0]];
      const half = 11, w = c.scr ? 17 : 9;
      const ext = [c.c[0] - u[0] * half - n[0] * w, c.c[1] - u[1] * half - n[1] * w, c.c[0] + u[0] * half + n[0] * w, c.c[1] + u[1] * half + n[1] * w];
      // gate stub reaches out on one side only
      const gx = c.c[0] + n[0] * c.gs * (c.scr ? 17 : 9), gy = c.c[1] + n[1] * c.gs * (c.scr ? 17 : 9);
      const ox = c.c[0] - n[0] * c.gs * 9, oy = c.c[1] - n[1] * c.gs * 9;
      const xs = [c.c[0] - u[0] * half, c.c[0] + u[0] * half, gx, ox], ys = [c.c[1] - u[1] * half, c.c[1] + u[1] * half, gy, oy];
      return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
    }
    if (c.kind === 'acsrc') return [c.c[0] - c.r, c.c[1] - c.r, c.c[0] + c.r, c.c[1] + c.r];
    if (c.kind === 'res') return [c.p1[0] - 9, c.p1[1] + 8, c.p1[0] + 9, c.p2[1] - 8];
    if (c.kind === 'ind') return [c.p1[0] - 10, c.p1[1] + 8, c.p1[0] + 12, c.p2[1] - 8];
    if (c.kind === 'bat') return [c.p1[0] - 12, c.p1[1] + 9, c.p1[0] + 12, c.p2[1] - 9];
    if (c.kind === 'xfmr') return [c.px - 2, c.s1[1] - 4, c.sx + 2, c.s2[1] + 4];
    return null;
  }
  function segHitsBox(p, q, b) {
    const x0 = b[0] + 2, y0 = b[1] + 2, x1 = b[2] - 2, y1 = b[3] - 2;
    if (x1 <= x0 || y1 <= y0) return false;
    if (p[0] === q[0]) { return p[0] > x0 && p[0] < x1 && Math.max(Math.min(p[1], q[1]), y0) < Math.min(Math.max(p[1], q[1]), y1); }
    if (p[1] === q[1]) { return p[1] > y0 && p[1] < y1 && Math.max(Math.min(p[0], q[0]), x0) < Math.min(Math.max(p[0], q[0]), x1); }
    return false;
  }
  function wireSegments(S) {
    const out = [];
    S.wires.forEach(w => { for (let i = 0; i < w.pts.length - 1; i++) out.push({ wire: w, p: w.pts[i], q: w.pts[i + 1] }); });
    return out;
  }

  function checkLayout(S) {
    const problems = [];
    const segs = wireSegments(S);
    const boxes = S.comps.map(c => ({ id: c.id, b: bodyBox(c) })).filter(x => x.b);
    segs.forEach(s => {
      if (s.p[0] !== s.q[0] && s.p[1] !== s.q[1]) problems.push('diagonal wire ' + s.wire.id);
      boxes.forEach(bx => { if (segHitsBox(s.p, s.q, bx.b)) problems.push('wire ' + s.wire.id + ' passes through ' + bx.id); });
    });
    // overlapping collinear wire segments
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.wire === b.wire) continue;
      if (a.p[1] === a.q[1] && b.p[1] === b.q[1] && a.p[1] === b.p[1]) {
        const lo = Math.max(Math.min(a.p[0], a.q[0]), Math.min(b.p[0], b.q[0])), hi = Math.min(Math.max(a.p[0], a.q[0]), Math.max(b.p[0], b.q[0]));
        if (hi - lo > 0.5) problems.push('overlap ' + a.wire.id + '/' + b.wire.id);
      }
      if (a.p[0] === a.q[0] && b.p[0] === b.q[0] && a.p[0] === b.p[0]) {
        const lo = Math.max(Math.min(a.p[1], a.q[1]), Math.min(b.p[1], b.q[1])), hi = Math.min(Math.max(a.p[1], a.q[1]), Math.max(b.p[1], b.q[1]));
        if (hi - lo > 0.5) problems.push('overlap ' + a.wire.id + '/' + b.wire.id);
      }
    }
    // a wire may not end in mid-air: every wire end must meet a pin or another wire
    const count = new Map();
    S.wires.forEach(w => [w.pts[0], w.pts[w.pts.length - 1]].forEach(p => count.set(key(p), (count.get(key(p)) || 0) + 1)));
    S.pins.forEach(p => count.set(key(p), (count.get(key(p)) || 0) + 1));
    S.wires.forEach(w => [w.pts[0], w.pts[w.pts.length - 1]].forEach(p => { if (count.get(key(p)) < 2) problems.push('dangling end of ' + w.id + ' at ' + key(p)); }));
    return problems;
  }

  /* connectivity read back from the drawing: pins that share a net */
  function extractNets(S) {
    const parent = new Map();
    const find = a => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
    const add = a => { if (!parent.has(a)) parent.set(a, a); };
    const union = (a, b) => { add(a); add(b); parent.set(find(a), find(b)); };
    S.wires.forEach(w => { for (let i = 0; i < w.pts.length - 1; i++) union(key(w.pts[i]), key(w.pts[i + 1])); });
    S.pins.forEach(p => add(key(p)));
    const groups = new Map();
    S.pins.forEach((p, name) => { const r = find(key(p)); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(name); });
    return Array.from(groups.values()).map(g => g.sort());
  }

  /* ------------------------------------------------------------------ current-path routing */
  function buildGraph(S) {
    const edges = [];
    const addEdge = (u, v, kind, ref, seg) => edges.push({ u: key(u), v: key(v), kind, ref, seg });
    S.wires.forEach(w => {
      for (let i = 0; i < w.pts.length - 1; i++) {
        const p = w.pts[i], q = w.pts[i + 1];
        addEdge(p, q, w.prim ? 'primwire' : 'wire', w.id, { x1: p[0], y1: p[1], x2: q[0], y2: q[1] });
      }
    });
    S.comps.forEach(c => {
      if (c.kind === 'diode') addEdge(c.a, c.k, 'dev', c.id);
      else if (c.kind === 'acsrc') addEdge(c.n, c.p, c.id === 'SRC' ? 'primsrc' : 'src', c.id);
      else if (c.kind === 'xfmr') { addEdge(c.ct, c.s1, 'src', c.id); addEdge(c.ct, c.s2, 'src', c.id); addEdge(c.p1, c.p2, 'prim', c.id); }
      else if (c.kind === 'res' || c.kind === 'ind' || c.kind === 'bat') addEdge(c.p1, c.p2, 'load', c.id);
    });
    return edges;
  }
  function findPath(edges, start, end, kinds) {
    if (start === end) return [];
    const adj = new Map();
    edges.forEach((e, i) => {
      if (!kinds.has(e.kind)) return;
      if (!adj.has(e.u)) adj.set(e.u, []); if (!adj.has(e.v)) adj.set(e.v, []);
      adj.get(e.u).push([e.v, i, 1]); adj.get(e.v).push([e.u, i, -1]);
    });
    const prev = new Map([[start, null]]), queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === end) break;
      (adj.get(cur) || []).forEach(([nx, i, dir]) => { if (!prev.has(nx)) { prev.set(nx, [cur, i, dir]); queue.push(nx); } });
    }
    if (!prev.has(end)) return null;
    const steps = [];
    let cur = end;
    while (prev.get(cur)) { const [pc, i, dir] = prev.get(cur); steps.push({ edge: edges[i], dir }); cur = pc; }
    return steps.reverse();
  }

  /* state: { kt: 'T1'|null, kb: 'T2'|null, fwd: bool, primSign: ±1 }  → { segs, els, ok } */
  function routeFor(S, st) {
    if (!S._edges) S._edges = buildGraph(S);
    const E = S._edges, pk = n => key(S.pins.get(n));
    const segs = [], els = new Set();
    let ok = true;
    const takeSteps = (steps, flip) => {
      if (!steps) { ok = false; return; }
      steps.forEach(s => {
        if (s.edge.seg) {
          const g = s.edge.seg, fwd = (s.dir === 1) !== !!flip;
          segs.push(fwd ? { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 } : { x1: g.x2, y1: g.y2, x2: g.x1, y2: g.y1 });
        } else els.add(s.edge.ref);
      });
    };
    const WIRE = new Set(['wire']), LOADK = new Set(['wire', 'load']), RET = new Set(['wire', 'src']);
    if (st.fwd) {
      els.add('DF');
      takeSteps(findPath(E, pk('DF.k'), pk(S.loadTop), WIRE));
      takeSteps(findPath(E, pk(S.loadTop), pk(S.loadBot), LOADK));
      takeSteps(findPath(E, pk(S.loadBot), pk('DF.a'), WIRE));
    } else if (st.kt) {
      els.add(st.kt);
      takeSteps(findPath(E, pk(st.kt + '.k'), pk(S.loadTop), WIRE));
      takeSteps(findPath(E, pk(S.loadTop), pk(S.loadBot), LOADK));
      let end = pk(S.loadBot);
      if (st.kb) {
        takeSteps(findPath(E, end, pk(st.kb + '.a'), WIRE));
        els.add(st.kb);
        end = pk(st.kb + '.k');
      }
      takeSteps(findPath(E, end, pk(st.kt + '.a'), RET));
    }
    if (S.hasPrimary && st.kt && st.primSign) {
      const flip = st.primSign < 0;
      takeSteps(findPath(E, pk('SRC.p'), pk('SRC.n'), new Set(['primwire', 'prim'])), flip);
      els.add('SRC');
    }
    return { segs, els, ok };
  }

  /* ------------------------------------------------------------------ SVG rendering */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function renderComp(c) {
    const g = (cls, inner) => '<g class="c ' + cls + '" data-id="' + c.id + '">' + inner + '</g>';
    if (c.kind === 'diode') {
      const u = unit(c.a, c.k), n = [-u[1], u[0]];
      const P = (t, s) => [c.c[0] + u[0] * t + n[0] * s, c.c[1] + u[1] * t + n[1] * s].map(f1).join(',');
      let s = '<path class="st" d="M' + f1(c.a[0]) + ',' + f1(c.a[1]) + ' L' + P(-10, 0) + ' M' + P(10, 0) + ' L' + f1(c.k[0]) + ',' + f1(c.k[1]) + '"/>';
      s += '<path class="st fl" d="M' + P(-10, 9) + ' L' + P(-10, -9) + ' L' + P(10, 0) + ' Z"/>';
      s += '<path class="st" d="M' + P(10, 9) + ' L' + P(10, -9) + '"/>';
      if (c.scr) {
        s += '<path class="st" d="M' + P(0, 4.5 * c.gs) + ' L' + P(8, 16 * c.gs) + '"/>';
        s += '<text class="lbl gate" x="' + P(8, 23 * c.gs).split(',')[0] + '" y="' + (parseFloat(P(8, 23 * c.gs).split(',')[1]) + 4) + '" text-anchor="middle">G</text>';
      }
      return g('dev' + (c.id === 'DF' ? ' fwd' : ''), s);
    }
    if (c.kind === 'acsrc') {
      const r = c.r, x = c.c[0], y = c.c[1];
      const sw = r * 0.55;
      return g('src', '<circle class="st" cx="' + x + '" cy="' + y + '" r="' + r + '"/><path class="st" d="M' + f1(x - sw) + ',' + y + ' q' + f1(sw / 2) + ',' + f1(-r * 0.62) + ' ' + f1(sw) + ',0 t' + f1(sw) + ',0"/>');
    }
    if (c.kind === 'res') {
      const x = c.p1[0], y0 = c.p1[1], y1 = c.p2[1], b0 = y0 + 8, b1 = y1 - 8, n = 6, dy = (b1 - b0) / n;
      let d = 'M' + x + ',' + y0 + ' L' + x + ',' + b0;
      for (let i = 0; i < n; i++) d += ' L' + (x + (i % 2 === 0 ? 8 : -8)) + ',' + f1(b0 + dy * (i + 0.5));
      d += ' L' + x + ',' + b1 + ' L' + x + ',' + y1;
      return g('load res', '<path class="st" d="' + d + '"/>');
    }
    if (c.kind === 'ind') {
      const x = c.p1[0], y0 = c.p1[1], y1 = c.p2[1], b0 = y0 + 8, b1 = y1 - 8, n = 4, dy = (b1 - b0) / n, r = dy / 2;
      let d = 'M' + x + ',' + y0 + ' L' + x + ',' + b0;
      for (let i = 0; i < n; i++) d += ' A' + f1(r) + ',' + f1(r) + ' 0 0 1 ' + x + ',' + f1(b0 + dy * (i + 1));
      d += ' L' + x + ',' + y1;
      return g('load ind', '<path class="st" d="' + d + '"/>');
    }
    if (c.kind === 'bat') {
      const x = c.p1[0], y0 = c.p1[1], y1 = c.p2[1], m = (y0 + y1) / 2;
      return g('load bat', '<path class="st" d="M' + x + ',' + y0 + ' L' + x + ',' + (m - 4) + ' M' + (x - 12) + ',' + (m - 4) + ' L' + (x + 12) + ',' + (m - 4) + ' M' + x + ',' + (m + 4) + ' L' + x + ',' + y1 + ' M' + (x - 6) + ',' + (m + 4) + ' L' + (x + 6) + ',' + (m + 4) + '"/><text class="lbl sign" x="' + (x - 15) + '" y="' + (m - 6) + '" text-anchor="end">+</text>');
    }
    if (c.kind === 'xfmr') {
      const coil = (x, y0, y1, n, side) => {
        const dy = (y1 - y0) / n, r = dy / 2;
        let d = 'M' + x + ',' + y0;
        for (let i = 0; i < n; i++) d += ' A' + f1(r) + ',' + f1(r) + ' 0 0 ' + (side > 0 ? 1 : 0) + ' ' + x + ',' + f1(y0 + dy * (i + 1));
        return '<path class="st" d="' + d + '"/>';
      };
      return g('xfmr', coil(c.px, c.p1[1], c.p2[1], 4, 1) + coil(c.sx, c.s1[1], c.s2[1], 6, 0) +
        '<path class="st" d="M' + c.cx1 + ',' + (c.s1[1] - 6) + ' L' + c.cx1 + ',' + (c.s2[1] + 6) + ' M' + c.cx2 + ',' + (c.s1[1] - 6) + ' L' + c.cx2 + ',' + (c.s2[1] + 6) + '"/>');
    }
    return '';
  }

  function renderSVG(S) {
    const segs = wireSegments(S);
    // hop-overs where a horizontal wire crosses a vertical wire or component lead (not at a joint)
    const vert = [];
    segs.forEach(s => { if (s.p[0] === s.q[0]) vert.push([s.p, s.q]); });
    S.comps.forEach(c => leadSegs(c).forEach(l => { if (l[0][0] === l[1][0]) vert.push(l); }));
    let wires = '';
    segs.forEach(s => {
      if (s.p[1] !== s.q[1]) { wires += '<path class="w" d="M' + s.p[0] + ',' + s.p[1] + ' L' + s.q[0] + ',' + s.q[1] + '"/>'; return; }
      const y = s.p[1], xa = Math.min(s.p[0], s.q[0]), xb = Math.max(s.p[0], s.q[0]);
      const hops = [];
      vert.forEach(v => {
        const x = v[0][0], ya = Math.min(v[0][1], v[1][1]), yb = Math.max(v[0][1], v[1][1]);
        if (x > xa + 7 && x < xb - 7 && y > ya + 0.5 && y < yb - 0.5) hops.push(x);
      });
      hops.sort((a, b) => a - b);
      let d = 'M' + xa + ',' + y;
      hops.forEach(x => { d += ' L' + (x - 6) + ',' + y + ' A6,6 0 0 1 ' + (x + 6) + ',' + y; });
      d += ' L' + xb + ',' + y;
      wires += '<path class="w" d="' + d + '"/>';
    });
    // junction dots
    const deg = new Map();
    const bump = (p, n) => deg.set(key(p), (deg.get(key(p)) || 0) + n);
    S.wires.forEach(w => w.pts.forEach((p, i) => bump(p, i === 0 || i === w.pts.length - 1 ? 1 : 2)));
    S.pins.forEach(p => bump(p, 1));
    let dots = '';
    deg.forEach((n, k) => { if (n >= 3) { const [x, y] = k.split(','); dots += '<circle class="dot" cx="' + x + '" cy="' + y + '" r="3.2"/>'; } });
    // arrows
    let arrows = '';
    S.arrows.forEach(a => { arrows += '<path class="arrow" d="M' + (a.x - 7) + ',' + (a.y - 4.5) + ' L' + (a.x + 5) + ',' + a.y + ' L' + (a.x - 7) + ',' + (a.y + 4.5) + ' Z"/>'; });
    const comps = S.comps.map(renderComp).join('');
    const texts = S.texts.map(t => '<text class="' + t.cls + '" x="' + t.x + '" y="' + t.y + '" text-anchor="' + t.anchor + '">' + esc(t.s) + '</text>').join('');
    return '<svg class="sch" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S.w + ' ' + S.h + '" role="img" aria-label="' + esc(S.title) + ' schematic">' +
      '<g class="wires">' + wires + '</g><g class="flow"></g><g class="comps">' + comps + '</g><g class="dots">' + dots + '</g><g class="arrows">' + arrows + '</g><g class="texts">' + texts + '</g></svg>';
  }

  const api = { buildSchematic, renderSVG, extractNets, checkLayout, routeFor, W, H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RL = root.RL || {}; root.RL.schematic = api; }
})(typeof window !== 'undefined' ? window : globalThis);
