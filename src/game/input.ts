import {
  addNode,
  buildMoveRail,
  burnHandleOffset,
  clearGuideHint,
  clearPlan,
  currentPreviewSeconds,
  deleteSelected,
  isEditing,
  launch,
  moveNodeAlong,
  nodeIncoming,
  nodePosition,
  openBodyGuide,
  pause,
  refreshGuide,
  reset,
  resume,
  selectNode,
  setNodeBurn,
  setPreviewSeconds,
  setSlow,
  setSpeed,
  speedAllowed,
  type Game,
  type RailSample,
} from "./state";
import { applyLayerKey, closeLayersOnEscape, type LayersPanelState } from "./layers";
import { panBy, wheelZoomFactor, worldToScreen, zoomAt } from "../render/camera";
import { shownNow, shownPath, shownPoint } from "../render/path-frame";
import { isSolChart, solDrawnRadius } from "../render/sol-scale";
import { theme } from "../render/theme";
import { bodyPose, SIM_SPEEDS, SPEED_KEY, type SimSpeed } from "../sim/physics";

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
  layersButton: HTMLButtonElement;
  /** UI-only. Opening the panel does not touch the sim. */
  layersPanel: LayersPanelState;
}

const HANDLE_RADIUS = 16;
const NODE_RADIUS = 12;
const PATH_RADIUS = 12;
/** Grab radius for the fade tip, in CSS pixels. Larger than the drawn end ring so it can be pulled. */
const TIP_RADIUS = 32;
/**
 * Screen pixels of tip drag for one second of preview.
 * The coast grows from the current end; it is not a 1:1 pull along the ship's speed.
 */
const TIP_PIXELS_PER_SECOND = 4;
/** Precise disc on the selected node's ×. The drawn marker is larger and ignores pointers. */
export const REMOVE_RADIUS = 4;
const DRAG_THRESHOLD = 5;

export type PlanningHit =
  | { type: "remove" }
  | { type: "handle"; index: number }
  | { type: "node"; index: number }
  | { type: "tip" }
  | { type: "body"; id: string }
  | { type: "path"; step: number }
  | { type: "empty" };

type Drag =
  | { kind: "pan"; lastX: number; lastY: number; moved: boolean }
  | { kind: "handle"; index: number }
  | { kind: "node"; index: number; rail: RailSample[] }
  | { kind: "tip"; x: number; y: number; base: number; raw: number | null; dirX: number; dirY: number }
  | { kind: "pending"; hit: PlanningHit; x: number; y: number };

/**
 * Move the fade tip. `alongPx` is signed screen pixels along the outgoing tangent.
 * Positive grows the coast from the length at pointer-down. The same `step` flies it.
 */
