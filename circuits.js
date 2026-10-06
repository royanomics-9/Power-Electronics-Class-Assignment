/* circuits.js — topology definitions for the eight rectifier circuits.
 *
 * Every circuit is described by:
 *   - u(θ)       : the source-node voltages (relative to the neutral / return node)
 *   - devices    : each device is either in the "top" group (common-cathode, anode on a
 *                  source node, cathode on the output node P) or in the "bot" group
 *                  (common-anode, cathode on a source node, anode on the output node N)
 *   - nat        : natural-commutation angle of the device (α = 0 reference), degrees
 *   - channels   : how the source / line currents are formed from node currents
 *   - netlist()  : an independent, hand-written connectivity list used by the tests to
 *                  prove that the drawn schematic and the simulated model are the same circuit.
 */
(function (root) {
  'use strict';

  const TOPOLOGIES = {
    HW:  { short: 'HW',  name: 'Half-wave' },
    FW:  { short: 'FW',  name: 'Full-wave' },
    DBR: { short: 'DBR', name: 'Diode bridge' },
    TCR: { short: 'TCR', name: 'Thyristor bridge' }
  };

  function circuitDef(phases, topo, device) {
    const dev = topo === 'DBR' ? 'diode' : topo === 'TCR' ? 'scr' : (device === 'scr' ? 'scr' : 'diode');
    const pre = dev === 'scr' ? 'T' : 'D';
    const controlled = dev === 'scr';
    const key = phases + 'ph-' + topo;
    const dv = (n, group, node, nat) => ({ id: pre + n, group, node, nat, kind: dev });
    let d;

    if (phases === 1 && topo === 'HW') {
      d = {
        pulses: 1, bridge: false, nodes: ['A'],
        u: (th, Vm) => [Vm * Math.sin(th)],
        devices: [dv(1, 'top', 0, 0)],
        plotSources: [{ name: 'vs', k: 0 }],
        channels: [{ name: 'is', terms: [[0, 1]] }],
        gateWidth: 30,
        title: 'Single-phase half-wave rectifier',
        sourceNote: 'Vs = rms of the supply voltage',
        vmFactor: 1
      };
    } else if (phases === 1 && topo === 'FW') {
      d = {
        pulses: 2, bridge: false, nodes: ['A1', 'A2'],
        u: (th, Vm) => { const v = Vm * Math.sin(th); return [v, -v]; },
        devices: [dv(1, 'top', 0, 0), dv(2, 'top', 1, 180)],
        plotSources: [{ name: 'vs1', k: 0 }, { name: 'vs2', k: 1 }],
        channels: [{ name: 'is', terms: [[0, 1], [1, -1]], label: 'is (primary, 1:1 per half)' }],
        gateWidth: 30,
        title: 'Single-phase full-wave rectifier (centre-tapped transformer)',
        sourceNote: 'Vs = rms of each secondary half',
        vmFactor: 1
      };
    } else if (phases === 1) {
      d = {
        pulses: 2, bridge: true, nodes: ['A', 'B'],
        u: (th, Vm) => [Vm * Math.sin(th), 0],
        devices: [dv(1, 'top', 0, 0), dv(2, 'bot', 1, 0), dv(3, 'top', 1, 180), dv(4, 'bot', 0, 180)],
        plotSources: [{ name: 'vs', k: 0 }],
        channels: [{ name: 'is', terms: [[0, 1]] }],
        gateWidth: 30,
        title: topo === 'DBR' ? 'Single-phase diode bridge rectifier' : 'Single-phase thyristor-controlled bridge rectifier',
        sourceNote: 'Vs = rms of the supply voltage',
        vmFactor: 1
      };
    } else if (topo === 'HW') {
      d = {
        pulses: 3, bridge: false, nodes: ['a', 'b', 'c'],
        u: (th, Vm) => [Vm * Math.sin(th), Vm * Math.sin(th - 2 * Math.PI / 3), Vm * Math.sin(th - 4 * Math.PI / 3)],
        devices: [dv(1, 'top', 0, 30), dv(2, 'top', 1, 150), dv(3, 'top', 2, 270)],
        plotSources: [{ name: 'va', k: 0 }, { name: 'vb', k: 1 }, { name: 'vc', k: 2 }],
        channels: [{ name: 'ia', terms: [[0, 1]] }, { name: 'ib', terms: [[1, 1]] }, { name: 'ic', terms: [[2, 1]] }],
        gateWidth: 30,
        title: 'Three-phase half-wave rectifier (3-pulse)',
        sourceNote: 'Vs = rms phase voltage (star source with neutral)',
        vmFactor: 1
      };
    } else if (topo === 'FW') {
      d = {
        pulses: 6, bridge: false, nodes: ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'],
        u: (th, Vm) => [0, 1, 2, 3, 4, 5].map(k => Vm * Math.sin(th - k * Math.PI / 3)),
        devices: [0, 1, 2, 3, 4, 5].map(k => dv(k + 1, 'top', k, (60 + 60 * k) % 360)),
        plotSources: [{ name: 'va', k: 0 }, { name: 'vb', k: 2 }, { name: 'vc', k: 4 }],
        channels: [
          { name: 'ia', terms: [[0, 1], [3, -1]], label: 'ia (winding a)' },
          { name: 'ib', terms: [[2, 1], [5, -1]], label: 'ib (winding b)' },
          { name: 'ic', terms: [[4, 1], [1, -1]], label: 'ic (winding c)' }
        ],
        gateWidth: 30,
        title: 'Three-phase full-wave rectifier (6-pulse, centre-tapped windings)',
        sourceNote: 'Vs = rms voltage of each half-winding (six-phase star)',
        vmFactor: 1
      };
    } else {
      d = {
        pulses: 6, bridge: true, nodes: ['a', 'b', 'c'],
        u: (th, Vm) => [Vm * Math.sin(th), Vm * Math.sin(th - 2 * Math.PI / 3), Vm * Math.sin(th - 4 * Math.PI / 3)],
        devices: [dv(1, 'top', 0, 30), dv(2, 'bot', 2, 90), dv(3, 'top', 1, 150),
                  dv(4, 'bot', 0, 210), dv(5, 'top', 2, 270), dv(6, 'bot', 1, 330)],
        plotSources: [{ name: 'va', k: 0 }, { name: 'vb', k: 1 }, { name: 'vc', k: 2 }],
        channels: [{ name: 'ia', terms: [[0, 1]] }, { name: 'ib', terms: [[1, 1]] }, { name: 'ic', terms: [[2, 1]] }],
        gateWidth: 80, // double-pulse equivalent: lets a discontinuous bridge start with two devices
        title: topo === 'DBR' ? 'Three-phase diode bridge rectifier (6-pulse)' : 'Three-phase thyristor-controlled bridge rectifier (6-pulse)',
        sourceNote: 'Vs = rms phase voltage (star source, line voltage = √3·Vs)',
        vmFactor: 1
      };
    }
    d.key = key;
    d.phases = phases;
    d.topo = topo;
    d.deviceType = dev;
    d.controlled = controlled;
    d.name = TOPOLOGIES[topo].short + ' · ' + phases + 'φ';
    d.devices.forEach(x => { x.top = x.group === 'top'; });
    return d;
  }

  /* ---------- load chain: R, then L (if present), then E (if present), top → bottom ---------- */
  function loadChain(load) {
    const chain = [{ name: 'R', p1: 'R.1', p2: 'R.2' }];
    if (load.Linf || load.L > 0) chain.push({ name: 'L', p1: 'L.1', p2: 'L.2' });
    if (load.E > 0) chain.push({ name: 'E', p1: 'E.p', p2: 'E.n' });
    return chain;
  }

  /* ---------- hand-written connectivity (pin-name nets) ---------- */
  function netlist(def, load, fwd) {
    const chain = loadChain(load);
    const top = chain[0].p1, bot = chain[chain.length - 1].p2;
    const nets = [];
    for (let i = 0; i < chain.length - 1; i++) nets.push([chain[i].p2, chain[i + 1].p1]);
    const P = [top], N = [bot];
    if (fwd) { P.push('DF.k'); N.push('DF.a'); }
    const id = k => def.devices[k].id;
    const D = n => def.devices.find(x => x.id === def.devices[0].id.charAt(0) + n).id;

    const k = def.key;
    if (k === '1ph-HW') {
      nets.push(['S0.p', id(0) + '.a']);
      P.push(id(0) + '.k');
      N.push('S0.n');
    } else if (k === '1ph-FW') {
      nets.push(['SRC.p', 'TX.p1'], ['SRC.n', 'TX.p2']);
      nets.push(['TX.s1', D(1) + '.a'], ['TX.s2', D(2) + '.a']);
      P.push(D(1) + '.k', D(2) + '.k');
      N.push('TX.ct');
    } else if (k === '1ph-DBR' || k === '1ph-TCR') {
      nets.push(['S0.p', D(1) + '.a', D(4) + '.k']);
      nets.push(['S0.n', D(3) + '.a', D(2) + '.k']);
      P.push(D(1) + '.k', D(3) + '.k');
      N.push(D(4) + '.a', D(2) + '.a');
    } else if (k === '3ph-HW') {
      for (let i = 0; i < 3; i++) { nets.push(['S' + i + '.p', D(i + 1) + '.a']); P.push(D(i + 1) + '.k'); N.push('S' + i + '.n'); }
    } else if (k === '3ph-FW') {
      for (let i = 0; i < 6; i++) { nets.push(['S' + i + '.p', D(i + 1) + '.a']); P.push(D(i + 1) + '.k'); N.push('S' + i + '.n'); }
    } else { // 3-phase bridge
      nets.push(['S0.p', D(1) + '.a', D(4) + '.k']);
      nets.push(['S1.p', D(3) + '.a', D(6) + '.k']);
      nets.push(['S2.p', D(5) + '.a', D(2) + '.k']);
      nets.push(['S0.n', 'S1.n', 'S2.n']);
      P.push(D(1) + '.k', D(3) + '.k', D(5) + '.k');
      N.push(D(4) + '.a', D(6) + '.a', D(2) + '.a');
    }
    nets.push(P, N);
    return nets;
  }

  const api = { TOPOLOGIES, circuitDef, loadChain, netlist };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RL = root.RL || {}; root.RL.circuits = api; }
})(typeof window !== 'undefined' ? window : globalThis);
