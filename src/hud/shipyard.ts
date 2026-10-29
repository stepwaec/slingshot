import { buyUpgrade, type Game } from "../game/state";
import { shipLoadout, UPGRADES, type UpgradeId } from "../game/upgrades";
import { resetShipLook, setEngineLook, shipLook, toggleLook, type LookModule } from "../render/appearance";
import { damageBand, ENGINE_PLUME_IDS, type EngineLook, shipBuild } from "../render/ship-art";
import { theme } from "../render/theme";
import { bakedSvgUrl } from "../render/svg-bake";

/**
 * Shipyard screen. Buying hull, tanks, solar, shielding or engines goes through
 * `buyUpgrade`. Scoop, sensors, cryosleep and the engine picture are cosmetic.
 */

const LOOKS: { id: LookModule; name: string; detail: string }[] = [
  { id: "scoop", name: "Gas scoop", detail: "Shoulder intakes. Appearance only, until scoops exist." },
  { id: "sensors", name: "Sensors", detail: "A nose antenna and a dish. Appearance only." },
  { id: "cryo", name: "Cryosleep", detail: "Pod windows on the hull. Appearance only." },
];

const REAL: { id: UpgradeId; name: string; detail: string }[] = [
  { id: "hull", name: "Hull plating", detail: "Armour shell. Hull 160, and the ship is heavier." },
  { id: "tanks", name: "Fuel tanks", detail: "Side pods. Fuel tank 140%, extra mass." },
  { id: "solar", name: "Solar panels", detail: "Blue wings. Refills fuel near stars, extra mass." },
  { id: "shield", name: "Shielding", detail: "Halves crew dose. The deflector shows, and the ship is heavier." },
];

export function mountShipyard(): void {
  const list = document.querySelector("#upgrade-list");
  const close = document.querySelector<HTMLButtonElement>("#yard-close");
  const panel = document.querySelector<HTMLElement>("#upgrades");
  if (!list || !panel) return;
  close?.addEventListener("click", () => {
    panel.hidden = true;
  });

  for (const spec of REAL) list.append(card(spec.name, spec.detail, buyButton(spec.id)));
  for (const spec of LOOKS) list.append(card(spec.name, spec.detail, lookButton(spec.id)));
  list.append(engineCard());
  mountPreview();
}

export function syncShipyard(game: Game): { hideToggle: boolean } {
  const planning = game.mode === "planning";
  const panel = document.querySelector<HTMLElement>("#upgrades");
  if (!planning && panel) panel.hidden = true;
  const load = shipLoadout(game.upgrades);
  const points = document.querySelector("#upgrade-points");
  const mass = document.querySelector("#upgrade-mass");
  const fuel = document.querySelector("#yard-fuel");
  const solar = document.querySelector("#yard-solar");
  if (points) points.textContent = String(game.points);
  if (mass) mass.textContent = load.mass.toFixed(2);
  if (fuel) fuel.textContent = `${Math.round(load.fuelFactor * 100)}%`;
  if (solar) solar.textContent = load.solar > 0 ? "Near stars" : "None";

  for (const spec of UPGRADES) {
    const button = document.querySelector<HTMLButtonElement>(`button[data-upgrade="${spec.id}"]`);
    if (!button) continue;
    const owned = game.upgrades.includes(spec.id);
    button.disabled = owned || game.points < spec.cost || !planning;
    button.textContent = owned ? "Fitted" : "Fit";
    button.classList.toggle("is-fitted", owned);
    button.closest(".yard-card")?.classList.toggle("is-fitted", owned);
  }
  for (const spec of LOOKS) {
    const button = document.querySelector<HTMLButtonElement>(`button[data-look="${spec.id}"]`);
    const on = shipLook[spec.id];
    if (!button) continue;
    button.textContent = on ? "Shown" : "Show";
    button.classList.toggle("is-fitted", on);
    button.closest(".yard-card")?.classList.toggle("is-fitted", on);
    button.disabled = !planning;
  }
  for (const look of ["chemical", "ion", "pulse"] as const) {
    const button = document.querySelector<HTMLButtonElement>(`button[data-engine="${look}"]`);
    button?.setAttribute("aria-pressed", shipLook.engine === look ? "true" : "false");
    if (button) button.disabled = !planning;
  }
  void syncPreview(game);
  return { hideToggle: !planning };
}

