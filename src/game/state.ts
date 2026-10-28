import { passage, simConfigFromLevel, type Level } from "../level/passage";
import {
  advanceFrame,
  assessPlan,
  cloneState,
  fuelCost,
  makeState,
  predictPlan,
  stepsPerFrame,
  step,
  type BurnNode,
  type NodeSnapshot,
  type PathSample,
  type PlanForecast,
  type PlanFuel,
  type PlanReuse,
  type SimSpeed,
  type SimState,
  type Vec2,
} from "../sim/physics";
import type { Camera } from "../render/camera";

export type GameMode = "planning" | "flying" | "finished";

export interface Game {
  level: Level;
  mode: GameMode;
  initial: SimState;
  ship: SimState;
  /** Fuel still in the tank. Planning starts from the full budget. */
  fuel: number;
  nodes: BurnNode[];
  /** Index of the selected node, or null. */
  selected: number | null;
  prediction: PlanForecast;
  predictMs: number;
  trail: Vec2[];
  speed: SimSpeed;
  camera: Camera;
  frameSamples: PathSample[];
  /** Next plan node `advancePlan` will consider. */
  cursor: { index: number };
  /** How many nodes have already spent fuel during this flight. */
  spentNodes: number;
}

export interface RailSample {
  step: number;
  x: number;
  y: number;
  /** Coasting state at this step, before the dragged node's burn. */
  state: SimState;
}

export function createGame(level: Level = passage, camera: Camera = { x: 0, y: 0, zoom: 1 }): Game {
  const initial = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, simConfigFromLevel(level));
  const started = performance.now();
  const prediction = predictPlan(initial, simConfigFromLevel(level), []);
  return {
    level,
    mode: "planning",
    initial,
    ship: cloneState(initial),
    fuel: level.fuel,
    nodes: [],
    selected: null,
    prediction,
    predictMs: performance.now() - started,
    trail: [],
    speed: 1,
    camera,
    frameSamples: [],
    cursor: { index: 0 },
    spentNodes: 0,
  };
}

export function planFuel(game: Game): PlanFuel {
  return assessPlan(game.nodes, game.level.fuel, game.level.fuelPerDv);
}

export function canLaunch(game: Game): boolean {
  if (game.mode !== "planning") return false;
  if (!planFuel(game).affordable) return false;
  for (let i = 0; i < game.nodes.length; i++) {
    const node = game.nodes[i];
    if (Math.hypot(node.dvx, node.dvy) >= 0.25) return true;
  }
  return false;
}

/** Replace the plan and predict it from the start. Planning only. */
export function setPlan(game: Game, nodes: readonly BurnNode[]): void {
  if (game.mode !== "planning") return;
  game.nodes = nodes.map((node) => ({ step: node.step, dvx: node.dvx, dvy: node.dvy }));
  game.nodes.sort((a, b) => a.step - b.step);
  game.selected = null;
  recompute(game, 0, "coast");
}

export function selectNode(game: Game, index: number | null): void {
  if (game.mode !== "planning") return;
  if (index === null) {
    game.selected = null;
    return;
  }
  if (index >= 0 && index < game.nodes.length) game.selected = index;
}

/** Click on the predicted path. An existing node at that step is selected instead. */
export function addNode(game: Game, step: number): void {
  if (game.mode !== "planning" || !Number.isInteger(step) || step < 0) return;
  const existing = game.nodes.findIndex((node) => node.step === step);
  if (existing >= 0) {
    game.selected = existing;
    return;
  }
  let index = game.nodes.findIndex((node) => node.step > step);
  if (index < 0) index = game.nodes.length;
  game.nodes.splice(index, 0, { step, dvx: 0, dvy: 0 });
  game.selected = index;
  recompute(game, index, "coast");
}

export function deleteNode(game: Game, index: number): void {
  if (game.mode !== "planning" || index < 0 || index >= game.nodes.length) return;
  game.nodes.splice(index, 1);
  if (game.selected !== null) {
    if (game.nodes.length === 0 || game.selected === index) {
      game.selected = game.nodes.length === 0 ? null : Math.min(index, game.nodes.length - 1);
    } else if (game.selected > index) {
      game.selected -= 1;
    }
  }
  recompute(game, Math.min(index, game.nodes.length), "coast");
}

