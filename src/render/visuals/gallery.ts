import * as THREE from "three";
import { artForBody, artForNebula, artMaterial, artMesh, loadArtTexture, poseArt, rasterPixels, type ArtFit } from "../art-sprite";
import {
  brightestOffset,
  cometDustMirror,
  cometTailStretch,
  ellipsePeriapsis,
  flareOpacity,
  prominenceWindow,
  pulsarBeamScale,
  sunBreathe,
  sunFlameAngle,
  sunGrainAngle,
  sunWispAngle,
  SUN_PROMINENCES,
} from "../art-motion";
import {
  atmosphereBreathe,
  comaBreathe,
  dragDashOffset,
  haloBreathe,
  keyedValue,
  knotOpacity,
  knotPoint,
  starquake,
  stripScroll,
  stripWindow,
} from "../art-motion";
import { zoomBucket } from "../ship-art";
import { keepBase, keepHalo, keepLight, stripsFor, surfaceKind, type StripSpec, type SurfaceKind } from "../surface-art";
import { rasterMarkup } from "../svg-bake";
import { shader, srgbVec } from "./materials";
import { beamAxis, bodyPose, bodyPresent, type Body, type Nebula } from "../../sim/physics";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Claude's SVG assets. A sun is several layers so the haze, rings, prominences
 * and flare can follow star.svg. A comet's dust and ion tails are separate
 * sprites. A pulsar's beams are scaled onto the level's damage reach.
 * Home, Planet X, gas giants, moons and the dwarf scroll their strips under a
 * light layer that turns toward the brightest star. The sun's granulation
 * turns under a fixed limb, and the flare keeps the 22 s timeline.
 */
export const createGallery: VisualFactory = (theme, level) => new GalleryVisual(theme, level);

const SURFACE_ROOT: Record<SurfaceKind, { id: string; fill: string }> = {
  ocean: { id: "planetStart", fill: "#1E5BD6" },
  planetx: { id: "planetX", fill: "#17B39C" },
  giant: { id: "gasBanded", fill: "#EBA75E" },
  moon: { id: "moon", fill: "#A6A2B6" },
  "moon-icy": { id: "moonIcy", fill: "#DCE4FF" },
  "moon-volcanic": { id: "moonVolcanic", fill: "#E0C25A" },
  dwarf: { id: "dwarf", fill: "#CDA273" },
};

type Role =
  | "body"
  | "haze"
  | "wisp"
  | "flame"
  | "front"
  | "grain"
  | "limb"
  | "prom"
  | "flare"
  | "tail"
  | "dust"
  | "beams"
  | "strip"
  | "halo"
  | "atmo"
  | "edge"
  | "coma"
  | "flow"
  | "knot"
  | "spark"
  | "quake"
  | "flash";

interface Sprite {
  mesh: THREE.Mesh;
  fit: ArtFit;
  body: Body | null;
  cloud: Nebula | null;
  role: Role;
  prom?: (typeof SUN_PROMINENCES)[number];
  strip?: StripSpec;
  /** Comet-local sample, SVG y down, for a sparkle. */
  spark?: { points: { x: number; y: number }[]; dur: number; begin: number };
}

interface LiveLayer {
  mesh: THREE.Mesh;
  svg: string;
  width: number;
  height: number;
  edit: (doc: Document, seconds: number) => void;
  last: number;
}

class GalleryVisual implements Visual {
  readonly space = "world" as const;
  readonly object = new THREE.Group();
  private readonly sprites: Sprite[] = [];
  private readonly dysonRestore: THREE.Mesh[] = [];
  private readonly theme: Theme;
  private bakeKey = "";
  private bakeGen = 0;
  private readonly live: LiveLayer[] = [];
  private readonly edgeOffset = { value: 0 };

  constructor(theme: Theme, level: Parameters<VisualFactory>[1]) {
    this.theme = theme;
    this.object.name = "design-art";
    for (const body of level.bodies) {
      if (body.supernova || body.quasar) continue;
      if (isSun(body)) {
        this.addSun(body);
        continue;
      }
      if (body.look === "comet") {
        this.addComet(body);
        continue;
      }
      if (body.look === "pulsar") {
        this.addPulsar(body);
        continue;
      }
      if (body.look === "magnetar") {
        this.addMagnetar(body);
        continue;
      }
      if (body.look === "red-giant") {
        this.addRedGiant(body);
        continue;
      }
      const kind = surfaceKind(body);
      if (kind) {
        this.addSurface(body, kind);
        continue;
      }
      const fit = artForBody(body, theme);
      if (!fit) continue;
      this.add(fit, body.id, body, null, "body", 0);
    }
    for (const cloud of level.nebulae ?? []) {
      const fit = artForNebula(cloud, theme);
      this.add(fit, cloud.id, null, cloud, "body", -1);
    }
  }

  private addSun(body: Body): void {
    const base = artForBody(body, this.theme);
    if (!base) return;
    const haze: ArtFit = { ...base, bake: { tag: "sun-haze", prep: sunHaze } };
    const wisp: ArtFit = { ...base, bake: { tag: "sun-wisp", prep: sunRing("starWispRing") } };
    const flame: ArtFit = { ...base, bake: { tag: "sun-flame", prep: sunRing("starFlameRing") } };
    this.add(haze, `${body.id}-haze`, body, null, "haze", 0, true);
    this.add(wisp, `${body.id}-wisp`, body, null, "wisp", 1);
    this.add(flame, `${body.id}-flame`, body, null, "flame", 2);
    for (const prom of SUN_PROMINENCES) {
      const layer: ArtFit = {
        ...base,
        bake: { tag: prom.id, prep: sunProm(prom.id) },
      };
      this.add(layer, `${body.id}-${prom.id}`, body, null, "prom", 3, false, prom);
    }
    const flare: ArtFit = {
      ...base,
      bake: { tag: "sun-flare", prep: sunFlare },
    };
    const grain: ArtFit = { ...base, bake: { tag: "sun-grain", prep: sunGrain } };
    const limb: ArtFit = { ...base, bake: { tag: "sun-limb", prep: sunLimb } };
    this.add(flare, `${body.id}-flare`, body, null, "flare", 4);
    this.add(grain, `${body.id}-grain`, body, null, "grain", 5);
    this.add(limb, `${body.id}-limb`, body, null, "limb", 6);
  }

