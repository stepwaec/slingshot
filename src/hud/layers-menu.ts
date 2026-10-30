import { LAYERS, layersOnCount, layerView, type LayerGame, type LayersPanelState } from "../game/layers";
import { gravityBandLegend } from "./gravity-legend";

/**
 * DOM for the Layers button and panel. Rows are built once from `LAYERS`.
 * design/assets/layers-menu.svg and design/style.md §20.
 */

const ICONS: Record<string, string> = {
  gravity: `<svg viewBox="-9 -9 18 18" width="18" height="18" aria-hidden="true"><path d="M-8 -8 Q-7 0 -8 8" fill="none" stroke="#9FB8FF" stroke-width="1"/><path d="M-8 -8 Q0 -7 8 -8" fill="none" stroke="#9FB8FF" stroke-width="1"/><path d="M-2.7 -8 Q0.3 0 -2.7 8" fill="none" stroke="#9FB8FF" stroke-width="1"/><path d="M-8 -2.7 Q0 0.3 8 -2.7" fill="none" stroke="#9FB8FF" stroke-width="1"/><path d="M2.6 -8 Q5.6 0 2.6 8" fill="none" stroke="#9FB8FF" stroke-width="1"/><path d="M-8 2.6 Q0 5.6 8 2.6" fill="none" stroke="#9FB8FF" stroke-width="1"/><path d="M7.9 -8 Q8.9 0 7.9 8" fill="none" stroke="#9FB8FF" stroke-width="1"/><path d="M-8 7.9 Q0 8.9 8 7.9" fill="none" stroke="#9FB8FF" stroke-width="1"/><circle cx="0" cy="1.5" r="2.4" fill="#FF8C2E"/></svg>`,
  magnetism: `<svg viewBox="-9 -10 18 20" width="18" height="18" aria-hidden="true"><circle r="2" fill="#FFE0FA"/><path d="M0 -1.5 C4.5 -5.5 4.5 5.5 0 1.5 M0 -1.5 C-4.5 -5.5 -4.5 5.5 0 1.5" fill="none" stroke="#C77DFF" stroke-width="1"/><path d="M0 -1.5 C7.7 -9.4 7.7 9.4 0 1.5 M0 -1.5 C-7.7 -9.4 -7.7 9.4 0 1.5" fill="none" stroke="#C77DFF" stroke-width="1"/></svg>`,
  radiation: `<svg viewBox="-9 -8 18 16" width="18" height="18" aria-hidden="true"><circle cx="-6" cy="-3.5" r="0.8" fill="#9BE15D"/><circle cx="-6" cy="3.5" r="1" fill="#9BE15D"/><circle cx="-2" cy="-3.5" r="1.2" fill="#D4F03C"/><circle cx="-2" cy="3.5" r="1.4" fill="#D4F03C"/><circle cx="2" cy="-3.5" r="1.6" fill="#FFE83A"/><circle cx="2" cy="3.5" r="1.8" fill="#FFE83A"/><circle cx="6" cy="-3.5" r="2.1" fill="#FFF4B8"/><circle cx="6" cy="3.5" r="2.3" fill="#FFF4B8"/></svg>`,
  astrophage: `<svg viewBox="-10 -10 20 20" width="18" height="18" aria-hidden="true"><line x1="-7.5" y1="-5.2" x2="-4.5" y2="-6.8" stroke="#FF7A9C" stroke-width="1.1" stroke-linecap="round"/><circle cx="-4.5" cy="-6.8" r="0.9" fill="#FF7A9C"/><line x1="-7.5" y1="0.8" x2="-4.5" y2="-0.8" stroke="#FF7A9C" stroke-width="1.1" stroke-linecap="round"/><circle cx="-4.5" cy="-0.8" r="0.9" fill="#FF7A9C"/><line x1="-7.5" y1="6.8" x2="-4.5" y2="5.2" stroke="#FF7A9C" stroke-width="1.1" stroke-linecap="round"/><circle cx="-4.5" cy="5.2" r="0.9" fill="#FF7A9C"/><line x1="-2.2" y1="-4.9" x2="2.2" y2="-7.1" stroke="#FF3D6E" stroke-width="1.1" stroke-linecap="round"/><circle cx="2.2" cy="-7.1" r="0.9" fill="#FF3D6E"/><line x1="-2.2" y1="1.1" x2="2.2" y2="-1.1" stroke="#FF3D6E" stroke-width="1.1" stroke-linecap="round"/><circle cx="2.2" cy="-1.1" r="0.9" fill="#FF3D6E"/><line x1="-2.2" y1="7.1" x2="2.2" y2="4.9" stroke="#FF3D6E" stroke-width="1.1" stroke-linecap="round"/><circle cx="2.2" cy="4.9" r="0.9" fill="#FF3D6E"/><line x1="3.1" y1="-4.5" x2="8.9" y2="-7.5" stroke="#FFC2D2" stroke-width="1.1" stroke-linecap="round"/><circle cx="8.9" cy="-7.5" r="0.9" fill="#FFC2D2"/><line x1="3.1" y1="1.4" x2="8.9" y2="-1.4" stroke="#FFC2D2" stroke-width="1.1" stroke-linecap="round"/><circle cx="8.9" cy="-1.4" r="0.9" fill="#FFC2D2"/><line x1="3.1" y1="7.5" x2="8.9" y2="4.5" stroke="#FFC2D2" stroke-width="1.1" stroke-linecap="round"/><circle cx="8.9" cy="4.5" r="0.9" fill="#FFC2D2"/></svg>`,
  tidal: `<svg viewBox="-9 -9 18 18" width="18" height="18" aria-hidden="true"><circle r="2.2" fill="#DCE4FF"/><path d="M-4.5 -3 L-7.5 0 L-4.5 3" fill="none" stroke="#7FE0FF" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M-3 -4.5 L0 -7 L3 -4.5" fill="none" stroke="#7FE0FF" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 -3 L7.5 0 L4.5 3" fill="none" stroke="#7FE0FF" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M-3 4.5 L0 7 L3 4.5" fill="none" stroke="#7FE0FF" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

interface LayerRow {
  id: string;
  button: HTMLButtonElement;
  note: HTMLElement;
  legend: HTMLElement | null;
}

function legendElement(kind: NonNullable<(typeof LAYERS)[number]["legend"]>): HTMLElement {
  const legend = document.createElement("span");
  legend.className = `layer-legend layer-legend-${kind}`;
  legend.hidden = true;
  if (kind === "gravity") {
    legend.append(gravityBandLegend());
    return legend;
  }
  if (kind === "magnetism") {
    legend.append(zoneLegend());
    return legend;
  }
  if (kind === "radiation") {
    legend.append(dotLegend());
    return legend;
  }
  if (kind === "tidal") {
    legend.append(tidalLegend());
    return legend;
  }
  legend.append(tickLegend());
  return legend;
}

function zoneLegend(): HTMLElement {
  const row = document.createElement("span");
  row.className = "zone-legend";
  const zones: Array<[string, string]> = [
    ["safe", "Safe"],
    ["fuzzy", "Fuzzy"],
    ["scrambled", "Scrambled"],
    ["damaging", "Damaging"],
    ["lethal", "Lethal"],
  ];
  for (let i = 0; i < zones.length; i++) {
    const item = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.className = "mag-swatch";
    swatch.dataset.zone = zones[i][0];
    item.append(swatch, document.createTextNode(zones[i][1]));
    row.append(item);
  }
  return row;
}

function dotLegend(): HTMLElement {
  const row = document.createElement("span");
  row.className = "dot-legend";
  const dots: Array<[string, string]> = [
    ["low", "Low"],
    ["raised", "Raised"],
    ["high", "High"],
    ["severe", "Severe"],
  ];
  for (let i = 0; i < dots.length; i++) {
    const item = document.createElement("span");
    const dot = document.createElement("i");
    dot.className = "rad-dot";
    dot.dataset.zone = dots[i][0];
    item.append(dot, document.createTextNode(dots[i][1]));
    row.append(item);
  }
  return row;
}

function tidalLegend(): HTMLElement {
  const row = document.createElement("span");
  row.className = "ring-legend";
  const marks: Array<[string, string]> = [
    ["trace", "Trace"],
    ["low", "Level 1"],
    ["warn", "Level 2"],
    ["critical", "Level 3 · hull"],
  ];
  for (let i = 0; i < marks.length; i++) {
    const item = document.createElement("span");
    const mark = document.createElement("i");
    mark.className = "tidal-ring";
    mark.dataset.zone = marks[i][0];
    item.append(mark, document.createTextNode(marks[i][1]));
    row.append(item);
  }
  return row;
}

function tickLegend(): HTMLElement {
  const row = document.createElement("span");
  row.className = "tick-legend";
  const ticks: Array<[string, string]> = [
    ["trace", "Trace"],
    ["present", "Present"],
    ["dense", "Dense"],
    ["harvest", "Harvest"],
    ["eaten", "Eaten"],
  ];
  for (let i = 0; i < ticks.length; i++) {
    const item = document.createElement("span");
    const mark = document.createElement("i");
    mark.className = "astro-tick";
    mark.dataset.zone = ticks[i][0];
    item.append(mark, document.createTextNode(ticks[i][1]));
    row.append(item);
  }
  return row;
}

/** Build one menuitemcheckbox per table entry. Call once, at startup. */
export function mountLayersMenu(panel: HTMLElement, onToggle: (id: string) => void): void {
  for (let i = 0; i < LAYERS.length; i++) {
    const layer = LAYERS[i];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "layer-row";
    button.id = `layer-${layer.id}`;
    button.dataset.layer = layer.id;
    button.setAttribute("role", "menuitemcheckbox");
    button.setAttribute("aria-checked", "false");
    const icon = document.createElement("span");
    icon.className = "layer-icon";
    icon.innerHTML = ICONS[layer.id] ?? "";
    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name;
    const key = document.createElement("kbd");
    key.textContent = layer.key;
    const swatch = document.createElement("span");
    swatch.className = "layer-switch";
    swatch.setAttribute("aria-hidden", "true");
    const slot = document.createElement("span");
    slot.className = "layer-slot";
    const note = document.createElement("span");
    note.className = "layer-note";
    note.hidden = true;
    slot.append(note);
    if (layer.legend) slot.append(legendElement(layer.legend));
    button.append(icon, name, key, swatch, slot);
    button.addEventListener("click", () => onToggle(layer.id));
    panel.append(button);
  }
}

function rowsOf(panel: HTMLElement): LayerRow[] {
  const buttons = panel.querySelectorAll<HTMLButtonElement>(".layer-row");
  const rows: LayerRow[] = [];
  buttons.forEach((button) => {
    const note = button.querySelector<HTMLElement>(".layer-note");
    if (!note) return;
    rows.push({
      id: button.dataset.layer ?? "",
      button,
      note,
      legend: button.querySelector<HTMLElement>(".layer-legend"),
    });
  });
  return rows;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Paint the button, the badge and each row from the table and the view flags. */
export function syncLayersMenu(
  game: LayerGame,
  panelState: LayersPanelState,
  button: HTMLButtonElement,
  panel: HTMLElement,
): void {
  const count = layersOnCount(game);
  const expanded = panelState.open ? "true" : "false";
  if (button.getAttribute("aria-expanded") !== expanded) button.setAttribute("aria-expanded", expanded);
  if (count > 0) button.dataset.on = "true";
  else delete button.dataset.on;
  const badge = button.querySelector<HTMLElement>(".layers-badge");
  if (badge) {
    badge.hidden = count === 0;
    if (count > 0) setText(badge, String(count));
  }
  panel.hidden = !panelState.open;

  const rows = rowsOf(panel);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const layer = LAYERS.find((item) => item.id === row.id);
    if (!layer) continue;
    const view = layerView(layer, game);
    const checked = view.checked ? "true" : "false";
    if (row.button.getAttribute("aria-checked") !== checked) row.button.setAttribute("aria-checked", checked);
    row.button.disabled = view.disabled;
    if (view.dim) row.button.dataset.dim = "true";
    else delete row.button.dataset.dim;
    const showNote = view.note.length > 0;
    row.note.hidden = !showNote;
    if (showNote) setText(row.note, view.note);
    if (row.legend) row.legend.hidden = !view.showLegend;
  }
}
