import { describe, expect, it } from "vitest";
import { createGame, launch, setPlan, setPreviewSeconds, tick } from "../src/game/state";
import { pathApproaches, showPath } from "../src/render/path-frame";
import type { BurnNode, PathSample } from "../src/sim/physics";
import { moonMission } from "../src/world/moon-mission";

/** Departure, lunar insertion, leave after one lap, Earth capture. */
const reference: BurnNode[] = [
  { step: 0, dvx: -0.8628732259524066, dvy: -6.139662026197736 },
  { step: 1209, dvx: 9.207295198561756, dvy: 8.181441674484159 },
  { step: 2911, dvx: 4.169690499008103, dvy: -2.7592899707137617 },
  { step: 4679, dvx: 3.6546281923744104, dvy: 15.317513431665407 },
];

const plans: { name: string; nodes: BurnNode[] }[] = [
  { name: "reference", nodes: reference },
  {
    name: "insertion nudged",
    nodes: reference.map((node, index) => (index === 1 ? { ...node, dvx: node.dvx + 0.15 } : node)),
  },
  {
    name: "departure nudged",
    nodes: [{ step: 0, dvx: reference[0].dvx, dvy: reference[0].dvy - 0.2 }],
  },
];

const previews = [20, 60, 140];
const cursors: (number | null)[] = [null, 400, 1500];

function sameSample(got: PathSample, want: PathSample): boolean {
  return got.x === want.x && got.y === want.y && got.step === want.step && got.rate === want.rate;
}

describe("predicted positions are the flight", () => {
  it("matches Launch at each preview and scrubber, in the world and in the body frame", () => {
    const lengths = new Map<string, number>();
    let sawMoon = false;
    for (const plan of plans) {
      for (const seconds of previews) {
        for (const cursor of cursors) {
          const label = `${plan.name} preview ${seconds}s cursor ${cursor ?? "none"}`;
          const game = createGame(moonMission);
          setPlan(game, plan.nodes);
          setPreviewSeconds(game, seconds);
          const path = game.prediction.path;
          game.cursorStep = cursor;
          expect(game.prediction.path, label).toBe(path);
          const predicted = path.map((sample) => ({ ...sample }));
          expect(predicted.length, label).toBeGreaterThan(1);
          lengths.set(`${plan.name}:${seconds}`, predicted.length);

          expect(launch(game), label).toBeUndefined();
          const flown: PathSample[] = [];
          let guard = 0;
          while (flown.length < predicted.length && game.mode === "flying" && guard++ < moonMission.maxSteps) {
            tick(game);
            for (let i = 0; i < game.frameSamples.length; i++) flown.push(game.frameSamples[i]);
          }
          expect(flown.length, label).toBeGreaterThanOrEqual(predicted.length);
          for (let i = 0; i < predicted.length; i++) {
            if (!sameSample(flown[i], predicted[i])) {
              throw new Error(
                `${label} diverged at sample ${i} (step ${predicted[i].step}): (${flown[i].x}, ${flown[i].y}) vs (${predicted[i].x}, ${predicted[i].y})`,
              );
            }
          }

          const bodies = moonMission.bodies;
          const drawnPlan = showPath(predicted, bodies, moonMission.g, moonMission.dt, 0);
          const drawnFly = showPath(flown.slice(0, predicted.length), bodies, moonMission.g, moonMission.dt, 0);
          expect(drawnFly.length, label).toBe(drawnPlan.length);
          for (let i = 0; i < drawnPlan.length; i++) {
            const got = drawnFly[i];
            const want = drawnPlan[i];
            if (got.x !== want.x || got.y !== want.y || got.bodyId !== want.bodyId) {
              throw new Error(
                `${label} frame diverged at sample ${i} (step ${predicted[i].step}): ${got.bodyId} (${got.x}, ${got.y}) vs ${want.bodyId} (${want.x}, ${want.y})`,
              );
            }
          }
          if (plan.name === "reference" && seconds === 140 && cursor === null) {
            expect(drawnPlan.some((point) => point.bodyId === "earth")).toBe(true);
            expect(drawnPlan.some((point) => point.bodyId === "luna")).toBe(true);
            const marks = pathApproaches(predicted, bodies, moonMission.g, moonMission.dt, 0);
            expect(marks.some((mark) => mark.bodyId === "luna")).toBe(true);
            sawMoon = true;
          }
        }
      }
    }
    expect(sawMoon).toBe(true);
    // The slider is the coast after the last burn. The nudged departure is still flying, so 20s is a prefix of 140s.
    const short = lengths.get("departure nudged:20") ?? 0;
    const long = lengths.get("departure nudged:140") ?? 0;
    expect(long).toBeGreaterThan(short);
  }, 180_000);
});
