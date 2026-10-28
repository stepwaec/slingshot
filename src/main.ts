import "./style.css";
import { bindInput } from "./game/input";
import {
  burnHandleOffset,
  canLaunch,
  createGame,
  launch,
  nodeIncoming,
  nodePosition,
  outcomeCopy,
  planFuel,
  selectNode,
  setPlan,
  tick,
  type Game,
} from "./game/state";
import { frameLevel, worldToScreen } from "./render/camera";
import { SpaceView } from "./render/view";
import type { BurnNode } from "./sim/physics";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

const app = required<HTMLElement>("#app");
const canvas = required<HTMLCanvasElement>("#space");
const launchButton = required<HTMLButtonElement>("#launch");
const deleteButton = required<HTMLButtonElement>("#delete");
const fuelValue = required<HTMLElement>("#fuel-value");
const fuelFill = required<HTMLElement>("#fuel-fill");
const modeLabel = required<HTMLElement>("#mode-label");
const telemetry = required<HTMLElement>("#telemetry");
const nodeRow = required<HTMLElement>("#node-row");
const nodeReadout = required<HTMLElement>("#node-readout");
const nodeLayer = required<HTMLElement>("#node-layer");
const aimLabel = required<HTMLElement>("#aim-label");
const planningActions = required<HTMLElement>("#planning-actions");
const flightActions = required<HTMLElement>("#flight-actions");
const fpsValue = required<HTMLElement>("#fps");
const overlay = required<HTMLElement>("#overlay");
const card = required<HTMLElement>(".card");
const overlayTitle = required<HTMLElement>("#overlay-title");
const overlayDetail = required<HTMLElement>("#overlay-detail");

const game = createGame();
const view = new SpaceView(canvas, game);
const resetButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-reset]")];
const clearButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-clear]")];
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-speed]")];
const tagPool: HTMLSpanElement[] = [];

let fps = 0;
let fpsFrames = 0;
let fpsStamp = performance.now();
let framed = false;
let overlayOpen = false;

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
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 2 || height < 2) return;
  view.resize(width, height);
  if (!framed) {
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
  if (canvas.clientWidth > 1 && canvas.clientHeight > 1) view.render(game, now);
  syncHud(game);
  requestAnimationFrame(loop);
}

function syncHud(current: Game): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const budget = current.level.fuel;
  const fuel = planFuel(current);
  const planning = current.mode === "planning";
  app.dataset.mode = current.mode;
  modeLabel.textContent = planning ? "Planning" : "In flight";
  planningActions.hidden = !planning;
  flightActions.hidden = planning;

  const remaining = planning ? fuel.left : current.fuel;
  const ratio = remaining / budget;
  const clamped = Math.max(0, Math.min(1, ratio));
  fuelFill.style.width = clamped <= 0 ? "0px" : `${Math.max(8, Math.round(220 * clamped))}px`;
  fuelFill.dataset.band = clamped >= 0.3 ? "full" : clamped >= 0.1 ? "low" : "critical";
  fuelValue.textContent = `${Math.round(ratio * 100)} %`;
  fuelValue.dataset.band = ratio < -1e-6 ? "critical" : "ok";

  const pose = planning ? current.initial : current.ship;
  const target = current.level.bodies.find((body) => body.id === current.level.targetId);
  const distance = target ? Math.hypot(pose.x - target.x, pose.y - target.y) : 0;
  const speed = Math.hypot(pose.vx, pose.vy);
  const vText = planning ? "  —" : speed.toFixed(2).padStart(5, " ");
  const dText = Math.round(distance).toString().padStart(4, " ");
  telemetry.textContent = `v ${vText}  ·  dX ${dText}`;
  fpsValue.textContent = `${Math.round(fps)} fps`;

  launchButton.disabled = !canLaunch(current);
  deleteButton.disabled = !planning || current.selected === null;
  for (const button of clearButtons) button.disabled = current.mode === "flying";
  for (const button of speedButtons) {
    button.setAttribute("aria-pressed", button.dataset.speed === String(current.speed) ? "true" : "false");
  }

  const showNodes = planning && current.nodes.length > 0;
  nodeRow.hidden = !showNodes;
  if (current.selected === null || !planning) {
    nodeReadout.hidden = true;
  } else {
    nodeReadout.hidden = false;
    const line = nodeLine(current, current.selected, fuel);
    nodeReadout.textContent = line.text;
    nodeReadout.dataset.over = line.over ? "true" : "false";
  }

  syncMarkers(current, width, height, fuel);
  syncOverlay(current, budget);
}

