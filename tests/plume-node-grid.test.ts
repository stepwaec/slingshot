import { describe, expect, it } from "vitest";
import { createGame, launch, setNodeBurn, setPlan, tick } from "../src/game/state";
import { passage } from "../src/level/catalog";
import { slingshotPlan } from "../src/level/solutions";
import { sampleBurnAnim, tailFromBurn } from "../src/render/burn-anim";
import {
  cellEdgeFade,
  clipSegment,
  inkAlpha,
  inkDepth,
  inkTone,
  rampStop,
  screenEdgeFade,
  sheetDrop,
} from "../src/render/gravityField";
import { burnChipText, paintNode } from "../src/render/node-style";
import { gridRamp01 } from "../src/render/palette";
import { plumeFrame, plumeHalfWidth, plumeLength, plumeWidth } from "../src/render/plume";
import { theme } from "../src/render/theme";
import { createNodes } from "../src/render/visuals/nodes";
import { createShip } from "../src/render/visuals/ship";

const spec = theme.plume;

describe("burn plume", () => {
  it("grows the drawn length with |Δv| and caps it", () => {
    expect(plumeLength(0.5, spec)).toBe(50);
    expect(plumeLength(3, spec)).toBe(80);
    expect(plumeLength(5.5, spec)).toBe(110);
    expect(plumeLength(12, spec)).toBe(110);
    expect(plumeLength(-3, spec)).toBe(plumeLength(3, spec));
    expect(plumeWidth(50, spec)).toBeCloseTo(6.5 + 50 / 40);
    expect(plumeWidth(110, spec)).toBeCloseTo(6.5 + 110 / 40);
  });

  it("follows the header half-width, with a point at the tip and no halo past it", () => {
    const width = plumeWidth(80, spec);
    const root = plumeHalfWidth(0, width, 0, spec);
    const belly = plumeHalfWidth(0.25, width, 0, spec);
    const tip = plumeHalfWidth(1, width, 0, spec);
    expect(root).toBeCloseTo(width * 0.55);
    expect(belly).toBeGreaterThan(root);
    expect(tip).toBe(0);
    expect(plumeHalfWidth(1.2, width, 0, spec)).toBe(0);
    const ragged = plumeHalfWidth(0.4, width, 0.1, spec);
    const later = plumeHalfWidth(0.4, width, 0.2, spec);
    expect(ragged).not.toBe(later);
  });

  it("keeps a big burn on screen for the existing tail, and the burn step itself is unchanged", () => {
    const small = plumeFrame(spec, "tail", 0.2, 0.8, 0.5, 1.15, 1);
    const large = plumeFrame(spec, "tail", 0.2, 0.8, 8, 4.2, 1);
    expect(small.length).toBe(50);
    expect(large.length).toBe(110);
    expect(large.cutoff).toBeGreaterThan(0);
    expect(large.cutoff).toBeLessThan(small.cutoff);
    const game = createGame(passage);
    setPlan(game, slingshotPlan);
    launch(game);
    const before = game.ship.step;
    tick(game);
    expect(game.ship.step).toBe(before + 1);
    const anim = sampleBurnAnim(game.ship.step, game.level.dt, game.nodes, theme.burn.windup, tailFromBurn(theme.burn));
    expect(anim.thrustMag).toBeGreaterThan(0);
  });

  it("winds up as a short lick, then grows through ignition", () => {
    const wind = plumeFrame(spec, "windup", -0.25, 0.5, 3, 2, 1);
    expect(wind.length).toBe(spec.lickLength);
    expect(wind.width).toBe(spec.lickWidth);
    expect(wind.glow).toBe(true);
    expect(wind.glowRx).toBeCloseTo(spec.glowRx0 + (spec.glowRx1 - spec.glowRx0) * 0.5);
    const flash = plumeFrame(spec, "burn", 0.06, 1, 3, 2, 1);
    expect(flash.grow).toBeCloseTo(0.5);
    expect(flash.flash).toBeCloseTo(0.5);
    expect(flash.cutoff).toBe(0);
    expect(flash.length).toBe(80);
  });
});

