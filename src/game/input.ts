import {
  addNode,
  buildMoveRail,
  burnHandleOffset,
  clearPlan,
  deleteSelected,
  isEditing,
  cycleGravity,
  launch,
  toggleMagnetism,
  moveNodeAlong,
  nodeIncoming,
  nodePosition,
  pause,
  reset,
  resume,
  selectNode,
  setGravityClock,
  setNodeBurn,
  setSlow,
  setSpeed,
  type Game,
  type RailSample,
} from "./state";
import { panBy, worldToScreen, zoomAt } from "../render/camera";
import { hasMagneticBody, SIM_SPEEDS, type SimSpeed } from "../sim/physics";

export interface InputElements {
  canvas: HTMLCanvasElement;
  launchButton: HTMLButtonElement;
  deleteButton: HTMLButtonElement;
  /** Small × drawn next to the selected node. */
  nodeRemove: HTMLButtonElement;
  resetButtons: HTMLButtonElement[];
  clearButtons: HTMLButtonElement[];
  speedButtons: HTMLButtonElement[];
  pauseButton: HTMLButtonElement;
  resumeButton: HTMLButtonElement;
  slowButton: HTMLButtonElement;
  gravityButton: HTMLButtonElement;
  gravityClockButton: HTMLButtonElement;
  magnetismButton: HTMLButtonElement;
}

const HANDLE_RADIUS = 16;
const NODE_RADIUS = 12;
const PATH_RADIUS = 12;
const DRAG_THRESHOLD = 5;

type Hit =
  | { type: "handle"; index: number }
  | { type: "node"; index: number }
  | { type: "path"; step: number }
  | { type: "empty" };

type Drag =
  | { kind: "pan"; lastX: number; lastY: number; moved: boolean }
  | { kind: "handle"; index: number }
  | { kind: "node"; index: number; rail: RailSample[] }
  | { kind: "pending"; hit: Hit; x: number; y: number };

export function bindInput(
  game: Game,
  elements: InputElements,
  getSize: () => { width: number; height: number },
  onReset?: () => void,
): void {
  const { canvas } = elements;
  let pointerId: number | null = null;
  let drag: Drag | null = null;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointerId !== null) return;
    pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const size = getSize();
    const hit = hitTest(game, size.width, size.height, event.offsetX, event.offsetY);
    if (isEditing(game) && hit.type === "handle") {
      selectNode(game, hit.index);
      drag = { kind: "handle", index: hit.index };
      canvas.classList.add("aiming");
      return;
    }
    if (isEditing(game) && (hit.type === "node" || hit.type === "path")) {
      if (hit.type === "node") selectNode(game, hit.index);
      drag = { kind: "pending", hit, x: event.offsetX, y: event.offsetY };
      return;
    }
    drag = { kind: "pan", lastX: event.offsetX, lastY: event.offsetY, moved: false };
    canvas.classList.add("panning");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId || drag === null) return;
    if (drag.kind === "pending") {
      if (Math.hypot(event.offsetX - drag.x, event.offsetY - drag.y) < DRAG_THRESHOLD) return;
      if (drag.hit.type === "node") {
        const rail = buildMoveRail(game, drag.hit.index);
        drag = { kind: "node", index: drag.hit.index, rail };
        canvas.classList.add("aiming");
      } else {
        drag = { kind: "pan", lastX: drag.x, lastY: drag.y, moved: true };
        canvas.classList.add("panning");
      }
    }
    if (drag.kind === "pan") {
      panBy(game.camera, event.offsetX - drag.lastX, event.offsetY - drag.lastY);
      drag.lastX = event.offsetX;
      drag.lastY = event.offsetY;
      drag.moved = true;
      return;
    }
    if (drag.kind === "handle") {
      aimHandle(game, getSize(), drag.index, event.offsetX, event.offsetY);
      return;
    }
    slideNode(game, getSize(), drag.index, drag.rail, event.offsetX, event.offsetY);
  });

  const endPointer = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const finished = drag;
    pointerId = null;
    drag = null;
    canvas.classList.remove("aiming", "panning");
    if (!finished || !isEditing(game)) return;
    if (finished.kind === "pending" && finished.hit.type === "path") addNode(game, finished.hit.step);
    if (finished.kind === "pending" && finished.hit.type === "node") selectNode(game, finished.hit.index);
    if (finished.kind === "pan" && !finished.moved) selectNode(game, null);
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const size = getSize();
      const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomAt(game.camera, size.width, size.height, event.offsetX, event.offsetY, Math.exp(-dy * 0.0011));
    },
    { passive: false },
  );

  const doReset = () => {
    reset(game);
    onReset?.();
  };

  elements.launchButton.addEventListener("click", () => launch(game));
  elements.pauseButton.addEventListener("click", () => pause(game));
  elements.resumeButton.addEventListener("click", () => resume(game));
  elements.slowButton.addEventListener("click", () => setSlow(game, !game.slow));
  elements.gravityButton.addEventListener("click", () => cycleGravity(game));
  elements.gravityClockButton.addEventListener("click", () => setGravityClock(game, !game.gravityClock));
  elements.magnetismButton.addEventListener("click", () => {
    if (!hasMagneticBody(game.level.bodies)) return;
    toggleMagnetism(game);
  });
  elements.deleteButton.addEventListener("click", () => deleteSelected(game));
  elements.nodeRemove.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteSelected(game);
  });
  for (const button of elements.resetButtons) button.addEventListener("click", doReset);
  for (const button of elements.clearButtons) button.addEventListener("click", () => clearPlan(game));
  for (const button of elements.speedButtons) {
    button.addEventListener("click", () => {
      const speed = Number(button.dataset.speed);
      if (isSimSpeed(speed)) setSpeed(game, speed);
    });
  }

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (game.mode === "planning") launch(game);
      else if (game.mode === "flying") pause(game);
      else if (game.mode === "paused") resume(game);
    } else if (event.key === "p" || event.key === "P") {
      if (game.mode === "flying") pause(game);
      else if (game.mode === "paused") resume(game);
    } else if (event.key === "s" || event.key === "S") {
      setSlow(game, !game.slow);
    } else if (event.key === "r" || event.key === "R") {
      doReset();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (game.selected === null || !isEditing(game)) return;
      event.preventDefault();
      if (event.repeat) return;
      deleteSelected(game);
    } else if (event.key === "Escape") {
      selectNode(game, null);
    } else if (event.key === "g" || event.key === "G") {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      cycleGravity(game);
    } else if (event.key === "c" || event.key === "C") {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (game.gravity !== "grid") return;
      setGravityClock(game, !game.gravityClock);
    } else if (event.key === "m" || event.key === "M") {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!hasMagneticBody(game.level.bodies)) return;
      toggleMagnetism(game);
    } else if (event.key === "1" || event.key === "2" || event.key === "4") {
      setSpeed(game, Number(event.key) as SimSpeed);
    }
  });
}

