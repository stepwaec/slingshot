import { describe, expect, it } from "vitest";
import { observatory } from "../src/level/catalog";
import { artForBody } from "../src/render/art-sprite";
import { prepSol, SOL_LOOKS, solArt } from "../src/render/sol-art";
import { theme } from "../src/render/theme";
import { bodySolid, type Body } from "../src/sim/physics";

/** Enough of a document for `prepSol` to retarget an outer rim. */
class MiniEl {
  localName: string;
  attrs: Record<string, string>;
  children: MiniEl[] = [];
  parentElement: MiniEl | null = null;
  owner: MiniDoc | null = null;

  constructor(localName: string, attrs: Record<string, string> = {}) {
    this.localName = localName;
    this.attrs = { ...attrs };
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  get nextSibling(): MiniEl | null {
    const kids = this.parentElement?.children;
    if (!kids) return null;
    const index = kids.indexOf(this);
    return index >= 0 ? kids[index + 1] ?? null : null;
  }

  append(child: MiniEl): void {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    child.owner = this.owner;
    this.children.push(child);
  }

  insertBefore(node: MiniEl, ref: MiniEl | null): void {
    node.parentElement?.removeChild(node);
    node.parentElement = this;
    node.owner = this.owner;
    const index = ref ? this.children.indexOf(ref) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }

  remove(): void {
    this.parentElement?.removeChild(this);
  }

  removeChild(child: MiniEl): void {
    this.children = this.children.filter((item) => item !== child);
    child.parentElement = null;
  }

  querySelectorAll(selector: string): MiniEl[] {
    const names = selector.split(",").map((item) => item.trim());
    const found: MiniEl[] = [];
    const walk = (el: MiniEl) => {
      for (const child of el.children) {
        if (names.includes("*") || names.includes(child.localName)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  cloneNode(deep: boolean): MiniEl {
    const copy = new MiniEl(this.localName, this.attrs);
    if (deep) {
      for (const child of this.children) copy.append(child.cloneNode(true));
    }
    return copy;
  }
}

class MiniDoc {
  documentElement: MiniEl;

  constructor(root: MiniEl) {
    this.documentElement = root;
    const mark = (el: MiniEl) => {
      el.owner = this;
      for (const child of el.children) mark(child);
    };
    mark(root);
  }

  getElementById(id: string): MiniEl | null {
    const walk = (el: MiniEl): MiniEl | null => {
      if (el.getAttribute("id") === id) return el;
      for (const child of el.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this.documentElement);
  }
}

function el(name: string, attrs: Record<string, string>, ...children: MiniEl[]): MiniEl {
  const node = new MiniEl(name, attrs);
  for (const child of children) node.append(child);
  return node;
}

function airBody(ids: { root: string; grad: string; mask: string; haze: string; rim: string; rimR: string; disc: string }): MiniDoc {
  const svg = el(
    "svg",
    {},
    el(
      "defs",
      {},
      el(
        "linearGradient",
        { id: ids.grad },
        el("stop", { offset: "0" }),
        el("stop", { offset: "0.5", "stop-opacity": "0.45" }),
        el("stop", { offset: "1", "stop-opacity": "0.06" }),
      ),
      el("mask", { id: ids.mask }, el("rect", { fill: `url(#${ids.grad})` })),
    ),
    el(
      "g",
      { id: ids.root },
      el("circle", { r: ids.disc, fill: "#000000" }),
      el("circle", { r: ids.disc, fill: `url(#${ids.haze.replace("Haze", "Shade")})` }),
      el("circle", { r: ids.disc, fill: `url(#${ids.haze})`, mask: `url(#${ids.mask})` }),
      el("circle", { r: ids.rimR, fill: `url(#${ids.rim})`, mask: `url(#${ids.mask})` }),
    ),
  );
  return new MiniDoc(svg);
}

describe("Sol bodies", () => {
  it("places every library look in the Observatory at the size ladder", () => {
    for (const look of SOL_LOOKS) {
      const art = solArt(look);
      const placed = observatory.bodies.find((item) => item.look === look);
      expect(placed, look).toBeTruthy();
      expect(placed?.radius).toBe(art.radius);
      const fit = artForBody(placed as Body, theme);
      if (look === "voyager" || look === "arrokoth") {
        expect(fit?.url).toBe(look === "voyager" ? theme.assets.solVoyager : theme.assets.solArrokoth);
      } else {
        expect(fit).toBeNull();
      }
    }
  });

  it("scrolls strips on the header periods and keeps locked faces fixed", () => {
    expect(solArt("venus").strips[0]).toMatchObject({ dur: 96, distance: -208, fromX: 208 });
    expect(solArt("earth").strips.map((strip) => [strip.id, strip.dur, strip.night ?? false])).toEqual([
      ["eth-land", 90, false],
      ["eth-cloud-shadow", 64, false],
      ["eth-clouds", 64, false],
      ["eth-cities", 90, true],
    ]);
    expect(solArt("mercury").strips[0]).toMatchObject({ dur: 300, distance: 132 });
    expect(solArt("mars").strips[0]?.dur).toBe(92);
    expect(solArt("jupiter").strips[0]?.dur).toBe(240);
    expect(solArt("saturn").strips[0]).toMatchObject({ dur: 260, rollDeg: -14 });
    expect(solArt("uranus").strips[0]).toMatchObject({ dur: 140, rollDeg: -62 });
    expect(solArt("titan").strips[0]?.dur).toBe(160);
    expect(solArt("neptune").strips[0]?.dur).toBe(120);
    expect(solArt("sol-sun").strips[0]).toMatchObject({ dur: 180, distance: 289, opacity: 0.92 });
    expect(solArt("luna").strips).toEqual([]);
    expect(solArt("pluto").strips).toEqual([]);
    expect(solArt("charon").strips).toEqual([]);
    expect(solArt("saturn").ringShadow).toBe(true);
    expect(solArt("uranus").rings).toBe(true);
    expect(solArt("uranus").ringShadow).toBe(false);
  });

  it("drops the night-side rim on Sol air and leaves the day glow and the shade", () => {
    for (const ids of [
      { root: "earth", grad: "ethLit", mask: "ethLitMask", haze: "ethHaze", rim: "ethRim", rimR: "36.62", disc: "34" },
      { root: "saturn", grad: "satLit", mask: "satLitMask", haze: "satHaze", rim: "satRim", rimR: "112.55", disc: "104.5" },
    ]) {
      const doc = airBody(ids);
      prepSol(doc as unknown as Document, ids.root, "air");
      const root = doc.getElementById(ids.root);
      const circles = root?.querySelectorAll("circle") ?? [];
      const haze = circles.find((circle) => circle.getAttribute("fill") === `url(#${ids.haze})`);
      const rim = circles.find((circle) => circle.getAttribute("fill") === `url(#${ids.rim})`);
      expect(haze?.getAttribute("mask"), ids.root).toBe(`url(#${ids.mask})`);
      expect(rim?.getAttribute("mask"), ids.root).toBe(`url(#${ids.mask}-day)`);
      expect(doc.getElementById(ids.grad)?.querySelectorAll("stop")[2]?.getAttribute("stop-opacity")).toBe("0.06");
      expect(doc.getElementById(`${ids.grad}-day`)?.querySelectorAll("stop")[2]?.getAttribute("stop-opacity")).toBe("0");
      expect(circles.some((circle) => (circle.getAttribute("fill") ?? "").includes("Shade"))).toBe(false);
    }
  });

  it("draws Voyager as a prop that does not collide", () => {
    const voyager = observatory.bodies.find((item) => item.look === "voyager");
    expect(voyager?.solid).toBe(false);
    expect(bodySolid(voyager as Body)).toBe(false);
    expect(voyager?.orbit).toBeUndefined();
  });
});