describe("burn node", () => {
  it("paints the ring states from the header", () => {
    const idle = paintNode({ editing: true, selected: false, placing: false, exceeds: false, offset: null, windup: 0.5, ignite: 0.4 }, 0);
    expect(idle.color).toBe("#B8A8FF");
    expect(idle.radius).toBe(5);
    expect(idle.core).toBe(true);
    const selected = paintNode({ editing: true, selected: true, placing: false, exceeds: false, offset: null, windup: 0.5, ignite: 0.4 }, 0);
    expect(selected.color).toBe("#FFFFFF");
    expect(selected.radius).toBe(6.5);
    expect(selected.outer).toBe(true);
    const over = paintNode({ editing: true, selected: true, placing: false, exceeds: true, offset: null, windup: 0.5, ignite: 0.4 }, 0);
    expect(over.color).toBe("#FF5A5F");
    expect(over.coreColor).toBe("#FF5A5F");
    const wind = paintNode({ editing: false, selected: false, placing: false, exceeds: false, offset: -0.25, windup: 0.5, ignite: 0.4 }, 0.5);
    expect(wind.arc).toBe(0.5);
    const fired = paintNode({ editing: false, selected: false, placing: false, exceeds: false, offset: 0.5, windup: 0.5, ignite: 0.4 }, 0);
    expect(fired.dashed).toBe(true);
    expect(fired.core).toBe(false);
    expect(fired.alpha).toBe(0.45);
    expect(burnChipText(1.8, 12, 100, false)).toBe("Δv 1.8 · 12 %");
    expect(burnChipText(6.2, 118, 100, true)).toBe("Δv 6.2 · +18 % over");
  });

  it("draws a ring instead of the gold disc and does not step the sim", () => {
    const game = createGame(passage);
    setPlan(game, slingshotPlan);
    const nodes = createNodes(theme, passage);
    const ship = createShip(theme, passage);
    nodes.update({ game, width: 1280, height: 720, now: 0, dpr: 1 });
    const marker = nodes.object.getObjectByName("burn-node");
    expect(marker).toBeTruthy();
    const frozen = game.ship.step;
    ship.update({ game, width: 1280, height: 720, now: 0, dpr: 1 });
    expect(game.ship.step).toBe(frozen);
    nodes.dispose();
    ship.dispose();
  });
});

describe("gravity grid ink", () => {
  it("maps well depth through the log ramp and keeps flat space faint", () => {
    expect(inkDepth(0, 10, 100)).toBe(0);
    expect(inkDepth(Number.POSITIVE_INFINITY, 10, 100)).toBe(1);
    const mid = inkDepth(10, 10, 100);
    const deep = inkDepth(80, 10, 100);
    expect(deep).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
    expect(deep).toBeLessThan(1);
    const tone = inkTone(0.5, theme.gravity.inkGamma);
    expect(tone).toBeCloseTo(Math.pow(0.5, 2.2));
    expect(rampStop(tone, theme.gravity.inkRamp)).toBeCloseTo(Math.min(1, tone * 1.05));
    const flat = inkAlpha(0, false, 1, theme.gravity.inkAlpha, theme.gravity.inkAlphaDepth, theme.gravity.inkMajorAlpha);
    const well = inkAlpha(1, true, 1, theme.gravity.inkAlpha, theme.gravity.inkAlphaDepth, theme.gravity.inkMajorAlpha);
    expect(flat).toBeCloseTo(0.16);
    expect(well).toBeGreaterThan(flat);
    expect(screenEdgeFade(0, 100, 200, 200, 70)).toBe(0);
    expect(screenEdgeFade(70, 100, 200, 200, 70)).toBe(1);
    expect(cellEdgeFade(0, 4, 10, 10, 5)).toBe(0);
    expect(cellEdgeFade(5, 5, 12, 12, 5)).toBe(1);
    expect(sheetDrop(0, 40, 1.3)).toBe(0);
    expect(sheetDrop(1, 40, 1.3)).toBe(-40);
    expect(sheetDrop(0.5, 40, 1.3)).toBeCloseTo(-40 * Math.pow(0.5, 1.3));
    const [r, g, b] = gridRamp01(0);
    expect(r).toBeCloseTo(0x2a / 255);
    expect(g).toBeCloseTo(0x4a / 255);
    expect(b).toBeCloseTo(0x8a / 255);
  });

  it("stops a segment at a body disc", () => {
    const clear = clipSegment(0, 0, 10, 0, [{ x: 50, y: 50, r: 4 }]);
    expect(clear).toEqual([[0, 0, 10, 0]]);
    const through = clipSegment(0, 0, 10, 0, [{ x: 5, y: 0, r: 2 }]);
    expect(through).toHaveLength(2);
    expect(through[0][2]).toBeCloseTo(3);
    expect(through[1][0]).toBeCloseTo(7);
    const inside = clipSegment(4, 0, 6, 0, [{ x: 5, y: 0, r: 3 }]);
    expect(inside).toEqual([]);
  });

  it("leaves the flight alone when the map is only a view", () => {
    const game = createGame(passage);
    setPlan(game, slingshotPlan);
    const node = game.nodes[0];
    setNodeBurn(game, 0, node.dvx, node.dvy);
    const fuel = game.fuel;
    game.gravity = "on";
    launch(game);
    tick(game);
    expect(game.fuel).toBeLessThan(fuel);
    game.gravity = "off";
    const step = game.ship.step;
    tick(game);
    expect(game.ship.step).toBe(step + 1);
  });
});
