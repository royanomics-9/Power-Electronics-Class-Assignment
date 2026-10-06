/* theory.js — closed-form reference results and per-circuit theory notes. */
(function (root) {
  'use strict';
  const C = typeof require !== 'undefined' ? require('./circuits.js') : root.RL.circuits;

  /* Average output voltage in closed form, or null when no closed form exists
   * (finite L with discontinuous current, or any load with a back-emf E > 0 and L = 0). */
  function analyticVavg(cfg) {
    const def = C.circuitDef(cfg.phases, cfg.topo, cfg.device);
    const p = def.pulses;
    const Vm = Math.SQRT2 * cfg.Vrms;
    const VmEff = (def.phases === 3 && def.bridge) ? Math.sqrt(3) * Vm : Vm;
    const a = (def.controlled ? cfg.alpha : 0) * Math.PI / 180;
    const Linf = !!cfg.Linf, L = cfg.L || 0, E = cfg.E || 0;
    const isR = !Linf && L === 0 && E === 0;
    if (!isR && !Linf) return null;

    const resistive = () => {
      if (p === 1) return VmEff * (1 + Math.cos(a)) / (2 * Math.PI);
      const t0 = Math.PI / 2 - Math.PI / p;
      if (a + t0 >= Math.PI) return 0; // fired after its phase voltage has already reversed: no conduction
      if (a <= t0 + 1e-12) return p / Math.PI * VmEff * Math.sin(Math.PI / p) * Math.cos(a);
      return p * VmEff / (2 * Math.PI) * (1 + Math.cos(a + t0));
    };
    if (isR) return { value: resistive(), basis: 'resistive load' };
    if (cfg.fwd) return { value: resistive(), basis: 'ideal inductor with freewheeling diode' };
    if (p === 1) return { value: 0, basis: 'ideal inductor, no freewheeling diode' };
    return { value: p / Math.PI * VmEff * Math.sin(Math.PI / p) * Math.cos(a), basis: 'ideal inductor, continuous current' };
  }

  const NOTES = {
    '1ph-HW': {
      how: 'One device conducts only while the supply is positive (and, for a thyristor, after the gate pulse at α). With an inductive load the current outlives the positive half-cycle and the output voltage goes negative until the current dies out; a freewheeling diode removes that negative part.',
      rows: [
        ['Vavg, diode, R load', 'Vm / π  ≈ 0.318 Vm'],
        ['Vrms, diode, R load', 'Vm / 2'],
        ['Vavg, thyristor, R load', 'Vm (1 + cos α) / 2π'],
        ['Ripple factor (diode, R)', '1.21'],
        ['Peak inverse voltage', 'Vm'],
        ['Device conduction', '≤ 180°, once per cycle']
      ]
    },
    '1ph-FW': {
      how: 'The centre-tapped secondary feeds two devices in alternate half-cycles, so both half-cycles reach the load. The two diodes block twice the half-winding voltage. The supply current is an AC square-ish wave with no DC component in the primary.',
      rows: [
        ['Vavg, diode, R load', '2Vm / π  ≈ 0.637 Vm'],
        ['Vrms, diode, R load', 'Vm / √2'],
        ['Vavg, thyristor, R load', 'Vm (1 + cos α) / π'],
        ['Vavg, thyristor, L → ∞', '(2Vm / π) cos α'],
        ['Ripple factor (diode, R)', '0.483'],
        ['Peak inverse voltage', '2Vm']
      ]
    },
    '1ph-DBR': {
      how: 'Two diode pairs (D1-D2, D3-D4) take turns conducting, so the full supply voltage is rectified without a centre tap. Each diode blocks only Vm.',
      rows: [
        ['Vavg, R load', '2Vm / π  ≈ 0.637 Vm'],
        ['Vrms, R load', 'Vm / √2'],
        ['Ripple factor (R load)', '0.483'],
        ['Peak inverse voltage', 'Vm'],
        ['Supply current, L → ∞', 'square wave ±Id, THD 48.3 %'],
        ['Power factor, L → ∞', '0.900 (= 2√2/π)']
      ]
    },
    '1ph-TCR': {
      how: 'Pairs T1-T2 and T3-T4 are fired at α after each zero crossing. With a highly inductive load the current is continuous and the output voltage is negative between the zero crossing and α, so the average falls as cos α and becomes negative (inverter operation) beyond 90° if a source E is present.',
      rows: [
        ['Vavg, L → ∞, continuous', '(2Vm / π) cos α'],
        ['Vavg, R load', 'Vm (1 + cos α) / π'],
        ['Vavg, with freewheeling diode', 'Vm (1 + cos α) / π'],
        ['Peak inverse voltage', 'Vm'],
        ['Displacement factor, L → ∞', 'cos α'],
        ['Power factor, L → ∞', '(2√2 / π) cos α']
      ]
    },
    '3ph-HW': {
      how: 'The device whose phase voltage is highest conducts for 120° (diodes). Each phase current carries a DC component, which is why this circuit needs a neutral and is used mainly for teaching and low-power work. Thyristors are fired α after the natural commutation point (30° after the phase zero crossing).',
      rows: [
        ['Vavg, diode', '3√3 Vm / 2π  ≈ 0.827 Vm'],
        ['Vavg, thyristor, α ≤ 30° (R) or L → ∞', '(3√3 Vm / 2π) cos α'],
        ['Vavg, R load, α > 30°', '(3Vm / 2π) [1 + cos(α + 30°)]'],
        ['Output ripple frequency', '3 × supply'],
        ['Peak inverse voltage', '√3 Vm'],
        ['Device conduction', '120°']
      ]
    },
    '3ph-FW': {
      how: 'Three centre-tapped secondary windings give a six-phase star; each of the six devices conducts for 60°. The output has six pulses per cycle, so ripple is small, but every device blocks 2Vm and carries current for only one sixth of the cycle.',
      rows: [
        ['Vavg, diode', '3Vm / π  ≈ 0.955 Vm'],
        ['Vavg, thyristor, α ≤ 60° (R) or L → ∞', '(3Vm / π) cos α'],
        ['Vavg, R load, α > 60°', '(3Vm / π) [1 + cos(α + 60°)]'],
        ['Output ripple frequency', '6 × supply'],
        ['Peak inverse voltage', '2Vm'],
        ['Device conduction', '60°']
      ]
    },
    '3ph-DBR': {
      how: 'The top diode with the highest phase voltage and the bottom diode with the lowest phase voltage conduct together, so the output follows the highest line-to-line voltage. Each diode conducts for 120° and the line current is a 120° quasi-square wave.',
      rows: [
        ['Vavg', '3√3 Vm / π ≈ 1.654 Vm = 2.34 Vs'],
        ['Vrms', '1.655 Vm'],
        ['Output ripple frequency', '6 × supply'],
        ['Peak inverse voltage', '√3 Vm'],
        ['Line current, L → ∞', '120° blocks of ±Id, rms √(2/3) Id, THD 31 %'],
        ['Power factor, L → ∞', '3/π = 0.955']
      ]
    },
    '3ph-TCR': {
      how: 'Thyristors are fired in the order T1…T6 at 60° intervals, each α after its natural point. A double (wide) gate pulse makes sure two devices start together when the current is discontinuous. For α > 90° with a source E the converter inverts.',
      rows: [
        ['Vavg, L → ∞, continuous', '(3√3 Vm / π) cos α'],
        ['Vavg, R load, α > 60°', '(3√3 Vm / π) [1 + cos(α + 60°)]'],
        ['Zero-output firing angle (R load)', '120°'],
        ['Peak inverse voltage', '√3 Vm'],
        ['Displacement factor, L → ∞', 'cos α'],
        ['Power factor, L → ∞', '(3/π) cos α']
      ]
    }
  };

  function notesFor(def) { return NOTES[def.phases + 'ph-' + def.topo]; }

  const api = { analyticVavg, notesFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RL = root.RL || {}; root.RL.theory = api; }
})(typeof window !== 'undefined' ? window : globalThis);
