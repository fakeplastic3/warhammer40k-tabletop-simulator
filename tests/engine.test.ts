import { describe, it, expect } from "vitest";
import { createState } from "@tabletop/game-data";
import {
  actionSchema,
  type GameState,
  type Player,
  type Weapon,
} from "@tabletop/shared";
import {
  addSecondPlayer,
  applyAction,
  coherent,
  d3,
  damageModel,
  edgeDistance,
  mortalDamage,
  reroll,
  roll,
  woundThreshold,
  resolveCombat,
  scoreObjectives,
  DecisionRequired,
  modifier,
} from "@tabletop/game-engine";
const die = () => 4;
function state() {
  return applyAction(
    addSecondPlayer(createState("test", "A", "sentinels"), "B", "raiders"),
    0,
    { type: "start" },
    die,
  );
}
function movement() {
  return applyAction(state(), 0, { type: "next" }, die);
}
function paths(s: GameState, dx: number, unit = "p0-u0") {
  return s.units
    .find((u) => u.id === unit)!
    .models.map((m) => ({ modelId: m.id, points: [{ x: m.x + dx, y: m.y }] }));
}
describe("dice and protocol", () => {
  it.each([
    [8, 4, 2],
    [5, 4, 3],
    [4, 4, 4],
    [3, 4, 5],
    [2, 4, 6],
  ])("wound chart %s vs %s", (s, t, w) => expect(woundThreshold(s, t)).toBe(w));
  it("checks dice, D3, modifiers and whole-roll rerolls", () => {
    expect(d3(() => 5)).toBe(3);
    expect(roll(die, 2, "charge", 1).total).toBe(9);
    expect(() => roll(() => 7, 1, "bad")).toThrow();
    expect(() => roll(die, 0, "bad")).toThrow();
    const r = reroll(
      die,
      roll(() => 1, 2, "charge"),
    );
    expect(r.rerolled).toEqual([1, 1]);
    expect(() => reroll(die, r)).toThrow();
  });
  it("rejects forged dice, unknown actions, nonfinite paths and empty paths", () => {
    expect(
      actionSchema.safeParse({
        type: "attack",
        unitId: "a",
        targetId: "b",
        weaponId: "c",
        dice: [6],
      }).success,
    ).toBe(false);
    expect(actionSchema.safeParse({ type: "godmode" }).success).toBe(false);
    expect(
      actionSchema.safeParse({
        type: "move",
        unitId: "a",
        mode: "normal",
        paths: [{ modelId: "m", points: [] }],
      }).success,
    ).toBe(false);
  });
});
describe("geometry and movement", () => {
  it("measures base edges and exact maximum movement", () => {
    const s = movement();
    expect(
      edgeDistance(s.units[0].models[0], s.units[0].models[1]),
    ).toBeCloseTo(1.5 - 32 / 25.4);
    const moved = applyAction(
      s,
      0,
      { type: "move", unitId: "p0-u0", mode: "normal", paths: paths(s, 6) },
      die,
    );
    expect(moved.units[0].models[0].x).toBe(10);
    expect(s.units[0].models[0].x).toBe(4);
  });
  it("rejects excess, repeated moves, foreign units and wrong turns", () => {
    const s = movement();
    expect(() =>
      applyAction(
        s,
        0,
        {
          type: "move",
          unitId: "p0-u0",
          mode: "normal",
          paths: paths(s, 6.001),
        },
        die,
      ),
    ).toThrow("exceeds");
    expect(() =>
      applyAction(
        s,
        1,
        { type: "move", unitId: "p1-u0", mode: "normal", paths: [] },
        die,
      ),
    ).toThrow();
    expect(() =>
      applyAction(
        s,
        0,
        { type: "move", unitId: "p1-u0", mode: "normal", paths: [] },
        die,
      ),
    ).toThrow();
    const m = applyAction(
      s,
      0,
      { type: "move", unitId: "p0-u0", mode: "normal", paths: paths(s, 1) },
      die,
    );
    expect(() =>
      applyAction(
        m,
        0,
        { type: "move", unitId: "p0-u0", mode: "normal", paths: [] },
        die,
      ),
    ).toThrow("already");
  });
  it("measures summed path segments atomically", () => {
    const s = movement();
    const p = paths(s, 1);
    p[0].points = [
      { x: 8, y: 8 },
      { x: 4, y: 8 },
    ];
    expect(() =>
      applyAction(
        s,
        0,
        { type: "move", unitId: "p0-u0", mode: "normal", paths: p },
        die,
      ),
    ).toThrow("exceeds");
    expect(s.units[0].models[0].x).toBe(4);
  });
  it("rejects edge crossings, overlapping bases, duplicate paths and incoherency", () => {
    const s = movement();
    for (const p of [
      paths(s, -4),
      [paths(s, 1)[0], paths(s, 1)[0]],
      [{ modelId: s.units[0].models[0].id, points: [{ x: 4, y: 9.5 }] }],
      [{ modelId: s.units[0].models[0].id, points: [{ x: 10, y: 8 }] }],
    ])
      expect(() =>
        applyAction(
          s,
          0,
          { type: "move", unitId: "p0-u0", mode: "normal", paths: p },
          die,
        ),
      ).toThrow();
  });
  it("rejects enemy and solid terrain traversal even with legal endpoints", () => {
    const s = movement();
    s.terrain = [
      {
        id: "wall",
        name: "wall",
        category: "dense",
        solid: true,
        x: 6,
        y: 6,
        width: 1,
        height: 7,
      },
    ];
    expect(() =>
      applyAction(
        s,
        0,
        { type: "move", unitId: "p0-u0", mode: "normal", paths: paths(s, 4) },
        die,
      ),
    ).toThrow("solid");
    s.terrain = [];
    s.units[2].models.forEach((m, i) => {
      m.x = 8;
      m.y = 8 + 1.5 * i;
    });
    expect(() =>
      applyAction(
        s,
        0,
        { type: "move", unitId: "p0-u0", mode: "normal", paths: paths(s, 6) },
        die,
      ),
    ).toThrow("enemy");
  });
  it("requires one connected group, not two mutually close pairs", () => {
    const m = state().units[0].models[0];
    expect(
      coherent(
        [0, 1.5, 7, 8.5].map((x, i) => ({ ...m, id: String(i), x, y: 0 })),
      ),
    ).toBe(false);
  });
  it("rolls advance once and blocks phase skipping until committed", () => {
    const s = applyAction(
      movement(),
      0,
      { type: "advance", unitId: "p0-u0" },
      () => 6,
    );
    expect(s.pending?.distance).toBe(12);
    expect(() => applyAction(s, 0, { type: "next" }, die)).toThrow("pending");
    expect(() =>
      applyAction(s, 0, { type: "advance", unitId: "p0-u0" }, die),
    ).toThrow();
    const m = applyAction(s, 0, { type: "commit", paths: paths(s, 12) }, die);
    expect(m.pending).toBeUndefined();
    expect(m.units[0].moved).toBe("advance");
  });
  it("only host configures nonoverlapping terrain in lobby", () => {
    const s = createState("a", "A", "sentinels");
    const terrain = {
      id: "x",
      name: "x",
      category: "dense" as const,
      solid: true,
      x: 10,
      y: 5,
      width: 2,
      height: 2,
    };
    expect(
      applyAction(s, 0, { type: "terrain", terrain }, die).terrain,
    ).toHaveLength(4);
    expect(() =>
      applyAction(state(), 0, { type: "terrain", terrain }, die),
    ).toThrow();
  });
});
describe("combat and turn lifecycle", () => {
  it("gains both CP and checks half strength battle shock", () => {
    let s = state();
    expect(s.cp).toEqual([1, 1]);
    s.units[0].models[0].wounds = 0;
    s.units[0].models[1].wounds = 0;
    s.status = "lobby";
    s = applyAction(s, 0, { type: "start" }, () => 1);
    s = applyAction(s, 0, { type: "next" }, () => 1);
    expect(s.units[0].shocked).toBe(true);
    expect(s.events.flatMap((e) => e.rolls ?? [])[0].values).toEqual([1, 1]);
  });
  it("requires two commanders and host to start", () => {
    expect(() =>
      applyAction(
        createState("a", "A", "sentinels"),
        0,
        { type: "start" },
        die,
      ),
    ).toThrow();
    expect(() =>
      applyAction(
        addSecondPlayer(createState("a", "A", "sentinels"), "B", "raiders"),
        1,
        { type: "start" },
        die,
      ),
    ).toThrow();
  });
  it("normal damage does not spill but mortal wounds do", () => {
    const u = state().units[0];
    expect(damageModel(u.models[0], 100)).toBe(2);
    expect(u.models[1].wounds).toBe(2);
    expect(mortalDamage(u, 3)).toBe(3);
    expect(u.models.map((m) => m.wounds)).toEqual([0, 0, 1]);
  });
  it("resolves ranged rolls and prevents second shooting", () => {
    let s = state();
    s.phase = "shooting";
    s.terrain = [];
    s.units[2].models.forEach((m) => (m.x = 20));
    const original = structuredClone(s);
    s = applyAction(
      s,
      0,
      {
        type: "attack",
        unitId: "p0-u0",
        targetId: "p1-u0",
        weaponId: "carbine",
      },
      die,
    );
    expect(s.events[0].rolls).toHaveLength(18);
    expect(s.units[2].models.every((m) => m.wounds === 0)).toBe(true);
    expect(original.units[2].models[0].wounds).toBe(2);
    expect(() =>
      applyAction(
        s,
        0,
        {
          type: "attack",
          unitId: "p0-u0",
          targetId: "p1-u1",
          weaponId: "carbine",
        },
        die,
      ),
    ).toThrow("cannot shoot");
  });
  it("natural 1 misses and natural 6 hits; invulnerable saves ignore AP", () => {
    const s = state();
    s.terrain = [];
    const a = s.units[0],
      t = s.units[2];
    t.models.forEach((m) => (m.x = 20));
    const w = { ...a.weapons[0], skill: 10, ap: -10 };
    expect(resolveCombat(s, a, t, w, () => 1).hits).toBe(0);
    t.invulnerable = 6;
    const r = resolveCombat(s, a, t, w, () => 6);
    expect(r.hits).toBe(6);
    expect(r.damage).toBe(0);
  });
  it("enforces advance weapon eligibility", () => {
    const s = state();
    s.terrain = [];
    const a = s.units[2],
      t = s.units[0];
    a.models.forEach((m) => (m.x = 20));
    a.moved = "advance";
    expect(() => resolveCombat(s, a, t, a.weapons[0], die)).toThrow("ASSAULT");
  });
  it("separates visibility and range witnesses", () => {
    const s = state();
    s.terrain = [];
    const a = s.units[0],
      t = s.units[2];
    a.models.slice(1).forEach((m) => (m.wounds = 0));
    t.models[0].x = 10;
    t.models[0].y = 8;
    t.models[1].x = 35;
    t.models[1].y = 28;
    t.models[2].wounds = 0;
    s.terrain = [
      {
        id: "wall",
        name: "wall",
        category: "dense",
        solid: true,
        x: 6,
        y: 7,
        width: 2,
        height: 2,
      },
    ];
    expect(resolveCombat(s, a, t, a.weapons[0], () => 1).hits).toBe(0);
  });
  it("charge rolls once, targets after rolling, grants Fights First", () => {
    let s = state();
    s.phase = "charge";
    s.terrain = [];
    s.units[2].models.forEach((m) => (m.x = 12));
    s = applyAction(s, 0, { type: "charge", unitId: "p0-u0" }, die);
    expect(s.pending?.distance).toBe(8);
    s = applyAction(
      s,
      0,
      { type: "commit", paths: paths(s, 6), targets: ["p1-u0"] },
      die,
    );
    expect(s.units[0].charged).toBe(true);
    expect(() =>
      applyAction(s, 0, { type: "charge", unitId: "p0-u0" }, die),
    ).toThrow();
  });
  it("records failed charge and disallows rerolling it", () => {
    let s = state();
    s.phase = "charge";
    s.units[2].models.forEach((m) => (m.x = 12));
    s = applyAction(s, 0, { type: "charge", unitId: "p0-u0" }, () => 1);
    expect(() =>
      applyAction(
        s,
        0,
        { type: "commit", paths: paths(s, 1), targets: ["p1-u0"] },
        die,
      ),
    ).toThrow("Double 1");
    s = applyAction(s, 0, { type: "commit", paths: [], decline: true }, die);
    expect(() =>
      applyAction(s, 0, { type: "charge", unitId: "p0-u0" }, die),
    ).toThrow("already declared");
  });
  it("scores OC, ties and battle shock", () => {
    const s = state();
    const o = s.objectives[0];
    s.units[0].models.forEach((m) => {
      m.x = o.x;
      m.y = o.y;
    });
    scoreObjectives(s);
    expect(o.owner).toBe(0);
    s.units[0].shocked = true;
    scoreObjectives(s);
    expect(o.owner).toBeNull();
  });
  it("completes five full rounds through both players fight steps", () => {
    let s = state();
    let turns = 0;
    for (let i = 0; i < 200 && s.status !== "finished"; i++) {
      const actor: Player =
        s.reaction?.player ?? (s.phase === "fight" ? s.fightPlayer : s.turn);
      const before = s.turnNumber;
      s = applyAction(
        s,
        actor,
        s.reaction ? { type: "passReaction" } : { type: "next" },
        die,
      );
      if (s.turnNumber !== before) turns++;
    }
    expect(s.status).toBe("finished");
    expect(s.round).toBe(5);
    expect(s.winner).toBe("draw");
    expect(turns).toBe(9);
    expect(s.cp).toEqual([10, 10]);
  });
  it("concedes only an active game", () => {
    const s = applyAction(state(), 1, { type: "resign" }, die);
    expect(s.winner).toBe(0);
    expect(() => applyAction(s, 0, { type: "next" }, die)).toThrow(
      "not active",
    );
  });
  it("expires modifiers and exposes ambiguous effects", () => {
    const s = state();
    s.effects = [
      {
        id: "a",
        event: "beforeAttack",
        unitId: "p0-u0",
        priority: 1,
        operation: "hit-modifier",
        value: 1,
        exclusiveKey: "a",
      },
    ];
    expect(modifier(s, "beforeAttack", "p0-u0", "hit-modifier")).toBe(1);
    s.effects.push({ ...s.effects[0], id: "b" });
    expect(() => modifier(s, "beforeAttack", "p0-u0", "hit-modifier")).toThrow(
      DecisionRequired,
    );
  });
});
describe("fight activation and overrun", () => {
  it("prioritizes charged units and alternates melee fighters", () => {
    let s = state();
    s.phase = "fight";
    s.fightStep = "combat";
    s.terrain = [];
    s.units[2].models.forEach((m) => (m.x = 6.5));
    s.units[0].charged = true;
    s.fightEligible = ["p0-u0", "p1-u0"];
    s = applyAction(
      s,
      0,
      { type: "attack", unitId: "p0-u0", targetId: "p1-u0", weaponId: "blade" },
      () => 1,
    );
    expect(s.units[0].fought).toBe(true);
    expect(s.fightPlayer).toBe(1);
    expect(() =>
      applyAction(
        s,
        0,
        {
          type: "attack",
          unitId: "p0-u0",
          targetId: "p1-u0",
          weaponId: "blade",
        },
        die,
      ),
    ).toThrow();
    s = applyAction(
      s,
      1,
      { type: "attack", unitId: "p1-u0", targetId: "p0-u0", weaponId: "blade" },
      () => 1,
    );
    expect(s.units[2].fought).toBe(true);
    s = applyAction(s, s.fightPlayer, { type: "next" }, die);
    expect(s.fightStep).toBe("consolidate");
  });
  it("allows an explicit training pass when every overrun target is unreachable", () => {
    let s = state();
    s.phase = "fight";
    s.fightStep = "combat";
    s.fightEligible = ["p0-u0"];
    s = applyAction(
      s,
      0,
      { type: "fightMove", unitId: "p0-u0", paths: [] },
      die,
    );
    expect(s.units[0].fought).toBe(true);
    expect(s.events[0].rule).toBe("training:unreachable fight pass");
    expect(applyAction(s, 0, { type: "next" }, die).fightStep).toBe(
      "consolidate",
    );
  });
  it("permits one extra pile-in for an unengaged eligible fighter", () => {
    let s = state();
    s.phase = "fight";
    s.fightStep = "combat";
    s.terrain = [];
    s.units[2].models.forEach((m) => (m.x = 9));
    s.fightEligible = ["p0-u0"];
    s = applyAction(
      s,
      0,
      { type: "fightMove", unitId: "p0-u0", paths: paths(s, 3) },
      die,
    );
    expect(s.units[0].oneShotUsed).toContain("__overrun");
    expect(() =>
      applyAction(s, 0, { type: "fightMove", unitId: "p0-u0", paths: [] }, die),
    ).toThrow();
    expect(
      applyAction(
        s,
        0,
        {
          type: "attack",
          unitId: "p0-u0",
          targetId: "p1-u0",
          weaponId: "blade",
        },
        () => 1,
      ).units[0].fought,
    ).toBe(true);
  });
});
describe("fall back and desperate escape", () => {
  function engagedMovement() {
    const s = movement();
    s.terrain = [];
    s.units[2].models.forEach((m) => (m.x = 6.5));
    return s;
  }
  it("falls back from engagement and cannot shoot afterwards", () => {
    let s = engagedMovement();
    s = applyAction(
      s,
      0,
      { type: "move", unitId: "p0-u0", mode: "fallback", paths: paths(s, -2) },
      die,
    );
    expect(s.units[0].moved).toBe("fallback");
    s.phase = "shooting";
    expect(() =>
      applyAction(
        s,
        0,
        {
          type: "attack",
          unitId: "p0-u0",
          targetId: "p1-u0",
          weaponId: "carbine",
        },
        die,
      ),
    ).toThrow("fell back");
  });
  it("requires desperate escape when shocked, crosses enemy bases and applies hazards", () => {
    const s = engagedMovement();
    s.units[0].shocked = true;
    const action = {
      type: "move" as const,
      unitId: "p0-u0",
      mode: "fallback" as const,
      paths: paths(s, 6),
    };
    expect(() => applyAction(s, 0, action, die)).toThrow("desperate escape");
    const result = applyAction(s, 0, { ...action, desperate: true }, () => 1);
    expect(result.units[0].models.map((m) => m.wounds)).toEqual([0, 1, 2]);
    expect(result.events[0].rolls![0].values).toEqual([1, 1, 1]);
    expect(result.units[0].shocked).toBe(true);
    expect(s.units[0].models[0].x).toBe(4);
  });
  it("checks leadership after nonshocked desperate escape", () => {
    const s = engagedMovement();
    const result = applyAction(
      s,
      0,
      {
        type: "move",
        unitId: "p0-u0",
        mode: "fallback",
        desperate: true,
        paths: paths(s, 6),
      },
      () => 2,
    );
    expect(result.units[0].shocked).toBe(true);
    expect(result.events.flatMap((e) => e.rolls ?? [])).toHaveLength(2);
  });
});

