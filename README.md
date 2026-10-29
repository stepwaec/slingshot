# Slingshot

A ship in orbit around Home has a fixed fuel budget and a plan made of burn nodes. Each node is a sim step on the predicted path and an impulsive delta-v applied there. The launch burn can sit at step 0. A later node at Planet X's sphere is what captures the ship: specific orbital energy below zero, periapsis above the surface, and apoapsis inside the capture radius. The star in between makes that much cheaper than a route that stays clear of it.

Prediction and flight use the same fixed-step integrator. Editing a node recomputes from that node forward, and the path before it stays put. Passage can be planned before launch. Relay cannot: the predicted line has a horizon, only two burns can be queued, and the capture burn is added on a pause mid-flight. Winning is still a stable orbit around Planet X.

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
- Launch flies the plan. Burns fire at their steps. 1× / 2× / 4× run more fixed steps per frame. Slow runs one fixed step every other frame. The time step never changes, so the path does not change.
- Pause freezes the ship so you can add or edit burns that have not fired yet, then resume. Passage can pause without limit. A level may instead allow a fixed number of pauses, or charge a score each time. The step does not advance while paused, so the trajectory stays the same.
- A captured orbit is bound to Planet X, clears the surface, and stays inside the dashed ring. Missing that and leaving the ring is lost in space. Hitting a body is a crash. Leaving the chart or running out of time is also lost in space.
- Drag empty space to pan. Scroll to zoom. The level menu switches systems and returns to planning.
- Reset returns to planning and keeps the nodes. Space launches, and pauses or resumes in flight. P does the same. S toggles slow motion. R resets. 1, 2, and 4 set the speed.

### Relay

Choose Relay in the level menu. Planet X circles a fixed point, and a moon circles Planet X. Both move on rails keyed by sim time, so the prediction and the flight see the same places.

The readout shows the horizon in seconds. That is how far the dotted line reaches. It gets shorter where gravity is strong. Only two burns can be queued at once. Relay also gives you three pauses.

Leave Home with a departure burn aimed toward Planet X's path, and put a small correction on the visible line. Those two burns are the whole plan you can commit before launch, and they do not capture: the ship meets Planet X and hits it. The capture burn sits past the opening horizon, and there is no free slot for it until the correction has fired.

Launch, then pause once Planet X is inside the horizon (the capture step in the reference solution is 2605, and step 2300 can already see it). Click the line to add the third burn, drag it until the path closes into a green orbit, and resume. Slow motion makes that approach easier to time. The fuel budget is **50**. The reference departure, correction, and capture together cost **48.87**.

The fuel budget is **60**. A slingshot launch plus its capture node costs **38.91** (22.00 + 16.91). The direct route costs **95.18** (76.00 + 19.18), which is over budget, so it cannot launch. A modest burn along the ship's orbital motion is the one that fits.

![Three burn nodes on the predicted path](docs/nodes-on-path.png)

![The slingshot plan captured into orbit around Planet X](docs/orbit-win.png)

## Layout

- `src/sim/physics.ts` — Newtonian gravity, fixed-step velocity Verlet, burn nodes, analytic orbits, the planning horizon, and the cached prediction. No DOM. Prediction and flight both call `advancePlan`. The horizon stops the predicted line only.
- `src/level/passage.ts` — Passage: fixed bodies, fuel, and the reference slingshot and direct plans. Up to eight burns can be queued, and pausing is free.
- `src/level/relay.ts` — Relay: Planet X and its moon on rails, a short horizon, two queued burns, three pauses, and the reference mid-flight capture.
- `src/render/` — orthographic Three.js view (WebGL). The HUD and result cards are HTML over the canvas. A parked perspective camera sits on the same world group for a later tilted view.

## Swapping a visual

v1 is flat and calm on purpose. A later pass can replace one element with something realistic (a textured planet, a bloom star, a glTF ship) without touching the sim or the other elements.

Colors, sizes, and asset paths live in `src/render/theme.ts`. Each element is built by one factory in `src/render/visuals/index.ts`. A factory returns a `Visual` (`src/render/visual.ts`): an object, a space (`background`, `world`, or `screen`), and `update` / `dispose`. The view only walks that list.

| Element | Factory to replace | Theme keys | What a realistic version would load |
| --- | --- | --- | --- |
| Starfield | `createStarfield` | `assets.starfield`, `starfield` | A real catalog or cubemap. Stay screen-fixed unless you also add parallax. |
| Star | `createStar` | `assets.star`, `star` | A textured star. Bloom belongs here, not on the whole scene. |
| Planets | `createPlanets` | `assets.planetStart`, `assets.planetX`, `planet` | Lit textured meshes. The star's position is already the light direction. |
| Ship | `createShip` | `assets.ship`, `assets.shipThrust`, `ship`, `thrust` | A glTF on the same group. Keep the heading lerp and the screen-pixel size rule, or drop the size rule if the model should scale with the world. |
| Trail | `createTrail` | `assets.trail`, `trail` | Another ribbon. Read `game.trail`; do not trim it in the sim. |
| Path | `createPath` | `assets.predictedPath`, `path` | Another dotted or meshed look-ahead. Read `game.prediction` only. |
| Nodes | `createNodes` | `assets.dragArrow`, `nodes` | Another handle. The tip must stay on `burnHandleOffset`, which is what clicking and dragging hit-test. |

Replace the factory in `visualFactories` and, if the new file path differs, the matching `theme.assets` entry. Leave `src/sim`, `src/game`, and the other factories alone.
- `src/game/` — the plan, flight, and pointer input.
- `tests/` — prediction matches flight at 1×, 2×, and 4× with three nodes; the same match with orbiting bodies; editing a later node leaves the earlier path unchanged; the slingshot captures inside the budget and the direct plan is over it; an over-budget plan cannot launch; pausing and slow motion do not change a trajectory; pause rules are enforced; Relay's opening plan does not win and the mid-flight capture does.

## Continuous integration

`.github/workflows/ci.yml` runs `npm test` and `npm run build` on Ubuntu with Node 22.