  private addComet(body: Body): void {
    const base = artForBody(body, this.theme);
    if (!base) return;
    const head: ArtFit = { ...base, spin: "tail", bake: { tag: "comet-head", prep: cometHead } };
    const dust: ArtFit = { ...base, spin: "tail", hide: [], bake: { tag: "comet-dust", prep: cometDust } };
    const tail: ArtFit = { ...base, spin: "tail", hide: [], bake: { tag: "comet-ion", prep: cometIon } };
    const coma: ArtFit = { ...base, spin: "tail", bake: { tag: "comet-coma", prep: cometComa } };
    const flow: ArtFit = { ...base, spin: "tail", hide: [], bake: { tag: "comet-flow", prep: cometFlow } };
    this.add(dust, `${body.id}-dust`, body, null, "dust", 0);
    this.add(tail, `${body.id}-tail`, body, null, "tail", 1);
    this.add(flow, `${body.id}-flow`, body, null, "flow", 1);
    const flowSprite = this.sprites[this.sprites.length - 1];
    if (flowSprite) this.trackLive(flowSprite.mesh, flow, cometFlowLive);
    this.addKnot(body, base);
    this.add(coma, `${body.id}-coma`, body, null, "coma", 2);
    this.add(head, body.id, body, null, "body", 3);
    void this.addSparkles(body, base);
  }

  private addPulsar(body: Body): void {
    const base = artForBody(body, this.theme);
    if (!base) return;
    const beams: ArtFit = { ...base, spin: "beam", bake: { tag: "pulsar-beams", prep: pulsarBeams } };
    const star: ArtFit = { ...base, spin: "none", bake: { tag: "pulsar-body", prep: pulsarBody } };
    this.add(beams, `${body.id}-beams`, body, null, "beams", 0);
    this.add(star, body.id, body, null, "body", 1);
  }

  private addSurface(body: Body, kind: SurfaceKind): void {
    const base = artForBody(body, this.theme);
    if (!base) return;
    const root = SURFACE_ROOT[kind];
    const rootId = root.id;
    const fill = root.fill;
    const disc: ArtFit = { ...base, spin: "none", bake: { tag: `${kind}-base`, prep: (doc) => keepBase(doc, rootId, fill) } };
    const light: ArtFit = { ...base, bake: { tag: `${kind}-light`, prep: (doc) => keepLight(doc, rootId) } };
    if (kind === "planetx") {
      const halo: ArtFit = { ...base, spin: "none", bake: { tag: "px-halo", prep: keepHalo } };
      this.add(halo, `${body.id}-halo`, body, null, "halo", 0);
    }
    this.add(disc, `${body.id}-base`, body, null, "body", 1);
    for (const spec of stripsFor(kind)) {
      const fit: ArtFit = {
        ...base,
        viewW: spec.viewW,
        viewH: spec.viewH,
        spin: "none",
        bake: { tag: spec.id, prep: spec.prep },
      };
      this.addStrip(fit, `${body.id}-${spec.id}`, body, spec);
    }
    this.add(light, `${body.id}-light`, body, null, "body", 5);
  }

