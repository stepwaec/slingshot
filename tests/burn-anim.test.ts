import { describe, expect, it } from "vitest";
import {
  burnWindow,
  markerPulse,
  sampleBurnAnim,
  simSeconds,
  tailFromBurn,
  thrustDuration,
  windupFlicker,
  type ThrustTail,
} from "../src/render/burn-anim";
import { theme, type Theme } from "../src/render/theme";
import { syncTopDown } from "../src/render/camera";
import { createNodes } from "../src/render/visuals/nodes";
import { createShip } from "../src/render/visuals/ship";
import { createTrail } from "../src/render/visuals/trail";
import type { Visual, VisualFrame } from "../src/render/visual";
import {
  createGame,
  launch,
  pause,
  resume,
  setNodeBurn,
  setPlan,
  setSlow,
  setSpeed,
  tick,
  type Game,
} from "../src/game/state";
import { passage } from "../src/level/catalog";
import { slingshotCapture, slingshotLaunch, slingshotPlan } from "../src/level/solutions";
import type { BurnNode } from "../src/sim/physics";

const dt = 1 / 60;
const fixedTail: ThrustTail = { base: 0.75, perDv: 0, max: 0.75 };

describe("burn windows", () => {
  it("opens the wind-up half a sim second before the burn and closes the tail after it", () => {
    const burn = 120;
    const windup = 0.5;
    const tail = 0.75;

    const early = burnWindow(89, burn, dt, windup, tail);
    expect(early.phase).toBe("idle");
    expect(early.offset).toBe((89 - burn) * dt);

    // Exactly 0.5s before is the closed edge: 30 steps, amount 0.
    const edge = burnWindow(90, burn, dt, windup, tail);
    expect(edge.phase).toBe("idle");
    expect(edge.amount).toBe(0);
    expect(edge.offset).toBe(-0.5);

    const mid = burnWindow(105, burn, dt, windup, tail);
    expect(mid.phase).toBe("windup");
    expect(mid.offset).toBe(-0.25);
    expect(mid.amount).toBe(0.5);

    const justBefore = burnWindow(119, burn, dt, windup, tail);
    expect(justBefore.phase).toBe("windup");
    expect(justBefore.amount).toBe(1 - 1 / 30);

    const at = burnWindow(burn, burn, dt, windup, tail);
    expect(at.phase).toBe("burn");
    expect(at.amount).toBe(1);
    expect(at.offset).toBe(0);

    const tailMid = burnWindow(burn + 22, burn, dt, windup, tail);
    expect(tailMid.phase).toBe("tail");
    expect(tailMid.offset).toBe(22 * dt);
    expect(tailMid.amount).toBe(1 - 22 / 45);

    const lastTail = burnWindow(burn + 44, burn, dt, windup, tail);
    expect(lastTail.phase).toBe("tail");
    expect(burnWindow(burn + 45, burn, dt, windup, tail).phase).toBe("idle");
    expect(burnWindow(burn + 46, burn, dt, windup, tail).phase).toBe("idle");
  });

  it("reads durations from its arguments", () => {
    expect(burnWindow(105, 120, dt, 0.2, 0.75).phase).toBe("idle");
    expect(burnWindow(110, 120, dt, 0.2, 0.75).phase).toBe("windup");
    expect(burnWindow(130, 120, dt, 0.5, 0.1).phase).toBe("idle");
    expect(burnWindow(122, 120, dt, 0.5, 0.1).phase).toBe("tail");
    expect(burnWindow(110, 120, dt, 0, 0.75).phase).toBe("idle");
    expect(burnWindow(122, 120, dt, 0.5, 0).phase).toBe("idle");
  });

  it("follows sim steps, so slow motion and pause do not resize the window", () => {
    // 30 steps at 1/60 and 15 steps at 1/30 are both exactly 0.5s.
    // A slower frame rate never enters this function.
    const fine = burnWindow(90, 120, 1 / 60, 0.5, 0.75);
    const coarse = burnWindow(45, 60, 1 / 30, 0.5, 0.75);
    expect(fine.phase).toBe("idle");
    expect(coarse.phase).toBe(fine.phase);
    expect(coarse.amount).toBe(fine.amount);
    expect(coarse.offset).toBe(fine.offset);

    const held = sampleBurnAnim(100, dt, [{ step: 120 }], 0.5, fixedTail);
    expect(sampleBurnAnim(100, dt, [{ step: 120 }], 0.5, fixedTail)).toEqual(held);
    expect(windupFlicker(held.time, held.windup, 9)).toBe(windupFlicker(held.time, held.windup, 9));
    expect(markerPulse(held.time, 3.5)).toBe(markerPulse(held.time, 3.5));
    expect(simSeconds(100, dt)).toBe(held.time);
  });

  it("tracks an edited plan and does not write the nodes", () => {
    const nodes = Object.freeze([Object.freeze({ step: 120 }), Object.freeze({ step: 90 })]);
    const before = sampleBurnAnim(100, dt, nodes, 0.5, fixedTail);
    expect(before.cues.map((cue) => cue.phase)).toEqual(["windup", "tail"]);
    expect(before.thrust).toBeGreaterThan(0);
    expect(before.windup).toBeGreaterThan(0);
    expect(before.cues[0].index).toBe(0);
    expect(before.cues[1].index).toBe(1);

    const moved = sampleBurnAnim(100, dt, [{ step: 400 }], 0.5, fixedTail);
    expect(moved.windup).toBe(0);
    expect(moved.thrust).toBe(0);
    expect(moved.cues).toEqual([]);

    const removed = sampleBurnAnim(100, dt, [], 0.5, fixedTail);
    expect(removed.cues).toEqual([]);
    expect(nodes.map((node) => node.step)).toEqual([120, 90]);
  });
});