export { resetShipLook };

function card(name: string, detail: string, action: HTMLElement): HTMLElement {
  const row = document.createElement("article");
  row.className = "yard-card";
  const copy = document.createElement("p");
  const title = document.createElement("strong");
  title.textContent = name;
  copy.append(title, document.createTextNode(detail));
  row.append(copy, action);
  return row;
}

function buyButton(id: UpgradeId): HTMLButtonElement {
  const spec = UPGRADES.find((item) => item.id === id);
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.upgrade = id;
  button.textContent = "Fit";
  button.title = spec ? `${spec.cost} points` : "";
  button.addEventListener("click", () => {
    const game = currentGame;
    if (!game) return;
    buyUpgrade(game, id);
    syncShipyard(game);
  });
  return button;
}

function lookButton(id: LookModule): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.look = id;
  button.textContent = "Show";
  button.addEventListener("click", () => {
    toggleLook(id);
    if (currentGame) syncShipyard(currentGame);
  });
  return button;
}

function engineCard(): HTMLElement {
  const row = card(
    "Engines",
    "Chemical, ion or pulse change the plume only. Fit Engines to push 15% harder, with extra mass.",
    buyButton("engines"),
  );
  const modes = document.createElement("div");
  modes.className = "engine-modes";
  for (const look of ["chemical", "ion", "pulse"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.engine = look;
    button.textContent = look[0]?.toUpperCase() + look.slice(1);
    button.addEventListener("click", () => {
      setEngineLook(look);
      if (currentGame) syncShipyard(currentGame);
    });
    modes.append(button);
  }
  row.append(modes);
  return row;
}

let currentGame: Game | null = null;

const preview = new Map<string, HTMLImageElement>();

function mountPreview(): void {
  const host = document.querySelector("#yard-ship");
  if (!host) return;
  for (const key of ["solar", "tanks", "platingBack", "engine", "hull", "platingFront", "cryo", "scoop", "sensors", "shield", "damage"]) {
    const img = document.createElement("img");
    img.alt = "";
    img.dataset.part = key;
    img.hidden = key !== "hull" && key !== "engine";
    host.append(img);
    preview.set(key, img);
  }
}

async function syncPreview(game: Game): Promise<void> {
  currentGame = game;
  const build = shipBuild(game.upgrades, shipLook);
  const pose = game.mode === "planning" ? game.initial : game.ship;
  const band = damageBand(pose.hull, pose.hullMax);
  const show = (key: string, on: boolean) => {
    const img = preview.get(key);
    if (img) img.hidden = !on;
  };
  show("solar", build.solar);
  show("tanks", build.tanks);
  show("platingBack", build.plating);
  show("platingFront", build.plating);
  show("cryo", build.cryo);
  show("scoop", build.scoop);
  show("sensors", build.sensors);
  show("shield", build.shield);
  show("hull", true);
  show("engine", true);
  show("damage", band !== "none");
  const assets = theme.assets;
  await Promise.all([
    setSrc("hull", assets.hull),
    setSrc("solar", assets.solar),
    setSrc("tanks", assets.tanks),
    setSrc("platingBack", assets.plating, ["shipModPlatingFront"]),
    setSrc("platingFront", assets.plating, ["shipModPlatingBack"]),
    setSrc("cryo", assets.cryo),
    setSrc("scoop", assets.scoop),
    setSrc("sensors", assets.sensors),
    setSrc("shield", assets.shield),
    setSrc("engine", engineUrl(build.engine), ENGINE_PLUME_IDS[build.engine]),
    setSrc("damage", band === "75" ? assets.damage75 : band === "45" ? assets.damage45 : assets.damage15),
  ]);
}

function engineUrl(look: EngineLook): string {
  if (look === "ion") return theme.assets.engineIon;
  if (look === "pulse") return theme.assets.enginePulse;
  return theme.assets.engineChemical;
}

async function setSrc(key: string, url: string, hide: readonly string[] = []): Promise<void> {
  const img = preview.get(key);
  if (!img) return;
  const baked = await bakedSvgUrl(url, hide);
  if (img.src !== baked) img.src = baked;
}