  private addStrip(fit: ArtFit, name: string, body: Body, spec: StripSpec): void {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stripMaterial(spec.opacity));
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = spec.order;
    mesh.userData.opacity = spec.opacity;
    this.object.add(mesh);
    this.sprites.push({ mesh, fit, body, cloud: null, role: "strip", strip: spec });
    void this.paint(mesh, fit, false, 1, 1, this.bakeGen);
  }

  private addRedGiant(body: Body): void {
    const base = artForBody(body, this.theme);
    if (!base) return;
    const star: ArtFit = { ...base, bake: { tag: "rg-star", prep: redGiantStar } };
    const atmo: ArtFit = { ...base, bake: { tag: "rg-atmo", prep: redGiantAtmo } };
    const grain: ArtFit = { ...base, bake: { tag: "rg-grain", prep: redGiantGrain } };
    const flare: ArtFit = { ...base, bake: { tag: "rg-flare", prep: redGiantFlare } };
    this.add(atmo, `${body.id}-atmo`, body, null, "atmo", 0);
    this.add(grain, `${body.id}-grain`, body, null, "grain", 1);
    this.add(star, `${body.id}-star`, body, null, "body", 2);
    this.add(flare, `${body.id}-flare`, body, null, "flare", 3);
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(edgeFrag, {
        uColor: { value: srgbVec("#FFB07A") },
        uAlpha: { value: 0.3 },
        uOffset: this.edgeOffset,
      }),
    );
    edge.name = `${body.id}-edge`;
    edge.frustumCulled = false;
    edge.renderOrder = 4;
    this.object.add(edge);
    this.sprites.push({ mesh: edge, fit: base, body, cloud: null, role: "edge" });
  }

  private addMagnetar(body: Body): void {
    const base = artForBody(body, this.theme);
    if (!base) return;
    const star: ArtFit = { ...base, spin: "none", bake: { tag: "mg-body", prep: magnetarBody } };
    this.add(star, body.id, body, null, "body", 2);
    for (const flicker of MAG_FLICKER) {
      const layer: ArtFit = {
        ...base,
        spin: "none",
        bake: { tag: `mg-${flicker.dur}`, prep: magnetarFlicker(flicker.dur) },
      };
      const mesh = artMesh(layer, `${body.id}-${flicker.dur}`);
      mesh.renderOrder = 1;
      mesh.userData.flicker = flicker;
      this.object.add(mesh);
      this.sprites.push({ mesh, fit: layer, body, cloud: null, role: "body" });
      void this.paint(mesh, layer, false, 1, 1, this.bakeGen);
    }
    for (const seed of ["A", "B"] as const) {
      const layer: ArtFit = { ...base, spin: "none", bake: { tag: `mg-noise-${seed}`, prep: magnetarNoise(seed) } };
      this.add(layer, `${body.id}-noise-${seed}`, body, null, seed === "A" ? "body" : "body", 0);
      const mesh = this.sprites[this.sprites.length - 1]?.mesh;
      if (mesh) mesh.userData.noise = seed;
    }
    const quake = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      shader(quakeFrag, {
        uColor: { value: srgbVec("#FFFFFF") },
        uAlpha: { value: 0 },
      }),
    );
    quake.name = `${body.id}-quake`;
    quake.frustumCulled = false;
    quake.renderOrder = 3;
    this.object.add(quake);
    this.sprites.push({ mesh: quake, fit: base, body, cloud: null, role: "quake" });
    const flash = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({
        color: "#FFFFFF",
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    flash.name = `${body.id}-flash`;
    flash.frustumCulled = false;
    flash.renderOrder = 4;
    this.object.add(flash);
    this.sprites.push({ mesh: flash, fit: base, body, cloud: null, role: "flash" });
    this.watchLive(body, base, artMesh(base, `${body.id}-dashes`), magnetarDashes, 1);
  }

  private addKnot(body: Body, base: ArtFit): void {
    const fit: ArtFit = { ...base, viewW: 32, viewH: 20, ox: 0, oy: 0, spin: "tail", bake: { tag: "comet-knot", prep: cometKnot } };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(32, 20), artMaterial());
    mesh.name = `${body.id}-knot`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.object.add(mesh);
    this.sprites.push({ mesh, fit, body, cloud: null, role: "knot" });
    void this.paint(mesh, fit, false, 1, 1, this.bakeGen);
  }

  private async addSparkles(body: Body, base: ArtFit): Promise<void> {
    const text = await fetch(base.url).then((res) => res.text());
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const holder = document.createElement("div");
    holder.style.position = "absolute";
    holder.style.left = "-9999px";
    holder.append(doc.documentElement);
    document.body.append(holder);
    for (const spark of SPARKLES) {
      const path = doc.getElementById(spark.path);
      const points: { x: number; y: number }[] = [];
      if (path && "getTotalLength" in path) {
        const curve = path as unknown as SVGGeometryElement;
        const length = curve.getTotalLength();
        for (let i = 0; i <= 24; i += 1) {
          const point = curve.getPointAtLength((length * i) / 24);
          points.push({ x: point.x, y: point.y });
        }
      }
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(spark.radius, 10),
        new THREE.MeshBasicMaterial({
          color: "#FFF4D6",
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      mesh.name = `${body.id}-${spark.path}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.object.add(mesh);
      this.sprites.push({
        mesh,
        fit: base,
        body,
        cloud: null,
        role: "spark",
        spark: { points, dur: spark.dur, begin: spark.begin },
      });
    }
    holder.remove();
  }

  private watchLive(
    body: Body,
    fit: ArtFit,
    mesh: THREE.Mesh,
    edit: (doc: Document, seconds: number) => void,
    order: number,
  ): void {
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    this.object.add(mesh);
    this.sprites.push({ mesh, fit, body, cloud: null, role: "body" });
    void fetch(fit.url)
      .then((res) => res.text())
      .then((svg) => {
        const size = rasterPixels(fit.viewW, fit.viewH);
        this.live.push({ mesh, svg, width: size.width, height: size.height, edit, last: -1 });
      });
  }

  private trackLive(mesh: THREE.Mesh, fit: ArtFit, edit: (doc: Document, seconds: number) => void): void {
    void fetch(fit.url)
      .then((res) => res.text())
      .then((svg) => {
        const size = rasterPixels(fit.viewW, fit.viewH);
        this.live.push({ mesh, svg, width: size.width, height: size.height, edit, last: -1 });
      });
  }

  private add(
    fit: ArtFit,
    name: string,
    body: Body | null,
    cloud: Nebula | null,
    role: Role,
    order: number,
    sun = false,
    prom?: (typeof SUN_PROMINENCES)[number],
  ): void {
    const mesh = artMesh(fit, name);
    mesh.renderOrder = order;
    mesh.userData.fade = role === "flare" || role === "prom";
    this.object.add(mesh);
    this.sprites.push({ mesh, fit, body, cloud, role, prom });
    void this.paint(mesh, fit, sun, 1, 1, this.bakeGen);
  }

  private async paint(mesh: THREE.Mesh, fit: ArtFit, sun: boolean, dpr: number, zoom: number, gen: number): Promise<void> {
    const texture = await loadArtTexture(fit, rasterPixels(fit.viewW, fit.viewH, dpr, zoom));
    if (gen !== this.bakeGen) {
      texture.dispose();
      return;
    }
    const material = mesh.material as THREE.MeshBasicMaterial;
    const previous = material.map;
    material.map = texture;
    if (!previous && !mesh.userData.fade) material.opacity = Number(mesh.userData.opacity ?? 1);
    material.needsUpdate = true;
    previous?.dispose();
    if (sun) document.documentElement.dataset.starArt = "1";
  }

  private ensureBake(frame: VisualFrame): void {
    const bucket = zoomBucket(frame.game.camera.zoom);
    const dpr = Math.min(Math.max(frame.dpr, 1), 2);
    const key = `${bucket}|${dpr}`;
    if (key === this.bakeKey) return;
    this.bakeKey = key;
    const gen = ++this.bakeGen;
    for (const sprite of this.sprites) {
      void this.paint(sprite.mesh, sprite.fit, sprite.role === "haze", dpr, bucket, gen);
    }
  }

  update(frame: VisualFrame): void {
    this.ensureBake(frame);
    for (let i = 0; i < this.dysonRestore.length; i++) {
      const mesh = this.dysonRestore[i];
      const material = mesh.material as THREE.MeshBasicMaterial;
      if (typeof mesh.userData.dysonBase === "number") material.opacity = mesh.userData.dysonBase;
    }
    this.dysonRestore.length = 0;
    const game = frame.game;
    const secondsNow = frame.now / 1000;
    this.edgeOffset.value = dragDashOffset(secondsNow);
    void this.refreshLive(secondsNow);
    const time = (game.mode === "planning" ? 0 : game.ship.step) * game.level.dt;
    const bodies = game.level.bodies;
    const seconds = frame.now / 1000;
    for (const sprite of this.sprites) {
      if (sprite.cloud) {
        const cloud = sprite.cloud;
        poseArt(sprite.mesh, sprite.fit, cloud.x, cloud.y, cloud.rx, cloud.angle, cloud.ry);
        continue;
      }
      const body = sprite.body;
      if (!body) continue;
      if (!bodyPresent(body, time)) {
        sprite.mesh.visible = false;
        continue;
      }
      sprite.mesh.visible = sprite.role === "flare" ? sprite.mesh.visible : true;
      const pose = bodyPose(body, time, bodies, game.level.g);
      const rot = rotation(sprite, pose.x, pose.y, time, bodies, frame.now, game.level.g);
      if (sprite.role === "haze" || sprite.role === "wisp" || sprite.role === "flame") {
        const breathe = sunBreathe(seconds);
        const angle = sprite.role === "wisp" ? sunWispAngle(seconds) : sprite.role === "flame" ? sunFlameAngle(seconds) : 0;
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius * breathe, angle);
        continue;
      }
      if (sprite.role === "prom" && sprite.prom) {
        poseProminence(sprite, pose.x, pose.y, body.radius, seconds);
        continue;
      }
      if (sprite.role === "flare") {
        const material = sprite.mesh.material as THREE.MeshBasicMaterial;
        const alpha = flareOpacity(seconds);
        material.opacity = alpha;
        sprite.mesh.visible = alpha > 0.01;
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius, rot);
        continue;
      }
      if (sprite.role === "grain") {
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius, sunGrainAngle(seconds));
        continue;
      }
      if (sprite.role === "limb") {
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius, 0);
        continue;
      }
      if (sprite.role === "strip" && sprite.strip) {
        poseStrip(sprite.mesh, sprite.strip, pose.x, pose.y, body.radius, seconds);
        continue;
      }
      if (sprite.role === "halo") {
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius * haloBreathe(seconds), 0);
        continue;
      }
      if (sprite.role === "atmo") {
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius * atmosphereBreathe(seconds), 0);
        continue;
      }
      if (sprite.role === "edge") {
        const world = body.radius * (192 / sprite.fit.svgRadius) * atmosphereBreathe(seconds);
        sprite.mesh.scale.set(world, world, 1);
        sprite.mesh.position.set(pose.x, pose.y, 0);
        continue;
      }
      if (sprite.role === "coma") {
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius * comaBreathe(seconds), rot);
        continue;
      }
      if (sprite.role === "tail" || sprite.role === "dust" || sprite.role === "flow") {
        const aim = towardStar(pose.x, pose.y, time, bodies, game.level.g);
        const distance = aim ? Math.hypot(aim.x, aim.y) : 1;
        const peri = ellipsePeriapsis(body.orbit?.a, body.orbit?.e, body.orbit?.radius);
        const stretch = cometTailStretch(distance, peri);
        const mirror = sprite.role === "dust" ? dustMirror(pose, time, bodies, game.level.g) : 1;
        poseArt(
          sprite.mesh,
          sprite.fit,
          pose.x,
          pose.y,
          body.radius,
          rot,
          undefined,
          stretch.along,
          stretch.across * mirror,
        );
        continue;
      }
      if (sprite.role === "knot" || sprite.role === "spark") {
        poseCometMark(sprite, pose.x, pose.y, body.radius, rot, seconds, time, bodies, game.level.g);
        continue;
      }
      if (sprite.role === "quake") {
        const pulse = starquake(seconds);
        const world = (pulse.radius * body.radius) / sprite.fit.svgRadius;
        sprite.mesh.scale.set(world, world, 1);
        sprite.mesh.position.set(pose.x, pose.y, 0);
        const material = sprite.mesh.material as THREE.ShaderMaterial;
        const color = material.uniforms.uColor?.value as THREE.Vector3;
        const mix = Math.min(1, Math.max(0, (pulse.radius - 9) / 141));
        color.set(1, 1, 1).lerp(srgbVec("#FF7AE6"), mix);
        material.uniforms.uAlpha!.value = pulse.stroke;
        continue;
      }
      if (sprite.role === "flash") {
        const pulse = starquake(seconds);
        sprite.mesh.scale.set(body.radius, body.radius, 1);
        sprite.mesh.position.set(pose.x, pose.y, 0);
        (sprite.mesh.material as THREE.MeshBasicMaterial).opacity = pulse.flash;
        continue;
      }
      if (sprite.role === "beams") {
        const reach = body.beam?.reach ?? 0;
        const scale = pulsarBeamScale(body.radius, sprite.fit.svgRadius, reach);
        const base = body.radius / sprite.fit.svgRadius;
        const along = base > 0 ? scale.sy / base : 1;
        poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius, rot, undefined, along, 1);
        continue;
      }
      poseArt(sprite.mesh, sprite.fit, pose.x, pose.y, body.radius, rot);
      poseField(sprite.mesh, seconds);
    }
    for (let i = 0; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      const coverage = sprite.body?.dyson?.coverage ?? 0;
      if (!(coverage > 0) || !sprite.mesh.visible) continue;
      const material = sprite.mesh.material as THREE.Material;
      if ((material as THREE.ShaderMaterial).isShaderMaterial) continue;
      const basic = material as THREE.MeshBasicMaterial;
      sprite.mesh.userData.dysonBase = basic.opacity;
      basic.opacity = basic.opacity * (1 - coverage);
      this.dysonRestore.push(sprite.mesh);
    }
  }

  private async refreshLive(seconds: number): Promise<void> {
    for (const layer of this.live) {
      if (layer.last >= 0 && seconds - layer.last < 0.12) continue;
      layer.last = seconds;
      const doc = new DOMParser().parseFromString(layer.svg, "image/svg+xml");
      layer.edit(doc, seconds);
      const markup = new XMLSerializer().serializeToString(doc.documentElement);
      const canvas = await rasterMarkup(markup, layer.width, layer.height);
      const material = layer.mesh.material as THREE.MeshBasicMaterial;
      const previous = material.map;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      material.map = texture;
      material.opacity = 1;
      material.needsUpdate = true;
      previous?.dispose();
    }
  }

  dispose(): void {
    disposeObject(this.object);
  }
}

function isSun(body: Body): boolean {
  return body.kind === "star" && (body.look === undefined || body.look === "sun");
}

function poseProminence(sprite: Sprite, x: number, y: number, radius: number, seconds: number): void {
  const prom = sprite.prom;
  if (!prom) return;
  const window = prominenceWindow(seconds, prom.begin, prom.dur);
  const material = sprite.mesh.material as THREE.MeshBasicMaterial;
  material.opacity = window.opacity;
  sprite.mesh.visible = window.opacity > 0.02;
  const fit = sprite.fit;
  const world = radius / fit.svgRadius;
  const rad = (prom.angle * Math.PI) / 180;
  const footX = 46 * Math.cos(rad);
  const footY = -46 * Math.sin(rad);
  const s = window.scale;
  sprite.mesh.scale.set(world * s, world * s, 1);
  sprite.mesh.rotation.z = 0;
  sprite.mesh.position.set(x + footX * world * (1 - s), y + footY * world * (1 - s), 0);
}

function rotation(sprite: Sprite, x: number, y: number, time: number, bodies: readonly Body[], now: number, g: number): number {
  const fit = sprite.fit;
  if (fit.spin === "light" && fit.light) {
    const aim = towardStar(x, y, time, bodies, g);
    if (!aim) return 0;
    const light = fit.light;
    return Math.atan2(aim.y, aim.x) - Math.atan2(light.y, light.x);
  }
  if (fit.spin === "tail") {
    const aim = towardStar(x, y, time, bodies, g);
    if (!aim) return 0;
    return Math.atan2(-aim.y, -aim.x);
  }
  if (fit.spin === "beam" && sprite.body) {
    const axis = beamAxis(sprite.body, time);
    if (!axis) return 0;
    return Math.atan2(axis.y, axis.x) - Math.PI / 2;
  }
  if (fit.spin === "neutron") return -((now / 1000) * Math.PI * 2) / 6;
  return 0;
}

function towardStar(x: number, y: number, time: number, bodies: readonly Body[], g: number): { x: number; y: number } | null {
  const samples = [];
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.kind !== "star" && body.kind !== "blackhole") continue;
    const pose = bodyPose(body, time, bodies, g);
    samples.push({ x: pose.x, y: pose.y, mass: body.mass });
  }
  return brightestOffset(samples, x, y);
}

function sunHaze(doc: Document): void {
  for (const id of ["starWispRing", "starFlameRing", "starProminences", "starFlare", "starDisc"]) {
    doc.getElementById(id)?.remove();
  }
  removeDirectCircles(doc.getElementById("star"));
  stripMotion(doc.getElementById("starBreathe"));
}

function sunRing(id: string): (doc: Document) => void {
  return (doc) => {
    for (const drop of ["starProminences", "starFlare", "starDisc"]) doc.getElementById(drop)?.remove();
    removeDirectCircles(doc.getElementById("star"));
    const breathe = doc.getElementById("starBreathe");
    const keep = doc.getElementById(id);
    if (breathe) {
      for (const child of [...breathe.children]) {
        if (child !== keep) child.remove();
      }
    }
    stripMotion(keep);
  };
}

function sunFront(doc: Document): void {
  for (const id of ["starBreathe", "starProminences", "starFlare"]) doc.getElementById(id)?.remove();
}

function sunGrain(doc: Document): void {
  sunFront(doc);
  const disc = doc.getElementById("starDisc");
  if (!disc) return;
  for (const child of [...disc.children]) {
    if (child.getAttribute("filter") !== "url(#starSurf)") child.remove();
  }
  rimStroke(doc.getElementById("star"))?.remove();
}

function sunLimb(doc: Document): void {
  sunFront(doc);
  const disc = doc.getElementById("starDisc");
  if (!disc) return;
  for (const child of [...disc.children]) {
    if (child.getAttribute("filter") === "url(#starSurf)") child.remove();
  }
}

function rimStroke(root: Element | null): Element | undefined {
  if (!root) return undefined;
  return [...root.children].find((child) => child.localName === "circle" && child.hasAttribute("stroke"));
}

function sunProm(id: string): (doc: Document) => void {
  return (doc) => {
    for (const drop of ["starBreathe", "starFlare", "starDisc"]) doc.getElementById(drop)?.remove();
    removeDirectCircles(doc.getElementById("star"));
    const proms = doc.getElementById("starProminences");
    if (proms) {
      for (const child of [...proms.children]) {
        if (!child.querySelector(`#${id}`)) child.remove();
      }
    }
    const node = doc.getElementById(id);
    if (!node) return;
    node.setAttribute("opacity", "1");
    node.setAttribute("transform", "scale(1)");
    node.querySelectorAll("animate, animateTransform").forEach((item) => item.remove());
  };
}

