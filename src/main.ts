import "./style.css";
import { bindInput } from "./game/input";
import { createGame, outcomeCopy, plannedCost, setPlannedDv, tick, type Game } from "./game/state";
import { frameLevel } from "./render/camera";
import { draw } from "./render/draw";
import { createStarfield } from "./render/stars";
import { passage } from "./level/passage";
import type { FlightStatus } from "./sim/physics";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>("#space");
const launchButton = required<HTMLButtonElement>("#launch");
const skipButton = required<HTMLButtonElement>("#skip");
const fuelSpent = required<HTMLElement>("#fuel-spent");
const fuelValue = required<HTMLElement>("#fuel-value");
const burnValue = required<HTMLElement>("#burn-value");
const pathValue = required<HTMLElement>("#path-value");
const fuelLeft = required<HTMLElement>("#fuel-left");
const fuelBurn = required<HTMLElement>("#fuel-burn");
const fpsValue = required<HTMLElement>("#fps");
const overlay = required<HTMLElement>("#overlay");
const overlayTitle = required<HTMLElement>("#overlay-title");
const overlayDetail = required<HTMLElement>("#overlay-detail");
const hint = required<HTMLElement>("#hint");

const context = canvas.getContext("2d");
if (!context) throw new Error("Could not get a canvas drawing context");
const ctx = context;

const game = createGame(passage);
const stars = createStarfield({ minX: -900, maxX: 1700, minY: -700, maxY: 1400 }, 1500);
const resetButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-reset]")];
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-speed]")];

let fps = 0;
let fpsFrames = 0;
let fpsStamp = performance.now();
let framed = false;
let previousMode = game.mode;

bindInput(
  game,
  { canvas, launchButton, skipButton, resetButtons, speedButtons },
  () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
  () => frameLevel(game.camera, canvas.clientWidth, canvas.clientHeight, game.level),
);

window.addEventListener("resize", resize);
resize();
requestAnimationFrame(loop);

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!framed && width > 0 && height > 0) {
    frameLevel(game.camera, width, height, game.level);
    framed = true;
  }
}

function loop(now: number): void {
  fpsFrames += 1;
  if (now - fpsStamp >= 500) {
    fps = (fpsFrames * 1000) / (now - fpsStamp);
    fpsFrames = 0;
    fpsStamp = now;
  }
  tick(game);
  if (game.mode === "capture" && previousMode !== "capture") frameCapture();
  previousMode = game.mode;
  draw(ctx, game, game.camera, stars, canvas.clientWidth, canvas.clientHeight);
  syncHud(game);
  requestAnimationFrame(loop);
}

function syncHud(current: Game): void {
  const budget = current.level.fuel;
  const planningBurn = current.mode === "planning" || current.mode === "capture";
  const planned = planningBurn ? plannedCost(current) : 0;
  const spent = budget - current.fuel;
  const remaining = current.fuel - planned;
  fuelValue.textContent = Math.max(0, remaining).toFixed(1);
  burnValue.textContent = (planningBurn ? planned : spent).toFixed(1);
  fuelSpent.style.width = `${(100 * (planningBurn ? spent : 0)) / budget}%`;
  fuelBurn.style.width = `${(100 * (planningBurn ? planned : spent)) / budget}%`;
  fuelLeft.style.width = `${(100 * Math.max(0, remaining)) / budget}%`;

  const status: FlightStatus | "aim" =
    current.mode === "finished" ? current.ship.status : (current.prediction?.status ?? "aim");
  pathValue.textContent = pathLabel(current, status);
  pathValue.dataset.status = status;
  fpsValue.textContent = `${Math.round(fps)} fps`;

  const capturing = current.mode === "capture";
  launchButton.textContent = capturing ? "Confirm" : "Launch";
  launchButton.disabled = capturing ? planned < 0.25 : current.mode !== "planning" || planned < 0.25;
  skipButton.hidden = !capturing;
  for (const button of speedButtons) {
    button.setAttribute("aria-pressed", button.dataset.speed === String(current.speed) ? "true" : "false");
  }

  const outcome = outcomeCopy(current);
  if (outcome) {
    overlay.hidden = false;
    overlayTitle.textContent = outcome.title;
    overlayDetail.textContent = `${outcome.detail} Fuel used ${spent.toFixed(1)}.`;
    hint.textContent = "Reset returns to planning.";
  } else {
    overlay.hidden = true;
    hint.textContent = hintFor(current.mode);
  }
}

function hintFor(mode: Game["mode"]): string {
  if (mode === "flying") return "The ship is following the planned burn. The trail is where it has been.";
  if (mode === "capture") {
    return "Drag a capture burn. The dotted line is the orbit it will fly. Confirm fires it. Skip leaves the burn unused.";
  }
  return "Drag from the ship to aim. The dotted line is the flight the burn will fly. Drag empty space to pan, scroll to zoom.";
}

function pathLabel(current: Game, status: FlightStatus | "aim"): string {
  if (current.mode === "flying") return "In flight";
  if (current.mode === "finished") {
    if (current.ship.status === "won") return "In orbit";
    if (current.ship.status === "crashed") return "Crashed";
    return "Lost in space";
  }
  const timing = `${current.predictMs.toFixed(1)} ms`;
  if (current.mode === "capture") {
    if (status === "won") return `Captured · ${timing}`;
    if (status === "crashed") return `Crash · ${timing}`;
    if (status === "lost" && current.prediction?.lostReason === "flyby") return `Flyby · ${timing}`;
    if (status === "lost") return `Lost in space · ${timing}`;
    return "Aim a capture burn";
  }
  if (status === "capture") return `Reach X · ${timing}`;
  if (status === "crashed") return `Crash · ${timing}`;
  if (status === "lost") return `Lost in space · ${timing}`;
  return "Aim a burn";
}

function frameCapture(): void {
  const planet = game.level.bodies.find((body) => body.id === game.level.targetId);
  if (!planet?.captureRadius) return;
  const span = Math.min(canvas.clientWidth, canvas.clientHeight);
  game.camera.x = planet.x;
  game.camera.y = planet.y;
  game.camera.zoom = (span * 0.58) / (planet.captureRadius * 2);
}

declare global {
  interface Window {
    __slingshot?: {
      game: Game;
      setDv: (dvx: number, dvy: number) => void;
    };
  }
}

if (import.meta.env.DEV) {
  window.__slingshot = {
    game,
    setDv: (dvx, dvy) => setPlannedDv(game, dvx, dvy),
  };
}