function syncMarkers(
  current: Game,
  width: number,
  height: number,
  fuel: ReturnType<typeof planFuel>,
): void {
  if (current.mode !== "planning" || width < 2) {
    nodeLayer.hidden = true;
    aimLabel.hidden = true;
    return;
  }
  nodeLayer.hidden = false;
  let shown = 0;
  for (let i = 0; i < current.nodes.length; i++) {
    const pos = nodePosition(current, i);
    if (!pos) continue;
    const screen = worldToScreen(current.camera, width, height, pos.x, pos.y);
    let tag = tagPool[shown];
    if (!tag) {
      tag = document.createElement("span");
      tag.className = "node-tag";
      nodeLayer.append(tag);
      tagPool.push(tag);
    }
    tag.hidden = false;
    tag.textContent = String(i + 1);
    tag.style.left = `${screen.x}px`;
    tag.style.top = `${screen.y}px`;
    tag.dataset.over = fuel.costs[i]?.exceeds ? "true" : "false";
    shown += 1;
  }
  for (let i = shown; i < tagPool.length; i++) tagPool[i].hidden = true;

  const selected = current.selected;
  const node = selected === null ? undefined : current.nodes[selected];
  const pos = selected === null ? null : nodePosition(current, selected);
  if (selected === null || !node || !pos) {
    aimLabel.hidden = true;
    return;
  }
  const offset = burnHandleOffset(node.dvx, node.dvy, current.level.dvPerPixel, nodeIncoming(current, selected));
  if (offset.placing) {
    aimLabel.hidden = true;
    return;
  }
  const screen = worldToScreen(current.camera, width, height, pos.x, pos.y);
  const tipX = screen.x + offset.x;
  const tipY = screen.y + offset.y;
  const power = Math.min(1, (fuel.costs[selected]?.cost ?? 0) / current.level.fuel);
  aimLabel.hidden = false;
  aimLabel.textContent = `${Math.round(power * 100)} %`;
  aimLabel.style.left = `${Math.round(tipX + 2)}px`;
  aimLabel.style.top = `${Math.round(tipY + (Math.sin(Math.atan2(offset.y, offset.x)) > 0 ? -14 : 25))}px`;
}

function syncOverlay(current: Game, budget: number): void {
  const outcome = outcomeCopy(current);
  if (!outcome) {
    if (overlayOpen) {
      overlay.classList.remove("is-in");
      overlay.hidden = true;
      overlayOpen = false;
    }
    return;
  }
  const kind = current.ship.status === "won" ? "win" : current.ship.status === "crashed" ? "crash" : "lost";
  card.dataset.result = kind;
  if (kind === "win") {
    const spare = Math.max(0, Math.round((current.fuel / budget) * 100));
    overlayTitle.textContent = "Planet X reached";
    overlayDetail.textContent = `Captured with ${spare} % fuel to spare.`;
  } else if (kind === "crash") {
    overlayTitle.textContent = "Crashed";
    overlayDetail.textContent = outcome.detail;
  } else {
    overlayTitle.textContent = "Lost in space";
    overlayDetail.textContent = outcome.detail;
  }
  if (!overlayOpen) {
    overlay.hidden = false;
    overlay.classList.remove("is-in");
    requestAnimationFrame(() => overlay.classList.add("is-in"));
    overlayOpen = true;
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