describe("deployment, reserves and defender choices", () => {
  it("caps reserves at 50% of original points and excludes them from geometry and OC", () => {
    let s = addSecondPlayer(createState("r", "A", "sentinels"), "B", "raiders");
    s = applyAction(
      s,
      0,
      { type: "reserve", unitId: "p0-u0", reserve: true },
      die,
    );
    expect(() =>
      applyAction(
        s,
        0,
        { type: "reserve", unitId: "p0-u1", reserve: true },
        die,
      ),
    ).toThrow("50%");
    expect(
      edgeDistance(s.units[0].models[0], s.units[2].models[0]),
    ).toBeGreaterThan(0);
    s.units[0].models.forEach((m) => {
      m.x = 14;
      m.y = 15;
    });
    scoreObjectives(s);
    expect(s.objectives[0].owner).toBeNull();
  });
  it("validates complete setup and own deployment zone", () => {
    const s = addSecondPlayer(
      createState("r", "A", "sentinels"),
      "B",
      "raiders",
    );
    expect(() =>
      applyAction(
        s,
        0,
        { type: "deploy", unitId: "p0-u0", paths: paths(s, 3) },
        die,
      ),
    ).toThrow("deployment zone");
    expect(() =>
      applyAction(
        s,
        0,
        { type: "deploy", unitId: "p0-u0", paths: paths(s, 0).slice(1) },
        die,
      ),
    ).toThrow("every");
    expect(
      applyAction(
        s,
        0,
        { type: "deploy", unitId: "p0-u0", paths: paths(s, 1) },
        die,
      ).units[0].models[0].x,
    ).toBe(5);
  });
  it("enforces ingress round, edge, enemy distance and arrival movement lock", () => {
    const s = movement();
    s.units[0].reserve = true;
    const p = paths(s, 0);
    expect(() =>
      applyAction(s, 0, { type: "ingress", unitId: "p0-u0", paths: p }, die),
    ).toThrow("round 1");
    s.round = 2;
    const r = applyAction(
      s,
      0,
      { type: "ingress", unitId: "p0-u0", paths: p },
      die,
    );
    expect(r.units[0].reserve).toBe(false);
    expect(r.units[0].arrivedTurn).toBe(r.turnNumber);
    expect(() =>
      applyAction(
        r,
        0,
        { type: "move", unitId: "p0-u0", mode: "normal", paths: p },
        die,
      ),
    ).toThrow("already");
    expect(() =>
      applyAction(
        s,
        0,
        { type: "ingress", unitId: "p0-u0", paths: paths(s, 18) },
        die,
      ),
    ).toThrow("edge");
    expect(() =>
      applyAction(
        s,
        0,
        { type: "ingress", unitId: "p0-u0", paths: paths(s, 34) },
        die,
      ),
    ).toThrow();
  });
  it("allows defender to set a complete stable casualty order", () => {
    const s = state();
    const ids = s.units[0].models.map((m) => m.id).reverse();
    expect(
      applyAction(
        s,
        0,
        { type: "allocate", unitId: "p0-u0", modelIds: ids },
        die,
      ).units[0].models[0].id,
    ).toBe(ids[0]);
    expect(() =>
      applyAction(
        s,
        0,
        { type: "allocate", unitId: "p1-u0", modelIds: ids },
        die,
      ),
    ).toThrow();
    expect(() =>
      applyAction(
        s,
        0,
        { type: "allocate", unitId: "p0-u0", modelIds: [ids[0]] },
        die,
      ),
    ).toThrow();
  });
});
describe("stratagem timing and dice decisions", () => {
  it("opens mandatory opponent reaction decisions and closes them without skipping phases", () => {
    let s = movement();
    s = applyAction(s, 0, { type: "next" }, die);
    expect(s.reaction?.kind).toBe("movementEnd");
    expect(() => applyAction(s, 0, { type: "next" }, die)).toThrow("reaction");
    s = applyAction(s, 1, { type: "passReaction" }, die);
    expect(s.phase).toBe("shooting");
    expect(s.reaction?.kind).toBe("shootingStart");
    s = applyAction(s, 1, { type: "passReaction" }, die);
    expect(s.reaction).toBeUndefined();
    expect(s.phase).toBe("shooting");
  });
  it("permits a charge reroll once and consumes CP", () => {
    let s = state();
    s.phase = "charge";
    s.units[2].models.forEach((m) => (m.x = 12));
    s = applyAction(s, 0, { type: "charge", unitId: "p0-u0" }, () => 1);
    s = applyAction(
      s,
      0,
      { type: "stratagem", name: "commandReroll", unitId: "p0-u0" },
      () => 6,
    );
    expect(s.pending?.distance).toBe(12);
    expect(s.cp[0]).toBe(0);
    expect(() =>
      applyAction(
        s,
        0,
        { type: "stratagem", name: "commandReroll", unitId: "p0-u0" },
        die,
      ),
    ).toThrow();
  });
  it("offers Bravery before command tests and enforces once per battle", () => {
    let s = state();
    s.units[0].models.slice(1).forEach((m) => (m.wounds = 0));
    s = applyAction(
      s,
      0,
      { type: "stratagem", name: "bravery", unitId: "p0-u0" },
      die,
    );
    s = applyAction(s, 0, { type: "next" }, () => 1);
    expect(s.units[0].shocked).toBe(false);
    expect(s.cp[0]).toBe(0);
    s.phase = "command";
    s.commandPending = true;
    s.cp[0] = 5;
    expect(() =>
      applyAction(
        s,
        0,
        { type: "stratagem", name: "bravery", unitId: "p0-u0" },
        die,
      ),
    ).toThrow("once");
  });
  it("uses grenades with range/visibility checks and prevents repeat unit stratagems", () => {
    let s = state();
    s.phase = "shooting";
    s.terrain = [];
    s.units[2].models.forEach((m) => (m.x = 12));
    s = applyAction(
      s,
      0,
      {
        type: "stratagem",
        name: "grenade",
        unitId: "p0-u0",
        targetId: "p1-u0",
      },
      () => 4,
    );
    expect(s.cp[0]).toBe(0);
    expect(s.units[2].models.every((m) => m.wounds === 0)).toBe(true);
    s.cp[0] = 10;
    expect(() =>
      applyAction(
        s,
        0,
        {
          type: "stratagem",
          name: "grenade",
          unitId: "p0-u0",
          targetId: "p1-u1",
        },
        die,
      ),
    ).toThrow();
  });
  it("Overwatch hits only natural 6 and never creates critical sustained hits", () => {
    const s = state();
    s.phase = "movement";
    s.reaction = { kind: "movementEnd", player: 1, advance: true };
    s.terrain = [];
    s.units[0].models.forEach((m) => (m.x = 20));
    s.units[2].weapons[0].abilities["sustained-hits"] = 10;
    const r = applyAction(
      s,
      1,
      {
        type: "stratagem",
        name: "overwatch",
        unitId: "p1-u0",
        targetId: "p0-u0",
      },
      () => 5,
    );
    expect(r.units[0].models[0].wounds).toBe(2);
    expect(r.cp[1]).toBe(0);
  });
  it("uses Smokescreen only at the appropriate window", () => {
    let s = state();
    s.phase = "shooting";
    expect(() =>
      applyAction(
        s,
        1,
        { type: "stratagem", name: "smoke", unitId: "p1-u0" },
        die,
      ),
    ).toThrow();
    s.reaction = { kind: "shootingStart", player: 1, advance: false };
    s = applyAction(
      s,
      1,
      { type: "stratagem", name: "smoke", unitId: "p1-u0" },
      die,
    );
    expect(s.smokeUnits).toEqual([{ unitId: "p1-u0", turn: 1 }]);
  });
  it("pauses before future dice, persists a decision and rerolls without revealing later outcomes", () => {
    let s = state();
    s.phase = "shooting";
    s.terrain = [];
    s.units[2].models.forEach((m) => (m.x = 20));
    s.autoRolls = [false, true];
    let count = 0;
    s = applyAction(
      s,
      0,
      {
        type: "attack",
        unitId: "p0-u0",
        targetId: "p1-u0",
        weaponId: "carbine",
      },
      () => {
        count++;
        return 1;
      },
    );
    expect(count).toBe(1);
    expect(s.resolution?.roll.values).toEqual([1]);
    expect(s.units[2].models[0].wounds).toBe(2);
    expect(() =>
      applyAction(s, 1, { type: "resolveRoll", reroll: false }, die),
    ).toThrow("rolling player");
    s = JSON.parse(JSON.stringify(s));
    s = applyAction(s, 0, { type: "resolveRoll", reroll: true }, () => 4);
    expect(s.resolution).toBeUndefined();
    expect(s.cp[0]).toBe(0);
    expect(s.stratagemUses?.[0].name).toBe("commandReroll");
    expect(s.events[0].rolls![0].rerolled).toEqual([1]);
  });
  it("lets defender review saves and resume deterministically after acceptance", () => {
    let s = state();
    s.phase = "shooting";
    s.terrain = [];
    s.units[2].models.forEach((m) => (m.x = 20));
    s.autoRolls = [true, false];
    s = applyAction(
      s,
      0,
      {
        type: "attack",
        unitId: "p0-u0",
        targetId: "p1-u0",
        weaponId: "carbine",
      },
      () => 4,
    );
    expect(s.resolution?.meta.player).toBe(1);
    expect(s.resolution?.meta.kind).toBe("save");
    let n = 0;
    while (s.resolution && n++ < 20)
      s = applyAction(s, 1, { type: "resolveRoll", reroll: false }, () => 4);
    expect(s.resolution).toBeUndefined();
    expect(s.cp[1]).toBe(1);
    expect(s.units[2].models.every((m) => m.wounds === 0)).toBe(true);
  });
});
describe("weapon abilities and declared pools", () => {
  function combat() {
    const s = state();
    s.phase = "shooting";
    s.terrain = [];
    s.units[2].models.forEach((m) => (m.x = 16));
    return s;
  }
  it("resolves declared ranged model pools atomically and rejects duplicate model weapons", () => {
    const s = combat();
    const allocations = s.units[0].models.map((m) => ({
      modelId: m.id,
      attacks: 2,
    }));
    const pool = { weaponId: "carbine", targetId: "p1-u0", allocations };
    expect(() =>
      applyAction(
        s,
        0,
        { type: "volley", unitId: "p0-u0", pools: [pool, pool] },
        die,
      ),
    ).toThrow("exceed");
    const result = applyAction(
      s,
      0,
      { type: "volley", unitId: "p0-u0", pools: [pool] },
      die,
    );
    expect(result.units[0].shotTurn).toBe(1);
    expect(result.units[2].models.every((m) => m.wounds === 0)).toBe(true);
    expect(s.units[2].models[0].wounds).toBe(2);
  });
  it("splits melee dice across engaged targets and rejects excessive allocations", () => {
    const s = combat();
    s.phase = "fight";
    s.fightStep = "combat";
    s.units[2].models.forEach((m) => (m.x = 6.5));
    s.units[3].models.forEach((m, i) => {
      m.x = 3;
      m.y = 5 - i * 1.5;
    });
    const modelId = s.units[0].models[0].id;
    const pools = [
      {
        weaponId: "blade",
        targetId: "p1-u0",
        allocations: [{ modelId, attacks: 1 }],
      },
      {
        weaponId: "blade",
        targetId: "p1-u1",
        allocations: [{ modelId, attacks: 1 }],
      },
    ];
    expect(
      applyAction(s, 0, { type: "volley", unitId: "p0-u0", pools }, () => 1)
        .units[0].fought,
    ).toBe(true);
    pools[1].allocations[0].attacks = 2;
    expect(() =>
      applyAction(s, 0, { type: "volley", unitId: "p0-u0", pools }, () => 1),
    ).toThrow("exceed");
  });
  it("torrent skips hit dice and lethal automatic wounds never become devastating critical wounds", () => {
    let s = combat();
    let a = s.units[0],
      t = s.units[2];
    let w: Weapon = { ...a.weapons[0], abilities: { torrent: true } };
    const r = resolveCombat(s, a, t, w, () => 1);
    expect(r.hits).toBe(6);
    expect(r.rolls.every((r) => !r.reason.endsWith("hit"))).toBe(true);
    s = combat();
    a = s.units[0];
    t = s.units[2];
    w = {
      ...a.weapons[0],
      abilities: { "lethal-hits": true, "devastating-wounds": true },
    };
    const lethal = resolveCombat(s, a, t, w, () => 6, { lethal: true });
    expect(lethal.wounds).toBe(6);
    expect(lethal.damage).toBe(0);
    expect(lethal.rolls.some((r) => r.reason.endsWith("wound"))).toBe(false);
  });
  it("sustained hits add wound dice, twin linked rerolls each failed wound once", () => {
    const s = combat(),
      a = s.units[0],
      t = s.units[2];
    const w = {
      ...a.weapons[0],
      abilities: { "sustained-hits": 1, "twin-linked": true },
    };
    const r = resolveCombat(s, a, t, w, () => 6);
    expect(r.hits).toBe(12);
    let n = 0;
    const r2 = resolveCombat(
      combat(),
      a,
      t,
      { ...w, abilities: { torrent: true, "twin-linked": true } },
      () => (++n % 2 ? 1 : 4),
      { twinLinked: true },
    );
    expect(r2.rolls.some((r) => r.rerolled)).toBe(true);
  });
  it("Feel No Pain prevents each lost wound and anti criticals bypass ordinary thresholds", () => {
    const s = combat(),
      a = s.units[0],
      t = s.units[2];
    t.feelNoPain = 2;
    let n = 0;
    const r = resolveCombat(s, a, t, a.weapons[0], () =>
      ++n % 3 === 0 ? 1 : 4,
    );
    expect(r.rolls.some((r) => r.reason.includes("Feel No Pain"))).toBe(true);
    const w = {
      ...a.weapons[0],
      strength: 1,
      abilities: {
        torrent: true,
        anti: { keyword: "INFANTRY", threshold: 2 },
        "devastating-wounds": true,
      },
    };
    const r2 = resolveCombat(combat(), a, t, w, () => 2);
    expect(r2.wounds).toBe(6);
  });
  it("indirect requires its tag, rejects torrent, grants cover and restricts hits", () => {
    const s = combat(),
      a = s.units[0],
      t = s.units[2];
    expect(() =>
      resolveCombat(s, a, t, a.weapons[0], die, { shootingType: "indirect" }),
    ).toThrow();
    const w = { ...a.weapons[0], abilities: { "indirect-fire": true } };
    expect(
      resolveCombat(s, a, t, w, () => 5, { shootingType: "indirect" }).hits,
    ).toBe(0);
    a.moved = "stationary";
    expect(
      resolveCombat(s, a, t, w, () => 4, { shootingType: "indirect" }).hits,
    ).toBe(6);
    expect(() =>
      resolveCombat(
        s,
        a,
        t,
        { ...w, abilities: { ...w.abilities, torrent: true } },
        die,
        { shootingType: "indirect" },
      ),
    ).toThrow();
  });
  it("heavy does not apply after ingress or outside own shooting phase", () => {
    const s = combat(),
      a = s.units[0],
      t = s.units[2];
    const w = { ...a.weapons[0], skill: 4, abilities: { heavy: true } };
    a.arrivedTurn = 1;
    expect(resolveCombat(s, a, t, w, () => 3).hits).toBe(0);
    a.arrivedTurn = undefined;
    expect(resolveCombat(s, a, t, w, () => 3).hits).toBe(6);
    s.phase = "movement";
    t.models.forEach((m) => (m.wounds = 2));
    expect(resolveCombat(s, a, t, w, () => 3).hits).toBe(0);
  });
  it("orders active mandatory/optional then opponent effects and expires phase effects", () => {
    let s = combat();
    s.effects = [
      {
        id: "a",
        owner: 0,
        event: "beforeAttack",
        unitId: "p0-u0",
        priority: 1,
        operation: "hit-modifier",
        value: 1,
        exclusiveKey: "x",
      },
      {
        id: "b",
        owner: 0,
        event: "beforeAttack",
        unitId: "p0-u0",
        priority: 1,
        operation: "hit-modifier",
        value: 1,
        exclusiveKey: "x",
        optional: true,
        until: { turn: 1, phase: "shooting" },
      },
    ];
    s = applyAction(s, 0, { type: "orderEffects", ids: ["b", "a"] }, die);
    expect(modifier(s, "beforeAttack", "p0-u0", "hit-modifier")).toBe(2);
    s = applyAction(s, 0, { type: "next" }, die);
    expect(s.effects.map((e) => e.id)).toEqual(["a"]);
  });
});
describe("reaction and reserve boundaries", () => {
  it("Rapid Ingress arrives only in the opponent movement-end window", () => {
    let s = movement();
    s.round = 2;
    s.units[2].reserve = true;
    s.reaction = { player: 1, kind: "movementEnd", advance: true };
    const p = paths(s, 0, "p1-u0");
    s = applyAction(
      s,
      1,
      { type: "stratagem", name: "rapidIngress", unitId: "p1-u0", paths: p },
      die,
    );
    expect(s.units[2].reserve).toBe(false);
    expect(s.cp[1]).toBe(0);
    expect(s.reaction?.kind).toBe("movementEnd");
  });
  it("Heroic Intervention uses recent chargers and Into the Fray caps every roll", () => {
    let s = state();
    s.phase = "charge";
    s.reaction = { player: 1, kind: "chargeEnd", advance: true };
    s.units[2].models.forEach((m) => (m.x = 10));
    s.units[0].charged = true;
    s = applyAction(
      s,
      1,
      { type: "stratagem", name: "heroic", unitId: "p1-u0" },
      () => 4,
    );
    expect(s.pending?.player).toBe(1);
    expect(s.pending?.allowedTargets).toContain("p0-u0");
    s = applyAction(s, 1, { type: "commit", paths: [], decline: true }, die);
    s = applyAction(s, 1, { type: "passReaction" }, die);
    expect(s.phase).toBe("fight");
    let capped = state();
    capped.phase = "charge";
    capped.cp[1] = 4;
    capped.reaction = { player: 1, kind: "chargeEnd", advance: true };
    capped.units[2].models.forEach((m) => (m.x = 10));
    capped = applyAction(
      capped,
      1,
      { type: "stratagem", name: "heroic", unitId: "p1-u0", intoFray: true },
      () => 6,
    );
    expect(capped.pending?.distance).toBe(6);
    expect(capped.cp[1]).toBe(2);
    expect(() => applyAction(capped, 1, { type: "passReaction" }, die)).toThrow(
      "pending",
    );
  });
  it("Counteroffensive forces that eligible unit to be the next friendly fighter", () => {
    let s = state();
    s.phase = "fight";
    s.fightStep = "combat";
    s.cp[1] = 2;
    s.reaction = { player: 1, kind: "afterEnemyFight", advance: false };
    s.units[2].models.forEach((m) => (m.x = 6.5));
    s = applyAction(
      s,
      1,
      { type: "stratagem", name: "counteroffensive", unitId: "p1-u0" },
      die,
    );
    expect(s.cp[1]).toBe(0);
    s = applyAction(s, 1, { type: "passReaction" }, die);
    expect(s.fightPlayer).toBe(1);
    expect(
      applyAction(
        s,
        1,
        {
          type: "attack",
          unitId: "p1-u0",
          targetId: "p0-u0",
          weaponId: "blade",
        },
        () => 1,
      ).units[2].fought,
    ).toBe(true);
  });
  it("destroys original reserves at the end of round three without destruction effects", () => {
    let s = state();
    s.round = 3;
    s.turn = 1;
    s.phase = "fight";
    s.fightStep = "consolidate";
    s.fightPlayer = 1;
    s.fightPassed = [0];
    s.units[0].reserve = true;
    s = applyAction(s, 1, { type: "next" }, die);
    expect(s.units[0].models.every((m) => m.wounds === 0)).toBe(true);
    expect(s.events.some((e) => e.message.includes("reserves deadline"))).toBe(
      true,
    );
  });
  it("allows the extra overrun choice when a unit began the fight step unengaged", () => {
    let s = state();
    s.phase = "fight";
    s.fightStep = "combat";
    s.fightEngagedStart = [];
    s.fightEligible = ["p0-u0"];
    s.units[2].models.forEach((m) => (m.x = 6.5));
    s = applyAction(
      s,
      0,
      { type: "fightMove", unitId: "p0-u0", paths: [] },
      die,
    );
    expect(s.units[0].oneShotUsed).toContain("__overrun");
  });
});

