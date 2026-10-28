# Slingshot

A ship in orbit around Home has a fixed fuel budget and two burns. The first sends it toward Planet X. The second, offered only when the ship enters Planet X's capture radius, has to leave the ship bound in an orbit there: specific orbital energy below zero, periapsis above the surface, and apoapsis inside the capture radius. The star in between makes that much cheaper than a route that stays clear of it.

This package is deterministic flight, one level, launch planning, and a single capture burn. Later packages can add hazards, resources, free mid-flight correction, and multi-sun uncertainty on top of the same simulator.

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

- Drag from the ship to set the launch burn. Length is delta-v. Fuel cost is proportional to that length and cannot exceed the fuel you have left.
- The dotted line is the flight that burn will produce. It uses the same integrator as flight.
- A blue line that says "Reach X" ends at Planet X's capture ring, where the sim pauses.
- Drag a second burn from the ship. Green and "Captured" means the burn leaves the ship in orbit. "Flyby" means it will leave the sphere unbound. Confirm fires the burn. Skip spends nothing and flies on.
- A captured orbit is bound to Planet X, clears the surface, and stays inside the dashed ring. Missing that and leaving the ring is lost in space. Hitting a body is a crash. Leaving the chart or running out of time is also lost in space.
- Drag empty space to pan. Scroll to zoom.
- Reset returns to planning. 1× / 2× / 4× run more fixed steps per frame. The time step never changes, so the path does not change.
- Space launches, and confirms a capture burn. R resets. 1, 2, and 4 set the speed.

The fuel budget is **60**. A slingshot launch plus its capture burn costs **39.48** (22.00 + 17.48). The direct route costs **95.63** (76.00 + 19.63), which is over budget. A modest burn along the ship's orbital motion is the one that fits.

## Layout

- `src/sim/physics.ts` — Newtonian gravity, fixed-step velocity Verlet, and the capture check. No DOM. Prediction and flight both call `step` and `resolveCapture`.
- `src/level/passage.ts` — bodies, fuel, orbit, and the reference launch and capture burns.
- `src/render/` — camera, starfield, and canvas drawing.
- `src/game/` — planning, flight, capture planning, and pointer input.
- `tests/` — prediction matches flight at 1×, 2×, and 4× with the capture burn; the slingshot captures for less than half the direct fuel and fits the budget; a flyby with no capture burn does not win.

## Continuous integration

`.github/workflows/ci.yml` runs `npm test` and `npm run build` on Ubuntu with Node 22.
