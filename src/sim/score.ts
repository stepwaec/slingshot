/**
 * Mission score. Pure: no DOM, no flight integration.
 *
 * Arrival in a stable orbit is required. Missing the outside-time deadline
 * is a hard fail and zeros the points and the stars, even if the ship is
 * captured. Under the deadline, ship time saved against the crew budget is
 * a bonus and leftover fuel adds points.
 *
 * WP4's score-pause rule feeds in as `pauseSpent`: the points already paid
 * to pause (`budget - score remaining`). Free and unlimited pauses spend 0.
 * A hard fail does not go negative; the pause charge only reduces a success.
 */

export interface MissionInput {
  arrived: boolean;
  /** Coordinate time. Home and the destination share this clock. */
  outsideTime: number;
  /** Ship proper time. */
  shipTime: number;
  fuelLeft: number;
  /** Points already paid to a WP4 `{ kind: "score" }` pause rule. */
  pauseSpent: number;
  /** Outside-time limit. Later than this is a hard fail. */
  deadline: number;
  /** Ship time at or under this earns the crew star. */
  crewLimit: number;
  /** Fuel remaining at or over this earns the fuel star. */
  fuelStarMin: number;
  /** Points per ship-second saved under `crewLimit`. */
  crewWeight: number;
  /** Points per unit of fuel left. */
  fuelWeight: number;
}

export interface MissionStars {
  deadline: boolean;
  crew: boolean;
  fuel: boolean;
}

export interface MissionScore {
  arrived: boolean;
  outsideTime: number;
  shipTime: number;
  fuelLeft: number;
  pauseSpent: number;
  /** Outside time minus ship time. */
  gap: number;
  hardFail: null | "arrival" | "deadline";
  points: number;
  stars: MissionStars;
}

export function scoreMission(input: MissionInput): MissionScore {
  const arrived = input.arrived;
  const outside = input.outsideTime;
  const ship = input.shipTime;
  const fuel = input.fuelLeft;
  const pauseSpent = input.pauseSpent > 0 ? input.pauseSpent : 0;
  const late = !(outside <= input.deadline + 1e-9);
  const hardFail = !arrived ? "arrival" : late ? "deadline" : null;
  const stars: MissionStars = {
    deadline: hardFail === null,
    crew: hardFail === null && ship <= input.crewLimit + 1e-9,
    fuel: hardFail === null && fuel + 1e-9 >= input.fuelStarMin,
  };
  let points = 0;
  if (hardFail === null) {
    const crewBonus = input.crewWeight * Math.max(0, input.crewLimit - ship);
    const fuelBonus = input.fuelWeight * Math.max(0, fuel);
    points = crewBonus + fuelBonus - pauseSpent;
    if (!(points > 0)) points = 0;
  }
  return {
    arrived,
    outsideTime: outside,
    shipTime: ship,
    fuelLeft: fuel,
    pauseSpent,
    gap: outside - ship,
    hardFail,
    points,
    stars,
  };
}
