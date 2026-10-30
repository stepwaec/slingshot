import { burnLimit, passage, pauseRuleOf, simConfigFromLevel, type Level } from "../level/catalog";
import {
  advanceFrame,
  assessPlan,
  cloneState,
  frameStepCount,
  extensionSteps,
  makeState,
  planHorizonEnd,
  predictPlan,
  previewRange,
  SIM_SPEEDS,
  spendPause,
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
import { scoreMission, type MissionScore } from "../sim/score";
import { UPGRADE_POINTS, UPGRADES, isUpgradeId, type UpgradeId } from "./upgrades";

export type GameMode = "planning" | "flying" | "paused" | "finished";

/** Gravity layer. View only — toggling it must not touch the ship or the plan. */
export type GravityView = "off" | "on";

export interface Game {
  level: Level;
  mode: GameMode;
  initial: SimState;
  ship: SimState;
  /** Fuel still in the tank. Planning starts from the full budget. */
  fuel: number;
  /** Points left for the upgrade screen. */
  points: number;
  /** Upgrades bought for this attempt. */
  upgrades: UpgradeId[];
  nodes: BurnNode[];
  /** Index of the selected node, or null. */
  selected: number | null;
  prediction: PlanForecast;
  predictMs: number;
  speed: SimSpeed;
  /** One fixed step every other rendered frame. `dt` stays put. */
  slow: boolean;
  /** Slow-motion frames accumulated toward the next step. */
  slowPhase: number;
  /** Pauses already spent this attempt. */
  pausesUsed: number;
  /** Score left for a `score` pause rule. Unused otherwise. */
  score: number;
  camera: Camera;
  frameSamples: PathSample[];
  /** Next plan node `advancePlan` will consider. */
  cursor: { index: number };
  /** How many nodes have already spent fuel during this flight. */
  spentNodes: number;
  /**
   * Planning gravity layer. On draws the bent grid over the clock-rate field.
   * Does not affect prediction or flight.
   */
  gravity: GravityView;
  /** Planning magnetism map. Does not affect prediction or flight. */
  magnetism: boolean;
  /** Planning radiation map. Does not affect prediction or flight. */
  radiation: boolean;
  /** Astrophage map. Planning and pause only. Does not affect prediction or flight. */
  astrophage: boolean;
  /**
   * Path sample under the pointer, in planning and pause.
   * Ghosts read it. Prediction and flight do not.
   */
  cursorStep: number | null;
  /**
   * Preview length in seconds, chosen on the planning slider.
   * `null` keeps today's look-ahead and still follows the ship.
   */
  previewSeconds: number | null;
}

/** Planning, or a tactical pause mid-flight. Burns can be edited in both. */
export function isEditing(game: Game): boolean {
  return game.mode === "planning" || game.mode === "paused";
}

export interface RailSample {
  step: number;
  x: number;
  y: number;
  /** Coasting state at this step, before the dragged node's burn. */
  state: SimState;
}

export function createGame(level: Level = passage, camera: Camera = { x: 0, y: 0, zoom: 1 }): Game {
  const config = simConfigFromLevel(level);
  const initial = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, config);
  const started = performance.now();
  const prediction = predictPlan(initial, config, [], undefined, extensionSteps(initial, config, null));
  return {
    level,
    mode: "planning",
    initial,
    ship: cloneState(initial),
    fuel: initial.tank,
    points: UPGRADE_POINTS,
    upgrades: [],
    nodes: [],
    selected: null,
    prediction,
    predictMs: performance.now() - started,
    speed: 1,
    slow: false,
    slowPhase: 0,
    pausesUsed: 0,
    score: startingScore(level),
    camera,
    frameSamples: [],
    cursor: { index: 0 },
    spentNodes: 0,
    gravity: "off",
    magnetism: false,
    radiation: false,
    astrophage: false,
    cursorStep: null,
    previewSeconds: null,
  };
}

/** Off → on → off. View state only. */
export function cycleGravity(game: Game): GravityView {
  game.gravity = game.gravity === "on" ? "off" : "on";
  return game.gravity;
}

/** Button copy for the gravity layer. Matches `cycleGravity` one to one. */
export function gravityLabel(view: GravityView): string {
  return view === "on" ? "Gravity on" : "Gravity off";
}

/**
 * G toggles the layer. Repeat and modifier chords do not, so a held key
 * cannot flip it twice. Returns whether the key was consumed.
 */
