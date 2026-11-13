"use client";
import { useEffect, useState } from "react";
import type { Action, GameState, Unit } from "@tabletop/shared";
type Pool = Extract<Action, { type: "volley" }>["pools"][number];
export default function AttackPlanner({
  state: s,
  unit: u,
  target,
  weapon,
  busy,
  enabled,
  send,
}: {
  state: GameState;
  unit: Unit;
  target: string;
  weapon: string;
  busy: boolean;
  enabled: boolean;
  send: (a: Action) => Promise<void>;
}) {
  const [model, setModel] = useState("all");
  const [attacks, setAttacks] = useState(1);
  const [pools, setPools] = useState<Pool[]>([]);
  const [lethal, setLethal] = useState(false);
  const [twinLinked, setTwinLinked] = useState(false);
  useEffect(() => {
    setPools([]);
    setModel("all");
  }, [u.id, s.phase, s.turnNumber]);
  const w = u.weapons.find((w) => w.id === weapon),
    t = s.units.find((t) => t.id === target);
  function add() {
    if (!w || !t) return;
    const allocations = u.models
      .filter((m) => m.wounds > 0 && (model === "all" || model === m.id))
      .flatMap((m) => {
        const distances = t.models
          .filter((n) => n.wounds > 0)
          .map((n) =>
            Math.max(0, Math.hypot(m.x - n.x, m.y - n.y) - m.radius - n.radius),
          );
        if (!distances.some((d) => d <= w!.range + 1e-7)) return [];
        const max =
          w!.attacks +
          (distances.some((d) => d <= w!.range / 2)
            ? (w!.abilities["rapid-fire"] ?? 0)
            : 0) +
          Math.floor(t.models.filter((n) => n.wounds > 0).length / 5) *
            (w!.abilities.blast ?? w!.abilities.cleave ?? 0);
        return [
          {
            modelId: m.id,
            attacks: w!.kind === "ranged" ? max : Math.min(attacks, max),
          },
        ];
      });
    if (allocations.length)
      setPools((p) => [...p, { weaponId: w.id, targetId: t.id, allocations }]);
  }
  return (
    <details className="attack-planner">
      <summary>Declare model / split attack pools</summary>
      <p className="hint">
        Choose weapon and target above, add each pool, then resolve the whole
        declaration. Ranged weapons use one target per model; melee attacks may
        split.
      </p>
      <label>
        Attacking models
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="all">All models in range</option>
          {u.models
            .filter((m) => m.wounds > 0)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
        </select>
      </label>
      {w?.kind === "melee" && (
        <label>
          Attacks per model
          <input
            type="number"
            min={1}
            max={100}
            value={attacks}
            onChange={(e) => setAttacks(Number(e.target.value))}
          />
        </label>
      )}
      <button
        disabled={!enabled || busy || !target || pools.length >= 30}
        onClick={add}
      >
        ADD DECLARED POOL
      </button>
      <ol>
        {pools.map((p, i) => (
          <li key={i}>
            {p.weaponId} → {p.targetId}:{" "}
            {p.allocations.reduce((n, a) => n + a.attacks, 0)} attacks{" "}
            <button
              onClick={() => setPools((p) => p.filter((_, j) => i !== j))}
            >
              REMOVE
            </button>
          </li>
        ))}
      </ol>
      <label className="check">
        <input
          type="checkbox"
          checked={lethal}
          onChange={(e) => setLethal(e.target.checked)}
        />
        Use optional Lethal Hits if weapon has it
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={twinLinked}
          onChange={(e) => setTwinLinked(e.target.checked)}
        />
        Use optional Twin-linked failed-wound rerolls
      </label>
      <button
        disabled={!enabled || busy || !pools.length}
        onClick={() =>
          void send({
            type: "volley",
            unitId: u.id,
            pools,
            lethal,
            twinLinked,
          }).then(() => setPools([]))
        }
      >
        RESOLVE DECLARED POOLS
      </button>
    </details>
  );
}
