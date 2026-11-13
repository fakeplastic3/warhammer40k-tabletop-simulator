import type { GameState, Unit, Weapon, Model, Roll } from "@tabletop/shared";
import {
  living,
  edgeDistance,
  modelVisible,
  covered,
  isEngaged,
} from "./geometry";
import { roll, reroll, woundThreshold, type DiceSource } from "./dice";
import { modifier } from "./effects";
export function damageModel(model: Model, damage: number) {
  const n = Math.min(model.wounds, damage);
  model.wounds -= n;
  return n;
}
function suffer(
  unit: Unit,
  model: Model,
  amount: number,
  dice?: DiceSource,
  rolls: Roll[] = [],
) {
  let lost = 0;
  for (let i = 0; i < amount && model.wounds > 0; i++) {
    if (unit.feelNoPain && dice) {
      const r = roll(dice, 1, `${unit.name} · Feel No Pain`);
      rolls.push(r);
      if (r.total >= unit.feelNoPain) continue;
    }
    lost += damageModel(model, 1);
  }
  return lost;
}
export function mortalDamage(
  unit: Unit,
  amount: number,
  dice?: DiceSource,
  rolls: Roll[] = [],
) {
  let actual = 0;
  for (let i = 0; i < amount; i++) {
    const m = living(unit).sort(
      (a, b) =>
        (a.wounds < a.maxWounds ? -1 : 0) - (b.wounds < b.maxWounds ? -1 : 0),
    )[0];
    if (!m) break;
    actual += suffer(unit, m, 1, dice, rolls);
  }
  return actual;
}
export function resolveCombat(
  s: GameState,
  a: Unit,
  t: Unit,
  w: Weapon,
  dice: DiceSource,
  options: {
    lethal?: boolean;
    twinLinked?: boolean;
    snap?: boolean;
    shootingType?: "normal" | "assault" | "close-quarters" | "indirect";
    ignorePsychicModifiers?: boolean;
    allocations?: { modelId: string; attacks: number }[];
    targetCount?: number;
    suppressHazard?: boolean;
    suppressOneShot?: boolean;
  } = {},
) {
  const rolls: Roll[] = [];
  let hitCount = 0,
    woundCount = 0,
    damage = 0;
  const saves: { value: number; damage: number }[] = [];
  const devastating: number[] = [];
  const initialCount = living(t).length;
  const targetCount = options.targetCount ?? initialCount;
  if (a.reserve || t.reserve)
    throw Error("Off-table units cannot attack or be targeted");
  const indirect = options.shootingType === "indirect";
  if (
    indirect &&
    (!w.abilities["indirect-fire"] ||
      w.abilities.torrent ||
      isEngaged(s, a) ||
      a.moved === "advance" ||
      a.moved === "fallback")
  )
    throw Error("Invalid Indirect Shooting selection");
  const spotted =
    a.moved === "stationary" &&
    s.units.some(
      (u) =>
        u.owner === a.owner &&
        !u.reserve &&
        living(u).some((m) => living(t).some((n) => modelVisible(s, m, t, n))),
    );
  const shooters = living(a).filter(
    (m) =>
      (!options.allocations ||
        options.allocations.some((x) => x.modelId === m.id)) &&
      living(t).some((n) => edgeDistance(m, n) <= w.range + 1e-7) &&
      (w.kind === "melee" ||
        indirect ||
        living(t).some((n) => modelVisible(s, m, t, n))),
  );
  if (!shooters.length)
    throw Error("No model has an eligible target in range and visibility");
  if (w.kind === "ranged" && a.moved === "advance" && !w.abilities.assault)
    throw Error("Only ASSAULT weapons may shoot after advancing");
  if (w.kind === "ranged" && isEngaged(s, a) && !w.abilities["close-quarters"])
    throw Error("Engaged infantry require CLOSE-QUARTERS weapons");
  if (w.abilities["one-shot"] && a.oneShotUsed.includes(w.id))
    throw Error("One-shot weapon already used");
  for (const m of shooters) {
    const half = living(t).some(
      (n) => edgeDistance(m, n) <= w.range / 2 + 1e-7,
    );
    const attacks =
      options.allocations?.find((x) => x.modelId === m.id)?.attacks ??
      w.attacks +
        (half ? (w.abilities["rapid-fire"] ?? 0) : 0) +
        Math.floor(targetCount / 5) *
          (w.abilities.blast ?? w.abilities.cleave ?? 0);
    let autoWounds = 0;
    let woundDice = 0;
    for (let i = 0; i < attacks; i++) {
      if (w.abilities.torrent && !options.snap) {
        hitCount++;
        woundDice++;
        continue;
      }
      const h = roll(dice, 1, `${a.name} · ${w.name} · hit`, 0, {
        player: a.owner,
        unitId: a.id,
        kind: indirect ? "other" : "hit",
      });
      rolls.push(h);
      const n = h.total;
      const rawHitMod =
        modifier(s, "beforeAttack", a.id, "hit-modifier") +
        (w.abilities.heavy &&
        s.phase === "shooting" &&
        s.turn === a.owner &&
        a.arrivedTurn !== s.turnNumber &&
        !isEngaged(s, a) &&
        a.movedDistance <= 3
          ? 1
          : 0);
      const rawSkill =
        w.skill +
        (w.kind === "ranged" &&
        (indirect || covered(s, m, t)) &&
        !w.abilities["ignores-cover"]
          ? 1
          : 0);
      const hitMod =
        w.abilities.psychic && options.ignorePsychicModifiers ? 0 : rawHitMod;
      const skill =
        w.abilities.psychic && options.ignorePsychicModifiers
          ? w.skill
          : rawSkill;
      if (
        options.snap
          ? n !== 6
          : (indirect && n < (spotted ? 4 : 6)) ||
            n === 1 ||
            (n !== 6 && n + hitMod < skill)
      )
        continue;
      hitCount++;
      if (
        !options.snap &&
        n === 6 &&
        w.abilities["lethal-hits"] &&
        options.lethal
      )
        autoWounds++;
      else woundDice++;
      if (!options.snap && n === 6 && w.abilities["sustained-hits"]) {
        hitCount += w.abilities["sustained-hits"];
        woundDice += w.abilities["sustained-hits"];
      }
    }
    for (let i = 0; i < woundDice; i++) {
      let r = roll(dice, 1, `${a.name} · wound`, 0, {
        player: a.owner,
        unitId: a.id,
        kind: "wound",
      });
      rolls.push(r);
      const threshold = woundThreshold(w.strength, t.toughness);
      const wm =
        modifier(s, "afterHit", a.id, "wound-modifier") +
        (w.abilities.lance && a.charged ? 1 : 0);
      const critical = (n: number) =>
        n === 6 ||
        (!!w.abilities.anti &&
          !!t.keywords?.includes(w.abilities.anti.keyword) &&
          n >= w.abilities.anti.threshold);
      const succeeds = (n: number) =>
        n !== 1 && (critical(n) || n + wm >= threshold);
      if (
        !r.rerolled &&
        !succeeds(r.total) &&
        w.abilities["twin-linked"] &&
        options.twinLinked
      ) {
        r = reroll(dice, r, r.reason, {
          player: a.owner,
          unitId: a.id,
          kind: "wound",
        });
        rolls.push(r);
      }
      if (!succeeds(r.total)) continue;
      woundCount++;
      const d = w.damage + (half ? (w.abilities.melta ?? 0) : 0);
      if (critical(r.total) && w.abilities["devastating-wounds"])
        devastating.push(d);
      else {
        const save = roll(dice, 1, `${t.name} · save`, 0, {
          player: t.owner,
          unitId: t.id,
          kind: "save",
        });
        rolls.push(save);
        saves.push({ value: save.total, damage: d });
      }
    }
    for (let i = 0; i < autoWounds; i++) {
      woundCount++;
      const save = roll(dice, 1, `${t.name} · save`, 0, {
        player: t.owner,
        unitId: t.id,
        kind: "save",
      });
      rolls.push(save);
      saves.push({
        value: save.total,
        damage: w.damage + (half ? (w.abilities.melta ?? 0) : 0),
      });
    }
  }
  // Supported armies have homogeneous profiles; defender declares casualty order in model array order.
  for (const attack of saves.sort(
    (a, b) => a.damage - b.damage || a.value - b.value,
  )) {
    const save = attack.value;
    const target = living(t).sort(
      (a, b) =>
        (a.wounds < a.maxWounds ? -1 : 0) - (b.wounds < b.maxWounds ? -1 : 0),
    )[0];
    if (!target) break;
    const saved =
      save !== 1 &&
      ((t.invulnerable !== undefined && save >= t.invulnerable) ||
        save + w.ap >= t.save);
    if (!saved) damage += suffer(t, target, attack.damage, dice, rolls);
  }
  for (const d of devastating) {
    const target = living(t).sort(
      (a, b) =>
        (a.wounds < a.maxWounds ? -1 : 0) - (b.wounds < b.maxWounds ? -1 : 0),
    )[0];
    if (target) damage += suffer(t, target, d, dice, rolls);
  }
  if (w.abilities.hazardous && !options.suppressHazard) {
    const r = roll(dice, shooters.length, `${a.name} · hazard`, 0, {
      player: a.owner,
      unitId: a.id,
      kind: "hazard",
    });
    rolls.push(r);
    mortalDamage(
      a,
      r.values.filter((n) => n <= 2).length *
        (a.keywords?.some((k) => ["MONSTER", "VEHICLE"].includes(k)) ? 3 : 1),
      dice,
      rolls,
    );
  }
  if (w.abilities["one-shot"] && !options.suppressOneShot)
    a.oneShotUsed.push(w.id);
  return {
    rolls,
    hits: hitCount,
    wounds: woundCount,
    damage,
    destroyed: initialCount - living(t).length,
  };
}