export function extendTip(game: Game, alongPx: number, baseSeconds: number): void {
  const dt = game.level.dt > 0 ? game.level.dt : 1 / 60;
  const raw = baseSeconds + alongPx / TIP_PIXELS_PER_SECOND;
  const snapped = Math.max(dt, Math.round(raw / dt) * dt);
  setPreviewSeconds(game, snapped, false);
}

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
    const hit = planningPointerHit(game, size.width, size.height, event.offsetX, event.offsetY);
    if (isEditing(game) && hit.type === "handle") {
      selectNode(game, hit.index);
      drag = { kind: "handle", index: hit.index };
      canvas.classList.add("aiming");
      return;
    }
    if (isEditing(game) && (hit.type === "node" || hit.type === "path" || hit.type === "remove" || hit.type === "tip" || hit.type === "body")) {
      if (hit.type === "node") selectNode(game, hit.index);
      drag = { kind: "pending", hit, x: event.offsetX, y: event.offsetY };
      return;
    }
    drag = { kind: "pan", lastX: event.offsetX, lastY: event.offsetY, moved: false };
    canvas.classList.add("panning");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (pointerId === null || drag === null || event.pointerId !== pointerId) {
      const size = getSize();
      const editing = isEditing(game);
      game.cursorStep = editing ? closestPathStep(game, size.width, size.height, event.offsetX, event.offsetY) : null;
      const over =
        editing &&
        overTip(game, size.width, size.height, event.offsetX, event.offsetY) &&
        tipOwnsClick(game, size.width, size.height, event.offsetX, event.offsetY);
      canvas.classList.toggle("extending", over);
      return;
    }
    game.cursorStep = null;
    if (drag.kind === "pending") {
      if (Math.hypot(event.offsetX - drag.x, event.offsetY - drag.y) < DRAG_THRESHOLD) return;
      if (drag.hit.type === "node") {
        const rail = buildMoveRail(game, drag.hit.index);
        drag = { kind: "node", index: drag.hit.index, rail };
        canvas.classList.add("aiming");
      } else if (drag.hit.type === "tip") {
        const size = getSize();
        const aim = tipDirection(game, size.width, size.height);
        drag = {
          kind: "tip",
          x: drag.x,
          y: drag.y,
          base: currentPreviewSeconds(game),
          raw: game.previewSeconds,
          dirX: aim.x,
          dirY: aim.y,
        };
        canvas.classList.add("extending");
      } else {
        drag = { kind: "pan", lastX: drag.x, lastY: drag.y, moved: true };
        canvas.classList.add("panning");
      }
    }
    if (drag.kind === "pan") {
      game.follow = false;
      panBy(game.camera, event.offsetX - drag.lastX, event.offsetY - drag.lastY);
      drag.lastX = event.offsetX;
      drag.lastY = event.offsetY;
      drag.moved = true;
      return;
    }
    if (drag.kind === "handle") {
      aimHandle(game, getSize(), drag.index, event.offsetX, event.offsetY, event.shiftKey);
      return;
    }
    if (drag.kind === "tip") {
      const along = (event.offsetX - drag.x) * drag.dirX + (event.offsetY - drag.y) * drag.dirY;
      extendTip(game, along, drag.base);
      return;
    }
    slideNode(game, getSize(), drag.index, drag.rail, event.offsetX, event.offsetY);
  });

  const endPointer = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const finished = drag;
    pointerId = null;
    drag = null;
    canvas.classList.remove("aiming", "panning", "extending");
    if (!finished || !isEditing(game)) return;
    if (finished.kind === "pending") settlePlanningClick(game, finished.hit);
    if (finished.kind === "pan" && !finished.moved) {
      selectNode(game, null);
      clearGuideHint(game);
    }
    if (finished.kind === "handle" || finished.kind === "node") refreshGuide(game);
    if (finished.kind === "tip") {
      if (game.previewSeconds !== finished.raw) game.guideDismissed = false;
      refreshGuide(game);
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", () => {
    game.cursorStep = null;
    if (drag === null) canvas.classList.remove("extending");
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const size = getSize();
      // ctrlKey is a trackpad pinch. Same curve as a mouse wheel.
      zoomAt(
        game.camera,
        size.width,
        size.height,
        event.offsetX,
        event.offsetY,
        wheelZoomFactor(event.deltaY, event.deltaMode),
      );
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
  elements.layersButton.addEventListener("click", () => {
    elements.layersPanel.open = !elements.layersPanel.open;
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
      if (isSimSpeed(speed) && speedAllowed(game.level, speed)) setSpeed(game, speed);
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
      if (closeLayersOnEscape(elements.layersPanel, event)) event.preventDefault();
      else if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) selectNode(game, null);
    } else if (applyLayerKey(game, elements.layersPanel, event)) {
      event.preventDefault();
    } else if (applySpeedKey(game, event)) {
      event.preventDefault();
    }
  });
}

/** Shift drags at a quarter of the level's Δv per pixel. */
const FINE_BOOST = 0.25;

/** Drag the boost handle. Past burns are refused by `setNodeBurn`. */
export function aimHandle(
  game: Game,
  size: { width: number; height: number },
  index: number,
  sx: number,
  sy: number,
  fine = false,
): void {
  const origin = nodePosition(game, index);
  if (!origin) return;
  const shown = shownPoint(game, origin.x, origin.y, game.nodes[index].step);
  const screen = worldToScreen(game.camera, size.width, size.height, shown.x, shown.y);
  const dx = sx - screen.x;
  const dy = sy - screen.y;
  const pixels = Math.hypot(dx, dy);
  if (pixels < 2) {
    setNodeBurn(game, index, 0, 0);
    return;
  }
  const dv = pixels * game.level.dvPerPixel * (fine ? FINE_BOOST : 1);
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
  const framed = shownPath(game, rail);
  for (let i = 0; i < rail.length; i++) {
    const sample = rail[i];
    const at = framed[i] ?? sample;
    const screen = worldToScreen(game.camera, size.width, size.height, at.x, at.y);
    const d = (screen.x - sx) * (screen.x - sx) + (screen.y - sy) * (screen.y - sy);
    if (d < bestD) {
      bestD = d;
      best = sample;
    }
  }
  moveNodeAlong(game, index, rail, best);
}

/**
 * What a planning click means. A press that does not drag settles as this.
 * The × deletes only on a precise hit; a drag that starts there pans instead.
 */
export function settlePlanningClick(game: Game, hit: PlanningHit): void {
  if (!isEditing(game)) return;
  if (hit.type === "remove") deleteSelected(game);
  else if (hit.type === "path") addNode(game, hit.step);
  else if (hit.type === "node") selectNode(game, hit.index);
  else if (hit.type === "body") openBodyGuide(game, hit.id);
}

