import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBakedCaptureZone } from "../src/render/surface-art";
import { targetZoneLook, targetZonePhase, type ZoneInput } from "../src/render/target-zone";
import { theme } from "../src/render/theme";

const spec = theme.zone;
const colors = {
  ring: theme.colors.zoneRing,
  stable: theme.colors.zoneStable,
  flash: theme.colors.zoneFlash,
};

function input(patch: Partial<ZoneInput> = {}): ZoneInput {
  return {
    status: "flying",
    lostReason: null,
    enteredCapture: false,
    distance: 200,
    captureRadius: 72,
    wonAge: 0,
    now: 0,
    scrim: false,
    ...patch,
  };
}

describe("target zone", () => {
  it("rests as a dim solid ring at t = 0 and brightens over the 4 s pulse", () => {
    const rest = targetZoneLook(input(), spec, colors);
    expect(rest.phase).toBe("idle");
    expect(rest.color).toBe("#3DE0C2");
    expect(rest.alpha).toBeCloseTo(0.55);
    expect(rest.bandAlpha).toBeCloseTo(0.14);
    expect(rest.widthPx).toBe(1.5);
    expect(rest.waveAlpha).toBe(0);

    const peak = targetZoneLook(input({ now: 2 }), spec, colors);
    expect(peak.alpha).toBeCloseTo(0.78);
    expect(peak.bandAlpha).toBeCloseTo(0.24);
  });

  it("holds steady and brighter while the ship is inside, and ignores the pulse", () => {
    const early = targetZoneLook(
      input({ enteredCapture: true, distance: 40, now: 0 }),
      spec,
      colors,
    );
    const later = targetZoneLook(
      input({ enteredCapture: true, distance: 40, now: 2 }),
      spec,
      colors,
    );
    expect(early.phase).toBe("inside");
    expect(early.alpha).toBe(0.95);
    expect(early.bandAlpha).toBe(0.32);
    expect(later.alpha).toBe(early.alpha);
    expect(targetZonePhase(input({ enteredCapture: true, distance: 80 }), spec)).toBe("idle");
    expect(targetZonePhase(input({ enteredCapture: false, distance: 10 }), spec)).toBe("idle");
  });

  it("flashes once on a win, then settles to the ice ring", () => {
    const start = targetZoneLook(input({ status: "won", wonAge: 0, scrim: true }), spec, colors);
    expect(start.phase).toBe("flash");
    expect(start.color).toBe("#3DE0C2");
    expect(start.widthPx).toBe(1.5);
    expect(start.waveAlpha).toBeCloseTo(0.9);
    expect(start.waveExtraPx).toBe(0);

    const white = targetZoneLook(input({ status: "won", wonAge: 0.15 }), spec, colors);
    expect(white.color).toBe("#FFFFFF");
    expect(white.widthPx).toBeCloseTo(3.5);

    const ice = targetZoneLook(input({ status: "won", wonAge: 1.1 }), spec, colors);
    expect(ice.color).toBe("#B5FFF0");
    expect(ice.widthPx).toBeCloseTo(1.6);

    const stable = targetZoneLook(input({ status: "won", wonAge: 2, scrim: true, now: 1 }), spec, colors);
    expect(stable.phase).toBe("stable");
    expect(stable.color).toBe("#B5FFF0");
    expect(stable.alpha).toBe(0.95);
    expect(stable.waveAlpha).toBe(0);

    const breathing = targetZoneLook(input({ status: "won", wonAge: 2, scrim: false, now: 3 }), spec, colors);
    expect(breathing.alpha).toBeCloseTo(1);
  });

  it("dims on a flyby and does not treat a win as a flyby", () => {
    const flyby = targetZoneLook(input({ status: "lost", lostReason: "flyby" }), spec, colors);
    expect(flyby.phase).toBe("flyby");
    expect(flyby.alpha).toBe(0.3);
    expect(flyby.bandAlpha).toBe(0.06);
    expect(targetZonePhase(input({ status: "won", lostReason: "flyby", wonAge: 3 }), spec)).toBe("stable");
  });

  it("drops a baked zone fill and any dashed or solid capture stroke", () => {
    expect(isBakedCaptureZone({ fill: "url(#pxZone)" })).toBe(true);
    expect(isBakedCaptureZone({ fill: "none", stroke: "#3DE0C2" })).toBe(true);
    expect(isBakedCaptureZone({ fill: "none", stroke: "#3DE0C2", dash: "6 6" })).toBe(true);
    expect(isBakedCaptureZone({ fill: "url(#pxShade)" })).toBe(false);
    expect(isBakedCaptureZone({ fill: "url(#pxRim)" })).toBe(false);
  });

  it("leaves no dash path in the live capture-ring shader", () => {
    const source = readFileSync("src/render/visuals/planets.ts", "utf8");
    expect(source).not.toMatch(/uDash|uPulsePx|ringCrawl|stroke-dash/);
    const themeSource = readFileSync("src/render/theme.ts", "utf8");
    expect(themeSource).not.toMatch(/ringDash|ringCrawl|ringPulsePx/);
  });
});
