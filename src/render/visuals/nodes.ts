import * as THREE from "three";
import { burnHandleOffset, isEditing, nodeIncoming, nodePosition, planFuel } from "../../game/state";
import type { Vec2 } from "../../sim/physics";
import { projectToScreen } from "../camera";
import { powerHex } from "../palette";
import type { Theme } from "../theme";
import { disposeObject, type Visual, type VisualFactory, type VisualFrame } from "../visual";

/**
 * Burn nodes and their drag arrows. The handle tip stays on the same screen
 * offset the input hit-test uses. Swap the factory to restyle the arrow;
 * do not change that offset or the sim.
 */
export const createNodes: VisualFactory = (theme) => new NodesVisual(theme);

interface NodeVisual {
  marker: THREE.Mesh;
  stroke: THREE.Mesh;
  handle: THREE.Mesh;
  shaft: THREE.Mesh;
  head: THREE.Mesh;
  ghost: THREE.Line;
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
    const planning = isEditing(game);
    if (!planning) {
      for (const node of this.nodes) hide(node);
      return;
    }
    const fuel = planFuel(game);
    const spec = this.theme.nodes;
    const colors = this.theme.colors;
    for (let i = 0; i < game.nodes.length; i++) {
      const visual = this.ensure(i);
      const pos = nodePosition(game, i);
      if (!pos) {
        hide(visual);
        continue;
      }
      projectToScreen(pos.x, pos.y, width, height, this.scratch);
      const x = this.scratch.x;
      const y = height - this.scratch.y;
      const node = game.nodes[i];
      const offset = burnHandleOffset(node.dvx, node.dvy, game.level.dvPerPixel, nodeIncoming(game, i));
      const tipX = x + offset.x;
      const tipY = y - offset.y;
      const exceeds = fuel.costs[i]?.exceeds ?? false;
      const selected = game.selected === i;
      const radius = selected ? spec.selectedRadius : spec.markerRadius;
      visual.marker.visible = true;
      visual.marker.position.set(x, y, 0);
      visual.marker.scale.set(radius, radius, 1);
      (visual.marker.material as THREE.MeshBasicMaterial).color.set(exceeds ? colors.resultCrash : colors.node);
      visual.stroke.visible = true;
      visual.stroke.position.set(x, y, 0);
      visual.stroke.scale.set(radius + spec.strokePad, radius + spec.strokePad, 1);
      (visual.stroke.material as THREE.MeshBasicMaterial).color.set(selected ? colors.text : colors.shipOutline);

      const ang = Math.atan2(tipY - y, tipX - x);
      const len = Math.hypot(tipX - x, tipY - y);
      if (offset.placing) {
        visual.shaft.visible = false;
        visual.head.visible = false;
        visual.handle.visible = true;
        visual.handle.position.set(tipX, tipY, 0);
        visual.handle.scale.set(4, 4, 1);
        (visual.handle.material as THREE.MeshBasicMaterial).color.set(colors.text);
        setLine(visual.ghost, x, y, tipX, tipY);
        visual.ghost.visible = true;
      } else {
        visual.ghost.visible = false;
        const headLen = Math.min(spec.headLength, Math.max(8, len * 0.35));
        const shaftEnd = Math.max(0, len - headLen);
        visual.shaft.visible = shaftEnd > 2;
        visual.shaft.position.set(x + Math.cos(ang) * shaftEnd * 0.5, y + Math.sin(ang) * shaftEnd * 0.5, 0);
        visual.shaft.scale.set(Math.max(shaftEnd, 0.001), spec.shaftWidth, 1);
        visual.shaft.rotation.z = ang;
        (visual.shaft.material as THREE.MeshBasicMaterial).opacity = spec.shaftAlpha;
        const cost = fuel.costs[i]?.cost ?? 0;
        const power = Math.min(1, cost / game.level.fuel);
        const hex = exceeds ? colors.resultCrash : powerHex(power);
        visual.head.visible = true;
        visual.head.position.set(tipX - Math.cos(ang) * headLen, tipY - Math.sin(ang) * headLen, 0);
        visual.head.scale.set(headLen / spec.headLength, headLen / spec.headLength, 1);
        visual.head.rotation.z = ang;
        (visual.head.material as THREE.MeshBasicMaterial).color.set(hex);
        visual.handle.visible = false;
      }
    }
    for (let i = game.nodes.length; i < this.nodes.length; i++) hide(this.nodes[i]);
  }

  dispose(): void {
    disposeObject(this.object);
  }

  private ensure(index: number): NodeVisual {
    const colors = this.theme.colors;
    const spec = this.theme.nodes;
    while (this.nodes.length <= index) {
      const marker = disc(colors.node);
      const stroke = disc(colors.shipOutline);
      const handle = disc(colors.text);
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
          opacity: 0.45,
          dashSize: 2,
          gapSize: 4,
          depthTest: false,
          toneMapped: false,
        }),
      );
      ghost.frustumCulled = false;
      ghost.computeLineDistances();
      ghost.renderOrder = 12;
      stroke.renderOrder = 13;
      marker.renderOrder = 14;
      shaft.renderOrder = 15;
      head.renderOrder = 16;
      handle.renderOrder = 17;
      this.object.add(ghost, stroke, marker, shaft, head, handle);
      this.nodes.push({ marker, stroke, handle, shaft, head, ghost });
    }
    return this.nodes[index];
  }
}

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

function hide(node: NodeVisual): void {
  node.marker.visible = false;
  node.stroke.visible = false;
  node.handle.visible = false;
  node.shaft.visible = false;
  node.head.visible = false;
  node.ghost.visible = false;
}

function setLine(line: THREE.Line, x0: number, y0: number, x1: number, y1: number): void {
  const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  attr.setXYZ(0, x0, y0, 0);
  attr.setXYZ(1, x1, y1, 0);
  attr.needsUpdate = true;
  line.computeLineDistances();
}
