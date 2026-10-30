import * as THREE from "three";
import { burnHandleOffset, isEditing, nodeIncoming, nodePosition, planFuel } from "../../game/state";
import type { Vec2 } from "../../sim/physics";
import { sampleBurnAnim, tailFromBurn } from "../burn-anim";
import { projectToScreen } from "../camera";
import { shader, srgbVec } from "./materials";
import { paintNode, type NodePaint } from "../node-style";
import { powerHex } from "../palette";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Burn nodes and their drag arrows. The handle tip stays on the same screen
 * offset the input hit-test uses. The ring, core and states are
 * design/assets/burn-node.svg. They read the plan. They do not move it.
 */
export const createNodes: VisualFactory = (theme) => new NodesVisual(theme);

interface RingUniforms {
  uColor: THREE.IUniform<THREE.Vector3>;
  uRadius: THREE.IUniform<number>;
  uWidth: THREE.IUniform<number>;
  uAlpha: THREE.IUniform<number>;
  uArc: THREE.IUniform<number>;
  uDash: THREE.IUniform<number>;
  uDashOn: THREE.IUniform<number>;
  uDashPeriod: THREE.IUniform<number>;
}

interface NodeVisual {
  root: THREE.Group;
  fill: THREE.Mesh;
  ring: THREE.Mesh;
  outer: THREE.Mesh;
  core: THREE.Mesh;
  arc: THREE.Mesh;
  flash: THREE.Mesh;
  handle: THREE.Mesh;
  shaft: THREE.Mesh;
  head: THREE.Mesh;
  ghost: THREE.Line;
  ringU: RingUniforms;
  outerU: RingUniforms;
  arcU: RingUniforms;
  flashU: RingUniforms;
  /** Last world point this node was drawn at. Pause drops past snapshots. */
  at: Vec2 | null;
}

class NodesVisual implements Visual {
  readonly space = "screen" as const;
  readonly object = new THREE.Group();
  private readonly theme: Theme;
  private readonly nodes: NodeVisual[] = [];
  private readonly scratch: Vec2 = { x: 0, y: 0 };

  constructor(theme: Theme) {
    this.theme = theme;
    this.object.name = "nodes";
    this.object.userData.asset = theme.assets.dragArrow;
  }

