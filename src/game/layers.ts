import type { Level } from "../level/schema";
import { levelHasAstro } from "./state";
import { hasMagneticBody, isCompactBody, starLuminosity } from "../sim/physics";

/**
 * Map layers menu. One table drives the rows, so a later layer is one entry.
 * design/style.md §20 and design/threejs-notes.md §23.
 *
 * Gravity, magnetism, radiation and Astrophage keep their view flags.
 * T stays unbound until the tidal-stress layer exists.
 */

export type LayerLegend = "gravity" | "magnetism" | "radiation" | "astrophage";

export interface LayerGame {
  level: Level;
  mode: "planning" | "flying" | "paused" | "finished";
  gravity: "off" | "on";
  magnetism: boolean;
  radiation: boolean;
  astrophage: boolean;
}

export interface LayerDef {
  id: string;
  name: string;
  key: string;
  available: (level: Level) => boolean;
  reason: string;
  legend: LayerLegend | null;
  isOn: (game: LayerGame) => boolean;
  /** Null until the layer has a view flag. The row still renders. */
  setOn: ((game: LayerGame, on: boolean) => void) | null;
}

/** Shown on every row while the ship is flying or the result card is up. */
export const LAYERS_FLIGHT_NOTE = "available in planning and pause";

/** A luminous star, a flare, a radiation belt, a pulsar beam, or an accretion disk. */
export function hasRadiationSource(level: Level): boolean {
  for (let i = 0; i < level.bodies.length; i++) {
    const body = level.bodies[i];
    if (body.flare) return true;
    if (body.look === "gas-giant" || body.look === "magnetar") return true;
    if (body.look === "pulsar" && (body.beam?.damage ?? 0) > 0) return true;
    if (body.kind === "blackhole") return true;
    if (body.kind === "star" && starLuminosity(body) > 0) return true;
  }
  return false;
}

/** White dwarf, neutron star (including pulsar and magnetar), or black hole. */
export function hasTidalBody(level: Level): boolean {
  for (let i = 0; i < level.bodies.length; i++) {
    if (isCompactBody(level.bodies[i])) return true;
  }
  return false;
}

export const LAYERS: readonly LayerDef[] = [
  {
    id: "gravity",
    name: "Gravity",
    key: "G",
    available: () => true,
    reason: "",
    legend: "gravity",
    isOn: (game) => game.gravity === "on",
    setOn: (game, on) => {
      game.gravity = on ? "on" : "off";
    },
  },
  {
    id: "magnetism",
    name: "Magnetism",
    key: "M",
    available: (level) => hasMagneticBody(level.bodies),
    reason: "no magnetic body in this level",
    legend: "magnetism",
    isOn: (game) => game.magnetism,
    setOn: (game, on) => {
      game.magnetism = on;
    },
  },
  {
    id: "radiation",
    name: "Radiation",
    key: "D",
    available: hasRadiationSource,
    reason: "this level has no radiation",
    legend: "radiation",
    isOn: (game) => game.radiation,
    setOn: (game, on) => {
      game.radiation = on;
    },
  },
  {
    id: "astrophage",
    name: "Astrophage",
    key: "A",
    available: levelHasAstro,
    reason: "no infected star here",
    legend: "astrophage",
    isOn: (game) => game.astrophage,
    setOn: (game, on) => {
      game.astrophage = on;
    },
  },
  {
    id: "tidal",
    name: "Tidal stress",
    key: "T",
    available: hasTidalBody,
    reason: "no tidal body here",
    legend: null,
    isOn: () => false,
    setOn: null,
  },
];

export function layerById(id: string): LayerDef {
  for (let i = 0; i < LAYERS.length; i++) {
    if (LAYERS[i].id === id) return LAYERS[i];
  }
  throw new Error(`Unknown layer ${id}`);
}

export interface LayerView {
  id: string;
  name: string;
  key: string;
  checked: boolean;
  disabled: boolean;
  dim: boolean;
  /** Reason, or the flight line. Empty when the row is simply off or showing its legend. */
  note: string;
  showLegend: boolean;
}

