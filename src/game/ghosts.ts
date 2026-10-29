import type { Body, BurnNode } from "../sim/physics";

/**
 * Sim steps at which planning draws a ghost of each moving body.
 * A maneuver node contributes its step. The path sample under the cursor
 * contributes its step. The step the bodies are already drawn at is left out,
 * and a step is listed once. This does not read or write the flight.
 */
export function ghostSteps(
  nodes: readonly Pick<BurnNode, "step">[],
  cursorStep: number | null,
  drawnStep: number,
): number[] {
  const steps: number[] = [];
  const seen = new Set<number>();
  const add = (step: number) => {
    if (step === drawnStep || seen.has(step)) return;
    seen.add(step);
    steps.push(step);
  };
  for (let i = 0; i < nodes.length; i++) add(nodes[i].step);
  if (cursorStep !== null) add(cursorStep);
  return steps;
}

/** Bodies whose pose is a function of sim time. Static worlds are not ghosted. */
export function movingBodies(bodies: readonly Body[]): Body[] {
  const moving: Body[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.orbit || body.drift) moving.push(body);
  }
  return moving;
}
