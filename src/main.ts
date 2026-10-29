import "./style.css";
import { bindInput } from "./game/input";
import {
  burnHandleOffset,
  canLaunch,
  canPause,
  createGame,
  gravityLabel,
  isEditing,
  loadLevel,
  missionResult,
  nodeIncoming,
  nodePosition,
  outcomeCopy,
  planFuel,
  queuedBurns,
  setPlan,
  tick,
  type Game,
} from "./game/state";
import { burnLimit, LEVELS, passage, pauseRuleOf, rescue, simConfigFromLevel, type Level } from "./level/catalog";
import { deepPlan, safePlan } from "./level/solutions";
import { createClockLatches, readClocks, type ClockLatches } from "./hud/readout";
import type { MissionScore } from "./sim/score";
import { frameLevel, worldToScreen } from "./render/camera";
import { SpaceView } from "./render/view";
import { doseAt, hasMagneticBody, horizonSteps, iceHarvestRate, nebulaScoopRate, solarRechargeRate, spreadAlong } from "./sim/physics";
import { shipLoadout } from "./game/upgrades";
import { mountShipyard, syncShipyard } from "./hud/shipyard";
import { resetShipLook } from "./render/appearance";
import { hullRatio, hullSegmentsLit, hullTone, stressLevel } from "./render/ship-art";

const levels: readonly Level[] = LEVELS;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

const app = required<HTMLElement>("#app");
const canvas = required<HTMLCanvasElement>("#space");
const launchButton = required<HTMLButtonElement>("#launch");
const deleteButton = required<HTMLButtonElement>("#delete");
const nodeRemove = required<HTMLButtonElement>("#node-x");
const fuelValue = required<HTMLElement>("#fuel-value");
const fuelFill = required<HTMLElement>("#fuel-fill");
const fuelGlyph = required<HTMLElement>("#fuel-glyph");
const fuelGhost = required<HTMLElement>("#fuel-ghost");
const fuelSliver = required<HTMLElement>("#fuel-sliver");
const fuelTrack = required<HTMLElement>(".fuel-track");
const pathGain = required<HTMLElement>("#path-gain");
const hullValue = required<HTMLElement>("#hull-value");
const recharge = required<HTMLElement>("#recharge");
const hullBar = required<HTMLElement>("#hull-bar");
const stressChip = required<HTMLElement>("#stress-chip");
const upgradeToggle = required<HTMLButtonElement>("#upgrade-toggle");
const upgradePanel = required<HTMLElement>("#upgrades");
const modeLabel = required<HTMLElement>("#mode-label");
const telemetry = required<HTMLElement>("#telemetry");
const nodeRow = required<HTMLElement>("#node-row");
const nodeReadout = required<HTMLElement>("#node-readout");
const nodeLayer = required<HTMLElement>("#node-layer");
const aimLabel = required<HTMLElement>("#aim-label");
const planningActions = required<HTMLElement>("#planning-actions");
const flightActions = required<HTMLElement>("#flight-actions");
const fpsValue = required<HTMLElement>("#fps");
const planNote = required<HTMLElement>("#plan-note");
const levelSelect = required<HTMLSelectElement>("#level");
const pauseButton = required<HTMLButtonElement>("#pause");
const resumeButton = required<HTMLButtonElement>("#resume");
const slowButton = required<HTMLButtonElement>("#slow");
const overlay = required<HTMLElement>("#overlay");
const card = required<HTMLElement>(".card");
const overlayTitle = required<HTMLElement>("#overlay-title");
const overlayDetail = required<HTMLElement>("#overlay-detail");
const overlayScore = required<HTMLElement>("#overlay-score");
const overlayStars = required<HTMLElement>("#overlay-stars");
const clockTitle = required<HTMLElement>("#clock-title");
const clockRate = required<HTMLElement>("#clock-rate");
const clockShip = required<HTMLElement>("#clock-ship");
const clockOut = required<HTMLElement>("#clock-out");
const clockGap = required<HTMLElement>("#clock-gap");
const clockLimit = required<HTMLElement>("#clock-limit");
const clockStars = required<HTMLElement>("#clock-stars");
const clockPoints = required<HTMLElement>("#clock-points");
const deadlineFill = required<HTMLElement>("#deadline-fill");
const routeActions = required<HTMLElement>("#route-actions");
const routeSafe = required<HTMLButtonElement>("#route-safe");
const routeDeep = required<HTMLButtonElement>("#route-deep");
const gravityButton = required<HTMLButtonElement>("#gravity");
const gravityClockButton = required<HTMLButtonElement>("#gravity-clock");
const magnetismButton = required<HTMLButtonElement>("#magnetism");
const radiationButton = required<HTMLButtonElement>("#radiation");
const doseBlock = required<HTMLElement>("#dose");
const doseValue = required<HTMLElement>("#dose-value");
const doseFill = required<HTMLElement>("#dose-fill");
const doseRate = required<HTMLElement>("#dose-rate");
const magLegend = required<HTMLElement>("#mag-legend");

