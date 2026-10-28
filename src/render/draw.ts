import type { Game } from "../game/state";
import { sampleOrbit, type FlightStatus, type Vec2 } from "../sim/physics";
import { simConfigFromLevel } from "../level/passage";
import { worldToScreen, type Camera } from "./camera";
import type { Star } from "./stars";

const BUCKET_COLOR = ["rgba(232, 236, 244, 0.45)", "rgba(236, 240, 248, 0.72)", "rgba(255, 250, 240, 0.95)"];

export function draw(
  ctx: CanvasRenderingContext2D,
  game: Game,
  camera: Camera,
  stars: readonly Star[],
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#070910";
  ctx.fillRect(0, 0, width, height);
  drawStars(ctx, camera, stars, width, height);

  const home = game.level.bodies.find((body) => body.id === game.level.orbit.bodyId);
  if (home) {
    const center = worldToScreen(camera, width, height, home.x, home.y);
    ctx.beginPath();
    ctx.arc(center.x, center.y, game.level.orbit.radius * camera.zoom, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(176, 196, 224, 0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const body of game.level.bodies) {
    if (body.captureRadius === undefined) continue;
    const center = worldToScreen(camera, width, height, body.x, body.y);
    ctx.beginPath();
    ctx.arc(center.x, center.y, body.captureRadius * camera.zoom, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(169, 224, 180, 0.9)";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const body of game.level.bodies) drawBody(ctx, camera, width, height, body);

  const aiming = game.mode === "planning" || game.mode === "capture";
  const pose = game.mode === "planning" ? game.initial : game.ship;
  if (aiming && game.prediction && game.prediction.path.length > 0) {
    strokePath(ctx, camera, width, height, [pose, ...game.prediction.path], pathColor(game.prediction.status), true);
  }
  const predictedOrbit = game.prediction?.orbit;
  const wonOrbit =
    game.mode === "finished" && game.ship.status === "won"
      ? sampleOrbit(game.ship, targetOf(game), simConfigFromLevel(game.level).g)
      : null;
  const orbit = predictedOrbit ?? wonOrbit;
  if (orbit && orbit.length > 1) {
    strokePath(ctx, camera, width, height, [...orbit, orbit[0]], "rgba(167, 224, 178, 0.95)", true);
  }

  if (game.trail.length > 1) {
    strokePath(ctx, camera, width, height, game.trail, "rgba(255, 178, 92, 0.95)", false);
  }

  const aim = plannedVelocity(game);
  if (aiming && aim.mag > 0.05) {
    drawBurn(ctx, camera, width, height, game, pose);
  }

  const nose = aiming ? aim.velocity : { x: pose.vx, y: pose.vy };
  const screen = worldToScreen(camera, width, height, pose.x, pose.y);
  drawShip(ctx, screen.x, screen.y, Math.atan2(-nose.y, nose.x));

  ctx.font = "12px system-ui, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const body of game.level.bodies) {
    const label = worldToScreen(camera, width, height, body.x, body.y);
    const y = label.y + body.radius * camera.zoom + 8;
    const text = body.kind === "star" ? "Star" : body.name;
    ctx.fillStyle = "rgba(5, 8, 14, 0.75)";
    ctx.fillText(text, label.x + 1, y + 1);
    ctx.fillStyle = "#d7deea";
    ctx.fillText(text, label.x, y);
  }
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  stars: readonly Star[],
  width: number,
  height: number,
): void {
  for (let bucket = 0; bucket < 3; bucket++) {
    ctx.beginPath();
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      if (star.bucket !== bucket) continue;
      const screen = worldToScreen(camera, width, height, star.x, star.y);
      if (screen.x < -4 || screen.y < -4 || screen.x > width + 4 || screen.y > height + 4) continue;
      ctx.moveTo(screen.x + star.radius, screen.y);
      ctx.arc(screen.x, screen.y, star.radius, 0, Math.PI * 2);
    }
    ctx.fillStyle = BUCKET_COLOR[bucket];
    ctx.fill();
  }
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  points: readonly Vec2[],
  color: string,
  dashed: boolean,
): void {
  ctx.beginPath();
  const first = worldToScreen(camera, width, height, points[0].x, points[0].y);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    const screen = worldToScreen(camera, width, height, points[i].x, points[i].y);
    ctx.lineTo(screen.x, screen.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = dashed ? 1.4 : 1.75;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash(dashed ? [2, 7] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  body: Game["level"]["bodies"][number],
): void {
  const screen = worldToScreen(camera, width, height, body.x, body.y);
  const radius = Math.max(2, body.radius * camera.zoom);
  if (body.kind === "star") {
    const glow = ctx.createRadialGradient(screen.x, screen.y, radius * 0.2, screen.x, screen.y, radius * 3.4);
    glow.addColorStop(0, "rgba(255, 214, 140, 0.55)");
    glow.addColorStop(0.45, "rgba(255, 160, 70, 0.16)");
    glow.addColorStop(1, "rgba(255, 140, 40, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const highlightX = screen.x - radius * 0.32;
  const highlightY = screen.y - radius * 0.36;
  const gradient = ctx.createRadialGradient(highlightX, highlightY, radius * 0.1, screen.x, screen.y, radius);
  const palette = bodyPalette(body.kind);
  gradient.addColorStop(0, palette.highlight);
  gradient.addColorStop(0.62, palette.base);
  gradient.addColorStop(1, palette.edge);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function bodyPalette(kind: Game["level"]["bodies"][number]["kind"]): { highlight: string; base: string; edge: string } {
  if (kind === "star") return { highlight: "#fff6d8", base: "#ffc14d", edge: "#e07a1a" };
  if (kind === "target") return { highlight: "#ffd0c2", base: "#e36a45", edge: "#8c2e22" };
  return { highlight: "#d5e6ff", base: "#3d7ed8", edge: "#1a3d78" };
}

function drawBurn(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  game: Game,
  origin: { x: number; y: number },
): void {
  const mag = Math.hypot(game.plannedDv.x, game.plannedDv.y);
  const pixels = mag / game.level.dvPerPixel;
  const world = pixels / camera.zoom;
  const dirX = game.plannedDv.x / mag;
  const dirY = game.plannedDv.y / mag;
  const start = worldToScreen(camera, width, height, origin.x, origin.y);
  const end = worldToScreen(camera, width, height, origin.x + dirX * world, origin.y + dirY * world);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = "rgba(244, 247, 252, 0.92)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - 8 * Math.cos(angle - 0.4), end.y - 8 * Math.sin(angle - 0.4));
  ctx.lineTo(end.x - 8 * Math.cos(angle + 0.4), end.y - 8 * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fillStyle = "rgba(244, 247, 252, 0.92)";
  ctx.fill();
}

function drawShip(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-8, 6.2);
  ctx.lineTo(-4.5, 0);
  ctx.lineTo(-8, -6.2);
  ctx.closePath();
  ctx.fillStyle = "#f4f7fb";
  ctx.fill();
  ctx.strokeStyle = "rgba(8, 12, 20, 0.65)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function pathColor(status: FlightStatus): string {
  if (status === "won") return "rgba(167, 224, 178, 0.95)";
  if (status === "crashed") return "rgba(240, 168, 160, 0.95)";
  if (status === "capture") return "rgba(148, 196, 255, 0.95)";
  return "rgba(196, 206, 222, 0.92)";
}

function targetOf(game: Game) {
  const body = game.level.bodies.find((item) => item.id === game.level.targetId);
  if (!body) throw new Error("Level is missing Planet X");
  return body;
}

function plannedVelocity(game: Game): { mag: number; velocity: Vec2 } {
  const pose = game.mode === "planning" ? game.initial : game.ship;
  const velocity = {
    x: pose.vx + game.plannedDv.x,
    y: pose.vy + game.plannedDv.y,
  };
  return { mag: Math.hypot(game.plannedDv.x, game.plannedDv.y), velocity };
}
