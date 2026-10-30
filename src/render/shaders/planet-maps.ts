import * as THREE from "three";
import charonFaceUrl from "../../../design/shaders/maps/charon-face.png?url";
import crackedAlbedoUrl from "../../../design/shaders/maps/cracked-albedo.png?url";
import crackedGlowUrl from "../../../design/shaders/maps/cracked-glow.png?url";
import dwarfAlbedoUrl from "../../../design/shaders/maps/dwarf-albedo.png?url";
import earthAlbedoUrl from "../../../design/shaders/maps/earth-albedo.png?url";
import earthCloudsUrl from "../../../design/shaders/maps/earth-clouds.png?url";
import earthLightsUrl from "../../../design/shaders/maps/earth-lights.png?url";
import erisFaceUrl from "../../../design/shaders/maps/eris-face.png?url";
import iceAlbedoUrl from "../../../design/shaders/maps/ice-albedo.png?url";
import lavaAlbedoUrl from "../../../design/shaders/maps/lava-albedo.png?url";
import lavaGlowUrl from "../../../design/shaders/maps/lava-glow.png?url";
import marsAlbedoUrl from "../../../design/shaders/maps/mars-albedo.png?url";
import mercuryAlbedoUrl from "../../../design/shaders/maps/mercury-albedo.png?url";
import moonBarrenUrl from "../../../design/shaders/maps/moon-barren-albedo.png?url";
import moonFaceUrl from "../../../design/shaders/maps/moon-face.png?url";
import moonIcyUrl from "../../../design/shaders/maps/moon-icy-albedo.png?url";
import moonVolcanicUrl from "../../../design/shaders/maps/moon-volcanic-albedo.png?url";
import oceanAlbedoUrl from "../../../design/shaders/maps/ocean-albedo.png?url";
import oceanCloudsUrl from "../../../design/shaders/maps/ocean-clouds.png?url";
import planetXAlbedoUrl from "../../../design/shaders/maps/planet-x-albedo.png?url";
import planetXCloudsUrl from "../../../design/shaders/maps/planet-x-clouds.png?url";
import plutoFaceUrl from "../../../design/shaders/maps/pluto-face.png?url";
import rockyAlbedoUrl from "../../../design/shaders/maps/rocky-albedo.png?url";
import titanAlbedoUrl from "../../../design/shaders/maps/titan-albedo.png?url";
import toxicAlbedoUrl from "../../../design/shaders/maps/toxic-albedo.png?url";
import toxicCloudsUrl from "../../../design/shaders/maps/toxic-clouds.png?url";
import venusAlbedoUrl from "../../../design/shaders/maps/venus-albedo.png?url";

/**
 * Baked rocky-planet maps. design/shader-specs.md §3 and threejs-notes.md §25.
 * Each file loads once and is shared. Strips are 1024×256 and faces are
 * 512×512, so they mip. wrapS repeats for the spin. Nothing here uploads
 * per frame: the loader sets needsUpdate once, when the image arrives.
 */

const MAP_URLS: Record<string, string> = {
  "charon-face": charonFaceUrl,
  "cracked-albedo": crackedAlbedoUrl,
  "cracked-glow": crackedGlowUrl,
  "dwarf-albedo": dwarfAlbedoUrl,
  "earth-albedo": earthAlbedoUrl,
  "earth-clouds": earthCloudsUrl,
  "earth-lights": earthLightsUrl,
  "eris-face": erisFaceUrl,
  "ice-albedo": iceAlbedoUrl,
  "lava-albedo": lavaAlbedoUrl,
  "lava-glow": lavaGlowUrl,
  "mars-albedo": marsAlbedoUrl,
  "mercury-albedo": mercuryAlbedoUrl,
  "moon-barren-albedo": moonBarrenUrl,
  "moon-face": moonFaceUrl,
  "moon-icy-albedo": moonIcyUrl,
  "moon-volcanic-albedo": moonVolcanicUrl,
  "ocean-albedo": oceanAlbedoUrl,
  "ocean-clouds": oceanCloudsUrl,
  "planet-x-albedo": planetXAlbedoUrl,
  "planet-x-clouds": planetXCloudsUrl,
  "pluto-face": plutoFaceUrl,
  "rocky-albedo": rockyAlbedoUrl,
  "titan-albedo": titanAlbedoUrl,
  "toxic-albedo": toxicAlbedoUrl,
  "toxic-clouds": toxicCloudsUrl,
  "venus-albedo": venusAlbedoUrl,
};

const cache = new Map<string, THREE.Texture>();
let loader: THREE.TextureLoader | null = null;
let pending = 0;
let settled = 0;

function configure(texture: THREE.Texture): void {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
}

function markSettled(): void {
  settled += 1;
  if (settled >= pending && pending > 0 && typeof document !== "undefined") {
    document.documentElement.dataset.planetMaps = "ready";
  }
}

/** One transparent sample for a slot the body does not use. Not mipmapped (1×1). */
let blank: THREE.Texture | null = null;

export function blankPlanetMap(): THREE.Texture {
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

export function planetTexture(name: string): THREE.Texture {
  const hit = cache.get(name);
  if (hit) return hit;
  const url = MAP_URLS[name];
  if (!url) throw new Error(`No rocky-planet map ${name}`);
  let texture: THREE.Texture;
  if (typeof document === "undefined") {
    texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    texture.needsUpdate = true;
    texture.userData.placeholder = true;
    configure(texture);
  } else {
    pending += 1;
    if (typeof document !== "undefined") delete document.documentElement.dataset.planetMaps;
    loader ??= new THREE.TextureLoader();
    texture = loader.load(url, markSettled, undefined, markSettled);
    configure(texture);
  }
  texture.name = name;
  cache.set(name, texture);
  return texture;
}

export function planetMapOrBlank(name: string | undefined): THREE.Texture {
  return name ? planetTexture(name) : blankPlanetMap();
}