function aimHandle(
  game: Game,
  size: { width: number; height: number },
  index: number,
  sx: number,
  sy: number,
): void {
  const origin = nodePosition(game, index);
  if (!origin) return;
  const screen = worldToScreen(game.camera, size.width, size.height, origin.x, origin.y);
  const dx = sx - screen.x;
  const dy = sy - screen.y;
  const pixels = Math.hypot(dx, dy);
  if (pixels < 2) {
    setNodeBurn(game, index, 0, 0);
    return;
  }
  const dv = pixels * game.level.dvPerPixel;
  setNodeBurn(game, index, (dx / pixels) * dv, (-dy / pixels) * dv);
}

function slideNode(
  game: Game,
  size: { width: number; height: number },
  index: number,
  rail: readonly RailSample[],
  sx: number,
  sy: number,
): void {
  if (rail.length === 0) return;
  let best = rail[0];
  let bestD = Infinity;
  for (let i = 0; i < rail.length; i++) {
    const sample = rail[i];
    const screen = worldToScreen(game.camera, size.width, size.height, sample.x, sample.y);
    const d = (screen.x - sx) * (screen.x - sx) + (screen.y - sy) * (screen.y - sy);
    if (d < bestD) {
      bestD = d;
      best = sample;
    }
  }
  moveNodeAlong(game, index, rail, best);
}

function hitTest(game: Game, width: number, height: number, sx: number, sy: number): Hit {
  if (!isEditing(game)) return { type: "empty" };
  const handle = closestHandle(game, width, height, sx, sy);
  if (handle !== null) return { type: "handle", index: handle };
  const node = closestNode(game, width, height, sx, sy);
  if (node !== null) return { type: "node", index: node };
  const step = closestPathStep(game, width, height, sx, sy);
  if (step !== null) return { type: "path", step };
  return { type: "empty" };
}

function closestHandle(game: Game, width: number, height: number, sx: number, sy: number): number | null {
  let best = -1;
  let bestD = HANDLE_RADIUS * HANDLE_RADIUS;
  for (let i = 0; i < game.nodes.length; i++) {
    const place = handlePoint(game, width, height, i);
    if (!place) continue;
    const d = (place.x - sx) * (place.x - sx) + (place.y - sy) * (place.y - sy);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? null : best;
}

function closestNode(game: Game, width: number, height: number, sx: number, sy: number): number | null {
  let best = -1;
  let bestD = NODE_RADIUS * NODE_RADIUS;
  for (let i = 0; i < game.nodes.length; i++) {
    const pos = nodePosition(game, i);
    if (!pos) continue;
    const screen = worldToScreen(game.camera, width, height, pos.x, pos.y);
    const d = (screen.x - sx) * (screen.x - sx) + (screen.y - sy) * (screen.y - sy);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? null : best;
}

function closestPathStep(game: Game, width: number, height: number, sx: number, sy: number): number | null {
  let bestStep: number | null = null;
  let bestD = PATH_RADIUS * PATH_RADIUS;
  const pose = game.mode === "paused" ? game.ship : game.initial;
  const origin = worldToScreen(game.camera, width, height, pose.x, pose.y);
  const originD = (origin.x - sx) * (origin.x - sx) + (origin.y - sy) * (origin.y - sy);
  if (originD <= 16 * 16) {
    bestD = originD;
    bestStep = pose.step;
  }
  const path = game.prediction.path;
  // The step that ended the flight is already lost or won; a new burn there never fires.
  const closed = game.prediction.final.status !== "flying" ? game.prediction.final.step : -1;
  for (let i = 0; i < path.length; i++) {
    if (path[i].step === closed) continue;
    const screen = worldToScreen(game.camera, width, height, path[i].x, path[i].y);
    const d = (screen.x - sx) * (screen.x - sx) + (screen.y - sy) * (screen.y - sy);
    if (d <= bestD) {
      bestD = d;
      bestStep = path[i].step;
    }
  }
  return bestStep;
}

function handlePoint(game: Game, width: number, height: number, index: number): { x: number; y: number } | null {
  const pos = nodePosition(game, index);
  if (!pos) return null;
  const node = game.nodes[index];
  const screen = worldToScreen(game.camera, width, height, pos.x, pos.y);
  const offset = burnHandleOffset(node.dvx, node.dvy, game.level.dvPerPixel, nodeIncoming(game, index));
  return { x: screen.x + offset.x, y: screen.y + offset.y };
}

function isSimSpeed(value: number): value is SimSpeed {
  return (SIM_SPEEDS as readonly number[]).includes(value);
}
