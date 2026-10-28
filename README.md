# Slingshot

A ship in orbit around Home has one burn and a fixed fuel budget. Reach the capture ring around Planet X. The star in between can throw you there for much less fuel than a route that stays clear of it.

This is the first work package: deterministic flight, one level, planning and launch. Later packages can add hazards, resources, mid-flight correction, and multi-sun uncertainty on top of the same simulator.

## Run

```bash
npm install
npm run dev
```

Then open the URL Vite prints (http://localhost:5173).

```bash
npm test
npm run build
```

`npm test` runs Vitest. `npm run build` typechecks and bundles.

## How to play

- Drag from the ship to set a single burn. Length is delta-v. Fuel cost is proportional to that length and cannot exceed the budget.
- The dotted line is the flight that burn will produce. It is the same integrator the ship uses after launch, not a separate approximation.
- Green means the line enters Planet X's capture ring. Red hits a body. Gray is lost: out of the charted system, or out of time.
- Launch flies it. The ship leaves a trail.
- Drag empty space to pan. Scroll to zoom.
- Reset returns to planning. 1× / 2× / 4× run more fixed steps per frame. The time step never changes, so the path does not change.
- Space launches. R resets. 1, 2, and 4 set the speed.

A modest burn roughly along the ship's orbital motion swings past the star and on to Planet X. A much larger burn can reach X while staying far from the star, and it spends more than twice the fuel.

## Layout

- `src/sim/physics.ts` — Newtonian gravity and a fixed-step velocity Verlet integrator. No DOM. Prediction and flight both call `step`.
- `src/level/passage.ts` — bodies, fuel, orbit, and the two reference burns the tests fly.
- `src/render/` — camera, starfield, and canvas drawing.
- `src/game/` — planning / flight state and pointer input.
- `tests/` — prediction matches flight at 1×, 2×, and 4×, and the slingshot wins on less than half the fuel of the direct route.

## Continuous integration

`.github/workflows/ci.yml` runs `npm test` and `npm run build` on Ubuntu with Node 22.