export function deleteSelected(game: Game): void {
  if (game.selected === null) return;
  deleteNode(game, game.selected);
}

export function clearPlan(game: Game): void {
  if (game.mode === "flying") return;
  game.nodes = [];
  game.selected = null;
  if (game.mode === "finished") restoreShip(game);
  game.mode = "planning";
  recompute(game, 0, "coast");
}

export function setNodeBurn(game: Game, index: number, dvx: number, dvy: number): void {
  if (game.mode !== "planning") return;
  const node = game.nodes[index];
  if (!node || !Number.isFinite(dvx) || !Number.isFinite(dvy)) return;
  if (node.dvx === dvx && node.dvy === dvy) {
    game.selected = index;
    return;
  }
  node.dvx = dvx;
  node.dvy = dvy;
  game.selected = index;
  recompute(game, index, "burn");
}

/**
 * Steps the node may occupy: the coast after the previous node, stopping before
 * the next node and before the flight ends. Built once per drag.
 */
export function buildMoveRail(game: Game, index: number): RailSample[] {
  const node = game.nodes[index];
  const config = simConfigFromLevel(game.level);
  if (!node || game.mode !== "planning") return [];
  let prev: SimState;
  if (index === 0) {
    prev = game.initial;
  } else {
    const previous = game.prediction.snapshots[index - 1];
    if (!previous?.reached) return [];
    prev = previous.after;
  }
  const nextStep = index + 1 < game.nodes.length ? game.nodes[index + 1].step : config.maxSteps;
  const blocked = index === 0 ? -1 : prev.step;
  const state = cloneState(prev);
  const samples: RailSample[] = [];
  if (state.status !== "flying") return samples;
  while (state.step < nextStep && state.step < config.maxSteps) {
    if (state.step !== blocked) {
      samples.push({ step: state.step, x: state.x, y: state.y, state: cloneState(state) });
    }
    if (state.step + 1 >= nextStep) break;
    step(state, config);
    if (state.status !== "flying") break;
  }
  return samples;
}

/** Slide a node to a step on a rail from `buildMoveRail`. */
export function moveNodeAlong(game: Game, index: number, rail: readonly RailSample[], sample: RailSample): void {
  if (game.mode !== "planning") return;
  const node = game.nodes[index];
  if (!node || node.step === sample.step) return;
  const prevStep = index === 0 ? game.initial.step : game.nodes[index - 1].step;
  if (sample.step <= prevStep) return;
  if (index + 1 < game.nodes.length && sample.step >= game.nodes[index + 1].step) return;
  const approach: PathSample[] = [];
  for (let i = 0; i < rail.length; i++) {
    const item = rail[i];
    if (item.step > prevStep && item.step <= sample.step) {
      approach.push({ x: item.x, y: item.y, step: item.step });
    }
  }
  node.step = sample.step;
  const snapshots = game.prediction.snapshots.slice();
  snapshots[index] = {
    step: sample.step,
    dvx: node.dvx,
    dvy: node.dvy,
    before: sample.state,
    after: sample.state,
    approach,
    reached: true,
  };
  game.selected = index;
  recompute(game, index, "burn", snapshots);
}

export function nodePosition(game: Game, index: number): Vec2 | null {
  const snap = game.prediction.snapshots[index];
  if (!snap?.reached) return null;
  return { x: snap.before.x, y: snap.before.y };
}

export function nodeIncoming(game: Game, index: number): Vec2 {
  const snap = game.prediction.snapshots[index];
  if (!snap?.reached) return { x: 1, y: 0 };
  const speed = Math.hypot(snap.before.vx, snap.before.vy);
  if (speed < 1e-8) return { x: 1, y: 0 };
  return { x: snap.before.vx, y: snap.before.vy };
}

