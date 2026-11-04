import { bodyPose, type Body } from "../sim/physics";

/**
 * Position and velocity of a circular orbit around `bodyId` at t = 0.
 * The velocity includes the parent's, so the ship starts with the body.
 * `angle` 0 is the parent's +x side. Positive angles run counterclockwise.
 */
export function shipOnCircle(
  bodies: readonly Body[],
  bodyId: string,
  radius: number,
  angle: number,
  g: number,
): { x: number; y: number; vx: number; vy: number } {
  let body: Body | undefined;
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].id === bodyId) body = bodies[i];
  }
  if (!body) throw new Error(`no body ${bodyId}`);
  if (!(radius > body.radius)) throw new Error(`orbit radius ${radius} is inside ${bodyId}`);
  const pose = bodyPose(body, 0, bodies, g);
  const speed = Math.sqrt((g * body.mass) / radius);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: pose.x + radius * cos,
    y: pose.y + radius * sin,
    vx: pose.vx - speed * sin,
    vy: pose.vy + speed * cos,
  };
}