function removeDirectCircles(star: Element | null): void {
  if (!star) return;
  for (const child of [...star.children]) {
    if (child.localName === "circle") child.remove();
  }
}

function sunFlare(doc: Document): void {
  for (const id of ["starBreathe", "starProminences", "starDisc"]) doc.getElementById(id)?.remove();
  removeDirectCircles(doc.getElementById("star"));
  const flare = doc.getElementById("starFlare");
  if (!flare) return;
  flare.setAttribute("opacity", "1");
  flare.querySelectorAll("animate").forEach((node) => node.remove());
}

function cometHead(doc: Document): void {
  doc.getElementById("cmTails")?.remove();
  doc.getElementById("cmHarvest")?.remove();
  const root = doc.getElementById("comet");
  if (!root) return;
  for (const child of [...root.children]) {
    if (child.localName === "ellipse" && child.getAttribute("rx") === "50") child.remove();
  }
}

function cometComa(doc: Document): void {
  const root = doc.getElementById("comet");
  if (!root) return;
  for (const child of [...root.children]) {
    if (child.localName === "ellipse" && child.getAttribute("rx") === "50") {
      child.querySelectorAll("animate, animateTransform").forEach((node) => node.remove());
      continue;
    }
    child.remove();
  }
}

function cometFlow(doc: Document): void {
  keepCometTail(doc);
  tuneFlow(doc, 0);
}

