import type {
  Action,
  GameState,
  Unit,
  Player,
  Model,
  GameEvent,
} from "@tabletop/shared";
import { spend, withDecisions } from "./decisions";
import { phases } from "@tabletop/shared";
import { createUnits, mission } from "@tabletop/game-data";
import {
  living,
  distance,
  edgeDistance,
  unitDistance,
  coherent,
  engaged,
  isEngaged,
  pointSegmentDistance,
  withinArea,
  intersectsRect,
  modelVisible,
  EPS,
} from "./geometry";
import { roll, type DiceSource } from "./dice";
import { effectActive } from "./effects";
import { mortalDamage, resolveCombat } from "./combat";
export * from "./geometry";
export * from "./dice";
export * from "./effects";
export * from "./combat";
export class RuleError extends Error {}
function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RuleError(message);
}
function log(
  s: GameState,
  message: string,
  rule: string,
  rolls?: GameEvent["rolls"],
) {
  s.events.push({
    kind: rolls ? "dice" : "rule",
    message,
    rule,
    ...(rolls ? { rolls } : {}),
  });
}
function unit(s: GameState, id: string, actor: Player) {
  const u = s.units.find((u) => u.id === id);
  requireRule(u && u.owner === actor, "You do not control this unit");
  requireRule(living(u).length, "Unit has been destroyed");
  requireRule(!u.reserve, "Unit is in reserves");
  return u;
}
export function scoreObjectives(s: GameState) {
  for (const o of s.objectives) {
    const control: [number, number] = [0, 0];
    for (const u of s.units.filter((u) => !u.reserve))
      for (const m of living(u)) {
        if (!u.shocked && distance(m, o) - m.radius - o.radius <= 3 + EPS)
          control[u.owner] += u.oc;
      }
    o.owner =
      control[0] > control[1]
        ? 0
        : control[1] > control[0]
          ? 1
          : (o.secured ?? null);
    if (
      o.secured !== undefined &&
      control[(1 - o.secured) as Player] > control[o.secured]
    )
      o.secured = undefined;
  }
}
function command(s: GameState, _dice: DiceSource) {
  s.cp[0]++;
  s.cp[1]++;
  s.commandPending = true;
  log(
    s,
    "Both players gain 1 CP; resolve command choices before ending phase",
    "08.02",
  );
}
function commandTests(s: GameState, dice: DiceSource) {
  for (const u of s.units.filter(
    (u) => u.owner === s.turn && living(u).length,
  )) {
    if (
      (s.stratagemUses ?? []).some(
        (x) =>
          x.name === "bravery" && x.unitId === u.id && x.turn === s.turnNumber,
      )
    )
      continue;
    if (
      u.shocked ||
      (u.startingStrength === 1
        ? living(u)[0].wounds <= living(u)[0].maxWounds / 2
        : living(u).length <= u.startingStrength / 2)
    ) {
      const r = roll(dice, 2, `${u.name} · battle-shock`);
      u.shocked = r.total < u.leadership;
      log(
        s,
        `${u.name}: ${u.shocked ? "battle-shocked" : "leadership passed"}`,
        "08.03",
        [r],
      );
    }
  }
  s.commandPending = false;
}
function resetTurn(s: GameState) {
  for (const u of s.units) {
    u.moved = undefined;
    u.movedDistance = 0;
    u.charged = false;
    u.fought = false;
    u.piled = false;
    u.consolidated = false;
    u.oneShotUsed = u.oneShotUsed.filter(
      (id) =>
        !["__chargeAttempt", "__overrun", "__counteroffensive"].includes(id),
    );
  }
  s.fightPassed = [];
  s.fightEligible = [];
  s.fightEngagedStart = [];
}
function endTurn(s: GameState, dice: DiceSource) {
  for (const u of s.units.filter((u) => !u.reserve)) {
    while (!coherent(living(u))) {
      const ms = living(u);
      const isolated = [...ms]
        .sort(
          (a, b) =>
            Math.min(
              ...ms.filter((m) => m.id !== a.id).map((m) => edgeDistance(a, m)),
            ) -
            Math.min(
              ...ms.filter((m) => m.id !== b.id).map((m) => edgeDistance(b, m)),
            ),
        )
        .at(-1);
      if (!isolated) break;
      isolated.wounds = 0;
      log(
        s,
        `${u.name}: removed ${isolated.id} to regain coherency (training casualty order)`,
        "03.03",
      );
    }
  }
  scoreObjectives(s);
  if (s.turn === 1) {
    if (s.round === 3 || s.round === mission.rounds)
      for (const u of s.units.filter((u) => u.reserve)) {
        for (const m of living(u)) m.wounds = 0;
        log(
          s,
          `${u.name}: reserves deadline missed; destroyed without triggers`,
          "20.05",
        );
      }
    for (const o of s.objectives)
      if (o.owner !== null) s.vp[o.owner] += mission.pointsPerObjective;
    log(
      s,
      `Round ${s.round} scored: ${s.vp[0]} : ${s.vp[1]} VP`,
      "training:Signal Control",
    );
    if (s.round === mission.rounds) {
      s.status = "finished";
      s.winner = s.vp[0] === s.vp[1] ? "draw" : s.vp[0] > s.vp[1] ? 0 : 1;
      log(
        s,
        `Battle complete: ${s.winner === "draw" ? "draw" : s.players[s.winner] + " wins"}`,
        "training:Signal Control",
      );
      return;
    }
    s.round++;
  }
  s.turn = (1 - s.turn) as Player;
  s.turnNumber++;
  s.phase = "command";
  resetTurn(s);
  command(s, dice);
}
type Paths = { modelId: string; points: { x: number; y: number }[] }[];
function applyPaths(
  s: GameState,
  u: Unit,
  paths: Paths,
  limit: number,
  mode: "normal" | "advance" | "fallback" | "escape" | "charge" | "fight",
) {
  const ids = new Set<string>();
  let maxDistance = 0;
  for (const p of paths) {
    requireRule(!ids.has(p.modelId), "Duplicate model path");
    ids.add(p.modelId);
    const m = living(u).find((m) => m.id === p.modelId);
    requireRule(m, "Path contains unknown or destroyed model");
    let prev = { x: m.x, y: m.y };
    let travelled = 0;
    for (const point of p.points) {
      travelled += distance(prev, point);
      requireRule(
        point.x - m.radius >= -EPS &&
          point.y - m.radius >= -EPS &&
          point.x + m.radius <= s.width + EPS &&
          point.y + m.radius <= s.height + EPS,
        "Model base crosses battlefield edge",
      );
      for (const terrain of s.terrain.filter((t) => t.solid))
        requireRule(
          !intersectsRect(prev, point, terrain, m.radius - EPS),
          "Path crosses solid terrain",
        );
      for (const enemy of s.units.filter(
        (v) => !v.reserve && v.owner !== u.owner && mode !== "escape",
      ))
        for (const n of living(enemy))
          requireRule(
            pointSegmentDistance(n, prev, point) >= m.radius + n.radius - EPS,
            "Path crosses an enemy model",
          );
      prev = point;
    }
    requireRule(
      travelled <= limit + EPS,
      `Movement exceeds ${limit.toFixed(2)} inches`,
    );
    maxDistance = Math.max(maxDistance, travelled);
    const end = p.points.at(-1)!;
    m.x = end.x;
    m.y = end.y;
  }
  const models = living(u);
  requireRule(coherent(models), "Unit would be out of coherency");
  for (const m of models) {
    for (const other of s.units.filter((v) => !v.reserve))
      for (const n of living(other))
        if (n.id !== m.id)
          requireRule(
            distance(m, n) >= m.radius + n.radius - EPS,
            "Model bases overlap",
          );
    for (const t of s.terrain.filter((t) => t.solid))
      requireRule(
        !withinArea(m, t),
        "Model ends inside a solid terrain feature",
      );
  }
  if (["normal", "advance", "fallback", "escape"].includes(mode))
    requireRule(!isEngaged(s, u), "Move must end unengaged");
  u.movedDistance = Math.max(u.movedDistance, maxDistance);
}
function place(s: GameState, u: Unit, paths: Paths) {
  requireRule(
    paths.length === living(u).length &&
      new Set(paths.map((p) => p.modelId)).size === paths.length,
    "Place every living model exactly once",
  );
  const oldReserve = u.reserve;
  u.reserve = false;
  for (const p of paths) {
    requireRule(p.points.length === 1, "Setup uses one destination per model");
    const m = living(u).find((m) => m.id === p.modelId);
    requireRule(m, "Unknown setup model");
    Object.assign(m, p.points[0]);
  }
  applyPaths(s, u, [], 0, "fight");
  u.reserve = oldReserve;
}
function ingress(s: GameState, u: Unit, paths: Paths) {
  requireRule(s.round >= 2, "No ingress in battle round 1");
  place(s, u, paths);
  u.reserve = false;
  for (const m of living(u)) {
    if (!u.deepStrike)
      requireRule(
        Math.min(
          m.x + m.radius,
          m.y + m.radius,
          s.width - m.x + m.radius,
          s.height - m.y + m.radius,
        ) <=
          6 + EPS,
        "Ingress wholly within 6 inches of an edge",
      );
    requireRule(
      s.units
        .filter((t) => t.owner !== u.owner && !t.reserve)
        .every((t) => living(t).every((n) => edgeDistance(m, n) > 8 + EPS)),
      "Ingress must be more than 8 inches from enemies",
    );
    if (s.round < 3)
      requireRule(
        u.owner === 0
          ? m.x + m.radius < s.width - 6 - EPS
          : m.x - m.radius > 6 + EPS,
        "Round 2 ingress cannot enter enemy deployment zone",
      );
  }
  u.arrivedTurn = s.turnNumber;
  u.moved = "normal";
  u.movedDistance = 0;
}
function legalFighters(s: GameState) {
  return s.units.filter(
    (u) =>
      !u.reserve &&
      living(u).length &&
      !u.fought &&
      (isEngaged(s, u) || u.charged || s.fightEligible.includes(u.id)),
  );
}
function scheduleFighter(s: GameState, prefer: Player) {
  const all = legalFighters(s);
  const forced = all.find(
    (u) => u.oneShotUsed.includes("__counteroffensive") && !u.fought,
  );
  const first = forced
    ? [forced]
    : all.filter((u) => u.charged || u.fightsFirst);
  const pool = first.length ? first : all;
  if (pool.length)
    s.fightPlayer = pool.some((u) => u.owner === prefer)
      ? prefer
      : ((1 - prefer) as Player);
  return pool;
}
function applyStratagem(
  s: GameState,
  actor: Player,
  a: Extract<Action, { type: "stratagem" }>,
  dice: DiceSource,
) {
  const u = s.units.find((u) => u.id === a.unitId && u.owner === actor);
  requireRule(u && living(u).length, "Select your living unit");
  if (a.name === "commandReroll") {
    const p = s.pending;
    requireRule(
      p && p.unitId === u.id && actor === (p.player ?? s.turn) && !p.rerolled,
      "No eligible pending roll",
    );
    spend(s, actor, a.name, u.id, 1);
    const r = roll(
      dice,
      p.kind === "charge" ? 2 : 1,
      `${u.name} · Command Re-roll`,
    );
    p.distance =
      p.kind === "charge"
        ? Math.min(p.maxDistance ?? Infinity, r.total)
        : u.move + r.total;
    p.rerolled = true;
    log(
      s,
      `${u.name}: pending ${p.kind} rerolled to ${p.distance}`,
      "15:Command Re-roll",
      [r],
    );
    return;
  }
  requireRule(!s.pending, "Resolve pending movement first");
  if (a.name === "bravery") {
    requireRule(
      actor === s.turn && s.phase === "command" && s.commandPending,
      "Insane Bravery before Command battle-shock tests",
    );
    requireRule(
      !(s.stratagemUses ?? []).some(
        (x) => x.actor === actor && x.name === "bravery",
      ),
      "Insane Bravery is once per battle",
    );
    requireRule(
      u.shocked ||
        (u.startingStrength === 1
          ? living(u)[0].wounds <= living(u)[0].maxWounds / 2
          : living(u).length <= u.startingStrength / 2),
      "Unit does not require a battle-shock test",
    );
    spend(s, actor, a.name, u.id, 1);
    u.shocked = false;
  } else if (a.name === "grenade") {
    requireRule(
      actor === s.turn &&
        s.phase === "shooting" &&
        !s.reaction &&
        !u.reserve &&
        !isEngaged(s, u) &&
        u.moved !== "advance" &&
        u.moved !== "fallback" &&
        u.keywords?.some((k) => ["EXPLOSIVES", "GRENADES"].includes(k)),
      "Unit cannot use Grenades now",
    );
    const t = s.units.find(
      (t) =>
        t.id === a.targetId &&
        t.owner !== actor &&
        !t.reserve &&
        living(t).length,
    );
    requireRule(
      t &&
        !isEngaged(s, t) &&
        unitDistance(u, t) <= 8 + EPS &&
        living(u).some((m) => living(t).some((n) => modelVisible(s, m, t, n))),
      "Grenade target must be visible, unengaged and within 8 inches",
    );
    spend(s, actor, a.name, u.id, 1);
    const r = roll(dice, 6, `${u.name} · grenades`);
    const grenadeRolls = [r];
    mortalDamage(t, r.values.filter((n) => n >= 4).length, dice, grenadeRolls);
    log(s, `${u.name}: grenades resolved`, "15:Grenades", grenadeRolls);
  } else if (a.name === "rapidIngress") {
    requireRule(
      s.reaction?.player === actor &&
        s.reaction.kind === "movementEnd" &&
        u.reserve &&
        !u.keywords?.includes("AIRCRAFT"),
      "Rapid Ingress only at opponent Movement end",
    );
    spend(s, actor, a.name, u.id, 1);
    ingress(s, u, a.paths ?? []);
  } else if (a.name === "overwatch") {
    requireRule(
      s.reaction?.player === actor &&
        s.reaction.kind === "movementEnd" &&
        !u.reserve &&
        !isEngaged(s, u) &&
        !u.keywords?.includes("TITANIC"),
      "Overwatch only at opponent Movement end",
    );
    const t = s.units.find(
      (t) =>
        t.id === a.targetId &&
        t.owner !== actor &&
        !t.reserve &&
        living(t).length,
    );
    requireRule(
      t && unitDistance(u, t) <= 24 + EPS && !isEngaged(s, t),
      "Choose an unengaged enemy within 24 inches",
    );
    const w = u.weapons.find((w) => w.kind === "ranged");
    requireRule(w, "Unit has no ranged weapon");
    spend(s, actor, a.name, u.id, 1);
    const result = resolveCombat(
      s,
      u,
      t,
      { ...w, range: Math.min(24, w.range) },
      dice,
      { snap: true },
    );
    u.shotTurn = s.turnNumber;
    log(
      s,
      `${u.name}: Overwatch → ${t.name}, ${result.damage} damage`,
      "15:Fire Overwatch",
      result.rolls,
    );
  } else if (a.name === "smoke") {
    requireRule(
      s.reaction?.player === actor &&
        s.reaction.kind === "shootingStart" &&
        !u.reserve &&
        u.keywords?.includes("SMOKE"),
      "Smokescreen requires SMOKE at opponent Shooting start",
    );
    spend(s, actor, a.name, u.id, 1);
    (s.smokeUnits ??= []).push({ unitId: u.id, turn: s.turnNumber });
  } else if (a.name === "heroic") {
    requireRule(
      s.reaction?.player === actor &&
        s.reaction.kind === "chargeEnd" &&
        !u.reserve &&
        !isEngaged(s, u) &&
        u.moved !== "advance" &&
        u.moved !== "fallback" &&
        !u.oneShotUsed.includes("__chargeAttempt"),
      "Heroic Intervention only at opponent Charge end",
    );
    const targets = s.units.filter(
      (t) =>
        t.owner !== actor &&
        !t.reserve &&
        living(t).length &&
        (a.intoFray
          ? unitDistance(u, t) <= 6 + EPS
          : t.charged && unitDistance(u, t) <= 12 + EPS),
    );
    requireRule(targets.length, "No eligible Heroic Intervention target");
    spend(s, actor, a.name, u.id, a.intoFray ? 2 : 1);
    const r = roll(dice, 2, `${u.name} · heroic charge`);
    u.oneShotUsed.push("__chargeAttempt");
    s.pending = {
      kind: "charge",
      player: actor,
      unitId: u.id,
      distance: a.intoFray ? Math.min(6, r.total) : r.total,
      allowedTargets: targets.map((t) => t.id),
      ...(a.intoFray ? { maxDistance: 6 } : {}),
    };
    log(
      s,
      `${u.name}: Heroic Intervention charge ${s.pending.distance} inches`,
      "15:Heroic Intervention",
      [r],
    );
  } else if (a.name === "counteroffensive") {
    requireRule(
      s.reaction?.player === actor &&
        s.reaction.kind === "afterEnemyFight" &&
        s.turn !== actor &&
        !u.fought &&
        legalFighters(s).includes(u),
      "Counteroffensive requires an eligible fighter after enemy attacks",
    );
    spend(s, actor, a.name, u.id, 2);
    u.oneShotUsed.push("__counteroffensive");
    s.fightPlayer = actor;
  }
  log(s, `${u.name}: ${a.name}`, "15");
}
export function applyAction(
  original: GameState,
  actor: Player,
  action: Action,
  dice: DiceSource,
): GameState {
  return withDecisions(original, actor, action, dice, reduceAction);
}
function reduceAction(
  original: GameState,
  actor: Player,
  action: Action,
  dice: DiceSource,
  skipWindow = false,
): GameState {
  const s = structuredClone(original);
  s.events = [];
  requireRule(s.players[actor] !== null, "Player is not assigned");
  if (
    s.reaction &&
    !["passReaction", "stratagem", "resign", "commit"].includes(action.type)
  )
    throw new RuleError("Opponent reaction window must finish first");
  if (action.type === "passReaction") {
    const reaction = s.reaction;
    requireRule(!s.pending, "Resolve pending reaction movement first");
    requireRule(
      reaction && reaction.player === actor,
      "No reaction window for you",
    );
    delete s.reaction;
    if (reaction.advance)
      return reduceAction(s, s.turn, { type: "next" }, dice, true);
    log(s, "Reaction window closed", "15");
  } else if (action.type === "reserve" || action.type === "deploy") {
    requireRule(
      s.status === "lobby",
      "Deployment is only available before battle",
    );
    const u = s.units.find((u) => u.id === action.unitId && u.owner === actor);
    requireRule(u, "You do not control this unit");
    if (action.type === "reserve") {
      u.reserve = action.reserve;
      const roster = s.units.filter((v) => v.owner === actor);
      requireRule(
        roster
          .filter((v) => v.reserve)
          .reduce((n, v) => n + (v.points ?? 100), 0) <=
          roster.reduce((n, v) => n + (v.points ?? 100), 0) / 2,
        "Strategic Reserves exceed 50% of army points",
      );
    } else {
      requireRule(!u.reserve, "Return unit from reserves before deploying");
      place(s, u, action.paths);
      for (const m of living(u))
        requireRule(
          actor === 0
            ? m.x + m.radius <= 6 + EPS
            : m.x - m.radius >= s.width - 6 - EPS,
          "Deploy wholly within your deployment zone",
        );
      requireRule(!isEngaged(s, u), "Deployment must be unengaged");
    }
    log(
      s,
      `${u.name}: ${u.reserve ? "Strategic Reserves" : "deployed"}`,
      "20.01 / training:deployment",
    );
  } else if (action.type === "terrain") {
    requireRule(
      s.status === "lobby" && actor === 0,
      "Only the host can configure terrain before battle",
    );
    const t = action.terrain;
    requireRule(
      t.x + t.width <= s.width && t.y + t.height <= s.height,
      "Terrain crosses battlefield edge",
    );
    requireRule(
      !s.units.some((u) => living(u).some((m) => withinArea(m, t))),
      "Terrain overlaps a model",
    );
    const index = s.terrain.findIndex((v) => v.id === t.id);
    if (index < 0) {
      requireRule(s.terrain.length < 20, "Terrain limit reached");
      s.terrain.push(t);
    } else s.terrain[index] = t;
    log(s, `Terrain configured: ${t.name}`, "training:terrain agreement");
  } else if (action.type === "start") {
    requireRule(
      s.status === "lobby" && actor === 0 && s.players[1] !== null,
      "Host can start after both players join",
    );
    s.status = "active";
    command(s, dice);
    log(
      s,
      "Signal Control begins. Original training armies and mission.",
      "training:Signal Control",
    );
  } else {
    requireRule(s.status === "active", "Match is not active");
    if (action.type === "resign") {
      s.status = "finished";
      s.winner = (1 - actor) as Player;
      log(s, `${s.players[actor]} resigned`, "training:concession");
    } else if (action.type === "next") {
      requireRule(!s.pending, "Resolve the pending move before advancing");
      if (s.phase === "command" && s.commandPending) commandTests(s, dice);
      if (!skipWindow && (s.phase === "movement" || s.phase === "charge")) {
        requireRule(
          actor === s.turn,
          "Only the turn player can advance phases",
        );
        const kind = s.phase === "movement" ? "movementEnd" : "chargeEnd";
        const opponent = (1 - s.turn) as Player;
        if (s.cp[opponent] > 0) {
          s.reaction = { player: opponent, kind, advance: true };
          log(s, `${s.players[opponent]}: ${kind} reaction window`, "15");
          s.revision++;
          return s;
        }
      }
      if (s.phase === "fight") {
        requireRule(actor === s.fightPlayer, "Wait for the other player");
        if (s.fightStep === "combat") {
          requireRule(
            !legalFighters(s).length,
            "All eligible units must fight",
          );
          s.fightStep = "consolidate";
          s.fightPlayer = s.turn;
          s.fightPassed = [];
          log(s, "Consolidation moves: turn player first", "12.07");
        } else {
          s.fightPassed.push(actor);
          if (s.fightPassed.length === 1) {
            s.fightPlayer = (1 - s.turn) as Player;
          } else if (s.fightStep === "pile-in") {
            s.fightStep = "combat";
            s.fightEngagedStart = s.units
              .filter((u) => isEngaged(s, u))
              .map((u) => u.id);
            s.fightEligible = s.units
              .filter((u) => isEngaged(s, u) || u.charged)
              .map((u) => u.id);
            s.fightPassed = [];
            scheduleFighter(s, s.turn);
            log(s, "Fight step: resolve all eligible units", "12.04");
          } else {
            endTurn(s, dice);
          }
        }
      } else {
        requireRule(
          actor === s.turn,
          "Only the turn player can advance phases",
        );
        scoreObjectives(s);
        if (s.phase === "movement")
          for (const u of s.units.filter(
            (u) => u.owner === s.turn && living(u).length && !u.moved,
          )) {
            u.moved = "stationary";
            log(s, `${u.name} remains stationary`, "09.04");
          }
        s.phase = phases[phases.indexOf(s.phase) + 1];
        if (s.phase === "shooting" && s.cp[(1 - s.turn) as Player] > 0)
          s.reaction = {
            player: (1 - s.turn) as Player,
            kind: "shootingStart",
            advance: false,
          };
        log(s, `${s.phase} phase begins`, "07.02");
        if (s.phase === "fight") {
          s.fightStep = "pile-in";
          s.fightPlayer = s.turn;
          s.fightPassed = [];
        }
      }
    } else if (action.type === "stratagem") {
      applyStratagem(s, actor, action, dice);
    } else if (action.type === "orderEffects") {
      requireRule(
        new Set(action.ids).size === action.ids.length &&
          action.ids.every((id) =>
            s.effects.some(
              (e) =>
                e.id === id &&
                (e.owner ?? s.units.find((u) => u.id === e.unitId)?.owner) ===
                  actor,
            ),
          ),
        "Choose only your own effects, without duplicates",
      );
      (s.effectOrders ??= [[], []])[actor] = action.ids;
      log(
        s,
        `${s.players[actor]} chose effect order and optional effects`,
        "01.05",
      );
    } else if (action.type === "allocate") {
      const u = s.units.find(
        (v) => v.id === action.unitId && v.owner === actor,
      );
      requireRule(u, "You do not control this unit");
      const ids = action.modelIds;
      requireRule(
        ids.length === u.models.length &&
          new Set(ids).size === ids.length &&
          ids.every((id) => u.models.some((m) => m.id === id)),
        "Declare every model exactly once",
      );
      u.models = ids.map((id) => u.models.find((m) => m.id === id)!);
      log(s, `${u.name}: defender casualty priority updated`, "05.04");
    } else if (action.type === "ingress") {
      requireRule(
        actor === s.turn && s.phase === "movement" && !s.pending,
        "Ingress only in your Movement phase",
      );
      const u = s.units.find(
        (u) => u.id === action.unitId && u.owner === actor,
      );
      requireRule(
        u?.reserve && living(u).length,
        "Select your living reserved unit",
      );
      ingress(s, u, action.paths);
      log(s, `${u.name}: ingress complete`, "20.02");
    } else if (action.type === "move" || action.type === "advance") {
      requireRule(
        actor === s.turn && s.phase === "movement" && !s.pending,
        "Movement is only available in your Movement phase",
      );
      const u = unit(s, action.unitId, actor);
      requireRule(!u.moved, "Unit already selected to move");
      if (action.type === "advance") {
        requireRule(!isEngaged(s, u), "Engaged units cannot advance");
        const r = roll(dice, 1, `${u.name} · advance`);
        s.pending = {
          kind: "advance",
          unitId: u.id,
          distance: u.move + r.total,
        };
        log(
          s,
          `${u.name} advances up to ${s.pending.distance} inches`,
          "09.06",
          [r],
        );
      } else {
        if (action.mode === "stationary") {
          requireRule(
            action.paths.length === 0,
            "Stationary units cannot move",
          );
          u.moved = "stationary";
        } else {
          requireRule(
            action.mode === "fallback" ? isEngaged(s, u) : !isEngaged(s, u),
            action.mode === "fallback"
              ? "Fall back requires engagement"
              : "Engaged units cannot make normal moves",
          );
          requireRule(
            !(action.mode === "fallback" && u.shocked && !action.desperate),
            "Battle-shocked units must use desperate escape to fall back",
          );
          requireRule(
            !action.desperate || action.mode === "fallback",
            "Desperate escape is a Fall Back option",
          );
          const escape = action.mode === "fallback" && action.desperate;
          const count = living(u).length;
          applyPaths(
            s,
            u,
            action.paths,
            u.move,
            escape ? "escape" : action.mode,
          );
          u.moved = action.mode;
          if (escape) {
            const hazard = roll(
              dice,
              count,
              `${u.name} · desperate escape hazards`,
              0,
              { player: actor, unitId: u.id, kind: "hazard" },
            );
            const hazardRolls = [hazard];
            const lost = mortalDamage(
              u,
              hazard.values.filter((n) => n <= 2).length,
              dice,
              hazardRolls,
            );
            log(
              s,
              `${u.name}: desperate escape caused ${lost} mortal wounds`,
              "09.07",
              hazardRolls,
            );
            if (!u.shocked && living(u).length) {
              const shock = roll(
                dice,
                2,
                `${u.name} · desperate escape battle-shock`,
              );
              u.shocked = shock.total < u.leadership;
              log(
                s,
                `${u.name}: ${u.shocked ? "battle-shocked" : "leadership passed"}`,
                "09.06",
                [shock],
              );
            }
          }
        }
        log(s, `${u.name}: ${action.mode}`, "09");
      }
    } else if (action.type === "charge") {
      requireRule(
        actor === s.turn && s.phase === "charge" && !s.pending,
        "Charge only in your Charge phase",
      );
      const u = unit(s, action.unitId, actor);
      requireRule(
        !u.charged && !s.events.some((e) => e.message === u.id),
        "Already charged",
      );
      requireRule(
        !u.oneShotUsed.includes("__chargeAttempt"),
        "Unit already declared a charge this phase",
      );
      requireRule(
        !isEngaged(s, u) && u.moved !== "advance" && u.moved !== "fallback",
        "Unit cannot declare a charge",
      );
      requireRule(
        s.units.some(
          (t) => t.owner !== actor && unitDistance(u, t) <= 12 + EPS,
        ),
        "No enemy within 12 inches",
      );
      const r = roll(dice, 2, `${u.name} · charge`);
      s.pending = { kind: "charge", unitId: u.id, distance: r.total };
      u.oneShotUsed.push("__chargeAttempt");
      log(s, `${u.name} charge roll: ${r.total}`, "11.02", [r]);
    } else if (action.type === "commit") {
      requireRule(
        s.pending && actor === (s.pending.player ?? s.turn),
        "No pending move for you",
      );
      const p = s.pending;
      const u = unit(s, p.unitId, actor);
      if (p.kind === "advance") {
        requireRule(!action.decline, "An advance must resolve its move");
        applyPaths(s, u, action.paths, p.distance, "advance");
        u.moved = "advance";
        log(s, `${u.name} completed advance`, "09.06");
      } else if (!action.decline) {
        requireRule(p.distance > 2, "Double 1 cannot complete a charge");
        const targets = (action.targets ?? []).map((id) =>
          s.units.find((u) => u.id === id),
        );
        requireRule(
          targets.length > 0 && new Set(action.targets).size === targets.length,
          "Select distinct charge targets",
        );
        for (const t of targets)
          requireRule(
            t &&
              (!p.allowedTargets || p.allowedTargets.includes(t.id)) &&
              t.owner !== actor &&
              unitDistance(u, t) <= Math.min(12, p.distance) + EPS,
            "Charge target outside rolled distance",
          );
        const old = structuredClone(u);
        applyPaths(s, u, action.paths, p.distance, "charge");
        for (const m of living(u)) {
          const before = old.models.find((n) => n.id === m.id)!;
          const nearest = (model: Model) =>
            Math.min(
              ...targets.flatMap((t) =>
                living(t!).map((n) => edgeDistance(model, n)),
              ),
            );
          requireRule(
            nearest(m) < nearest(before) - EPS,
            "Every charging model must end closer to a target",
          );
          const possible = Math.max(0, nearest(before) - p.distance);
          requireRule(
            possible > 1 + EPS || nearest(m) <= 1 + EPS,
            "Charging model must end within 1 inch when reachable",
          );
          requireRule(
            possible > 2 + EPS || nearest(m) <= 2 + EPS,
            "Charging model must end engaged when reachable",
          );
        }
        for (const t of targets)
          requireRule(engaged(u, t!), "Charge must engage every target");
        for (const t of s.units.filter(
          (t) => t.owner !== actor && !action.targets?.includes(t.id),
        ))
          requireRule(!engaged(u, t), "Charge engages an undeclared target");
        u.charged = true;
        log(s, `${u.name} completed charge and gains Fights First`, "11.04");
      } else log(s, `${u.name} charge declined or failed`, "11.02");
      delete s.pending;
    } else if (action.type === "attack" || action.type === "volley") {
      requireRule(!s.pending, "Resolve pending movement first");
      s.effectActor = actor;
      const u = unit(s, action.unitId, actor);
      const pools =
        action.type === "volley"
          ? action.pools
          : [
              {
                targetId: action.targetId,
                weaponId: action.weaponId,
                allocations: undefined,
              },
            ];
      const declarations = pools.map((p) => {
        const t = s.units.find((t) => t.id === p.targetId);
        requireRule(
          t && !t.reserve && t.owner !== actor && living(t).length,
          "Select a living enemy target",
        );
        const w = u.weapons.find((w) => w.id === p.weaponId);
        requireRule(w, "Unknown weapon");
        if (s.phase === "shooting") {
          requireRule(
            actor === s.turn &&
              w.kind === "ranged" &&
              u.shotTurn !== s.turnNumber,
            "Unit cannot shoot now",
          );
          requireRule(
            u.moved !== "fallback",
            "Units that fell back cannot shoot",
          );
          requireRule(
            !isEngaged(s, t) ||
              (engaged(u, t) && !!w.abilities["close-quarters"]),
            "Cannot shoot at an engaged target",
          );
        } else {
          requireRule(
            s.phase === "fight" &&
              s.fightStep === "combat" &&
              w.kind === "melee",
            "Attack not allowed in this phase",
          );
          const pool = scheduleFighter(s, s.fightPlayer);
          requireRule(
            actor === s.fightPlayer && pool.some((x) => x.id === u.id),
            "Wrong fight activation or Fights First priority",
          );
          requireRule(engaged(u, t), "Melee target is not engaged");
        }
        return { p, t, w, targetCount: living(t).length };
      });
      if (action.type === "volley") {
        const used = new Map<string, number>();
        const normalMelee = new Map<string, string>();
        const rangedTargets = new Set<string>();
        for (const { p } of declarations)
          requireRule(
            new Set(p.allocations?.map((x) => x.modelId)).size ===
              p.allocations?.length,
            "Duplicate model in a declared pool",
          );
        for (const { p, t, w, targetCount } of declarations)
          for (const allocation of p.allocations ?? []) {
            const m = living(u).find((m) => m.id === allocation.modelId);
            requireRule(m, "Allocation contains unknown or destroyed model");
            requireRule(
              living(t).some((n) => edgeDistance(m, n) <= w.range + EPS),
              "Allocated model has no in-range target",
            );
            requireRule(
              w.kind === "melee" ||
                living(t).some((n) => modelVisible(s, m, t, n)),
              "Allocated model cannot see target",
            );
            const key = m.id + ":" + w.id;
            const splitTargets = new Set(
              declarations
                .filter(
                  (d) =>
                    d.w.id === w.id &&
                    d.p.allocations?.some((x) => x.modelId === m.id),
                )
                .map((d) => d.t.id),
            ).size;
            const max =
              w.attacks +
              (living(t).some((n) => edgeDistance(m, n) <= w.range / 2 + EPS)
                ? (w.abilities["rapid-fire"] ?? 0)
                : 0) +
              Math.floor(targetCount / 5) *
                (w.abilities.blast ??
                  (splitTargets === 1 ? (w.abilities.cleave ?? 0) : 0));
            const total = (used.get(key) ?? 0) + allocation.attacks;
            requireRule(
              total <= max,
              "Attack allocations exceed weapon attacks",
            );
            used.set(key, total);
            if (w.kind === "ranged") {
              requireRule(
                !rangedTargets.has(key) && allocation.attacks === max,
                "Each selected ranged weapon must declare its full pool against one target",
              );
              rangedTargets.add(key);
            } else if (!w.abilities["extra-attacks"]) {
              requireRule(
                !normalMelee.has(m.id) || normalMelee.get(m.id) === w.id,
                "A model selects one normal melee weapon",
              );
              normalMelee.set(m.id, w.id);
            }
          }
        const chosen = declarations.map((d) => d.w);
        if (chosen.some((w) => w.abilities["close-quarters"]))
          requireRule(
            chosen.every((w) => w.abilities["close-quarters"]),
            "Infantry cannot mix close-quarters and other ranged weapons",
          );
      }
      const hazards = new Set<string>();
      const once = new Set<string>();
      for (const { p, t, w, targetCount } of declarations) {
        if (!living(t).length) {
          log(
            s,
            `${u.name}: excess declared attacks against destroyed ${t.name} lost`,
            "05.07",
          );
          continue;
        }
        const result = resolveCombat(s, u, t, w, dice, {
          ...action,
          ...(p.allocations
            ? {
                allocations: p.allocations,
                targetCount,
                suppressHazard: true,
                suppressOneShot: true,
              }
            : {}),
        });
        if (p.allocations) {
          if (w.abilities.hazardous)
            for (const x of p.allocations) hazards.add(w.id + ":" + x.modelId);
          if (w.abilities["one-shot"]) once.add(w.id);
        }
        log(
          s,
          `${u.name} → ${t.name}: ${result.hits} hits, ${result.wounds} wounds, ${result.damage} damage, ${result.destroyed} destroyed`,
          "04–05",
          result.rolls,
        );
      }
      if (hazards.size) {
        const r = roll(dice, hazards.size, `${u.name} · hazards`, 0, {
          player: actor,
          unitId: u.id,
          kind: "hazard",
        });
        const rolls = [r];
        mortalDamage(u, r.values.filter((n) => n <= 2).length, dice, rolls);
        log(s, `${u.name}: hazardous weapons resolved`, "06.05", rolls);
      }
      u.oneShotUsed.push(...once);
      if (s.phase === "shooting") u.shotTurn = s.turnNumber;
      else {
        u.fought = true;
        scheduleFighter(s, (1 - actor) as Player);
        if (actor === s.turn && s.cp[(1 - actor) as Player] >= 2)
          s.reaction = {
            player: (1 - actor) as Player,
            kind: "afterEnemyFight",
            advance: false,
          };
      }
    } else if (action.type === "fightMove") {
      requireRule(
        s.phase === "fight" && actor === s.fightPlayer,
        "Not your fight movement step",
      );
      const u = unit(s, action.unitId, actor);
      const overrun = s.fightStep === "combat";
      const pile = s.fightStep !== "consolidate";
      if (overrun) {
        const pool = scheduleFighter(s, s.fightPlayer);
        requireRule(
          pool.some((v) => v.id === u.id) &&
            (!isEngaged(s, u) ||
              (!!s.fightEngagedStart && !s.fightEngagedStart.includes(u.id))) &&
            !u.oneShotUsed.includes("__overrun"),
          "Overrun requires an eligible fighter that is unengaged or began the fight step unengaged",
        );
      } else
        requireRule(
          pile ? !u.piled : !u.consolidated,
          "Unit already moved in this step",
        );
      requireRule(
        isEngaged(s, u) || u.charged || s.fightEligible.includes(u.id),
        "Unit not eligible for fight movement",
      );
      const old = structuredClone(u);
      const enemies = s.units.filter(
        (t) => !t.reserve && t.owner !== actor && living(t).length,
      );
      const eligibleTargets = isEngaged(s, u)
        ? enemies.filter((t) => engaged(u, t))
        : enemies.filter((t) => unitDistance(u, t) <= (pile ? 5 : 3) + EPS);
      const targets = action.targets?.length
        ? action.targets.map((id) => {
            const t = eligibleTargets.find((t) => t.id === id);
            requireRule(t, "Ineligible fight-move target");
            return t;
          })
        : eligibleTargets;
      const objective =
        !pile && !targets.length
          ? s.objectives.filter(
              (o) =>
                (!action.objectiveId || o.id === action.objectiveId) &&
                living(u).some(
                  (m) => distance(m, o) - m.radius - o.radius <= 3 + EPS,
                ),
            )[0]
          : undefined;
      if (overrun && !targets.length) {
        requireRule(
          action.paths.length === 0,
          "No overrun target within reach",
        );
        u.fought = true;
        u.oneShotUsed.push("__overrun");
        log(
          s,
          `${u.name}: no target within overrun reach; training pass`,
          "training:unreachable fight pass",
        );
        scheduleFighter(s, (1 - actor) as Player);
        s.revision++;
        return s;
      }
      requireRule(targets.length || objective, "No eligible fight-move target");
      applyPaths(s, u, action.paths, 3, "fight");
      for (const path of action.paths) {
        const m = u.models.find((m) => m.id === path.modelId)!;
        const before = old.models.find((m) => m.id === path.modelId)!;
        if (distance(m, before) <= EPS) continue;
        if (targets.length) {
          const nearest = (v: Model) =>
            Math.min(
              ...targets.flatMap((t) =>
                living(t).map((n) => edgeDistance(v, n)),
              ),
            );
          requireRule(
            nearest(before) > EPS,
            "Models in base contact cannot move",
          );
          requireRule(
            nearest(m) < nearest(before) - EPS,
            "Fight movement must approach closest target",
          );
          if (nearest(before) <= 5 + EPS)
            requireRule(
              nearest(m) <= 2 + EPS,
              "Fight movement must engage if reachable",
            );
          for (const t of enemies)
            if (living(t).some((n) => edgeDistance(before, n) <= 2 + EPS))
              requireRule(
                living(t).some((n) => edgeDistance(m, n) <= 2 + EPS),
                "Engaged model must remain engaged with its original enemy",
              );
        } else {
          requireRule(
            distance(m, objective!) < distance(before, objective!),
            "Move must approach objective",
          );
        }
      }
      if (pile) requireRule(isEngaged(s, u), "Pile in must end engaged");
      else if (objective) {
        requireRule(
          !isEngaged(s, u),
          "Objective consolidation must remain unengaged",
        );
        requireRule(
          living(u).some(
            (m) =>
              distance(m, objective) - m.radius - objective.radius <= 3 + EPS,
          ),
          "Consolidation must reach the objective",
        );
      } else
        for (const t of targets)
          requireRule(
            engaged(u, t),
            "Consolidation must engage selected enemies",
          );
      if (overrun) u.oneShotUsed.push("__overrun");
      else if (pile) u.piled = true;
      else u.consolidated = true;
      log(s, `${u.name}: ${s.fightStep}`, "12");
      if (!pile && s.units.some((t) => engaged(u, t) && !t.fought)) {
        s.fightStep = "combat";
        s.fightEligible.push(
          ...s.units.filter((t) => engaged(u, t)).map((t) => t.id),
        );
        s.fightPassed = [];
        scheduleFighter(s, (1 - actor) as Player);
      }
    }
  }
  s.revision++;
  delete s.effectActor;
  s.effects = s.effects.filter((e) => effectActive(s, e));
  return s;
}
export function addSecondPlayer(state: GameState, name: string, army: string) {
  requireRule(
    state.status === "lobby" && state.players[1] === null,
    "Room is full or already started",
  );
  const s = structuredClone(state);
  s.players[1] = name;
  s.armies[1] = army;
  s.units.push(...createUnits(1, army));
  s.revision++;
  return s;
}