describe("thrust duration", () => {
  const tail: ThrustTail = { base: 1, perDv: 0.5, max: 3 };

  it("grows with |dv| and clamps at the theme maximum", () => {
    expect(thrustDuration(0, tail)).toBe(1);
    expect(thrustDuration(1, tail)).toBe(1.5);
    expect(thrustDuration(2, tail)).toBe(2);
    expect(thrustDuration(-2, tail)).toBe(thrustDuration(2, tail));
    expect(thrustDuration(4, tail)).toBe(3);
    expect(thrustDuration(10, tail)).toBe(3);
    expect(thrustDuration(-10, tail)).toBe(3);

    let previous = 0;
    for (const mag of [0, 0.25, 0.5, 1, 2, 3, 4, 8, 22]) {
      const duration = thrustDuration(mag, tail);
      expect(duration).toBeGreaterThanOrEqual(previous);
      expect(duration).toBeLessThanOrEqual(tail.max);
      previous = duration;
    }
  });

  it("gives a small burn a short tail and a large burn a long one, in sim seconds", () => {
    const burn = 100;
    const later = burn + 90;
    const small = sampleBurnAnim(later, dt, [{ step: burn, dvx: 0, dvy: 0.2 }], 0.5, tail);
    const large = sampleBurnAnim(later, dt, [{ step: burn, dvx: 0, dvy: 10 }], 0.5, tail);
    expect(thrustDuration(0.2, tail)).toBeLessThan(1.5);
    expect(thrustDuration(10, tail)).toBe(tail.max);
    expect(small.thrust).toBe(0);
    expect(small.cues).toEqual([]);
    expect(large.thrust).toBeGreaterThan(0);
    expect(large.thrustStretch).toBe(1);
    expect(large.cues[0].phase).toBe("tail");
    const gone = sampleBurnAnim(later, dt, [], 0.5, tail);
    expect(gone.thrust).toBe(0);
    expect(sampleBurnAnim(later, dt, [{ step: burn, dvx: 0, dvy: 10 }], 0.5, tail)).toEqual(large);
  });
});

interface Trace {
  x: number;
  y: number;
  vx: number;
  vy: number;
  step: number;
  fuel: number;
  t: number;
  tau: number;
  status: string;
  nodes: string;
}

function themeWith(windup: number, tail: ThrustTail): Theme {
  return {
    ...theme,
    burn: {
      windup,
      tailBase: tail.base,
      tailPerDv: tail.perDv,
      tailMax: tail.max,
      flickerHz: theme.burn.flickerHz,
      pulseHz: theme.burn.pulseHz,
    },
  } as Theme;
}

function snap(game: Game): Trace {
  const ship = game.ship;
  return {
    x: ship.x,
    y: ship.y,
    vx: ship.vx,
    vy: ship.vy,
    step: ship.step,
    fuel: game.fuel,
    t: ship.t,
    tau: ship.tau,
    status: ship.status,
    nodes: game.nodes.map((node) => `${node.step}:${node.dvx}:${node.dvy}`).join("|"),
  };
}

function sameTrace(actual: Trace, expected: Trace): boolean {
  return (
    actual.x === expected.x &&
    actual.y === expected.y &&
    actual.vx === expected.vx &&
    actual.vy === expected.vy &&
    actual.step === expected.step &&
    actual.fuel === expected.fuel &&
    actual.t === expected.t &&
    actual.tau === expected.tau &&
    actual.status === expected.status &&
    actual.nodes === expected.nodes
  );
}

function expectTrace(actual: readonly Trace[], expected: readonly Trace[], label: string): void {
  expect(actual, label).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    if (!sameTrace(actual[i], expected[i])) {
      throw new Error(`${label} diverged at sample ${i} (step ${expected[i].step})`);
    }
  }
}

interface Draw {
  ship: Visual | null;
  nodes: Visual | null;
  trail: Visual | null;
  now: number;
}