function cometFlowLive(doc: Document, seconds: number): void {
  keepCometTail(doc);
  tuneFlow(doc, seconds);
}

function tuneFlow(doc: Document, seconds: number): void {
  const tails = doc.getElementById("cmTails");
  if (!tails) return;
  for (const child of [...tails.children]) {
    if (child.id === "cmIonRays") {
      child.querySelectorAll("path").forEach((node) => node.setAttribute("stroke-opacity", "0"));
      continue;
    }
    if (child.id === "cmDustStrands" || child.localName === "path" || child.localName === "ellipse") child.remove();
    if (child.localName === "g" && child.querySelector("animateMotion")) child.remove();
  }
  tails.querySelectorAll("animate").forEach((node) => {
    const dur = Number.parseFloat(node.getAttribute("dur") ?? "2.2");
    const offset = (-200 * (((seconds % dur) + dur) % dur)) / dur;
    node.parentElement?.setAttribute("stroke-dashoffset", String(offset));
    node.remove();
  });
}

function cometIon(doc: Document): void {
  keepCometTail(doc);
  doc.getElementById("cmDustStrands")?.remove();
  const tails = doc.getElementById("cmTails");
  if (!tails) return;
  for (const child of [...tails.children]) {
    if (child.localName === "path" && child.getAttribute("fill")?.includes("cmDustFill")) child.remove();
    if (child.localName === "g" && child.querySelector("animateMotion")) child.remove();
  }
}