export function applyGravityKey(
  game: Game,
  event: { key: string; repeat?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
): boolean {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key !== "g" && event.key !== "G") return false;
  cycleGravity(game);
  return true;
}

/** Magnetism heatmap. Ignored by the sim and by prediction. */
export function setMagnetism(game: Game, on: boolean): void {
  game.magnetism = on;
}

export function toggleMagnetism(game: Game): void {
  game.magnetism = !game.magnetism;
}

/** Radiation heatmap. Ignored by the sim and by prediction. */
export function setRadiation(game: Game, on: boolean): void {
  game.radiation = on;
}

export function toggleRadiation(game: Game): void {
  game.radiation = !game.radiation;
}

/** Astrophage flow map. Ignored by the sim and by prediction. */
export function toggleAstrophage(game: Game): void {
  game.astrophage = !game.astrophage;
}

/** True when the level has an infected star, a Petrova line, or Tau Ceti. */
export function levelHasAstro(level: Level): boolean {
  if (level.petrova && level.petrova.length > 0) return true;
  return level.bodies.some((body) => body.astrophage !== undefined || body.look === "tau-ceti");
}

export function loadLevel(game: Game, level: Level): void {
  game.level = level;
  game.speed = 1;
  game.slow = false;
  game.slowPhase = 0;
  game.nodes = [];
  game.selected = null;
  game.cursorStep = null;
  game.previewSeconds = null;
  game.mode = "planning";
  game.points = UPGRADE_POINTS;
  game.upgrades = [];
  restoreShip(game);
  recompute(game, 0, "coast");
}

/** Points already paid to a WP4 score-pause rule. Free and unlimited pauses pay 0. */
export function pauseSpent(game: Game): number {
  const rule = game.level.pause;
  if (!rule || rule.kind !== "score") return 0;
  return Math.max(0, rule.budget - game.score);
}

/**
 * Score the plan (while planning) or the flight (otherwise).
 * A captured orbit is still required. The deadline is judged on outside time.
 */
export function missionResult(game: Game): MissionScore {
  const preview = game.mode === "planning";
  const pose = preview ? game.prediction.final : game.ship;
  const profile = game.level.mission;
  return scoreMission({
    arrived: pose.status === "won",
    outsideTime: pose.t,
    shipTime: pose.tau,
    fuelLeft: preview ? planFuel(game).left : game.fuel,
    pauseSpent: pauseSpent(game),
    deadline: profile.deadline,
    crewLimit: profile.crewLimit,
    fuelStarMin: profile.fuelStarMin,
    crewWeight: profile.crewWeight,
    fuelWeight: profile.fuelWeight,
  });
}

/** Spend points on one upgrade. Planning only. Mass changes the prediction. */
export function buyUpgrade(game: Game, id: string): boolean {
  if (game.mode !== "planning") return false;
  if (!isUpgradeId(id)) return false;
  if (game.upgrades.includes(id)) return false;
  const spec = UPGRADES.find((item) => item.id === id);
  if (!spec || game.points < spec.cost) return false;
  game.points -= spec.cost;
  game.upgrades.push(id);
  restoreShip(game);
  recompute(game, 0, "coast");
  return true;
}

export function planFuel(game: Game): PlanFuel {
  const config = simConfigFromLevel(game.level, game.upgrades);
  const perDv = config.engine === "spin" ? 0 : (config.fuelPerDv ?? game.level.fuelPerDv);
  return assessPlan(game.nodes, config.fuelMax ?? game.level.fuel, perDv);
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
  if (!isEditing(game)) return;
  if (index === null) {
    game.selected = null;
    return;
  }
  if (index >= game.cursor.index && index < game.nodes.length) game.selected = index;
}

/** Burns still waiting to fire. Fired nodes do not count against the cap. */
export function queuedBurns(game: Game): number {
  return Math.max(0, game.nodes.length - game.cursor.index);
}

/**
 * True when `step` is still ahead of the ship and inside the current preview.
 * Planning measures from the pad. A pause measures from the frozen ship.
 * The end is `planHorizonEnd`: the slider's extension past the latest burn,
 * or past the ship when there is no later burn.
 */
export function stepInHorizon(game: Game, step: number): boolean {
  const origin = planOrigin(game);
  if (!Number.isInteger(step) || step < origin.step) return false;
  const config = simConfigFromLevel(game.level, game.upgrades);
  return step <= planHorizonEnd(origin, config, game.nodes, extensionSteps(origin, config, game.previewSeconds));
}