function draw(game: Game, view: Draw): void {
  if (!view.ship || !view.nodes || !view.trail) return;
  syncTopDown(game.camera, 1280, 720);
  const frame: VisualFrame = { game, width: 1280, height: 720, now: view.now, dpr: 1 };
  view.ship.update(frame);
  view.nodes.update(frame);
  view.trail.update(frame);
  view.now += 16;
}

function viewFor(kind: "none" | "on" | "off"): Draw {
  if (kind === "none") return { ship: null, nodes: null, trail: null, now: 0 };
  const look = kind === "on" ? theme : themeWith(0, { base: 0, perDv: 0, max: 0 });
  return {
    ship: createShip(look, passage),
    nodes: createNodes(look, passage),
    trail: createTrail(look, passage),
    now: 0,
  };
}

function flySlingshot(kind: "none" | "on" | "off"): Trace[] {
  const game = createGame();
  setPlan(game, slingshotPlan);
  launch(game);
  const view = viewFor(kind);
  const trace: Trace[] = [];
  const pauseAt = slingshotCapture.step - 15;
  let paused = false;
  let guard = 0;
  while (game.mode === "flying" && guard++ < passage.maxSteps) {
    if (!paused && game.ship.step === pauseAt) {
      const frozen = snap(game);
      expect(pause(game)).toBe(true);
      const during = sampleBurnAnim(game.ship.step, game.level.dt, game.nodes, theme.burn.windup, tailFromBurn(theme.burn));
      expect(during.windup).toBeGreaterThan(0);
      for (let i = 0; i < 5; i++) draw(game, view);
      expect(sameTrace(snap(game), frozen)).toBe(true);
      expect(sampleBurnAnim(game.ship.step, game.level.dt, game.nodes, theme.burn.windup, tailFromBurn(theme.burn))).toEqual(during);
      resume(game);
      paused = true;
    }
    tick(game);
    draw(game, view);
    trace.push(snap(game));
  }
  view.ship?.dispose();
  view.nodes?.dispose();
  view.trail?.dispose();
  expect(paused).toBe(true);
  expect(trace.length).toBeGreaterThan(slingshotCapture.step);
  return trace;
}

function flyEdited(kind: "none" | "on" | "off"): Trace[] {
  const plan: BurnNode[] = [
    { step: 0, dvx: slingshotLaunch.dvx, dvy: slingshotLaunch.dvy },
    { step: 180, dvx: 1.2, dvy: -0.4 },
  ];
  const game = createGame();
  setPlan(game, plan);
  launch(game);
  setSlow(game, true);
  const view = viewFor(kind);
  const trace: Trace[] = [];
  let edited = false;
  let guard = 0;
  while (game.ship.step < 280 && game.mode === "flying" && guard++ < 2000) {
    if (!edited && game.ship.step >= 40) {
      expect(pause(game)).toBe(true);
      for (let i = 0; i < 3; i++) draw(game, view);
      const before = snap(game);
      setNodeBurn(game, 1, 1.5, -0.15);
      expect(game.ship.step).toBe(before.step);
      expect(game.ship.x).toBe(before.x);
      expect(game.fuel).toBe(before.fuel);
      const seen = sampleBurnAnim(game.ship.step, dt, game.nodes, 0.5, fixedTail);
      expect(seen.cues.some((cue) => cue.index === 1 && cue.phase === "windup")).toBe(false);
      resume(game);
      setSlow(game, false);
      setSpeed(game, 4);
      edited = true;
    }
    tick(game);
    draw(game, view);
    trace.push(snap(game));
  }
  view.ship?.dispose();
  view.nodes?.dispose();
  view.trail?.dispose();
  expect(edited).toBe(true);
  expect(game.ship.step).toBeGreaterThanOrEqual(280);
  expect(trace[trace.length - 1].nodes).toContain("180:1.5:-0.15");
  return trace;
}

describe("burn animation leaves the flight untouched", () => {
  it("keeps trajectories and fuel bit-identical with the animation on and off", () => {
    const plain = flySlingshot("none");
    const on = flySlingshot("on");
    const off = flySlingshot("off");
  expectTrace(on, plain, "animation on");
  expectTrace(off, plain, "animation off");
    expect(plain[0].fuel).toBeLessThan(passage.fuel);
    const last = plain[plain.length - 1];
    expect(last.status).toBe("won");
    expect(last.step).toBe(slingshotCapture.step);
    expect(last.fuel).toBeLessThan(plain[0].fuel);
    const atLaunchTail = sampleBurnAnim(plain[0].step, dt, slingshotPlan, theme.burn.windup, tailFromBurn(theme.burn));
    expect(atLaunchTail.thrust).toBeGreaterThan(0);
  });

  it("stays bit-identical through slow motion, 4x, pause, and a mid-flight burn edit", () => {
    const plain = flyEdited("none");
    const on = flyEdited("on");
    const off = flyEdited("off");
    expectTrace(on, plain, "edited animation on");
    expectTrace(off, plain, "edited animation off");
    expect(plain.some((sample) => sample.step === 180)).toBe(true);
  });
});