/**
 * Screen-space pick. The delete × is a small disc offset from the selected
 * node and wins only there. The fade tip wins over the path so it can be
 * dragged. The Moon's disc wins over the path so a click there offers
 * capture. A click on the path, including beside a node, picks the path.
 */
export function planningPointerHit(game: Game, width: number, height: number, sx: number, sy: number): PlanningHit {
  if (!isEditing(game)) return { type: "empty" };
  const remove = removeMarkerPoint(game, width, height);
  if (remove) {
    const dx = remove.x - sx;
    const dy = remove.y - sy;
    if (dx * dx + dy * dy <= REMOVE_RADIUS * REMOVE_RADIUS) return { type: "remove" };
  }
  const handle = closestHandle(game, width, height, sx, sy);
  if (handle !== null) return { type: "handle", index: handle };
  const node = closestNode(game, width, height, sx, sy);
  if (node !== null) return { type: "node", index: node };
  if (overTip(game, width, height, sx, sy) && tipOwnsClick(game, width, height, sx, sy)) return { type: "tip" };
  const body = moonUnderPointer(game, width, height, sx, sy);
  if (body) return { type: "body", id: body };
  const step = closestPathStep(game, width, height, sx, sy);
  if (step !== null) return { type: "path", step };
  return { type: "empty" };
}

function tipPoint(game: Game, width: number, height: number): { x: number; y: number } | null {
  const path = game.prediction.path;
  if (path.length === 0) return null;
  const last = path[path.length - 1];
  const shown = shownPoint(game, last.x, last.y, last.step);
  return worldToScreen(game.camera, width, height, shown.x, shown.y);
}

function overTip(game: Game, width: number, height: number, sx: number, sy: number): boolean {
  const tip = tipPoint(game, width, height);
  if (!tip) return false;
  const dx = tip.x - sx;
  const dy = tip.y - sy;
  return dx * dx + dy * dy <= TIP_RADIUS * TIP_RADIUS;
}

/**
 * The fade tip owns the click unless an earlier pass is stacked on the same pixel.
 * That earlier pass stays a path click, so a loop can still take a burn.
 */
function tipOwnsClick(game: Game, width: number, height: number, sx: number, sy: number): boolean {
  const path = game.prediction.path;
  if (path.length === 0) return false;
  const step = closestPathStep(game, width, height, sx, sy);
  if (step === null) return true;
  const last = path[path.length - 1].step;
  return Math.abs(last - step) * game.level.dt <= 1;
}

/** Unit screen vector along the last step of the drawn plan. x right, y down. */
function tipDirection(game: Game, width: number, height: number): { x: number; y: number } {
  const path = game.prediction.path;
  if (path.length < 2) return { x: 1, y: 0 };
  const prev = path[path.length - 2];
  const last = path[path.length - 1];
  const a = shownPoint(game, prev.x, prev.y, prev.step);
  const b = shownPoint(game, last.x, last.y, last.step);
  const sa = worldToScreen(game.camera, width, height, a.x, a.y);
  const sb = worldToScreen(game.camera, width, height, b.x, b.y);
  const dx = sb.x - sa.x;
  const dy = sb.y - sa.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** The Moon's drawn disc, or null. Other bodies are not a capture click in v1. */
function moonUnderPointer(game: Game, width: number, height: number, sx: number, sy: number): string | null {
  const bodies = game.level.bodies;
  let moon: (typeof bodies)[number] | null = null;
  let earthRadius = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.id === "luna" && body.kind === "moon") moon = body;
    if (body.id === "earth") earthRadius = body.radius;
  }
  if (!moon) return null;
  const time = shownNow(game.mode, game.ship.step, game.level.dt);
  const pose = bodyPose(moon, time, bodies, game.level.g);
  const screen = worldToScreen(game.camera, width, height, pose.x, pose.y);
  const zoom = game.camera.zoom > 0 ? game.camera.zoom : 1;
  const drawn = solDrawnRadius(moon, isSolChart(bodies), zoom, earthRadius);
  const radius = drawn * zoom + 4;
  const dx = screen.x - sx;
  const dy = screen.y - sy;
  if (dx * dx + dy * dy <= radius * radius) return moon.id;
  return null;
}

