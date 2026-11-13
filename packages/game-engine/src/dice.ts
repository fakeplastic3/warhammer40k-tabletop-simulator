import type { Roll, RollMeta } from "@tabletop/shared";
export type DiceSource = (() => number) & {
  afterRoll?: (r: Roll, meta?: RollMeta) => Roll;
};
export function roll(
  dice: DiceSource,
  count: number,
  reason: string,
  modifier = 0,
  meta?: RollMeta,
): Roll {
  if (!Number.isInteger(count) || count < 1 || count > 1000)
    throw Error("Invalid dice count");
  const values = Array.from({ length: count }, () => {
    const n = dice();
    if (!Number.isInteger(n) || n < 1 || n > 6)
      throw Error("Invalid dice source");
    return n;
  });
  const r = {
    reason,
    values,
    modifier,
    total: values.reduce((a, b) => a + b, 0) + modifier,
  };
  return dice.afterRoll?.(r, meta) ?? r;
}
export function reroll(
  dice: DiceSource,
  previous: Roll,
  reason = previous.reason,
  meta?: RollMeta,
): Roll {
  if (previous.rerolled) throw Error("A roll cannot be rerolled twice");
  const r = roll(
    dice,
    previous.values.length,
    reason,
    previous.modifier,
    meta ? { ...meta, rerolled: true } : undefined,
  );
  return { ...r, rerolled: previous.values };
}
export function d3(dice: DiceSource) {
  return Math.ceil(roll(dice, 1, "D3").total / 2);
}
export function woundThreshold(strength: number, toughness: number) {
  return strength >= 2 * toughness
    ? 2
    : strength > toughness
      ? 3
      : strength === toughness
        ? 4
        : strength * 2 <= toughness
          ? 6
          : 5;
}