describe("remaining weapon ability boundaries", () => {
  function board() {
    const s = state();
    s.phase = "shooting";
    s.terrain = [];
    s.units[2].models.forEach((m) => (m.x = 16));
    s.units[0].models.slice(1).forEach((m) => (m.wounds = 0));
    return s;
  }
  it("one-shot persists for the battle and hazardous rolls wound the firing unit", () => {
    const s = board(),
      a = s.units[0],
      t = s.units[2];
    const w = {
      ...a.weapons[0],
      abilities: { "one-shot": true, hazardous: true },
    };
    const r = resolveCombat(s, a, t, w, () => 1);
    expect(r.hits).toBe(0);
    expect(a.models[0].wounds).toBe(1);
    expect(a.oneShotUsed).toContain(w.id);
    expect(() => resolveCombat(s, a, t, w, die)).toThrow("One-shot");
  });
  it("melta increases damage only at half range without spilling excess damage", () => {
    const near = board(),
      a = near.units[0],
      t = near.units[2];
    const w = { ...a.weapons[0], attacks: 1, abilities: { melta: 2 } };
    const r = resolveCombat(near, a, t, w, die);
    expect(r.damage).toBe(2);
    expect(r.destroyed).toBe(1);
    expect(t.models[1].wounds).toBe(2);
    const far = board();
    far.units[2].models.forEach((m) => (m.x = 20));
    expect(resolveCombat(far, far.units[0], far.units[2], w, die).damage).toBe(
      1,
    );
  });
  it("blast and cleave add dice per full five targets; Lance improves charged wounds", () => {
    const s = board(),
      a = s.units[0],
      t = s.units[2];
    const base = t.models[0];
    t.models = Array.from({ length: 5 }, (_, i) => ({
      ...base,
      id: `blast-${i}`,
      y: 8 + i * 1.5,
    }));
    expect(
      resolveCombat(
        s,
        a,
        t,
        { ...a.weapons[0], abilities: { blast: 1 } },
        () => 6,
      ).hits,
    ).toBe(3);
    t.models.forEach((m) => (m.x = 6.5));
    const w = { ...a.weapons[1], attacks: 1, abilities: { lance: 1 } };
    expect(resolveCombat(s, a, t, w, () => 3).wounds).toBe(0);
    a.charged = true;
    expect(resolveCombat(s, a, t, w, () => 3).wounds).toBe(1);
  });
});
