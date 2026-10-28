# Slingshot

A ship in orbit around Home has a fixed fuel budget and a plan made of burn nodes. Each node is a sim step on the predicted path and an impulsive delta-v applied there. The launch burn can sit at step 0. A later node at Planet X's sphere is what captures the ship: specific orbital energy below zero, periapsis above the surface, and apoapsis inside the capture radius. The star in between makes that much cheaper than a route that stays clear of it.

Prediction and flight use the same fixed-step integrator. Editing a node recomputes from that node forward, and the path before it stays put. There is no live pause: capture is just another node in the plan.

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

- The dotted line is the coast the ship will fly. Click it to add a burn node at that sim step. Step 0, on the ship, is the launch node.
- Drag a node's handle to set direction and strength. Drag the node marker to slide it along the path. Delete (button or the Delete key) removes the selected node. Clear plan removes every node.
- The readout shows the plan total, the selected node's burn and fuel cost, and the fuel left. A node that costs more than the fuel remaining when the ship reaches it is marked in red. That plan cannot launch.
- The path after each node is the trajectory that burn produces. Green, with a closed ellipse, means the plan ends in orbit around Planet X. Blue means a flyby. Red means a crash.
- Launch flies the plan. Burns fire at their steps. 1× / 2× / 4× run more fixed steps per frame. The time step never changes, so the path does not change.
- A captured orbit is bound to Planet X, clears the surface, and stays inside the dashed ring. Missing that and leaving the ring is lost in space. Hitting a body is a crash. Leaving the chart or running out of time is also lost in space.
- Drag empty space to pan. Scroll to zoom.
- Reset returns to planning and keeps the nodes. Space launches. R resets. 1, 2, and 4 set the speed.

The fuel budget is **60**. A slingshot launch plus its capture node costs **38.91** (22.00 + 16.91). The direct route costs **95.18** (76.00 + 19.18), which is over budget, so it cannot launch. A modest burn along the ship's orbital motion is the one that fits.

![Three burn nodes on the predicted path](docs/nodes-on-path.png)

![The slingshot plan captured into orbit around Planet X](docs/orbit-win.png)

## Layout

- `src/sim/physics.ts` — Newtonian gravity, fixed-step velocity Verlet, burn nodes, and the cached prediction. No DOM. Prediction and flight both call `advancePlan`.
- `src/level/passage.ts` — bodies, fuel, and the reference slingshot and direct plans.
- `src/render/` — camera, starfield, and canvas drawing.
- `src/game/` — the plan, flight, and pointer input.
- `tests/` — prediction matches flight at 1×, 2×, and 4× with three nodes; editing a later node leaves the earlier path unchanged; the slingshot captures inside the budget and the direct plan is over it; an over-budget plan cannot launch.

## Continuous integration

`.github/workflows/ci.yml` runs `npm test` and `npm run build` on Ubuntu with Node 22.