function cometDust(doc: Document): void {
  keepCometTail(doc);
  const tails = doc.getElementById("cmTails");
  if (!tails) return;
  for (const child of [...tails.children]) {
    if (child.id === "cmDustStrands") continue;
    if (child.localName === "path" && child.getAttribute("fill")?.includes("cmDustFill")) continue;
    child.remove();
  }
}

function keepCometTail(doc: Document): void {
  const root = doc.getElementById("comet");
  if (!root) return;
  for (const child of [...root.children]) {
    if (child.id !== "cmTails") child.remove();
  }
}

function dustMirror(
  pose: { x: number; y: number; vx: number; vy: number },
  time: number,
  bodies: readonly Body[],
  g: number,
): number {
  let best = 0;
  let star: { x: number; y: number; vx: number; vy: number } | null = null;
  for (const body of bodies) {
    if (body.kind !== "star" && body.kind !== "blackhole") continue;
    const sample = bodyPose(body, time, bodies, g);
    const dx = sample.x - pose.x;
    const dy = sample.y - pose.y;
    const d2 = dx * dx + dy * dy;
    if (!(d2 > 1) || !(body.mass > 0)) continue;
    const weight = body.mass / d2;
    if (weight > best) {
      best = weight;
      star = sample;
    }
  }
  if (!star) return 1;
  return cometDustMirror(pose.x - star.x, pose.y - star.y, pose.vx - star.vx, pose.vy - star.vy);
}

function stripMotion(node: Element | null): void {
  node?.querySelectorAll("animate, animateTransform").forEach((item) => item.remove());
}

function pulsarBody(doc: Document): void {
  doc.getElementById("puSweep")?.remove();
}

