import { TIME_BANDS } from "../render/palette";
import { theme } from "../render/theme";

/**
 * Gravity row of the Layers menu.
 * design/assets/layers-menu.svg: six 16×10 swatches, "clock ×0.96" … "stopped", and "+ grid".
 * The Layers menu mounts this under the Gravity name when that row is on.
 */
export function gravityBandLegend(): HTMLElement {
  const spec = theme.gravity;
  const root = document.createElement("div");
  root.className = "gravity-legend";

  const swatches = document.createElement("div");
  swatches.className = "gravity-legend-swatches";
  for (let i = 0; i < TIME_BANDS.length; i++) {
    const band = TIME_BANDS[i];
    const chip = document.createElement("i");
    chip.className = "gravity-band-swatch";
    chip.title = band.label;
    chip.style.background = hexAlpha(band.color, band.alpha);
    chip.style.borderColor = hexAlpha(band.contour, spec.legendStrokeAlpha);
    swatches.append(chip);
  }
  const grid = document.createElement("span");
  grid.className = "gravity-legend-grid";
  grid.textContent = "+ grid";
  swatches.append(grid);

  const scale = document.createElement("div");
  scale.className = "gravity-legend-scale";
  const slow = document.createElement("span");
  slow.textContent = `clock ${TIME_BANDS[0].label}`;
  const stopped = document.createElement("span");
  stopped.textContent = "stopped";
  scale.append(slow, stopped);

  root.append(swatches, scale);
  return root;
}

function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
