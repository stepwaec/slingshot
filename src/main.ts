import "./style.css";
import { bindInput } from "./game/input";
import {
  canLaunch,
  createGame,
  launch,
  outcomeCopy,
  planFuel,
  selectNode,
  setPlan,
  tick,
  type Game,
} from "./game/state";
import { frameLevel } from "./render/camera";
import { draw } from "./render/draw";
import { createStarfield } from "./render/stars";
import { passage } from "./level/passage";
import type { BurnNode, FlightStatus } from "./sim/physics";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>("#space");
const launchButton = required<HTMLButtonElement>("#launch");
const deleteButton = required<HTMLButtonElement>("#delete");
const fuelSpent = required<HTMLElement>("#fuel-spent");
const fuelValue = required<HTMLElement>("#fuel-value");
const burnLabel = required<HTMLElement>("#burn-label");
const burnValue = required<HTMLElement>("#burn-value");
const pathValue = required<HTMLElement>("#path-value");
const fuelLeft = required<HTMLElement>("#fuel-left");
const fuelBurn = required<HTMLElement>("#fuel-burn");
const nodeRow = required<HTMLElement>("#node-row");
const nodeReadout = required<HTMLElement>("#node-readout");
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
const clearButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-clear]")];
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-speed]")];

let fps = 0;
let fpsFrames = 0;
let fpsStamp = performance.now();
let framed = false;

bindInput(
  game,
  { canvas, launchButton, deleteButton, resetButtons, clearButtons, speedButtons },
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
  const budget = current.level.fuel;
  const fuel = planFuel(current);
  const planning = current.mode === "planning";
  const spent = budget - current.fuel;
  if (planning) {
    burnLabel.textContent = "Plan";
    fuelValue.textContent = fuel.left.toFixed(1);
    burnValue.textContent = fuel.total.toFixed(1);
    fuelSpent.style.width = "0%";
    fuelBurn.style.width = `${Math.min(100, (100 * fuel.total) / budget)}%`;
    fuelLeft.style.width = `${Math.max(0, Math.min(100, (100 * fuel.left) / budget))}%`;
    fuelBurn.classList.toggle("over", !fuel.affordable);
    fuelValue.classList.toggle("over", fuel.left < -1e-6);
  } else {
    burnLabel.textContent = "Spent";
    fuelValue.textContent = current.fuel.toFixed(1);
    burnValue.textContent = spent.toFixed(1);
    fuelSpent.style.width = `${(100 * spent) / budget}%`;
    fuelBurn.style.width = "0%";
    fuelLeft.style.width = `${Math.max(0, (100 * current.fuel) / budget)}%`;
    fuelBurn.classList.remove("over");
    fuelValue.classList.remove("over");
  }

  const status: FlightStatus | "aim" =
    current.mode === "finished" ? current.ship.status : (current.prediction.status ?? "aim");
  const over = planning && !fuel.affordable;
  pathValue.textContent = pathLabel(current, status, over);
  pathValue.dataset.status = over ? "over" : status;
  fpsValue.textContent = `${Math.round(fps)} fps`;

  launchButton.disabled = !canLaunch(current);
  deleteButton.disabled = !planning || current.selected === null;
  for (const button of clearButtons) button.disabled = current.mode === "flying";
  for (const button of speedButtons) {
    button.setAttribute("aria-pressed", button.dataset.speed === String(current.speed) ? "true" : "false");
  }

  const selected = planning ? current.selected : null;
  if (selected === null) {
    nodeRow.hidden = true;
  } else {
    nodeRow.hidden = false;
    const line = nodeLine(current, selected, fuel);
    nodeReadout.textContent = line.text;
    nodeReadout.dataset.over = line.over ? "true" : "false";
  }

  const outcome = outcomeCopy(current);
  if (outcome) {
    overlay.hidden = false;
    overlayTitle.textContent = outcome.title;
    overlayDetail.textContent = `${outcome.detail} Fuel used ${spent.toFixed(1)}.`;
    hint.textContent = "Reset keeps this plan. Clear plan removes every node.";
  } else {
    overlay.hidden = true;
    hint.textContent = hintFor(current.mode);
  }
}

function nodeLine(current: Game, index: number, fuel: ReturnType<typeof planFuel>): { text: string; over: boolean } {
  const node = current.nodes[index];
  const cost = fuel.costs[index];
  const snap = current.prediction.snapshots[index];
  const magnitude = Math.hypot(node.dvx, node.dvy);
  const where = snap?.reached ? `step ${node.step}` : "beyond the flight";
  const base = `Node ${index + 1} of ${current.nodes.length} · ${where} · Δv ${magnitude.toFixed(1)} · cost ${cost.cost.toFixed(1)}`;
  if (cost.exceeds) return { text: `${base} · exceeds fuel`, over: true };
  return { text: `${base} · ${cost.remainingBefore.toFixed(1)} left`, over: false };
}

function hintFor(mode: Game["mode"]): string {
  if (mode === "flying") return "The ship is flying the plan. Each burn fires at its step.";
  return "Click the dotted path to add a burn. Drag a handle to aim it, or drag the node along the path. Delete removes the selected node.";
}

function pathLabel(current: Game, status: FlightStatus | "aim", over: boolean): string {
  if (current.mode === "flying") return "In flight";
  if (current.mode === "finished") {
    if (current.ship.status === "won") return "In orbit";
    if (current.ship.status === "crashed") return "Crashed";
    return "Lost in space";
  }
  const timing = `${current.predictMs.toFixed(1)} ms`;
  if (over) return `Over budget · ${timing}`;
  const hasBurn = current.nodes.some((node) => Math.hypot(node.dvx, node.dvy) >= 0.05);
  if (status === "won") return `In orbit · ${timing}`;
  if (status === "crashed") return `Crash · ${timing}`;
  if (status === "lost" && current.prediction.lostReason === "flyby") return `Flyby · ${timing}`;
  if (status === "lost" && current.prediction.lostReason === "timeout" && !hasBurn) return `Coast · ${timing}`;
  if (status === "lost" && current.prediction.lostReason === "timeout") return `Timeout · ${timing}`;
  if (status === "lost") return `Lost in space · ${timing}`;
  return "Add a burn";
}

declare global {
  interface Window {
    __slingshot?: {
      game: Game;
      setPlan: (nodes: readonly BurnNode[]) => void;
      launch: () => void;
      select: (index: number | null) => void;
    };
  }
}

if (import.meta.env.DEV) {
  window.__slingshot = {
    game,
    setPlan: (nodes) => setPlan(game, nodes),
    launch: () => launch(game),
    select: (index) => selectNode(game, index),
  };
}