function cometKnot(doc: Document): void {
  const ellipse = doc.querySelector("#cmTails ellipse");
  const svg = doc.documentElement;
  if (!ellipse) return;
  ellipse.querySelectorAll("animate, animateMotion").forEach((node) => node.remove());
  ellipse.setAttribute("cx", "0");
  ellipse.setAttribute("cy", "0");
  ellipse.setAttribute("opacity", "1");
  svg.setAttribute("viewBox", "-16 -10 32 20");
  svg.setAttribute("width", "32");
  svg.setAttribute("height", "20");
  doc.getElementById("comet")?.remove();
  svg.append(ellipse);
}

function redGiantStar(doc: Document): void {
  doc.getElementById("rgAtmosphere")?.remove();
  doc.getElementById("rgStarFlare")?.remove();
  doc.querySelector("#rgStarDisc circle[filter]")?.remove();
}

function redGiantGrain(doc: Document): void {
  const circle = doc.querySelector("#rgStarDisc circle[filter]");
  if (!circle) return;
  keepAncestors(circle);
}

function redGiantFlare(doc: Document): void {
  const flare = doc.getElementById("rgStarFlare");
  if (!flare) return;
  flare.removeAttribute("opacity");
  flare.querySelectorAll("animate").forEach((node) => node.remove());
  keepAncestors(flare);
}

function keepAncestors(node: Element): void {
  let current = node;
  const svg = node.ownerDocument.documentElement;
  while (current.parentElement && current.parentElement !== svg) {
    const parent = current.parentElement;
    for (const child of [...parent.children]) {
      if (child !== current) child.remove();
    }
    current = parent;
  }
}

function redGiantAtmo(doc: Document): void {
  const atmo = doc.getElementById("rgAtmosphere");
  if (!atmo) return;
  atmo.querySelectorAll("animate, animateTransform").forEach((node) => node.remove());
  for (const child of [...atmo.children]) {
    if (child.getAttribute("stroke-dasharray")) child.remove();
  }
  doc.getElementById("rgStar")?.remove();
}

function magnetarBody(doc: Document): void {
  doc.getElementById("mgInterference")?.remove();
  const field = doc.getElementById("mgField");
  if (field) {
    for (const child of [...field.children]) {
      if (child.localName === "g") child.remove();
    }
  }
  const root = doc.getElementById("magnetar");
  for (const child of [...(root?.children ?? [])]) {
    if (child.getAttribute("stroke-width") === "1.5" || child.getAttribute("r") === "12") child.remove();
  }
  doc.querySelectorAll("animate, animateTransform").forEach((node) => node.remove());
}

function magnetarFlicker(dur: number): (doc: Document) => void {
  return (doc) => {
    const root = doc.getElementById("magnetar");
    for (const child of [...(root?.children ?? [])]) {
      if (child.id !== "mgField") child.remove();
    }
    const field = doc.getElementById("mgField");
    for (const group of [...(field?.children ?? [])]) {
      if (group.localName === "circle") {
        group.remove();
        continue;
      }
      const anim = group.querySelector("animate");
      if (anim?.getAttribute("dur") !== `${dur}s`) {
        group.remove();
        continue;
      }
      group.querySelectorAll("[stroke-dasharray]").forEach((node) => node.remove());
      group.querySelectorAll("animate").forEach((node) => node.remove());
      group.setAttribute("opacity", "1");
    }
  };
}

function magnetarNoise(seed: "A" | "B"): (doc: Document) => void {
  return (doc) => {
    const root = doc.getElementById("magnetar");
    const noise = doc.getElementById("mgInterference");
    for (const child of [...(root?.children ?? [])]) {
      if (child !== noise) child.remove();
    }
    const groups = [...(noise?.children ?? [])];
    const keep = seed === "A" ? groups[0] : groups[1];
    for (const group of groups) {
      if (group !== keep) group.remove();
    }
    keep?.querySelectorAll("animate").forEach((node) => node.remove());
    noise?.setAttribute("opacity", "1");
  };
}

function magnetarDashes(doc: Document, seconds: number): void {
  const root = doc.getElementById("magnetar");
  for (const child of [...(root?.children ?? [])]) {
    if (child.id !== "mgField") child.remove();
  }
  const field = doc.getElementById("mgField");
  field?.querySelectorAll("circle").forEach((node) => node.remove());
  for (const group of [...(field?.children ?? [])]) {
    const solid = [...group.children].find((node) => node.localName === "path" && !node.getAttribute("stroke-dasharray"));
    solid?.remove();
    const anim = group.querySelector("animate");
    const dashAnim = group.querySelector("animate[attributeName='stroke-dashoffset']");
    const dur = Number.parseFloat(dashAnim?.getAttribute("dur") ?? "1");
    const from = Number.parseFloat(dashAnim?.getAttribute("from") ?? "0");
    const to = Number.parseFloat(dashAnim?.getAttribute("to") ?? "0");
    const u = ((seconds % dur) + dur) % dur / (dur || 1);
    const dash = group.querySelector("[stroke-dasharray]");
    dash?.setAttribute("stroke-dashoffset", String(from + (to - from) * u));
    anim?.remove();
    dashAnim?.remove();
    group.setAttribute("opacity", "1");
  }
}

function pulsarBeams(doc: Document): void {
  const root = doc.getElementById("pulsar");
  if (!root) return;
  for (const child of [...root.children]) {
    if (child.id !== "puSweep") child.remove();
  }
  root.querySelectorAll("animateTransform").forEach((node) => node.remove());
}

const MAG_FLICKER = [
  { dur: 1.7, values: [0.85, 1, 0.7, 1, 0.9, 0.6, 1] },
  { dur: 2.3, values: [1, 0.75, 1, 0.9, 0.65, 1, 0.85] },
  { dur: 3.1, values: [0.9, 1, 0.8, 0.6, 1, 0.95, 0.9] },
  { dur: 2.7, values: [0.85, 1, 0.7, 1, 0.9, 0.6, 1] },
  { dur: 1.9, values: [1, 0.75, 1, 0.9, 0.65, 1, 0.85] },
  { dur: 3.4, values: [0.9, 1, 0.8, 0.6, 1, 0.95, 0.9] },
] as const;

