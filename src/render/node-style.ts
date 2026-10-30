/**
 * Burn-node paint from design/assets/burn-node.svg.
 * Screen pixels. The sim does not read this.
 */

export interface NodePaint {
  /** Ring centreline radius, px. */
  radius: number;
  width: number;
  color: string;
  alpha: number;
  dashed: boolean;
  fill: boolean;
  core: boolean;
  coreColor: string;
  outer: boolean;
  /** 0..1 clockwise from 12 o'clock. 0 hides the arc. */
  arc: number;
  /** 0..1 ignition. Negative hides the flash. */
  flash: number;
  arrow: boolean;
}

export interface NodePaintInput {
  editing: boolean;
  selected: boolean;
  placing: boolean;
  exceeds: boolean;
  /** Sim seconds after the burn. Negative before it. Absent in planning. */
  offset: number | null;
  windup: number;
  ignite: number;
}

const IDLE: NodePaint = {
  radius: 5,
  width: 2,
  color: "#B8A8FF",
  alpha: 1,
  dashed: false,
  fill: true,
  core: true,
  coreColor: "#F7FBFF",
  outer: false,
  arc: 0,
  flash: -1,
  arrow: false,
};

/** Which ring to draw. Fired wins, then ignition, then the planning states. */
export function paintNode(input: NodePaintInput, windupAmount: number): NodePaint {
  const offset = input.offset;
  if (offset !== null && offset > input.ignite) {
    return {
      radius: 5,
      width: 1.5,
      color: "#B8A8FF",
      alpha: 0.45,
      dashed: true,
      fill: false,
      core: false,
      coreColor: "#F7FBFF",
      outer: false,
      arc: 0,
      flash: -1,
      arrow: false,
    };
  }
  const flash = offset !== null && offset >= 0 && offset <= input.ignite ? offset / Math.max(input.ignite, 1e-6) : -1;
  const arc = offset !== null && offset < 0 && offset > -input.windup ? windupAmount : 0;
  if (!input.editing) {
    return { ...IDLE, arc, flash, arrow: false };
  }
  if (input.placing) {
    return { ...IDLE, arrow: false, arc, flash };
  }
  if (input.exceeds) {
    return {
      ...IDLE,
      color: "#FF5A5F",
      coreColor: "#FF5A5F",
      arrow: true,
      arc,
      flash,
    };
  }
  if (input.selected) {
    return {
      ...IDLE,
      radius: 6.5,
      color: "#FFFFFF",
      outer: true,
      arrow: true,
      arc,
      flash,
    };
  }
  return { ...IDLE, arrow: true, arc, flash };
}

/** Chip by the arrow head. "Δv 1.8 · 12 %" or "Δv 6.2 · +18 % over". */
export function burnChipText(dv: number, cost: number, fuel: number, exceeds: boolean): string {
  const mag = Number.isFinite(dv) ? Math.abs(dv) : 0;
  const pct = fuel > 0 && Number.isFinite(cost) ? Math.round((cost / fuel) * 100) : 0;
  const shown = mag.toFixed(1);
  if (exceeds) return `Δv ${shown} · +${Math.max(0, pct - 100)} % over`;
  return `Δv ${shown} · ${pct} %`;
}
