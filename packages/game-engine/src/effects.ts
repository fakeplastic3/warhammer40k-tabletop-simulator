import { phases } from "@tabletop/shared";
import type { GameState, TimedEffect, Player } from "@tabletop/shared";
export class DecisionRequired extends Error {
  constructor(public choices: string[]) {
    super(`Unresolved effect order: ${choices.join(", ")}`);
  }
}
function owner(s: GameState, e: TimedEffect): Player {
  return e.owner ?? s.units.find((u) => u.id === e.unitId)?.owner ?? s.turn;
}
export function effectActive(s: GameState, e: TimedEffect) {
  return (
    (e.expiresRevision === undefined || e.expiresRevision >= s.revision) &&
    (!e.until ||
      (e.until.turn >= s.turnNumber &&
        (e.until.phase === undefined ||
          e.until.turn !== s.turnNumber ||
          phases.indexOf(s.phase) <= phases.indexOf(e.until.phase))))
  );
}
export function effectsFor(
  s: GameState,
  event: string,
  unitId: string,
): TimedEffect[] {
  const active = s.effectActor ?? s.turn;
  const list = s.effects.filter(
    (e) =>
      e.event === event &&
      e.unitId === unitId &&
      effectActive(s, e) &&
      (!e.optional || s.effectOrders?.[owner(s, e)].includes(e.id)),
  );
  for (const a of list) {
    const conflicts = list.filter(
      (b) =>
        a.id !== b.id &&
        a.exclusiveKey &&
        b.exclusiveKey === a.exclusiveKey &&
        b.priority === a.priority,
    );
    if (conflicts.length) {
      const order = s.effectOrders?.[owner(s, a)] ?? [];
      if (
        ![a, ...conflicts].every(
          (e) => owner(s, e) === owner(s, a) && order.includes(e.id),
        )
      )
        throw new DecisionRequired([a.id, ...conflicts.map((b) => b.id)]);
    }
  }
  return list.sort((a, b) => {
    const oa = owner(s, a),
      ob = owner(s, b);
    const group = (e: TimedEffect, o: Player) =>
      (o === active ? 0 : 2) + (e.optional ? 1 : 0);
    const order = s.effectOrders?.[oa] ?? [];
    const rank = (id: string) =>
      order.includes(id) ? order.indexOf(id) : Number.MAX_SAFE_INTEGER;
    return (
      group(a, oa) - group(b, ob) ||
      a.priority - b.priority ||
      (oa === ob ? rank(a.id) - rank(b.id) : 0) ||
      a.id.localeCompare(b.id)
    );
  });
}
export function modifier(
  s: GameState,
  event: string,
  unitId: string,
  operation: TimedEffect["operation"],
) {
  return effectsFor(s, event, unitId)
    .filter((e) => e.operation === operation)
    .reduce((sum, e) => sum + e.value, 0);
}