const SPARKLES = [
  { path: "cmS0", radius: 1.1, dur: 9, begin: 0 },
  { path: "cmS3", radius: 0.9, dur: 11, begin: -3 },
  { path: "cmS6", radius: 1.1, dur: 10, begin: -6 },
  { path: "cmS9", radius: 0.9, dur: 12, begin: -2 },
  { path: "cmS13", radius: 1.1, dur: 13, begin: -8 },
  { path: "cmS17", radius: 0.9, dur: 12, begin: -5 },
  { path: "cmS2", radius: 1.1, dur: 10, begin: -7 },
  { path: "cmS11", radius: 0.9, dur: 14, begin: -10 },
] as const;

const edgeFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uOffset;
void main() {
  float r = length(vLocal);
  float w = 1.2 * fwidth(r);
  float ring = 1.0 - smoothstep(0.0, w, abs(r - 1.0));
  float along = atan(vLocal.y, vLocal.x) * 192.0;
  float dash = fract((along - uOffset) / 16.0);
  if (dash > 0.625) discard;
  if (ring <= 0.0) discard;
  gl_FragColor = vec4(uColor, uAlpha * ring);
}
`;

const quakeFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float r = length(vLocal);
  float w = 1.5 * fwidth(r);
  float ring = 1.0 - smoothstep(0.0, w, abs(r - 1.0));
  if (ring <= 0.0 || uAlpha <= 0.0) discard;
  gl_FragColor = vec4(uColor, uAlpha * ring);
}
`;

let sharedDisc: THREE.CanvasTexture | null = null;

function discAlpha(): THREE.CanvasTexture {
  if (sharedDisc) return sharedDisc;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const fade = ctx.createRadialGradient(128, 128, 124, 128, 128, 128);
  fade.addColorStop(0, "#ffffff");
  fade.addColorStop(1, "#000000");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 256, 256);
  sharedDisc = new THREE.CanvasTexture(canvas);
  sharedDisc.colorSpace = THREE.NoColorSpace;
  return sharedDisc;
}

function stripMaterial(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    alphaMap: discAlpha(),
  });
}

function poseStrip(mesh: THREE.Mesh, spec: StripSpec, x: number, y: number, radius: number, seconds: number): void {
  const scroll = stripScroll(seconds, spec.dur, spec.distance);
  const window = stripWindow(spec.svgRadius, spec.tx, spec.ty, spec.originX, spec.originY, spec.viewW, spec.viewH, scroll);
  const material = mesh.material as THREE.MeshBasicMaterial;
  const map = material.map;
  if (map) {
    map.offset.set(window.offsetX, window.offsetY);
    map.repeat.set(window.repeatX, window.repeatY);
  }
  mesh.scale.set(radius, radius, 1);
  mesh.rotation.z = 0;
  mesh.position.set(x, y, 0);
}

function poseCometMark(
  sprite: Sprite,
  x: number,
  y: number,
  radius: number,
  rot: number,
  seconds: number,
  time: number,
  bodies: readonly Body[],
  g: number,
): void {
  const aim = towardStar(x, y, time, bodies, g);
  const distance = aim ? Math.hypot(aim.x, aim.y) : 1;
  const peri = ellipsePeriapsis(sprite.body?.orbit?.a, sprite.body?.orbit?.e, sprite.body?.orbit?.radius);
  const stretch = cometTailStretch(distance, peri);
  const scale = radius / sprite.fit.svgRadius;
  const sx = scale * stretch.along;
  const sy = scale * stretch.across;
  let lx = 0;
  let ly = 0;
  let opacity = 0;
  if (sprite.role === "knot") {
    const point = knotPoint(seconds);
    lx = point.x;
    ly = -point.y;
    opacity = knotOpacity(seconds);
  } else if (sprite.spark && sprite.spark.points.length > 0) {
    const u = (((seconds - sprite.spark.begin) % sprite.spark.dur) + sprite.spark.dur) % sprite.spark.dur / sprite.spark.dur;
    const index = Math.min(sprite.spark.points.length - 1, Math.round(u * (sprite.spark.points.length - 1)));
    const point = sprite.spark.points[index];
    if (point) {
      lx = point.x;
      ly = -point.y;
    }
    opacity = keyedValue(seconds - sprite.spark.begin, sprite.spark.dur, [0, 0.1, 0.6, 1], [0, 0.9, 0.6, 0]);
  }
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  sprite.mesh.scale.set(sx, sy, 1);
  sprite.mesh.rotation.z = rot;
  sprite.mesh.position.set(x + c * lx * sx - s * ly * sy, y + s * lx * sx + c * ly * sy, 0);
  (sprite.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
}

function poseField(mesh: THREE.Mesh, seconds: number): void {
  const material = mesh.material as THREE.MeshBasicMaterial;
  const flicker = mesh.userData.flicker as { dur: number; values: number[] } | undefined;
  if (flicker) {
    const last = flicker.values.length - 1;
    const times = flicker.values.map((_, index) => (last > 0 ? index / last : 0));
    material.opacity = keyedValue(seconds, flicker.dur, times, flicker.values);
  }
  if (mesh.userData.noise === "A" || mesh.userData.noise === "B") {
    const wave = 0.5 + 0.5 * Math.cos((Math.PI * 2 * seconds) / 5);
    material.opacity = 0.26 * (mesh.userData.noise === "A" ? wave : 1 - wave);
  }
}
