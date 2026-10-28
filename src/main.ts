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

bindInput(
  game,
  { canvas, launchButton, resetButtons, speedButtons },
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
  draw(ctx, game, game.camera, stars, canvas.clientWidth, canvas.clientHeight);
  syncHud(game);
  requestAnimationFrame(loop);
}

function syncHud(current: Game): void {
  const cost = current.mode === "planning" ? plannedCost(current) : current.level.fuel - current.fuel;
  const remaining = current.mode === "planning" ? current.level.fuel - cost : current.fuel;
  fuelValue.textContent = remaining.toFixed(1);
  burnValue.textContent = cost.toFixed(1);
  const burnWidth = Math.min(100, (cost / current.level.fuel) * 100);
  const leftWidth = Math.min(100, (remaining / current.level.fuel) * 100);
  fuelBurn.style.width = `${burnWidth}%`;
  fuelLeft.style.width = `${leftWidth}%`;

  const status: FlightStatus | "aim" =
    current.mode === "finished" ? current.ship.status : (current.prediction?.status ?? "aim");
  pathValue.textContent = pathLabel(current, status);
  pathValue.dataset.status = status;
  fpsValue.textContent = `${Math.round(fps)} fps`;

  launchButton.disabled = current.mode !== "planning" || cost < 0.25;
  for (const button of speedButtons) {
    button.setAttribute("aria-pressed", button.dataset.speed === String(current.speed) ? "true" : "false");
  }

  const outcome = outcomeCopy(current);
  if (outcome) {
    overlay.hidden = false;
    overlayTitle.textContent = outcome.title;
    overlayDetail.textContent = `${outcome.detail} Fuel used ${cost.toFixed(1)}.`;
    hint.textContent = "Reset returns to planning.";
  } else {
    overlay.hidden = true;
    hint.textContent =
      current.mode === "flying"
        ? "The ship is following the planned burn. The trail is where it has been."
        : "Drag from the ship to aim. The dotted line is the flight the burn will fly. Drag empty space to pan, scroll to zoom.";
  }
}

function pathLabel(current: Game, status: FlightStatus | "aim"): string {
  if (current.mode === "flying") return "In flight";
  if (current.mode === "finished") {
    if (current.ship.status === "won") return "Arrived";
    if (current.ship.status === "crashed") return "Crashed";
    return "Lost in space";
  }
  if (status === "won") return `Capture · ${current.predictMs.toFixed(1)} ms`;
  if (status === "crashed") return `Crash · ${current.predictMs.toFixed(1)} ms`;
  if (status === "lost") return `Lost in space · ${current.predictMs.toFixed(1)} ms`;
  return "Aim a burn";
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
