import * as THREE from "three";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory } from "../visual";

/**
 * Screen-fixed sky. v1 paints the theme's three layers once per resize.
 * starfield.svg is a sample of the same treatment, not a bitmap to copy.
 * A later sky replaces this factory (cubemap, catalog) and can ignore the seed.
 */
export const createStarfield: VisualFactory = (theme) => new StarfieldVisual(theme);

class StarfieldVisual implements Visual {
  readonly space = "background" as const;
  readonly object: THREE.Mesh;
  private texture: THREE.CanvasTexture | null = null;
  private width = 0;
  private height = 0;
  private readonly theme: Theme;

  constructor(theme: Theme) {
    this.theme = theme;
    const material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false });
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.object.frustumCulled = false;
    this.object.name = "starfield";
    this.object.userData.asset = theme.assets.starfield;
  }

  resize(width: number, height: number, dpr: number): void {
    if (width === this.width && height === this.height && this.texture) return;
    this.width = width;
    this.height = height;
    this.texture?.dispose();
    const texture = new THREE.CanvasTexture(paint(this.theme, width, height, dpr));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    this.texture = texture;
    const material = this.object.material as THREE.MeshBasicMaterial;
    material.map = texture;
    material.needsUpdate = true;
    this.object.scale.set(width, height, 1);
    this.object.position.set(width / 2, height / 2, 0);
  }

  update(): void {
    /* Static. No parallax, no twinkle. */
  }

  dispose(): void {
    this.texture?.dispose();
    disposeObject(this.object);
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(theme: Theme, width: number, height: number, dpr: number): HTMLCanvasElement {
  const sky = theme.starfield;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const g = canvas.getContext("2d", { alpha: false });
  if (!g) throw new Error("Could not paint the starfield");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = theme.colors.bg;
  g.fillRect(0, 0, width, height);
  const vignette = g.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, sky.vignetteRadius);
  vignette.addColorStop(0, theme.colors.vignette);
  vignette.addColorStop(1, theme.colors.bg);
  g.fillStyle = vignette;
  g.fillRect(0, 0, width, height);
  paintNebula(g, width * 0.28, height * 0.42, width * 0.42, height * 0.28, "#3A2A78", 0.28);
  paintNebula(g, width * 0.72, height * 0.3, width * 0.36, height * 0.22, "#1C4E72", 0.22);
  paintNebula(g, width * 0.55, height * 0.72, width * 0.5, height * 0.16, "#6A3058", 0.16);

  const rnd = mulberry32(sky.seed);
  const scale = (width * height) / (sky.referenceWidth * sky.referenceHeight);
  const sparkles: [number, number][] = [];
  for (let layer = 0; layer < sky.layers.length; layer++) {
    const { color, radius, alpha, count } = sky.layers[layer];
    const n = Math.round(count * scale);
    const tint = layer === 0 ? "#6E8FD0" : layer === 1 ? "#F0C48A" : color;
    g.globalAlpha = alpha;
    g.fillStyle = layer === sky.layers.length - 1 ? color : tint;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = rnd() * width;
      const y = rnd() * height;
      g.moveTo(x + radius, y);
      g.arc(x, y, radius, 0, Math.PI * 2);
      if (layer === sky.layers.length - 1 && sparkles.length < sky.sparkles) sparkles.push([x, y]);
    }
    g.fill();
  }
  g.globalAlpha = 0.5;
  g.strokeStyle = theme.colors.starsNear;
  g.lineWidth = 0.6;
  g.lineCap = "round";
  g.beginPath();
  for (const [x, y] of sparkles) {
    g.moveTo(x - 2.5, y);
    g.lineTo(x + 2.5, y);
    g.moveTo(x, y - 2.5);
    g.lineTo(x, y + 2.5);
  }
  g.stroke();
  g.globalAlpha = 1;
  return canvas;
}

function paintNebula(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  alpha: number,
): void {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / Math.max(rx, 1));
  const wash = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  wash.addColorStop(0, color);
  wash.addColorStop(1, "rgba(0,0,0,0)");
  g.globalAlpha = alpha;
  g.fillStyle = wash;
  g.beginPath();
  g.arc(0, 0, rx, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
