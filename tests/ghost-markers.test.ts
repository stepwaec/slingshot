import { describe, expect, it } from "vitest";
import { createGame, setPlan } from "../src/game/state";
import { movingBodies } from "../src/game/ghosts";
import { lead } from "../src/level/catalog";
import { leadPlan } from "../src/level/solutions";
import {
  aheadFade,
  burnsAhead,
  collisionPulse,
  ghostChip,
  ghostDraw,
  pickGhostKind,
  planGhosts,
  pointAtStep,
  shipInside,
  trackTicks,
} from "../src/render/ghost-look";
import { theme } from "../src/render/theme";

describe("LU2 ghost markers", () => {
  const spec = theme.ghost;

  it("keeps the header sizes and tokens", () => {
    expect(theme.colors.ghostBody).toBe("#DCE4FF");
    expect(theme.colors.ghostCursor).toBe("#FFFFFF");
    expect(theme.colors.ghostTarget).toBe("#3DE0C2");
    expect(theme.colors.ghostCollision).toBe("#FF5A5F");
    expect(theme.colors.ghostGone).toBe("#FF9F43");
    expect(theme.colors.ghostTie).toBe("#8B95B5");
    expect(spec.minRadius).toBe(8);
    expect(spec.ringWidth).toBe(1.2);
    expect(spec.innerRatio).toBe(0.62);
    expect(spec.innerWidth).toBe(0.7);
    expect(spec.innerAlpha).toBe(0.5);
    expect(spec.alphaBurn).toBe(0.85);
    expect(spec.alphaOther).toBe(0.6);
    expect(spec.widthCursor).toBe(1.6);
    expect(spec.widthArrival).toBe(1.4);
    expect(spec.fillCursor).toBe(0.12);
    expect(spec.fillArrival).toBe(0.1);
    expect(spec.fillCollision).toBe(0.14);
    expect(spec.goneDash).toBe(2);
    expect(spec.goneGap).toBe(3);
    expect(spec.collisionPeriod).toBe(0.8);
    expect(spec.collisionLow).toBe(0.45);
    expect(spec.badgeRadius).toBe(6.5);
    expect(spec.chipFont).toBe(10.5);
    expect(spec.tieDash).toBe(1.5);
    expect(spec.tieGap).toBe(3.5);
    expect(spec.pathRing).toBe(2.6);
    expect(spec.pathDot).toBe(4);
    expect(spec.trackWidth).toBe(1.4);
    expect(spec.trackGap).toBe(5);
    expect(spec.tickSeconds).toBe(10);
    expect(spec.captureDash).toBe(6);
    expect(spec.captureCrawl).toBe(12);
    expect(spec.farBurns).toBe(3);
    expect(spec.farAlpha).toBe(0.3);
  });

  it("picks a state in the header order", () => {
    const base = { present: true, colliding: false, arrival: false, cursor: false, target: true };
    expect(pickGhostKind({ ...base, present: false, colliding: true })).toBe("gone");
    expect(pickGhostKind({ ...base, colliding: true, arrival: true })).toBe("collision");
    expect(pickGhostKind({ ...base, arrival: true, cursor: true })).toBe("arrival");
    expect(pickGhostKind({ ...base, cursor: true })).toBe("cursor");
    expect(pickGhostKind(base)).toBe("burn");
    expect(pickGhostKind({ ...base, target: false })).toBe("other");
    expect(pickGhostKind({ ...base, target: false, cursor: true })).toBe("other");
  });

  it("paints the cursor fill in the body colour and keeps the white ring", () => {
    const cursor = ghostDraw("cursor", spec);
    expect(cursor.ink).toBe("cursor");
    expect(cursor.fillInk).toBe("body");
    expect(cursor.width).toBe(1.6);
    expect(cursor.badge).toBe(false);
    const burn = ghostDraw("burn", spec);
    expect(burn.badge).toBe(true);
    expect(burn.alpha).toBe(0.85);
    const gone = ghostDraw("gone", spec);
    expect(gone.fillInk).toBe("none");
    expect(gone.dash).toBe(2);
    expect(gone.mark).toBe(2);
    const hit = ghostDraw("collision", spec);
    expect(hit.mark).toBe(1);
    expect(hit.inner).toBe(false);
    const arrival = ghostDraw("arrival", spec);
    expect(arrival.capture).toBe(true);
    expect(arrival.ink).toBe("target");
  });

  it("writes the sample chip sentences", () => {
    expect(ghostChip("burn", 24)).toBe("+0:24");
    expect(ghostChip("cursor", 51)).toBe("+0:51");
    expect(ghostChip("arrival", 70)).toBe("arrive 1:10");
    expect(ghostChip("collision", 48)).toBe("collision 0:48");
    expect(ghostChip("gone", 102)).toBe("gone at 1:42");
    expect(ghostChip("other", 10)).toBeNull();
  });

  it("fades only ghosts more than three burns ahead", () => {
    const nodes = [{ step: 10 }, { step: 20 }, { step: 30 }, { step: 40 }, { step: 50 }];
    expect(burnsAhead(nodes, 0, 30)).toBe(3);
    expect(burnsAhead(nodes, 0, 40)).toBe(4);
    expect(aheadFade(3, spec.farBurns, spec.farAlpha, 0.85)).toBe(1);
    expect(aheadFade(4, spec.farBurns, spec.farAlpha, 0.85)).toBeCloseTo(0.3 / 0.85);
  });

  it("rests the collision pulse at full alpha", () => {
    expect(collisionPulse(0, 0.8, 1, 0.45)).toBeCloseTo(1);
    expect(collisionPulse(0.4, 0.8, 1, 0.45)).toBeCloseTo(0.45);
  });

  it("ticks the future track every 10 s, strictly inside the window", () => {
    expect(trackTicks(0, 25, 10)).toEqual([10, 20]);
    expect(trackTicks(10, 20, 10)).toEqual([]);
  });

  it("finds a path sample and a hit inside the body", () => {
    const path = [
      { step: 1, x: 0, y: 0 },
      { step: 4, x: 10, y: 0 },
      { step: 9, x: 3, y: 4 },
    ];
    expect(pointAtStep(path, 4)).toEqual({ step: 4, x: 10, y: 0 });
    expect(pointAtStep(path, 5)).toBeNull();
    expect(shipInside(0, 0, 3, 4, 5)).toBe(true);
    expect(shipInside(0, 0, 3, 4, 4)).toBe(false);
  });

  it("draws one cursor ghost and keeps the arrival on the target", () => {
    const nodes = [{ step: 0 }, { step: 40 }, { step: 80 }];
    const slots = planGhosts(nodes, 55, 0, 3, 1, 80);
    const atLaunch = slots.filter((slot) => slot.step === 0);
    expect(atLaunch).toHaveLength(0);
    expect(slots.filter((slot) => slot.step === 40)).toHaveLength(3);
    const cursor = slots.filter((slot) => slot.step === 55);
    expect(cursor).toEqual([
      { step: 55, bodyIndex: 1, burnNumber: null, cursor: true, arrival: false },
    ]);
    const arrival = slots.filter((slot) => slot.arrival);
    expect(arrival).toHaveLength(1);
    expect(arrival[0].bodyIndex).toBe(1);
    expect(arrival[0].step).toBe(80);
    expect(arrival[0].burnNumber).toBe(3);
  });

  it("marks Lead's winning step as the arrival and leaves the prediction alone", () => {
    const game = createGame(lead);
    setPlan(game, leadPlan);
    const prediction = game.prediction;
    expect(prediction.status).toBe("won");
    const moving = movingBodies(lead.bodies);
    const targetIndex = moving.findIndex((body) => body.id === lead.targetId);
    expect(targetIndex).toBe(0);
    const capture = prediction.steps;
    const slots = planGhosts(leadPlan, 120, 0, moving.length, targetIndex, capture);
    game.cursorStep = 120;
    expect(game.prediction).toBe(prediction);
    const atCapture = slots.filter((slot) => slot.step === capture && slot.bodyIndex === targetIndex);
    expect(atCapture).toHaveLength(1);
    expect(atCapture[0].arrival).toBe(true);
    expect(slots.filter((slot) => slot.step === 120)).toHaveLength(1);
    expect(slots.some((slot) => slot.step === 0)).toBe(false);
  });
});