/** Click on the predicted path. An existing node at that step is selected instead. */
export function addNode(game: Game, step: number): void {
  if (!isEditing(game) || !stepInHorizon(game, step)) return;
  const existing = game.nodes.findIndex((node) => node.step === step);
  if (existing >= 0) {
    if (existing >= game.cursor.index) game.selected = existing;
    return;
  }
  if (queuedBurns(game) >= burnLimit(game.level)) return;
  let index = game.nodes.findIndex((node) => node.step > step);
  if (index < 0) index = game.nodes.length;
  game.nodes.splice(index, 0, { step, dvx: 0, dvy: 0 });
  game.selected = index;
  recompute(game, index, "coast");
}

export function deleteNode(game: Game, index: number): void {
  if (!isEditing(game) || index < game.cursor.index || index >= game.nodes.length) return;
  game.nodes.splice(index, 1);
  if (game.selected !== null) {
    if (game.nodes.length === 0 || game.selected === index) {
      game.selected = game.nodes.length === 0 ? null : Math.min(index, game.nodes.length - 1);
    } else if (game.selected > index) {
      game.selected -= 1;
    }
  }
  if (game.selected !== null && game.selected < game.cursor.index) game.selected = null;
  recompute(game, Math.min(index, game.nodes.length), "coast");
}

export function deleteSelected(game: Game): void {
  if (game.selected === null) return;
  deleteNode(game, game.selected);
}

export function clearPlan(game: Game): void {
  if (game.mode === "flying") return;
  if (game.mode === "paused") {
    game.nodes.length = game.cursor.index;
    game.selected = null;
    recompute(game, game.cursor.index, "coast");
    return;
  }
  game.nodes = [];
  game.selected = null;
  if (game.mode === "finished") restoreShip(game);
  game.mode = "planning";
  recompute(game, 0, "coast");
}

