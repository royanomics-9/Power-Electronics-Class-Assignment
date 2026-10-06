# Rectifier Lab

Developed by Tahiti Roy (Roll no. 24EE10100).

Interactive simulator for eight rectifier circuits: **{1-phase, 3-phase} × {HW, FW, DBR, TCR}**.
Each circuit has its own schematic (with an animated current path), synchronised waveforms, harmonic spectra, measured results, formulas and a live accuracy check.

| | HW half-wave | FW full-wave | DBR diode bridge | TCR thyristor bridge |
|---|---|---|---|---|
| 1-phase | 1 pulse | 2 pulse (centre-tapped) | 2 pulse | 2 pulse |
| 3-phase | 3 pulse | 6 pulse (six-phase star) | 6 pulse | 6 pulse |

HW and FW can use diodes or thyristors. Loads: R, R+L, R+L+E, ideal inductor (L→∞), optional freewheeling diode.

## Run

No build step and no dependencies.

- Open `index.html` directly in a browser, or
- `npm start` (Node ≥ 18) and visit http://localhost:8080 (see `tools/serve.js` for the port).

## Deploy

It is a static site; publish the folder as is.

- **GitHub Pages:** push to GitHub, then Settings → Pages → Source: GitHub Actions. `.github/workflows/pages.yml` runs the tests and publishes.
- **Netlify:** import the repo; `netlify.toml` is already configured (publish directory = root, no build command).
- Any static host works (S3, nginx, Cloudflare Pages).

## Test

```
npm test          # engine (893), schematic (1584), file/structure (77) checks
npm run test:ui   # 155 browser checks (needs: pip install playwright, Chromium)
npm run test:all
```

What is verified: closed-form average voltages for every circuit (many α, R and L→∞ loads, with and without freewheeling diode); power balance; KCL; conduction angles and device currents; PF, THD, DPF, PIV; schematic connectivity read back from the drawing equals the circuit netlist; every conduction state has a drawable current loop; every control exercised in a real browser.

## Model and limits

- Ideal sources and switches: no source inductance (instant commutation, no overlap), no device drops.
- Load is R, L and E in series; the ideal-inductor option gives constant current.
- Firing angle α is measured from each device's natural commutation point; α = 0 gives the diode result.
- HW and FW are interpreted as: 1φ FW = centre-tapped transformer with two devices; 3φ FW = six-phase star from centre-tapped windings.
- Idle-bridge blocking voltages use an equal-leakage divider convention.
- Thyristor gate pulses are 30 wide (about 80 for the 3φ bridge, equivalent to double pulsing).

## Structure

```
index.html          page layout
css/styles.css      themes and layout
js/circuits.js      circuit definitions, independent netlists
js/sim.js           steady-state simulation and metrics
js/theory.js        closed-form formulas and explanatory text
js/schematic.js     schematic data, SVG renderer, net extraction, current routes
js/plots.js         canvas waveform, Gantt and harmonic charts
js/main.js          state, controls, animation, exports
tests/              Node and Playwright tests
tools/serve.js      local static server
```
