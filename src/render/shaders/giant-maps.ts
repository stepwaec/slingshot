import * as THREE from "three";
import gasBandedBandsUrl from "../../../design/shaders/maps/gas-banded-bands.png?url";
import gasRingedBandsUrl from "../../../design/shaders/maps/gas-ringed-bands.png?url";
import gasRingedRingsUrl from "../../../design/shaders/maps/gas-ringed-rings.png?url";
import jupiterBandsUrl from "../../../design/shaders/maps/jupiter-bands.png?url";
import neptuneBandsUrl from "../../../design/shaders/maps/neptune-bands.png?url";
import iceBandsUrl from "../../../design/shaders/maps/ring-saturn-bands.png?url";
import iceRingsUrl from "../../../design/shaders/maps/ring-saturn-rings.png?url";
import saturnBandsUrl from "../../../design/shaders/maps/saturn-bands.png?url";
import saturnRingsUrl from "../../../design/shaders/maps/saturn-rings.png?url";
import uranusBandsUrl from "../../../design/shaders/maps/uranus-bands.png?url";
import uranusRingsUrl from "../../../design/shaders/maps/uranus-rings.png?url";

/**
 * Baked gas-giant maps. design/shader-specs.md §4 and threejs-notes.md §25.
 * Each file loads once and is shared. Band strips repeat on S and mip.
 * Ring profiles are 1024×4 and clamp: the shader box-filters them.
 * Nothing here uploads a texture per frame.
 */

const BANDS: Record<string, string> = {
  "gas-banded-bands": gasBandedBandsUrl,
  "gas-ringed-bands": gasRingedBandsUrl,
  "jupiter-bands": jupiterBandsUrl,
  "neptune-bands": neptuneBandsUrl,
  "ring-saturn-bands": iceBandsUrl,
  "saturn-bands": saturnBandsUrl,
  "uranus-bands": uranusBandsUrl,
};

const RINGS: Record<string, string> = {
  "gas-ringed-rings": gasRingedRingsUrl,
  "ring-saturn-rings": iceRingsUrl,
  "saturn-rings": saturnRingsUrl,
  "uranus-rings": uranusRingsUrl,
};

const cache = new Map<string, THREE.Texture>();
let loader: THREE.TextureLoader | null = null;
let pending = 0;
let settled = 0;

function markSettled(): void {
  settled += 1;
  if (settled >= pending && pending > 0 && typeof document !== "undefined") {
    document.documentElement.dataset.giantMaps = "ready";
  }
}

function configure(texture: THREE.Texture, rings: boolean): void {
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = true;
  texture.wrapS = rings ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = rings ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = !rings;
}

/** One transparent sample for a giant that has no rings. */
let blank: THREE.Texture | null = null;

export function blankRingMap(): THREE.Texture {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blank.colorSpace = THREE.NoColorSpace;
    blank.wrapS = THREE.ClampToEdgeWrapping;
    blank.wrapT = THREE.ClampToEdgeWrapping;
    blank.flipY = true;
    blank.generateMipmaps = false;
    blank.minFilter = THREE.LinearFilter;
    blank.magFilter = THREE.LinearFilter;
    blank.needsUpdate = true;
  }
  return blank;
}

export function giantTexture(name: string): THREE.Texture {
  const hit = cache.get(name);
  if (hit) return hit;
  const band = BANDS[name];
  const ring = RINGS[name];
  const url = band ?? ring;
  if (!url) throw new Error(`No gas-giant map ${name}`);
  const rings = ring !== undefined;
  let texture: THREE.Texture;
  if (typeof document === "undefined") {
    texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, rings ? 0 : 255]), 1, 1);
    texture.needsUpdate = true;
    texture.userData.placeholder = true;
    configure(texture, rings);
  } else {
    pending += 1;
    delete document.documentElement.dataset.giantMaps;
    loader ??= new THREE.TextureLoader();
    texture = loader.load(url, markSettled, undefined, markSettled);
    configure(texture, rings);
  }
  texture.name = name;
  cache.set(name, texture);
  return texture;
}