/** Centre of the ×, or null when the selected node is not one the player can delete. */
function removeMarkerPoint(game: Game, width: number, height: number): { x: number; y: number } | null {
  if (!isEditing(game)) return null;
  const index = game.selected;
  if (index === null || index < game.cursor.index) return null;
  const node = game.nodes[index];
  if (!node) return null;
  if (game.mode !== "planning" && (game.ship.step - node.step) * game.level.dt > theme.nodes.ignite) return null;
  const pos = nodePosition(game, index);
  if (!pos) return null;
  const shown = shownPoint(game, pos.x, pos.y, node.step);
  const screen = worldToScreen(game.camera, width, height, shown.x, shown.y);
  return { x: screen.x + theme.nodes.deleteX, y: screen.y + theme.nodes.deleteY };
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
    if (i < game.cursor.index) continue;
    const pos = nodePosition(game, i);
    if (!pos) continue;
    const shown = shownPoint(game, pos.x, pos.y, game.nodes[i].step);
    const screen = worldToScreen(game.camera, width, height, shown.x, shown.y);
    const d = (screen.x - sx) * (screen.x - sx) + (screen.y - sy) * (screen.y - sy);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? null : best;
}

/** Samples this close to the nearest hit are the same point on a stacked loop. */
const STACK_PX = 3;
/** A cluster that spans more than this is several passes, not one arc. */
const STACK_SECONDS = 1;

function closestPathStep(game: Game, width: number, height: number, sx: number, sy: number): number | null {
  const pose = game.mode === "paused" ? game.ship : game.initial;
  const hits: { step: number; d: number }[] = [];
  const origin = worldToScreen(game.camera, width, height, pose.x, pose.y);
  const originD = (origin.x - sx) * (origin.x - sx) + (origin.y - sy) * (origin.y - sy);
  if (originD <= 16 * 16) hits.push({ step: pose.step, d: originD });
  const path = game.prediction.path;
  const framed = shownPath(game, path);
  // The step that ended the flight is already lost or won; a new burn there never fires.
  const closed = game.prediction.final.status !== "flying" ? game.prediction.final.step : -1;
  const limit = PATH_RADIUS * PATH_RADIUS;
  for (let i = 0; i < path.length; i++) {
    if (path[i].step === closed) continue;
    const at = framed[i] ?? path[i];
    const screen = worldToScreen(game.camera, width, height, at.x, at.y);
    const dx = screen.x - sx;
    const dy = screen.y - sy;
    const d = dx * dx + dy * dy;
    if (d <= limit) hits.push({ step: path[i].step, d });
  }
  if (hits.length === 0) return null;
  let closest = hits[0];
  for (let i = 1; i < hits.length; i++) {
    if (hits[i].d < closest.d) closest = hits[i];
  }
  const reach = Math.sqrt(closest.d) + STACK_PX;
  let minStep = closest.step;
  let maxStep = closest.step;
  const near: { step: number; d: number }[] = [];
  for (let i = 0; i < hits.length; i++) {
    if (Math.sqrt(hits[i].d) > reach) continue;
    near.push(hits[i]);
    if (hits[i].step < minStep) minStep = hits[i].step;
    if (hits[i].step > maxStep) maxStep = hits[i].step;
  }
  if ((maxStep - minStep) * game.level.dt < STACK_SECONDS) return closest.step;
  let after = -1;
  for (let i = 0; i < game.nodes.length; i++) {
    if (game.nodes[i].step > after) after = game.nodes[i].step;
  }
  if (after >= 0) {
    let earliest = -1;
    for (let i = 0; i < near.length; i++) {
      const step = near[i].step;
      if (step > after && (earliest < 0 || step < earliest)) earliest = step;
    }
    if (earliest >= 0) return earliest;
  }
  let phase = near[0];
  for (let i = 1; i < near.length; i++) {
    if (Math.abs(near[i].step - pose.step) < Math.abs(phase.step - pose.step)) phase = near[i];
  }
  return phase.step;
}

function handlePoint(game: Game, width: number, height: number, index: number): { x: number; y: number } | null {
  if (index < game.cursor.index) return null;
  const pos = nodePosition(game, index);
  if (!pos) return null;
  const node = game.nodes[index];
  const shown = shownPoint(game, pos.x, pos.y, node.step);
  const screen = worldToScreen(game.camera, width, height, shown.x, shown.y);
  const offset = burnHandleOffset(node.dvx, node.dvy, game.level.dvPerPixel, nodeIncoming(game, index));
  return { x: screen.x + offset.x, y: screen.y + offset.y };
}

function isSimSpeed(value: number): value is SimSpeed {
  return (SIM_SPEEDS as readonly number[]).includes(value);
}

/** 1, 2, 4, 8, comma and period. A speed above the level cap is ignored. */
function applySpeedKey(
  game: Game,
  event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const speed = SPEED_KEY[event.key];
  if (speed === undefined) return false;
  if (speedAllowed(game.level, speed)) setSpeed(game, speed);
  return true;
}