/**
 * Screen-pixel offset from a node to its drag handle.
 * `y` is already flipped into screen space (down is positive).
 */
export function burnHandleOffset(
  dvx: number,
  dvy: number,
  dvPerPixel: number,
  incoming: Vec2,
): { x: number; y: number; placing: boolean } {
  const mag = Math.hypot(dvx, dvy);
  if (mag < 1e-4) {
    const speed = Math.hypot(incoming.x, incoming.y) || 1;
    return { x: (incoming.x / speed) * 18, y: (-incoming.y / speed) * 18, placing: true };
  }
  const pixels = mag / dvPerPixel;
  return { x: (dvx / mag) * pixels, y: (-dvy / mag) * pixels, placing: false };
}

export function launch(game: Game): void {
  if (!canLaunch(game)) return;
  game.ship = cloneState(game.initial);
  game.fuel = game.level.fuel;
  game.mode = "flying";
  game.trail = [{ x: game.initial.x, y: game.initial.y }];
  game.cursor = { index: 0 };
  game.spentNodes = 0;
  game.selected = null;
  game.frameSamples = [];
}

/** One rendered frame. Sim speed adds fixed steps; it does not change dt. */
export function tick(game: Game): void {
  if (game.mode !== "flying") return;
  const config = simConfigFromLevel(game.level);
  advanceFrame(game.ship, config, stepsPerFrame(game.speed), game.frameSamples, game.nodes, game.cursor);
  for (let i = 0; i < game.frameSamples.length; i++) {
    const sample = game.frameSamples[i];
    game.trail.push({ x: sample.x, y: sample.y });
  }
  const perDv = game.level.fuelPerDv;
  while (game.spentNodes < game.cursor.index) {
    const node = game.nodes[game.spentNodes];
    game.fuel -= fuelCost(node.dvx, node.dvy, perDv);
    game.spentNodes += 1;
  }
  if (game.fuel < 0) game.fuel = 0;
  if (game.ship.status !== "flying") game.mode = "finished";
}

export function setSpeed(game: Game, speed: SimSpeed): void {
  game.speed = speed;
}

/** Back to planning. The nodes stay. */
export function reset(game: Game): void {
  restoreShip(game);
  game.mode = "planning";
  recompute(game, 0, "coast");
}

export function outcomeCopy(game: Game): { title: string; detail: string } | null {
  if (game.mode !== "finished") return null;
  if (game.ship.status === "won") {
    return {
      title: "In orbit around Planet X",
      detail: "The ship is bound to Planet X. Periapsis clears the surface, and apoapsis stays inside the capture radius.",
    };
  }
  if (game.ship.status === "crashed") {
    const body = game.level.bodies.find((item) => item.id === game.ship.crashedBodyId);
    return {
      title: "Crashed",
      detail: `The ship hit ${body?.name ?? "a body"}.`,
    };
  }
  const why =
    game.ship.lostReason === "timeout"
      ? "Time ran out."
      : game.ship.lostReason === "flyby"
        ? "The ship flew past Planet X without being captured."
        : "The ship left the charted system.";
  return { title: "Lost in space", detail: why };
}

function restoreShip(game: Game): void {
  const initial = makeState(
    game.level.ship.x,
    game.level.ship.y,
    game.level.ship.vx,
    game.level.ship.vy,
    simConfigFromLevel(game.level),
  );
  game.initial = initial;
  game.ship = cloneState(initial);
  game.fuel = game.level.fuel;
  game.trail = [];
  game.cursor = { index: 0 };
  game.spentNodes = 0;
  game.frameSamples = [];
}

function recompute(
  game: Game,
  from: number,
  kind: PlanReuse["kind"],
  snapshots?: readonly NodeSnapshot[],
): void {
  const started = performance.now();
  const prior = snapshots ?? game.prediction?.snapshots;
  const reuse = prior ? { snapshots: prior, from, kind } : undefined;
  game.prediction = predictPlan(game.initial, simConfigFromLevel(game.level), game.nodes, reuse);
  game.predictMs = performance.now() - started;
}