export function setNodeBurn(game: Game, index: number, dvx: number, dvy: number): void {
  if (!isEditing(game) || index < game.cursor.index) return;
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
  const config = simConfigFromLevel(game.level, game.upgrades);
  if (!node || !isEditing(game) || index < game.cursor.index) return [];
  let prev: SimState;
  if (index === 0) {
    prev = game.initial;
  } else {
    const previous = game.prediction.snapshots[index - 1];
    if (previous?.reached) prev = previous.after;
    else if (game.mode === "paused" && index === game.cursor.index) prev = game.ship;
    else return [];
  }
  const nextStep = index + 1 < game.nodes.length ? game.nodes[index + 1].step : config.maxSteps;
  const origin = planOrigin(game);
  const horizonEnd = planHorizonEnd(origin, config, game.nodes, extensionSteps(origin, config, game.previewSeconds));
  const blocked = index === 0 ? -1 : prev.step;
  const state = cloneState(prev);
  const samples: RailSample[] = [];
  if (state.status !== "flying") return samples;
  while (state.step < nextStep && state.step < config.maxSteps && state.step <= horizonEnd) {
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
  if (!isEditing(game) || index < game.cursor.index) return;
  const node = game.nodes[index];
  if (!node || node.step === sample.step || !stepInHorizon(game, sample.step)) return;
  const prevStep = index === 0 ? game.initial.step : game.nodes[index - 1].step;
  if (sample.step <= prevStep) return;
  if (index + 1 < game.nodes.length && sample.step >= game.nodes[index + 1].step) return;
  const approach: PathSample[] = [];
  for (let i = 0; i < rail.length; i++) {
    const item = rail[i];
    if (item.step > prevStep && item.step <= sample.step) {
      approach.push({ x: item.x, y: item.y, step: item.step, rate: item.state.rate });
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
  game.fuel = game.ship.tank;
  game.mode = "flying";
  game.cursor = { index: 0 };
  game.spentNodes = 0;
  game.selected = null;
  game.frameSamples = [];
}

/** One rendered frame. Sim speed and slow motion add fixed steps; neither changes dt. */
export function tick(game: Game): void {
  if (game.mode !== "flying") return;
  const counted = frameStepCount(game.speed, game.slow, game.slowPhase);
  game.slowPhase = counted.phase;
  const config = simConfigFromLevel(game.level, game.upgrades);
  advanceFrame(game.ship, config, counted.steps, game.frameSamples, game.nodes, game.cursor);
  game.fuel = game.ship.tank;
  if (game.ship.status !== "flying") game.mode = "finished";
}

/** True when `speed` is at or under the level's optional cap. Omitted cap is 32×. */
export function speedAllowed(level: Level, speed: SimSpeed): boolean {
  const cap = level.maxSpeed ?? SIM_SPEEDS[SIM_SPEEDS.length - 1];
  return speed <= cap;
}

export function setSpeed(game: Game, speed: SimSpeed): void {
  if (!speedAllowed(game.level, speed)) return;
  game.speed = speed;
}

/** Fix the planning preview at `seconds`. The coast after the latest burn uses this length. */
export function setPreviewSeconds(game: Game, seconds: number): void {
  if (!isEditing(game) || !Number.isFinite(seconds)) return;
  const origin = planOrigin(game);
  const config = simConfigFromLevel(game.level, game.upgrades);
  const range = previewRange(origin, config);
  const clamped = Math.min(range.maxSeconds, Math.max(range.minSeconds, seconds));
  if (game.previewSeconds !== null && game.previewSeconds === clamped) return;
  game.previewSeconds = clamped;
  recompute(game, game.nodes.length, "coast");
}

export function setSlow(game: Game, slow: boolean): void {
  game.slow = slow;
  if (!slow) game.slowPhase = 0;
}

export function canPause(game: Game): boolean {
  if (game.mode !== "flying" || game.ship.status !== "flying") return false;
  return spendPause(pauseRuleOf(game.level), pauseBudget(game)) !== null;
}

/**
 * Freeze the ship so burns can be added or edited. The step does not advance,
 * so resuming continues the same trajectory.
 */
export function pause(game: Game): boolean {
  if (game.mode !== "flying" || game.ship.status !== "flying") return false;
  const next = spendPause(pauseRuleOf(game.level), pauseBudget(game));
  if (!next) return false;
  game.pausesUsed = next.used;
  game.score = next.score;
  game.mode = "paused";
  game.selected = null;
  recompute(game, 0, "coast");
  return true;
}

export function resume(game: Game): void {
  if (game.mode !== "paused") return;
  game.mode = "flying";
  game.selected = null;
}

/** Back to planning. The nodes stay. Pause budget refills. */
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
    : game.ship.lostReason === "hull"
      ? "The hull failed."
      : game.ship.lostReason === "dose"
        ? "The crew took a lethal dose."
        : game.ship.lostReason === "nova"
          ? "The star exploded."
          : game.ship.lostReason === "burned"
            ? "The planet burned up before the ship was in orbit."
            : "The ship left the charted system.";
  return { title: "Lost in space", detail: why };
}

function restoreShip(game: Game): void {
  const initial = makeState(
    game.level.ship.x,
    game.level.ship.y,
    game.level.ship.vx,
    game.level.ship.vy,
    simConfigFromLevel(game.level, game.upgrades),
  );
  game.initial = initial;
  game.ship = cloneState(initial);
  game.fuel = initial.tank;
  game.cursor = { index: 0 };
  game.spentNodes = 0;
  game.frameSamples = [];
  game.pausesUsed = 0;
  game.score = startingScore(game.level);
  game.slowPhase = 0;
}

function startingScore(level: Level): number {
  return level.pause?.kind === "score" ? level.pause.budget : 0;
}

function pauseBudget(game: Game): { used: number; score: number } {
  return { used: game.pausesUsed, score: game.score };
}

/** Where the predicted line starts. A pause forecasts from the frozen ship. */
function planOrigin(game: Game): SimState {
  return game.mode === "paused" ? game.ship : game.initial;
}

function recompute(
  game: Game,
  from: number,
  kind: PlanReuse["kind"],
  snapshots?: readonly NodeSnapshot[],
): void {
  const started = performance.now();
  const prior = snapshots ?? game.prediction?.snapshots;
  let reuse = prior ? { snapshots: prior, from, kind } : undefined;
  if (game.mode === "paused" && reuse) {
    if (kind === "coast" && from > 0 && !prior?.[from - 1]?.reached) reuse = undefined;
    if (kind === "burn" && !prior?.[from]?.reached) reuse = undefined;
  }
  const origin = planOrigin(game);
  const config = simConfigFromLevel(game.level, game.upgrades);
  game.prediction = predictPlan(origin, config, game.nodes, reuse, extensionSteps(origin, config, game.previewSeconds));
  game.predictMs = performance.now() - started;
}