const game = createGame();
if (import.meta.env.DEV) {
  (window as unknown as { __slingshot?: { game: Game; setPlan: typeof setPlan } }).__slingshot = { game, setPlan };
}
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
let spreadFor: Game["prediction"] | null = null;
let spreadSigma = 0;

for (const level of levels) {
  const option = document.createElement("option");
  option.value = level.id;
  option.textContent = level.name;
  levelSelect.append(option);
}
routeSafe.addEventListener("click", () => setPlan(game, safePlan));
routeDeep.addEventListener("click", () => setPlan(game, deepPlan));
upgradeToggle.addEventListener("click", () => {
  upgradePanel.hidden = !upgradePanel.hidden;
});
const hullSegments: HTMLElement[] = [];
for (let i = 0; i < 10; i++) {
  const segment = document.createElement("i");
  hullBar.append(segment);
  hullSegments.push(segment);
}
mountShipyard();

levelSelect.addEventListener("change", () => {
  const next = levels.find((level) => level.id === levelSelect.value) ?? passage;
  loadLevel(game, next);
  resetShipLook();
  view.reload(next);
  frameLevel(game.camera, canvas.clientWidth, canvas.clientHeight, next);
  framed = true;
});

bindInput(
  game,
  {
    canvas,
    launchButton,
    deleteButton,
    nodeRemove,
    resetButtons,
    clearButtons,
    speedButtons,
    pauseButton,
    resumeButton,
    slowButton,
    gravityButton,
    gravityClockButton,
    magnetismButton,
    radiationButton,
  },
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

function syncRecharge(current: Game): void {
  const solar = shipLoadout(current.upgrades).solar;
  const editing = isEditing(current);
  const pose = editing ? current.initial : current.ship;
  const stars = solarRechargeRate(pose.x, pose.y, pose.t, current.level.bodies, solar, current.level.g);
  const scoop = nebulaScoopRate(pose.x, pose.y, current.level.nebulae);
  const ice = iceHarvestRate(pose.x, pose.y, pose.t, current.level.bodies, current.level.g);
  const gained = Math.max(0, current.prediction.final.recharged);
  const budget = Math.max(1, current.level.fuel);
  const fraction = solar > 0 ? stars / solar : 0;
  let state = "off";
  if (!editing && fraction >= 0.6) state = "close";
  else if (!editing && fraction >= 0.08) state = "charge";
  else if (editing && solar > 0 && gained > 0.05) state = "plan";
  if (fuelGlyph.dataset.state !== state) fuelGlyph.dataset.state = state;
  fuelTrack.classList.toggle("is-charging", state === "charge" || state === "close");
  fuelTrack.classList.toggle("is-close", state === "close");

  const shown = editing ? planFuel(current).left : current.fuel;
  const ratio = Math.max(0, Math.min(1, shown / budget));
  const end = Math.max(0, Math.min(1, current.prediction.final.tank / budget));
  const ghost = editing && end > ratio + 0.005 ? Math.round(220 * end) : 0;
  fuelGhost.style.width = ghost > 0 ? `${ghost}px` : "0px";
  const fill = Number.parseFloat(fuelFill.style.width) || 0;
  fuelSliver.style.left = `${Math.max(0, fill - 1)}px`;

  const charging = state === "charge" || state === "close";
  const planned = state === "plan";
  recharge.hidden = !(charging || planned);
  if (charging) {
    const percent = ((stars + scoop + ice) / budget) * 100;
    recharge.textContent = `+${percent.toFixed(1)} %/s`;
  } else if (planned) {
    recharge.textContent = `+${Math.round((gained / budget) * 100)} % on this path`;
  }

  const path = current.prediction.path;
  const last = path[path.length - 1];
  const showGain = editing && gained > 0.05 && last;
  pathGain.hidden = !showGain;
  if (showGain && last) {
    const screen = worldToScreen(current.camera, canvas.clientWidth, canvas.clientHeight, last.x, last.y);
    pathGain.style.left = `${screen.x + 10}px`;
    pathGain.style.top = `${screen.y - 8}px`;
    pathGain.textContent = `+${Math.round((gained / budget) * 100)} %`;
  }
}

function syncDose(current: Game): void {
  const limit = current.level.physics?.doseLimit ?? 0;
  const per = current.level.physics?.dosePerD1 ?? 0;
  const armed = per > 0 && limit > 0;
  doseBlock.hidden = !armed;
  radiationButton.hidden = !armed;
  const on = armed && current.radiation;
  radiationButton.setAttribute("aria-pressed", on ? "true" : "false");
  if (!armed) return;
  const pose = current.mode === "flying" ? current.ship : current.initial;
  const dose = current.mode === "flying" ? current.ship.dose : current.prediction.final.dose;
  const ratio = Math.max(0, Math.min(1, dose / limit));
  const band = ratio >= 0.75 ? "critical" : ratio >= 0.25 ? "warn" : "ok";
  doseFill.style.width = `${Math.round(ratio * 100)}%`;
  doseFill.dataset.band = band;
  doseValue.dataset.band = band;
  doseValue.textContent = `${dose.toFixed(1)} mSv`;
  const reading = doseAt(pose.x, pose.y, pose.t, current.level.bodies, current.level.g);
  const shield = shipLoadout(current.upgrades).shield;
  const rate = reading.d * per * shield;
  doseRate.dataset.band = band;
  doseRate.dataset.source = reading.source;
  doseRate.textContent = reading.source === "shadow" ? "0.0 mSv/s · shadow" : `+${rate.toFixed(1)} mSv/s · ${reading.source}`;
}

function syncMagnetism(current: Game): void {
  const show = hasMagneticBody(current.level.bodies);
  magnetismButton.hidden = !show;
  const on = show && current.magnetism;
  magnetismButton.setAttribute("aria-pressed", on ? "true" : "false");
  magLegend.hidden = !(on && isEditing(current));
}

function syncGravity(current: Game): void {
  const label = gravityLabel(current.gravity);
  // Rewriting the text node every frame makes Safari drop the next click:
  // mousedown and mouseup land on different nodes, so the map stays on.
  if (gravityButton.textContent !== label) gravityButton.textContent = label;
  const pressed = current.gravity === "off" ? "false" : "true";
  if (gravityButton.getAttribute("aria-pressed") !== pressed) gravityButton.setAttribute("aria-pressed", pressed);
  gravityClockButton.hidden = current.gravity !== "grid";
  const clockPressed = current.gravityClock ? "true" : "false";
  if (gravityClockButton.getAttribute("aria-pressed") !== clockPressed) {
    gravityClockButton.setAttribute("aria-pressed", clockPressed);
  }
}

function syncHud(current: Game): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const budget = current.level.fuel;
  const fuel = planFuel(current);
  const planning = current.mode === "planning";
  const editing = isEditing(current);
  app.dataset.mode = current.mode;
  syncGravity(current);
  syncMagnetism(current);
  syncDose(current);
  modeLabel.textContent = planning ? "Planning" : current.mode === "paused" ? "Paused" : "In flight";
  planningActions.hidden = !planning;
  flightActions.hidden = planning;
  pauseButton.hidden = current.mode !== "flying";
  resumeButton.hidden = current.mode !== "paused";
  pauseButton.disabled = !canPause(current);
  slowButton.setAttribute("aria-pressed", current.slow ? "true" : "false");
  if (levelSelect.value !== current.level.id) levelSelect.value = current.level.id;

  const remaining = editing ? fuel.left : current.fuel;
  const ratio = remaining / budget;
  const clamped = Math.max(0, Math.min(1, ratio));
  fuelFill.style.width = clamped <= 0 ? "0px" : `${Math.max(8, Math.round(220 * clamped))}px`;
  fuelFill.dataset.band = clamped >= 0.3 ? "full" : clamped >= 0.1 ? "low" : "critical";
  fuelValue.textContent = `${Math.round(ratio * 100)} %`;
  syncRecharge(current);
  fuelValue.dataset.band = ratio < -1e-6 ? "critical" : "ok";
  syncHull(current);
  syncUpgrades(current);

  const pose = planning ? current.initial : current.ship;
  const target = current.level.bodies.find((body) => body.id === current.level.targetId);
  const distance = target ? Math.hypot(pose.x - target.x, pose.y - target.y) : 0;
  const speed = Math.hypot(pose.vx, pose.vy);
  const vText = planning ? "  —" : speed.toFixed(2).padStart(5, " ");
  const dText = Math.round(distance).toString().padStart(4, " ");
  let line = `v ${vText}  ·  dX ${dText}`;
  if (editing && hasMagneticBody(current.level.bodies) && current.prediction.path.length > 1) {
    if (spreadFor !== current.prediction) {
      const spread = spreadAlong(current.prediction.path, current.level.dt, current.level.bodies);
      spreadSigma = spread.length === 0 ? 0 : spread[spread.length - 1].sigma;
      spreadFor = current.prediction;
    }
    if (spreadSigma >= 0.6) line += `  ·  spread ±${Math.round(spreadSigma)} px`;
  }
  telemetry.textContent = line;
  fpsValue.textContent = `${Math.round(fps)} fps`;

  launchButton.disabled = !canLaunch(current);
  routeActions.hidden = !(planning && current.level.id === rescue.id);
  deleteButton.disabled = !editing || current.selected === null;
  for (const button of clearButtons) button.disabled = current.mode === "flying";
  syncPlanNote(current);
  for (const button of speedButtons) {
    button.setAttribute("aria-pressed", button.dataset.speed === String(current.speed) ? "true" : "false");
  }

  const showNodes = editing && current.nodes.length > 0;
  nodeRow.hidden = !showNodes;
  if (current.selected === null || !editing) {
    nodeReadout.hidden = true;
  } else {
    nodeReadout.hidden = false;
    const line = nodeLine(current, current.selected, fuel);
    nodeReadout.textContent = line.text;
    nodeReadout.dataset.over = line.over ? "true" : "false";
  }

  syncMarkers(current, width, height, fuel);
  syncClocks(current);
  syncOverlay(current, budget);
}

