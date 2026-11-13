import type {
  Action,
  GameState,
  Player,
  Roll,
  RollMeta,
  StratagemUse,
} from "@tabletop/shared";
import type { DiceSource } from "./dice";
export function mayUse(
  s: GameState,
  actor: Player,
  name: string,
  unitId: string,
  cost: number,
) {
  const u = s.units.find((u) => u.id === unitId && u.owner === actor);
  return (
    !!u &&
    !u.shocked &&
    u.models.some((m) => m.wounds > 0) &&
    s.cp[actor] >= cost &&
    !(s.stratagemUses ?? []).some(
      (x) =>
        x.turn === s.turnNumber &&
        x.phase === s.phase &&
        x.actor === actor &&
        (x.name === name || x.unitId === unitId),
    )
  );
}
export function spend(
  s: GameState,
  actor: Player,
  name: string,
  unitId: string,
  cost: number,
) {
  if (!mayUse(s, actor, name, unitId, cost))
    throw Error(
      "Insufficient CP, battle-shocked target, or stratagem/unit already used this phase",
    );
  s.cp[actor] -= cost;
  const use: StratagemUse = {
    turn: s.turnNumber,
    phase: s.phase,
    actor,
    name,
    unitId,
  };
  (s.stratagemUses ??= []).push(use);
}
class PauseRoll {
  constructor(
    public roll: Roll,
    public meta: RollMeta,
  ) {}
}
export function withDecisions(
  original: GameState,
  actor: Player,
  action: Action,
  dice: DiceSource,
  reduce: (s: GameState, p: Player, a: Action, d: DiceSource) => GameState,
) {
  if (original.players[actor] === null) throw Error("Player is not assigned");
  if (action.type === "dicePolicy") {
    const s = structuredClone(original);
    (s.autoRolls ??= [true, true])[actor] = action.automatic;
    if (s.resolution)
      (s.resolution.original.autoRolls ??= [true, true])[actor] =
        action.automatic;
    s.revision++;
    s.events = [
      {
        kind: "rule",
        message: `${s.players[actor]} ${action.automatic ? "automatically accepts" : "reviews"} eligible dice`,
        rule: "training:dice preference",
      },
    ];
    return s;
  }
  const prior = original.resolution;
  if (action.type === "resign") {
    const s = structuredClone(original);
    delete s.resolution;
    return reduce(s, actor, action, dice);
  }
  if (!prior && action.type === "resolveRoll")
    throw Error("No dice decision pending");
  if (prior && action.type !== "resolveRoll")
    throw Error("Resolve the pending dice decision first");
  const task = prior
    ? structuredClone(prior)
    : {
        original: structuredClone(original),
        actor,
        action,
        tape: [] as number[],
        accepted: 0,
        overrides: {} as Record<number, Roll>,
        roll: undefined as unknown as Roll,
        meta: undefined as unknown as RollMeta,
      };
  if (prior) {
    if (actor !== task.meta.player)
      throw Error("Only the rolling player can decide");
    const choice = action as Extract<Action, { type: "resolveRoll" }>;
    if (choice.reroll) {
      spend(task.original, actor, "commandReroll", task.meta.unitId, 1);
      const r = structuredClone(task.roll);
      if (r.rerolled || task.meta.rerolled)
        throw Error("A roll cannot be rerolled twice");
      const old = [...r.values];
      if (task.meta.kind === "charge") r.values = r.values.map(() => dice());
      else {
        const i = choice.dieIndex ?? 0;
        if (i >= r.values.length) throw Error("Invalid die index");
        r.values[i] = dice();
      }
      if (r.values.some((n) => !Number.isInteger(n) || n < 1 || n > 6))
        throw Error("Invalid dice source");
      r.rerolled = old;
      r.total = r.values.reduce((a, b) => a + b, 0) + r.modifier;
      task.overrides[task.accepted] = r;
    }
    task.accepted++;
  }
  task.original.revision = original.revision;
  let position = 0,
    index = 0;
  const replay: DiceSource = () => {
    if (position === task.tape.length) task.tape.push(dice());
    return task.tape[position++];
  };
  replay.afterRoll = (r, meta) => {
    const i = index++;
    const overridden = task.overrides[i];
    if (overridden) return overridden;
    if (i < task.accepted) return r;
    if (
      meta &&
      meta.kind !== "other" &&
      !meta.rerolled &&
      task.original.autoRolls?.[meta.player] === false &&
      mayUse(task.original, meta.player, "commandReroll", meta.unitId, 1)
    )
      throw new PauseRoll(r, meta);
    task.accepted = i + 1;
    return r;
  };
  try {
    return reduce(task.original, task.actor, task.action, replay);
  } catch (e) {
    if (!(e instanceof PauseRoll)) throw e;
    const s = structuredClone(original);
    task.roll = e.roll;
    task.meta = e.meta;
    s.resolution = task;
    s.cp = [...task.original.cp];
    s.stratagemUses = task.original.stratagemUses;
    s.revision++;
    s.events = [
      {
        kind: "dice",
        message: `${s.players[e.meta.player]}: review ${e.roll.reason}`,
        rule: "15:Command Re-roll",
        rolls: [e.roll],
      },
    ];
    return s;
  }
}