  update(frame: VisualFrame): void {
    const { game, width, height } = frame;
    const editing = isEditing(game);
    const spec = this.theme.nodes;
    const anim =
      game.mode === "planning"
        ? null
        : sampleBurnAnim(game.ship.step, game.level.dt, game.nodes, this.theme.burn.windup, tailFromBurn(this.theme.burn));
    const fuel = editing ? planFuel(game) : null;
    for (let i = 0; i < game.nodes.length; i++) {
      const visual = this.ensure(i);
      const node = game.nodes[i];
      const simOffset = game.mode === "planning" ? null : (game.ship.step - node.step) * game.level.dt;
      const pos = nodePosition(game, i);
      if (pos) visual.at = { x: pos.x, y: pos.y };
      const fired = simOffset !== null && simOffset > spec.ignite;
      const at = pos ?? (editing && fired ? visual.at : null);
      if (!at) {
        visual.root.visible = false;
        continue;
      }
      projectToScreen(at.x, at.y, width, height, this.scratch);
      const x = this.scratch.x;
      const y = height - this.scratch.y;
      const offset = burnHandleOffset(node.dvx, node.dvy, game.level.dvPerPixel, nodeIncoming(game, i));
      const cue = anim?.cues.find((item) => item.index === i);
      const paint = paintNode(
        {
          editing,
          selected: game.selected === i,
          placing: editing && offset.placing,
          exceeds: fuel?.costs[i]?.exceeds ?? false,
          offset: simOffset,
          windup: this.theme.burn.windup,
          ignite: spec.ignite,
        },
        cue?.phase === "windup" ? cue.amount : 0,
      );
      visual.root.position.set(x, y, 0);
      visual.root.visible = paint.drawn;
      if (!paint.drawn) continue;
      this.applyPaint(visual, paint);
      if (!paint.arrow && !(editing && offset.placing)) {
        visual.shaft.visible = false;
        visual.head.visible = false;
        visual.handle.visible = false;
        visual.ghost.visible = false;
        continue;
      }
      const tipX = offset.x;
      const tipY = -offset.y;
      const ang = Math.atan2(tipY, tipX);
      const len = Math.hypot(tipX, tipY);
      if (offset.placing) {
        visual.shaft.visible = false;
        visual.head.visible = false;
        visual.handle.visible = true;
        visual.handle.position.set(tipX, tipY, 0);
        visual.handle.scale.set(spec.handleRadius, spec.handleRadius, 1);
        setLine(visual.ghost, 0, 0, tipX, tipY);
        visual.ghost.visible = true;
        continue;
      }
      visual.ghost.visible = false;
      visual.handle.visible = false;
      const headLen = Math.min(spec.headLength, Math.max(8, len * 0.35));
      const shaftEnd = Math.max(0, len - headLen);
      visual.shaft.visible = shaftEnd > 2;
      visual.shaft.position.set(Math.cos(ang) * shaftEnd * 0.5, Math.sin(ang) * shaftEnd * 0.5, 0);
      visual.shaft.scale.set(Math.max(shaftEnd, 0.001), spec.shaftWidth, 1);
      visual.shaft.rotation.z = ang;
      const cost = fuel?.costs[i]?.cost ?? 0;
      const power = Math.min(1, cost / game.level.fuel);
      const hex = paint.color === "#FF5A5F" ? paint.color : powerHex(power);
      visual.head.visible = true;
      visual.head.position.set(tipX - Math.cos(ang) * headLen, tipY - Math.sin(ang) * headLen, 0);
      visual.head.scale.set(headLen / spec.headLength, headLen / spec.headLength, 1);
      visual.head.rotation.z = ang;
      (visual.head.material as THREE.MeshBasicMaterial).color.set(hex);
    }
    for (let i = game.nodes.length; i < this.nodes.length; i++) this.nodes[i].root.visible = false;
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private applyPaint(visual: NodeVisual, paint: NodePaint): void {
    const spec = this.theme.nodes;
    visual.fill.visible = paint.fill;
    visual.ring.visible = true;
    visual.fill.scale.set(paint.radius, paint.radius, 1);
    visual.core.visible = paint.core;
    visual.core.scale.set(spec.coreRadius, spec.coreRadius, 1);
    (visual.core.material as THREE.MeshBasicMaterial).color.set(paint.coreColor);
    setRing(visual.ringU, paint.color, paint.radius, paint.width, paint.alpha, 0, paint.dashed ? spec.firedDash : 0, paint.dashed ? spec.firedDash + spec.firedGap : 0);
    visual.outer.visible = paint.outer;
    if (paint.outer) {
      setRing(visual.outerU, "#B8A8FF", spec.selectedOuter, spec.selectedOuterWidth, spec.selectedOuterAlpha, 0, 0, 0);
    }
    visual.arc.visible = paint.arc > 0.001;
    if (visual.arc.visible) {
      setRing(visual.arcU, "#F7FBFF", spec.windupRadius, spec.windupWidth, 1, paint.arc * Math.PI * 2, 0, 0);
    }
    visual.flash.visible = paint.flash >= 0;
    if (visual.flash.visible) {
      const radius = spec.igniteRadius0 + (spec.igniteRadius1 - spec.igniteRadius0) * paint.flash;
      setRing(visual.flashU, "#F7FBFF", radius, spec.igniteWidth, 1 - paint.flash, 0, 0, 0);
    }
  }

  private ensure(index: number): NodeVisual {
    const colors = this.theme.colors;
    const spec = this.theme.nodes;
    while (this.nodes.length <= index) {
      const root = new THREE.Group();
      root.name = "burn-node";
      const fill = disc(colors.nodeFill);
      const ringU = ringUniforms("#B8A8FF");
      const ring = ringMesh(ringU, 12);
      const outerU = ringUniforms("#B8A8FF");
      const outer = ringMesh(outerU, 13);
      const core = disc(colors.nodeCore);
      const arcU = ringUniforms("#F7FBFF");
      const arc = ringMesh(arcU, 11);
      const flashU = ringUniforms("#F7FBFF");
      const flash = ringMesh(flashU, 10);
      const handle = disc(colors.nodeHandle);
      const shaft = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: colors.arrow,
          transparent: true,
          opacity: spec.shaftAlpha,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      shaft.frustumCulled = false;
      const head = new THREE.Mesh(
        headGeometry(spec.headLength, spec.headHalfWidth),
        new THREE.MeshBasicMaterial({
          color: colors.text,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      head.frustumCulled = false;
      const ghostGeo = new THREE.BufferGeometry();
      ghostGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const ghost = new THREE.Line(
        ghostGeo,
        new THREE.LineDashedMaterial({
          color: colors.arrow,
          transparent: true,
          opacity: spec.ghostAlpha,
          dashSize: spec.ghostDash,
          gapSize: spec.ghostGap,
          depthTest: false,
          toneMapped: false,
        }),
      );
      ghost.frustumCulled = false;
      ghost.computeLineDistances();
      fill.renderOrder = 14;
      ring.renderOrder = 15;
      outer.renderOrder = 13;
      core.renderOrder = 16;
      shaft.renderOrder = 17;
      head.renderOrder = 18;
      handle.renderOrder = 19;
      root.add(flash, arc, outer, fill, ring, core, ghost, shaft, head, handle);
      this.object.add(root);
      this.nodes.push({ root, fill, ring, outer, core, arc, flash, handle, shaft, head, ghost, ringU, outerU, arcU, flashU, at: null });
    }
    return this.nodes[index];
  }
}

function setRing(
  uniforms: RingUniforms,
  color: string,
  radius: number,
  width: number,
  alpha: number,
  arc: number,
  dashOn: number,
  dashPeriod: number,
): void {
  uniforms.uColor.value.copy(srgbVec(color));
  uniforms.uRadius.value = radius;
  uniforms.uWidth.value = width;
  uniforms.uAlpha.value = alpha;
  uniforms.uArc.value = arc;
  uniforms.uDash.value = 0;
  uniforms.uDashOn.value = dashOn;
  uniforms.uDashPeriod.value = dashPeriod;
}

function ringUniforms(color: string): RingUniforms {
  return {
    uColor: { value: srgbVec(color) },
    uRadius: { value: 5 },
    uWidth: { value: 2 },
    uAlpha: { value: 1 },
    uArc: { value: 0 },
    uDash: { value: 0 },
    uDashOn: { value: 0 },
    uDashPeriod: { value: 0 },
  };
}

function ringMesh(uniforms: RingUniforms, order: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(48, 48), shader(ringFrag, uniforms as unknown as Record<string, THREE.IUniform>));
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.visible = false;
  return mesh;
}

const ringFrag = /* glsl */ `
varying vec2 vLocal;
uniform vec3 uColor;
uniform float uRadius;
uniform float uWidth;
uniform float uAlpha;
uniform float uArc;
uniform float uDash;
uniform float uDashOn;
uniform float uDashPeriod;
void main() {
  float r = length(vLocal);
  float dist = abs(r - uRadius);
  float aa = fwidth(dist);
  float band = 1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + aa, dist);
  if (band <= 0.0) discard;
  if (uArc > 0.0) {
    float ang = atan(vLocal.x, vLocal.y);
    if (ang < 0.0) ang += 6.2831853;
    if (ang > uArc) discard;
  }
  if (uDashPeriod > 0.0) {
    float along = atan(vLocal.y, vLocal.x) * uRadius;
    float u = fract((along - uDash) / uDashPeriod);
    if (u > uDashOn / uDashPeriod) discard;
  }
  gl_FragColor = vec4(uColor, band * uAlpha);
}
`;

function disc(color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  mesh.frustumCulled = false;
  return mesh;
}

function headGeometry(length: number, halfWidth: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([length, 0, 0, 0, halfWidth, 0, 0, -halfWidth, 0], 3));
  return geometry;
}

function setLine(line: THREE.Line, x0: number, y0: number, x1: number, y1: number): void {
  const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  attr.setXYZ(0, x0, y0, 0);
  attr.setXYZ(1, x1, y1, 0);
  attr.needsUpdate = true;
  line.computeLineDistances();
}