function syncHull(current: Game): void {
  const pose = current.mode === "planning" ? current.initial : current.ship;
  const tone = hullTone(pose.hull, pose.hullMax);
  const lit = hullSegmentsLit(pose.hull, pose.hullMax);
  hullBar.dataset.band = tone;
  hullValue.dataset.band = tone;
  hullValue.textContent = `${Math.round(hullRatio(pose.hull, pose.hullMax) * 100)}%`;
  hullSegments.forEach((segment, index) => segment.classList.toggle("on", index < lit));
  const stress = current.mode === "planning" ? current.prediction.final.peakStress : current.ship.stress;
  const level = stressLevel(stress);
  stressChip.hidden = level === 0;
  stressChip.dataset.level = String(level);
}

function syncUpgrades(current: Game): void {
  const yard = syncShipyard(current);
  upgradeToggle.hidden = yard.hideToggle;
}

function syncMarkers(
  current: Game,
  width: number,
  height: number,
  fuel: ReturnType<typeof planFuel>,
): void {
  if (!isEditing(current) || width < 2) {
    nodeLayer.hidden = true;
    nodeRemove.hidden = true;
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
  const canRemove = selected !== null && selected >= current.cursor.index && pos !== null;
  if (!canRemove || !pos) {
    nodeRemove.hidden = true;
  } else {
    const at = worldToScreen(current.camera, width, height, pos.x, pos.y);
    nodeRemove.hidden = false;
    nodeRemove.style.left = `${Math.round(at.x + 16)}px`;
    nodeRemove.style.top = `${Math.round(at.y - 16)}px`;
  }
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

let clockLatches: ClockLatches | null = null;
let clockLatchKey = "";

function syncClocks(current: Game): void {
  const planning = current.mode === "planning";
  const pose = planning ? current.prediction.final : current.ship;
  const outside = pose.t;
  const ship = pose.tau;
  const rate = planning ? slowestRate(current) : current.ship.rate;
  const deadline = current.level.mission.deadline;
  const ratio = deadline > 0 ? outside / deadline : 0;
  const band = ratio >= 1 ? "over" : ratio >= 0.8 ? "near" : "ok";
  const gap = outside - ship;
  const margin = deadline - outside;
  const latchKey = `${current.level.id}:${current.mode}`;
  if (!clockLatches || clockLatchKey !== latchKey) {
    clockLatches = createClockLatches(rate, gap, margin);
    clockLatchKey = latchKey;
  }
  const clocks = readClocks(clockLatches, rate, gap, margin);
  clockTitle.textContent = planning ? "Predicted" : "Clocks";
  clockRate.textContent = clocks.rate;
  clockRate.dataset.trend = clocks.rateTrend;
  clockRate.title = clocks.rateTrend;
  clockShip.textContent = `Ship ${ship.toFixed(2)} s`;
  clockOut.textContent = `Outside ${outside.toFixed(2)} s`;
  clockGap.textContent = clocks.gap;
  clockGap.dataset.band = band;
  clockGap.dataset.trend = clocks.gapTrend;
  clockGap.title = clocks.gapTrend;
  clockLimit.textContent = clocks.margin;
  clockLimit.dataset.band = band;
  clockLimit.dataset.trend = clocks.marginTrend;
  clockLimit.title = clocks.marginTrend;
  const clamped = Math.max(0, Math.min(1, ratio));
  deadlineFill.style.width = `${Math.round(clamped * 100)}%`;
  deadlineFill.dataset.band = band;
  if (planning) {
    const mission = missionResult(current);
    clockStars.hidden = false;
    clockPoints.hidden = false;
    clockStars.textContent = missionLine(mission);
    clockPoints.textContent = mission.hardFail ? "0 pts" : `${Math.round(mission.points)} pts`;
  } else {
    clockStars.hidden = true;
    clockPoints.hidden = true;
    clockStars.textContent = "";
    clockPoints.textContent = "";
  }
}

function slowestRate(current: Game): number {
  let rate = current.initial.rate;
  const path = current.prediction.path;
  for (let i = 0; i < path.length; i++) {
    if (path[i].rate < rate) rate = path[i].rate;
  }
  return rate;
}

function missionLine(mission: MissionScore): string {
  if (mission.hardFail === "arrival") return "No capture";
  if (mission.hardFail === "deadline") return "Misses the deadline";
  const mark = (name: string, on: boolean) => `${on ? "★" : "☆"} ${name}`;
  const stars = mission.stars;
  return `${mark("Deadline", stars.deadline)} · ${mark("Crew", stars.crew)} · ${mark("Fuel", stars.fuel)}`;
}

function showStars(mission: MissionScore): void {
  overlayStars.hidden = false;
  overlayScore.hidden = false;
  const stars = overlayStars.querySelectorAll<HTMLElement>("[data-star]");
  for (const star of stars) {
    const key = star.dataset.star;
    const on =
      key === "deadline" ? mission.stars.deadline : key === "crew" ? mission.stars.crew : mission.stars.fuel;
    star.dataset.on = on ? "true" : "false";
  }
  if (mission.hardFail) {
    overlayScore.textContent = "Hard fail · 0 pts";
    return;
  }
  overlayScore.textContent = `${Math.round(mission.points)} pts · gap +${mission.gap.toFixed(1)} s`;
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
  const mission = missionResult(current);
  const late = current.ship.status === "won" && mission.hardFail === "deadline";
  const kind = late ? "late" : current.ship.status === "won" ? "win" : current.ship.status === "crashed" ? "crash" : "lost";
  card.dataset.result = kind;
  if (late) {
    overlayTitle.textContent = "Deadline missed";
    overlayDetail.textContent = `In orbit after ${mission.outsideTime.toFixed(1)} s outside. The crew aged ${mission.shipTime.toFixed(1)} s. The window closed at ${current.level.mission.deadline.toFixed(1)} s.`;
    showStars(mission);
  } else if (kind === "win") {
    const spare = Math.max(0, Math.round((current.fuel / budget) * 100));
    overlayTitle.textContent = "Planet X reached";
    overlayDetail.textContent = `Captured with ${spare} % fuel to spare. Crew time ${mission.shipTime.toFixed(1)} s, outside ${mission.outsideTime.toFixed(1)} s.`;
    showStars(mission);
  } else if (kind === "crash") {
    overlayTitle.textContent = "Crashed";
    overlayDetail.textContent = outcome.detail;
    overlayStars.hidden = true;
    overlayScore.hidden = true;
  } else {
    overlayTitle.textContent = "Lost in space";
    overlayDetail.textContent = outcome.detail;
    overlayStars.hidden = true;
    overlayScore.hidden = true;
  }
  if (!overlayOpen) {
    overlay.hidden = false;
    overlay.classList.remove("is-in");
    requestAnimationFrame(() => overlay.classList.add("is-in"));
    overlayOpen = true;
  }
}

function syncPlanNote(current: Game): void {
  const parts: string[] = [];
  if (current.level.horizon) {
    const origin = current.mode === "paused" ? current.ship : current.initial;
    const seconds = horizonSteps(origin, simConfigFromLevel(current.level)) * current.level.dt;
    parts.push(`horizon ${seconds.toFixed(1)}s`);
  }
  if (current.level.maxPlannedBurns !== undefined && current.level.maxPlannedBurns <= 4) {
    parts.push(`burns ${queuedBurns(current)}/${burnLimit(current.level)}`);
  }
  const rule = pauseRuleOf(current.level);
  if (rule.kind === "free") {
    const left = Math.max(0, rule.count - current.pausesUsed);
    parts.push(left === 1 ? "1 pause" : `${left} pauses`);
  } else if (rule.kind === "score") {
    parts.push(`score ${Math.max(0, Math.round(current.score))}`);
  }
  if (parts.length === 0) {
    planNote.hidden = true;
    return;
  }
  planNote.hidden = false;
  planNote.textContent = parts.join("  ·  ");
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
