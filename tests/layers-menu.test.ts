import { describe, expect, it } from "vitest";
import {
  LAYERS,
  LAYERS_FLIGHT_NOTE,
  applyLayerKey,
  closeLayersOnEscape,
  enforceLayerAvailability,
  layerById,
  layerControlsLocked,
  layerView,
  layersOnCount,
  toggleLayer,
} from "../src/game/layers";
import { createGame, loadLevel } from "../src/game/state";
import type { Level } from "../src/level/schema";
import { observatory } from "../src/level/catalog";
import { stage as passage } from "./support/stage";

const shade = passage;
const needle = observatory;
const dim = observatory;
const rescue = observatory;
const ember: Level = {
  ...passage,
  id: "library-tide",
  physics: { tidalStrength: 1 },
  bodies: [
    ...passage.bodies,
    {
      id: "dwarf",
      name: "the white dwarf",
      kind: "star",
      look: "white-dwarf",
      x: 400,
      y: 0,
      mass: 100000,
      radius: 16,
    },
  ],
};

const press = { repeat: false, metaKey: false, ctrlKey: false, altKey: false };

function darkLevel(): Level {
  return {
    ...passage,
    bodies: passage.bodies.filter((body) => body.id === "home" || body.id === "x"),
  };
}

describe("layers menu table", () => {
  it("lists every layer as one entry, in the design order", () => {
    expect(LAYERS.map((layer) => [layer.id, layer.name, layer.key])).toEqual([
      ["gravity", "Gravity", "G"],
      ["magnetism", "Magnetism", "M"],
      ["radiation", "Radiation", "D"],
      ["astrophage", "Astrophage", "A"],
      ["tidal", "Tidal stress", "T"],
    ]);
    for (const layer of LAYERS) {
      expect(typeof layer.available).toBe("function");
      expect("reason" in layer).toBe(true);
      expect("legend" in layer).toBe(true);
    }
    expect(LAYERS.filter((layer) => layer.setOn).map((layer) => layer.id)).toEqual([
      "gravity",
      "magnetism",
      "radiation",
      "astrophage",
      "tidal",
    ]);
    expect(layerById("tidal").legend).toBe("tidal");
    expect(layerById("tidal").setOn).not.toBeNull();
  });

  it("keeps Gravity as the label when the layer is on", () => {
    const game = createGame(passage);
    const gravity = layerById("gravity");
    expect(layerView(gravity, game).name).toBe("Gravity");
    expect(layerView(gravity, game).checked).toBe(false);
    game.gravity = "on";
    const on = layerView(gravity, game);
    expect(on.name).toBe("Gravity");
    expect(on.checked).toBe(true);
    expect(on.showLegend).toBe(true);
    expect(on.note).toBe("");
  });

  it("enables a layer only when the level has what it draws", () => {
    const dark = darkLevel();
    expect(layerById("gravity").available(dark)).toBe(true);
    expect(layerById("magnetism").available(passage)).toBe(false);
    expect(layerById("magnetism").available(needle)).toBe(true);
    expect(layerById("magnetism").reason).toBe("no magnetic body in this level");
    expect(layerById("radiation").available(passage)).toBe(true);
    expect(layerById("radiation").available(shade)).toBe(true);
    expect(layerById("radiation").available(dark)).toBe(false);
    expect(layerById("radiation").reason).toBe("this level has no radiation");
    expect(layerById("astrophage").available(shade)).toBe(false);
    expect(layerById("astrophage").available(dim)).toBe(true);
    expect(layerById("astrophage").reason).toBe("no infected star here");
    const astro = layerView(layerById("astrophage"), createGame(dim));
    expect(astro.disabled).toBe(false);
    expect(astro.dim).toBe(false);
    expect(layerById("tidal").available(passage)).toBe(false);
    expect(layerById("tidal").available(rescue)).toBe(false);
    expect(layerById("tidal").available(ember)).toBe(true);
    expect(layerById("tidal").reason).toBe("no tidal body here");

    const off = layerView(layerById("magnetism"), createGame(passage));
    expect(off.disabled).toBe(true);
    expect(off.dim).toBe(true);
    expect(off.note).toBe("no magnetic body in this level");
    expect(off.showLegend).toBe(false);
  });
});

