import type { Objective } from "../level/schema";

/**
 * Stand-in objective line until Claude's briefing lands.
 * Uses the existing HUD type. No new colours.
 */
export function objectiveText(
  objectives: readonly Objective[] | undefined,
  leg: number,
  status: "flying" | "won" | "crashed" | "lost",
  planCompletes: boolean,
): string | null {
  if (!objectives || objectives.length === 0) return null;
  if (status === "won") return "Mission complete";
  if (planCompletes) return "Plan completes both legs";
  const index = leg < 0 ? 0 : leg >= objectives.length ? objectives.length - 1 : leg;
  const item = objectives[index];
  const label = item.label ?? item.bodyId;
  return `${index + 1}/${objectives.length}  ${label}`;
}
