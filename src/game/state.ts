import { passage, simConfigFromLevel, type Level } from "../level/passage";
import {
  advanceFrame,
  clampDv,
  cloneState,
  flyMission,
  fuelCost,
  makeState,
  predict,
  resolveCapture,
  stepsPerFrame,
  tryApplyImpulse,
  type Prediction,
  type SimSpeed,
  type SimState,
  type Vec2,
} from "../sim/physics";
import type { Camera } from "../render/camera";

export type GameMode = "planning" | "flying" | "capture" | "finished";

export interface Game {
  level: Level;
  mode: GameMode;
  initial: SimState;
  ship: SimState;
  fuel: number;
  plannedDv: Vec2;
  prediction: Prediction | null;
  predictMs: number;
  trail: Vec2[];
  speed: SimSpeed;
  camera: Camera;
  frameSamples: Vec2[];
}

export function createGame(level: Level = passage, camera: Camera = { x: 0, y: 0, zoom: 1 }): Game {
  const initial = makeState(level.ship.x, level.ship.y, level.ship.vx, level.ship.vy, simConfigFromLevel(level));
  return {
    level,
    mode: "planning",
    initial,
    ship: cloneState(initial),
    fuel: level.fuel,
    plannedDv: { x: 0, y: 0 },
    prediction: null,
    predictMs: 0,
    trail: [],
    speed: 1,
    camera,
    frameSamples: [],
  };
}

export function plannedCost(game: Game): number {
  return fuelCost(game.plannedDv.x, game.plannedDv.y, game.level.fuelPerDv);
}

export function setPlannedDv(game: Game, dvx: number, dvy: number): void {
  if (game.mode !== "planning" && game.mode !== "capture") return;
  const clamped = clampDv(dvx, dvy, game.fuel, game.level.fuelPerDv);
  game.plannedDv = clamped;
  const magnitude = Math.hypot(clamped.x, clamped.y);
  const config = simConfigFromLevel(game.level);
  if (game.mode === "planning" && magnitude < 0.05) {
    game.prediction = null;
    game.predictMs = 0;
    return;
  }
  const started = performance.now();
  if (game.mode === "planning") {
    const preview = cloneState(game.initial);
    const applied = tryApplyImpulse(preview, clamped.x, clamped.y, game.fuel, game.level.fuelPerDv);
    if (!applied.ok) {
      game.prediction = null;
      game.predictMs = 0;
      return;
    }
    game.prediction = predict(preview, config);
  } else {
    game.prediction = flyMission(game.ship, config, 1, clamped, game.fuel, game.level.fuelPerDv);
  }
  game.predictMs = performance.now() - started;
}

export function launch(game: Game): void {
  if (game.mode !== "planning") return;
  if (Math.hypot(game.plannedDv.x, game.plannedDv.y) < 0.25) return;
  const ship = cloneState(game.initial);
  const applied = tryApplyImpulse(ship, game.plannedDv.x, game.plannedDv.y, game.fuel, game.level.fuelPerDv);
  if (!applied.ok) return;
  game.ship = ship;
  game.fuel = applied.fuel;
  game.mode = "flying";
  game.prediction = null;
  game.trail = [{ x: game.initial.x, y: game.initial.y }];
}

/** One rendered frame. Sim speed adds fixed steps; it does not change dt. */
export function tick(game: Game): void {
  if (game.mode !== "flying") return;
  advanceFrame(game.ship, simConfigFromLevel(game.level), stepsPerFrame(game.speed), game.frameSamples);
  for (let i = 0; i < game.frameSamples.length; i++) game.trail.push(game.frameSamples[i]);
  if (game.ship.status === "capture") {
    game.mode = "capture";
    game.plannedDv = { x: 0, y: 0 };
    setPlannedDv(game, 0, 0);
    return;
  }
  if (game.ship.status !== "flying") game.mode = "finished";
}

/** Fire the capture burn that is currently aimed. */
export function confirmCapture(game: Game): void {
  if (game.mode !== "capture") return;
  const applied = resolveCapture(
    game.ship,
    game.plannedDv.x,
    game.plannedDv.y,
    game.fuel,
    game.level.fuelPerDv,
    simConfigFromLevel(game.level),
  );
  if (!applied.ok) return;
  game.fuel = applied.fuel;
  game.plannedDv = { x: 0, y: 0 };
  game.prediction = null;
  game.mode = game.ship.status === "flying" ? "flying" : "finished";
}

/** Continue with no capture burn. A fast flyby then leaves the sphere unbound. */
export function skipCapture(game: Game): void {
  if (game.mode !== "capture") return;
  game.plannedDv = { x: 0, y: 0 };
  confirmCapture(game);
}

export function setSpeed(game: Game, speed: SimSpeed): void {
  game.speed = speed;
}

export function reset(game: Game): void {
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
  game.plannedDv = { x: 0, y: 0 };
  game.prediction = null;
  game.predictMs = 0;
  game.trail = [];
  game.mode = "planning";
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