/** Planning and pause can edit layers. Flight and the result card cannot. */
export function layerControlsLocked(game: LayerGame): boolean {
  return game.mode !== "planning" && game.mode !== "paused";
}

export function layerView(layer: LayerDef, game: LayerGame): LayerView {
  const locked = layerControlsLocked(game);
  const available = layer.available(game.level);
  const wired = layer.setOn !== null;
  const checked = wired && available && layer.isOn(game);
  if (locked) {
    return {
      id: layer.id,
      name: layer.name,
      key: layer.key,
      checked,
      disabled: true,
      dim: true,
      note: LAYERS_FLIGHT_NOTE,
      showLegend: false,
    };
  }
  if (!available) {
    return {
      id: layer.id,
      name: layer.name,
      key: layer.key,
      checked: false,
      disabled: true,
      dim: true,
      note: layer.reason,
      showLegend: false,
    };
  }
  if (!wired) {
    return {
      id: layer.id,
      name: layer.name,
      key: layer.key,
      checked: false,
      disabled: true,
      dim: false,
      note: "",
      showLegend: false,
    };
  }
  return {
    id: layer.id,
    name: layer.name,
    key: layer.key,
    checked,
    disabled: false,
    dim: false,
    note: "",
    showLegend: checked && layer.legend !== null,
  };
}

/** How many wired layers are on. The badge reads this. */
export function layersOnCount(game: LayerGame): number {
  let count = 0;
  for (let i = 0; i < LAYERS.length; i++) {
    const layer = LAYERS[i];
    if (layer.setOn && layer.available(game.level) && layer.isOn(game)) count += 1;
  }
  return count;
}

/** Turn off any layer this level cannot show. Called when a level loads. */
export function enforceLayerAvailability(game: LayerGame): void {
  for (let i = 0; i < LAYERS.length; i++) {
    const layer = LAYERS[i];
    if (!layer.setOn || layer.available(game.level)) continue;
    if (layer.isOn(game)) layer.setOn(game, false);
  }
}

/**
 * Click or key. Returns whether the flag changed.
 * Locked, unwired and unavailable layers stay as they are.
 */
export function toggleLayer(game: LayerGame, id: string): boolean {
  const layer = layerById(id);
  if (!layer.setOn) return false;
  if (layerControlsLocked(game)) return false;
  if (!layer.available(game.level)) return false;
  layer.setOn(game, !layer.isOn(game));
  return true;
}

export interface LayersPanelState {
  open: boolean;
}

export interface LayerKeyEvent {
  key: string;
  repeat?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

function chord(event: LayerKeyEvent): boolean {
  return Boolean(event.repeat || event.metaKey || event.ctrlKey || event.altKey);
}

/**
 * L toggles the panel. G, M, D and A toggle their layers, in planning and pause.
 * T stays unbound until the tidal layer exists. Repeats and modifier chords
 * do nothing, the same way `applyGravityKey` treats G.
 * Returns whether the key was consumed.
 */
export function applyLayerKey(game: LayerGame, panel: LayersPanelState, event: LayerKeyEvent): boolean {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key !== "l" && key !== "g" && key !== "m" && key !== "d" && key !== "a") return false;
  if (chord(event)) return false;
  if (key === "l") {
    panel.open = !panel.open;
    return true;
  }
  const id = key === "g" ? "gravity" : key === "m" ? "magnetism" : key === "d" ? "radiation" : "astrophage";
  return toggleLayer(game, id);
}

/**
 * Esc closes the panel and stops there, so a selected burn stays selected.
 * Returns whether the panel was closed.
 */
export function closeLayersOnEscape(panel: LayersPanelState, event: LayerKeyEvent): boolean {
  if (event.key !== "Escape") return false;
  if (chord(event)) return false;
  if (!panel.open) return false;
  panel.open = false;
  return true;
}