describe("layers menu keys", () => {
  it("toggles the panel with L and the live layers with G, M and D", () => {
    const game = createGame(shade);
    const panel = { open: false };
    expect(applyLayerKey(game, panel, { key: "l", ...press })).toBe(true);
    expect(panel.open).toBe(true);
    expect(applyLayerKey(game, panel, { key: "L", ...press })).toBe(true);
    expect(panel.open).toBe(false);

    expect(applyLayerKey(game, panel, { key: "g", ...press })).toBe(true);
    expect(game.gravity).toBe("on");
    expect(applyLayerKey(game, panel, { key: "G", ...press })).toBe(true);
    expect(game.gravity).toBe("off");

    expect(applyLayerKey(game, panel, { key: "d", ...press })).toBe(true);
    expect(game.radiation).toBe(true);
    expect(applyLayerKey(game, panel, { key: "D", ...press })).toBe(true);
    expect(game.radiation).toBe(false);

    const magnetic = createGame(needle);
    expect(applyLayerKey(magnetic, panel, { key: "m", ...press })).toBe(true);
    expect(magnetic.magnetism).toBe(true);
    const before = magnetic.prediction;
    expect(applyLayerKey(magnetic, panel, { key: "M", ...press })).toBe(true);
    expect(magnetic.magnetism).toBe(false);
    expect(magnetic.prediction).toBe(before);
  });

  it("toggles Astrophage with A on an infected star, and Tidal stress with T on Ember", () => {
    const game = createGame(dim);
    const panel = { open: false };
    const before = game.prediction;
    expect(applyLayerKey(game, panel, { key: "a", ...press })).toBe(true);
    expect(game.astrophage).toBe(true);
    expect(applyLayerKey(game, panel, { key: "A", ...press })).toBe(true);
    expect(game.astrophage).toBe(false);
    expect(game.prediction).toBe(before);
    expect(applyLayerKey(game, panel, { key: "a", repeat: true, metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
    expect(applyLayerKey(game, panel, { key: "t", ...press })).toBe(false);
    expect(toggleLayer(game, "tidal")).toBe(false);

    const plain = createGame(passage);
    expect(applyLayerKey(plain, panel, { key: "a", ...press })).toBe(false);
    expect(plain.astrophage).toBe(false);

    const tides = createGame(ember);
    const tideBefore = tides.prediction;
    expect(applyLayerKey(tides, panel, { key: "t", ...press })).toBe(true);
    expect(tides.tidal).toBe(true);
    expect(layerView(layerById("tidal"), tides).showLegend).toBe(true);
    expect(applyLayerKey(tides, panel, { key: "T", ...press })).toBe(true);
    expect(tides.tidal).toBe(false);
    expect(tides.prediction).toBe(tideBefore);
  });

  it("ignores repeats, modifier chords, C, R, and A where there is no infection", () => {
    const game = createGame(passage);
    game.radiation = true;
    const panel = { open: false };
    expect(applyLayerKey(game, panel, { key: "d", repeat: true, metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
    expect(applyLayerKey(game, panel, { key: "g", repeat: false, metaKey: true, ctrlKey: false, altKey: false })).toBe(false);
    expect(applyLayerKey(game, panel, { key: "l", repeat: false, metaKey: false, ctrlKey: true, altKey: false })).toBe(false);
    expect(applyLayerKey(game, panel, { key: "m", repeat: false, metaKey: false, ctrlKey: false, altKey: true })).toBe(false);
    expect(game.radiation).toBe(true);
    expect(game.gravity).toBe("off");
    expect(game.magnetism).toBe(false);
    expect(panel.open).toBe(false);

    expect(applyLayerKey(game, panel, { key: "c", ...press })).toBe(false);
    expect(applyLayerKey(game, panel, { key: "C", ...press })).toBe(false);
    expect(applyLayerKey(game, panel, { key: "r", ...press })).toBe(false);
    expect(applyLayerKey(game, panel, { key: "a", ...press })).toBe(false);
    expect(applyLayerKey(game, panel, { key: "t", ...press })).toBe(false);
    expect(game.radiation).toBe(true);
    expect(panel.open).toBe(false);
  });

  it("closes the panel on Esc before a later Esc would clear the selection", () => {
    const panel = { open: true };
    expect(closeLayersOnEscape(panel, { key: "Escape", ...press })).toBe(true);
    expect(panel.open).toBe(false);
    expect(closeLayersOnEscape(panel, { key: "Escape", ...press })).toBe(false);
    expect(closeLayersOnEscape({ open: true }, { key: "Escape", repeat: true, metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
    expect(closeLayersOnEscape({ open: true }, { key: "Escape", repeat: false, metaKey: true, ctrlKey: false, altKey: false })).toBe(false);
  });

  it("does not toggle magnetism where the level has no magnetic body", () => {
    const game = createGame(passage);
    expect(applyLayerKey(game, { open: false }, { key: "m", ...press })).toBe(false);
    expect(game.magnetism).toBe(false);
    expect(toggleLayer(game, "magnetism")).toBe(false);
  });
});

describe("layers menu availability and flight lock", () => {
  it("forces unavailable layers off when a level loads", () => {
    const game = createGame(needle);
    game.gravity = "on";
    game.magnetism = true;
    game.radiation = true;
    game.astrophage = true;
    loadLevel(game, darkLevel());
    expect(game.gravity).toBe("on");
    expect(game.magnetism).toBe(false);
    expect(game.radiation).toBe(false);
    expect(game.astrophage).toBe(false);
    expect(layersOnCount(game)).toBe(1);

    game.magnetism = true;
    game.radiation = true;
    enforceLayerAvailability(game);
    expect(game.magnetism).toBe(false);
    expect(game.radiation).toBe(false);

    loadLevel(game, needle);
    game.gravity = "off";
    game.magnetism = true;
    game.radiation = true;
    enforceLayerAvailability(game);
    expect(game.magnetism).toBe(true);
    expect(game.radiation).toBe(true);
    expect(layersOnCount(game)).toBe(2);
  });

  it("disables the switches in flight and lets them work again on pause", () => {
    const game = createGame(shade);
    game.radiation = true;
    game.gravity = "on";
    expect(layerControlsLocked(game)).toBe(false);

    game.mode = "flying";
    expect(layerControlsLocked(game)).toBe(true);
    const radiation = layerView(layerById("radiation"), game);
    expect(radiation.disabled).toBe(true);
    expect(radiation.dim).toBe(true);
    expect(radiation.checked).toBe(true);
    expect(radiation.note).toBe(LAYERS_FLIGHT_NOTE);
    expect(radiation.showLegend).toBe(false);
    expect(layerView(layerById("gravity"), game).note).toBe(LAYERS_FLIGHT_NOTE);
    expect(toggleLayer(game, "radiation")).toBe(false);
    expect(toggleLayer(game, "gravity")).toBe(false);
    expect(applyLayerKey(game, { open: false }, { key: "d", ...press })).toBe(false);
    expect(game.radiation).toBe(true);
    expect(game.gravity).toBe("on");

    const panel = { open: false };
    expect(applyLayerKey(game, panel, { key: "l", ...press })).toBe(true);
    expect(panel.open).toBe(true);

    game.mode = "paused";
    expect(layerControlsLocked(game)).toBe(false);
    const paused = layerView(layerById("radiation"), game);
    expect(paused.disabled).toBe(false);
    expect(paused.showLegend).toBe(true);
    expect(toggleLayer(game, "radiation")).toBe(true);
    expect(game.radiation).toBe(false);
    const prediction = game.prediction;
    expect(toggleLayer(game, "gravity")).toBe(true);
    expect(game.gravity).toBe("off");
    expect(game.prediction).toBe(prediction);
  });
});
