/* plots.js — canvas waveform panels, conduction timing chart and harmonic bar chart.
 * Each panel caches its static drawing (axes, traces) in an offscreen bitmap; the moving cursor and
 * hover crosshair are drawn on top, so animation stays smooth.
 */
(function (root) {
  'use strict';

  const M = { l: 58, r: 12, t: 10, b: 24 };

  function niceStep(range, target) {
    const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function fmtTick(v, step) {
    if (Math.abs(v) < step * 1e-6) return '0';
    const d = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
    return v.toFixed(d);
  }
  function theme(el) {
    const cs = getComputedStyle(el);
    const g = n => cs.getPropertyValue(n).trim();
    return {
      surface: g('--plot-bg'), grid: g('--plot-grid'), axis: g('--plot-axis'), text: g('--text-2'), ink: g('--text'),
      cursor: g('--cursor'), accent: g('--accent'), dim: g('--plot-dim'),
      vs: [g('--c-a'), g('--c-b'), g('--c-c'), g('--c-d'), g('--c-e'), g('--c-f')],
      vo: g('--c-vo'), io: g('--c-io'), id: g('--c-id'), vd: g('--c-vd'), fwd: g('--c-fwd'), bar: g('--c-bar')
    };
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    return { dpr, w, h };
  }

  /* ------------------------------------------------------------ line panels */
  class LinePanel {
    constructor(canvas) {
      this.canvas = canvas; this.spec = null; this.base = document.createElement('canvas');
      this.dirty = true; this.theta = null;
    }
    set(spec) { this.spec = spec; this.dirty = true; }
    invalidate() { this.dirty = true; }
    plotRect() { const { w, h } = setupCanvas(this.canvas); return { x0: M.l, x1: w - M.r, y0: M.t, y1: h - M.b, w, h }; }
    xToIndex(px) {
      const r = this.plotRect(), N = this.spec.N;
      const f = (px - r.x0) / (r.x1 - r.x0);
      return Math.max(0, Math.min(N - 1, Math.round(f * N - 0.5)));
    }
    yRange() {
      const s = this.spec; let lo = 0, hi = 0;
      s.series.forEach(se => { const d = se.data; for (let i = 0; i < d.length; i += 2) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; } });
      (s.hlines || []).forEach(l => { lo = Math.min(lo, l.y); hi = Math.max(hi, l.y); });
      if (hi - lo < 1e-9) { hi = lo + 1; }
      const pad = (hi - lo) * 0.08;
      if (hi > 0) hi += pad; if (lo < 0) lo -= pad;
      return [lo, hi];
    }
    drawBase() {
      const { dpr, w, h } = setupCanvas(this.canvas);
      this.base.width = this.canvas.width; this.base.height = this.canvas.height;
      const ctx = this.base.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const T = theme(this.canvas), s = this.spec;
      ctx.fillStyle = T.surface; ctx.fillRect(0, 0, w, h);
      const x0 = M.l, x1 = w - M.r, y0 = M.t, y1 = h - M.b;
      const [lo, hi] = this.yRange();
      this.lo = lo; this.hi = hi;
      const X = th => x0 + (x1 - x0) * th / 360, Y = v => y1 - (y1 - y0) * (v - lo) / (hi - lo);
      this.X = X; this.Y = Y;
      ctx.font = '11px ' + getComputedStyle(this.canvas).getPropertyValue('--font-num');
      ctx.textBaseline = 'middle';
      // y grid
      const step = niceStep(hi - lo, Math.max(3, Math.floor((y1 - y0) / 34)));
      ctx.lineWidth = 1;
      for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = Math.abs(v) < step * 1e-6 ? T.axis : T.grid;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillStyle = T.text; ctx.textAlign = 'right'; ctx.fillText(fmtTick(v, step), x0 - 7, y);
      }
      // x grid
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let th = 0; th <= 360; th += 30) {
        const x = Math.round(X(th)) + 0.5, major = th % 60 === 0;
        ctx.strokeStyle = major ? T.grid : T.dim; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        if (major) { ctx.fillStyle = T.text; ctx.fillText(th + '°', x, y1 + 6); }
      }
      // frame
      ctx.strokeStyle = T.axis; ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
      // hlines (averages)
      (s.hlines || []).forEach(l => {
        ctx.strokeStyle = l.color; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
        const y = Math.round(Y(l.y)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        const tw = ctx.measureText(l.label).width;
        ctx.fillStyle = T.surface; ctx.globalAlpha = 0.85; ctx.fillRect(x1 - tw - 10, y - 17, tw + 8, 15); ctx.globalAlpha = 1;
        ctx.fillStyle = T.ink; ctx.fillText(l.label, x1 - 6, y - 3);
      });
      // traces
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0 - 1, x1 - x0, y1 - y0 + 2); ctx.clip();
      s.series.forEach(se => {
        ctx.strokeStyle = se.color; ctx.lineWidth = se.width || 1.8; ctx.lineJoin = 'round';
        ctx.setLineDash(se.dash || []);
        ctx.beginPath();
        const d = se.data, N = d.length;
        for (let i = 0; i < N; i++) {
          const th = (i + 0.5) * 360 / N, x = X(th), y = Y(d[i]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.setLineDash([]);
      });
      ctx.restore();
      this.dirty = false;
    }
    draw(cursor, hover) {
      if (!this.spec) return;
      const { dpr, w, h } = setupCanvas(this.canvas);
      if (this.dirty || this.base.width !== this.canvas.width || this.base.height !== this.canvas.height) this.drawBase();
      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const T = theme(this.canvas), N = this.spec.N, y0 = M.t, y1 = h - M.b;
      const mark = (idx, color, dots, dash) => {
        const x = Math.round(this.X((idx + 0.5) * 360 / N)) + 0.5;
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash || []);
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]);
        if (dots) this.spec.series.forEach(se => {
          const y = this.Y(se.data[idx]);
          ctx.fillStyle = se.color; ctx.strokeStyle = T.surface; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.2832); ctx.stroke(); ctx.fill();
        });
      };
      if (hover !== null && hover !== undefined) mark(hover, T.dim === T.grid ? T.axis : T.text, false, [3, 3]);
      if (cursor !== null && cursor !== undefined) mark(cursor, T.cursor, true);
    }
  }

  /* ------------------------------------------------------------ conduction timing (Gantt) */
  class GanttPanel {
    constructor(canvas) { this.canvas = canvas; this.spec = null; this.base = document.createElement('canvas'); this.dirty = true; }
    set(spec) { this.spec = spec; this.dirty = true; }
    invalidate() { this.dirty = true; }
    xToIndex(px) {
      const { w } = setupCanvas(this.canvas), N = this.spec.N, f = (px - M.l) / (w - M.r - M.l);
      return Math.max(0, Math.min(N - 1, Math.round(f * N - 0.5)));
    }
    drawBase() {
      const { dpr, w, h } = setupCanvas(this.canvas);
      this.base.width = this.canvas.width; this.base.height = this.canvas.height;
      const ctx = this.base.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const T = theme(this.canvas), s = this.spec, N = s.N;
      ctx.fillStyle = T.surface; ctx.fillRect(0, 0, w, h);
      const x0 = M.l, x1 = w - M.r, y0 = M.t, y1 = h - M.b, rows = s.rows.length;
      const rh = (y1 - y0) / rows, X = th => x0 + (x1 - x0) * th / 360;
      ctx.font = '11px ' + getComputedStyle(this.canvas).getPropertyValue('--font-num');
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let th = 0; th <= 360; th += 30) {
        const x = Math.round(X(th)) + 0.5, major = th % 60 === 0;
        ctx.strokeStyle = major ? T.grid : T.dim; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        if (major) { ctx.fillStyle = T.text; ctx.fillText(th + '°', x, y1 + 6); }
      }
      s.rows.forEach((r, i) => {
        const yt = y0 + i * rh, yb = yt + rh;
        ctx.strokeStyle = T.grid; ctx.beginPath(); ctx.moveTo(x0, Math.round(yb) + 0.5); ctx.lineTo(x1, Math.round(yb) + 0.5); ctx.stroke();
        ctx.fillStyle = T.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(r.label, x0 - 8, yt + rh / 2);
        // conduction bars (merge consecutive samples)
        ctx.fillStyle = r.color;
        let start = -1;
        for (let n = 0; n <= N; n++) {
          const v = n < N ? r.on[n] : 0;
          if (v && start < 0) start = n;
          if (!v && start >= 0) {
            const xa = X(start * 360 / N), xb = X(n * 360 / N);
            ctx.fillRect(xa, yt + rh * 0.22, Math.max(1, xb - xa), rh * 0.56);
            start = -1;
          }
        }
        // wrap-around join is already continuous because bars end at 360° and restart at 0°
        // gate pulse starts
        if (r.gate) {
          ctx.fillStyle = T.ink;
          for (let n = 0; n < N; n++) {
            const prev = r.gate[(n + N - 1) % N];
            if (r.gate[n] && !prev) {
              const x = X(n * 360 / N);
              ctx.beginPath(); ctx.moveTo(x, yt + rh * 0.12); ctx.lineTo(x + 4, yt + rh * 0.12 - 0); ctx.lineTo(x, yt + rh * 0.12 + 5); ctx.closePath(); ctx.fill();
            }
          }
        }
      });
      ctx.strokeStyle = T.axis; ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
      this.X = X; this.dirty = false;
    }
    draw(cursor, hover) {
      if (!this.spec) return;
      const { dpr, w, h } = setupCanvas(this.canvas);
      if (this.dirty || this.base.width !== this.canvas.width) this.drawBase();
      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const T = theme(this.canvas), N = this.spec.N;
      const mark = (idx, color, dash) => {
        const x = Math.round(this.X((idx + 0.5) * 360 / N)) + 0.5;
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash || []);
        ctx.beginPath(); ctx.moveTo(x, M.t); ctx.lineTo(x, h - M.b); ctx.stroke(); ctx.setLineDash([]);
      };
      if (hover !== null && hover !== undefined) mark(hover, T.text, [3, 3]);
      if (cursor !== null && cursor !== undefined) mark(cursor, T.cursor);
    }
  }

  /* ------------------------------------------------------------ harmonic spectrum */
  class BarPanel {
    constructor(canvas) { this.canvas = canvas; this.spec = null; this.hover = -1; }
    set(spec) { this.spec = spec; this.draw(); }
    hit(px) {
      const { w } = setupCanvas(this.canvas), n = this.spec.values.length;
      const x0 = M.l, x1 = w - M.r, f = (px - x0) / (x1 - x0);
      return Math.max(0, Math.min(n - 1, Math.floor(f * n)));
    }
    draw() {
      if (!this.spec) return;
      const { dpr, w, h } = setupCanvas(this.canvas);
      const ctx = this.canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const T = theme(this.canvas), s = this.spec, vals = s.values, n = vals.length;
      ctx.fillStyle = T.surface; ctx.fillRect(0, 0, w, h);
      const x0 = M.l, x1 = w - M.r, y0 = M.t + 4, y1 = h - M.b;
      let hi = 0; vals.forEach(v => { if (v > hi) hi = v; }); if (hi <= 0) hi = 1; hi *= 1.1;
      const Y = v => y1 - (y1 - y0) * v / hi, bw = (x1 - x0) / n;
      ctx.font = '11px ' + getComputedStyle(this.canvas).getPropertyValue('--font-num');
      const step = niceStep(hi, 4);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
      for (let v = 0; v <= hi; v += step) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = v === 0 ? T.axis : T.grid; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.fillStyle = T.text; ctx.fillText(fmtTick(v, step), x0 - 7, y);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      vals.forEach((v, i) => {
        const x = x0 + i * bw;
        ctx.fillStyle = i === this.hover ? T.cursor : s.color;
        const top = Y(v);
        ctx.fillRect(x + bw * 0.18, top, Math.max(1, bw * 0.64), y1 - top);
        if (n <= 30 ? true : i % 2 === 0) { ctx.fillStyle = T.text; ctx.fillText(i === 0 ? 'DC' : String(i), x + bw / 2, y1 + 6); }
      });
      ctx.strokeStyle = T.axis; ctx.beginPath(); ctx.moveTo(x0, y1 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke();
    }
  }

  const api = { LinePanel, GanttPanel, BarPanel, theme };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RL = root.RL || {}; root.RL.plots = api; }
})(typeof window !== 'undefined' ? window : globalThis);
