import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { passage, relay, rescue } from "../src/level/catalog";
import { LevelError, loadLevelData, loadLevelJson } from "../src/level/schema";

function passageText(): string {
  return readFileSync(new URL("../src/levels/passage.json", import.meta.url), "utf8");
}

describe("level loader", () => {
  it("loads the shipped files with the pre-move numbers", () => {
    expect(passage.dt).toBe(1 / 60);
    expect(relay.dt).toBe(1 / 60);
    expect(rescue.dt).toBe(1 / 60);
    expect(passage.ship.vy).toBe(Math.sqrt((passage.g * 90_000) / 68));
    expect(relay.ship.vy).toBe(Math.sqrt((relay.g * 9_000) / 42));
    expect(rescue.c).toBe(42);
    expect(rescue.bodies.find((body) => body.id === "hole")?.radius).toBe(44);
    expect(passage.physics).toBeUndefined();
    expect(relay.horizon?.seconds).toBe(8);
    expect(rescue.pause).toEqual({ kind: "score", cost: 8, budget: 24 });
  });

  it("rejects malformed JSON and names the file", () => {
    expect(() => loadLevelJson("{", "demo.json")).toThrow(LevelError);
    try {
      loadLevelJson("{", "demo.json");
    } catch (error) {
      expect(error).toBeInstanceOf(LevelError);
      expect((error as LevelError).source).toBe("demo.json");
      expect((error as LevelError).message).toMatch(/invalid JSON/);
      expect((error as LevelError).issues[0]).toMatch(/invalid JSON/);
    }
    expect(() => loadLevelJson("null", "empty.json")).toThrow(/level must be a JSON object/);
  });

  it("rejects schema errors with a field path", () => {
    const parsed = JSON.parse(passageText()) as Record<string, unknown>;

    const cases: Array<{ mutate: (copy: Record<string, unknown>) => void; pattern: RegExp }> = [
      {
        mutate: (copy) => {
          delete copy.targetId;
        },
        pattern: /level\.targetId is required/,
      },
      {
        mutate: (copy) => {
          copy.colour = "red";
        },
        pattern: /level\.colour is not a recognised field/,
      },
      {
        mutate: (copy) => {
          const bodies = copy.bodies as Array<Record<string, unknown>>;
          bodies[1].id = bodies[0].id;
        },
        pattern: /duplicated/,
      },
      {
        mutate: (copy) => {
          copy.physics = { p: 1 };
        },
        pattern: /level\.physics\.p must be greater than 1/,
      },
      {
        mutate: (copy) => {
          copy.physics = { eps: -4 };
        },
        pattern: /level\.physics\.eps must be at least 0/,
      },
      {
        mutate: (copy) => {
          copy.physics = { dilationCap: 0.5 };
        },
        pattern: /level\.physics\.dilationCap must be at least 1/,
      },
      {
        mutate: (copy) => {
          copy.physics = { gravityScale: 0 };
        },
        pattern: /level\.physics\.gravityScale must be greater than 0/,
      },
      {
        mutate: (copy) => {
          copy.physics = { tidalStrength: -1 };
        },
        pattern: /level\.physics\.tidalStrength/,
      },
      {
        mutate: (copy) => {
          copy.physics = { dragStrength: "heavy" };
        },
        pattern: /level\.physics\.dragStrength must be a finite number/,
      },
      {
        mutate: (copy) => {
          copy.physics = { gravtyScale: 2 };
        },
        pattern: /level\.physics\.gravtyScale is not a recognised field/,
      },
      {
        mutate: (copy) => {
          copy.pause = { kind: "sometimes" };
        },
        pattern: /level\.pause\.kind/,
      },
      {
        mutate: (copy) => {
          copy.targetId = "missing";
        },
        pattern: /level\.targetId "missing"/,
      },
      {
        mutate: (copy) => {
          copy.maxSpeed = 3;
        },
        pattern: /level\.maxSpeed must be one of/,
      },
    ];

    for (const item of cases) {
      const copy = JSON.parse(passageText()) as Record<string, unknown>;
      item.mutate(copy);
      expect(() => loadLevelData(copy, "passage.json"), item.pattern.source).toThrow(item.pattern);
    }

    expect(parsed.id).toBe("passage");
  });

  it("accepts a physics block, including the unused tidal and drag knobs", () => {
    const copy = JSON.parse(passageText()) as Record<string, unknown>;
    copy.physics = {
      c: 80,
      gravityScale: 1.5,
      eps: 12,
      p: 2.2,
      dilationStrength: 0.5,
      dilationCap: 10,
      tidalStrength: 0.25,
      dragStrength: 0.1,
    };
    const level = loadLevelData(copy, "tuned.json");
    expect(level.physics).toEqual(copy.physics);
  });

  it("accepts a per-level sim speed cap and leaves it off otherwise", () => {
    expect(passage.maxSpeed).toBeUndefined();
    const copy = JSON.parse(passageText()) as Record<string, unknown>;
    copy.maxSpeed = 16;
    expect(loadLevelData(copy, "capped.json").maxSpeed).toBe(16);
  });
});
