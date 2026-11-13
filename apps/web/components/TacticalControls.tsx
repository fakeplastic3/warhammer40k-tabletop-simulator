"use client";
import { useState } from "react";
import type { Action, GameState, Player, Point } from "@tabletop/shared";
export default function TacticalControls({
  state: s,
  seat,
  selected,
  target,
  paths,
  busy,
  send,
}: {
  state: GameState;
  seat: Player;
  selected: string;
  target: string;
  paths: { modelId: string; points: Point[] }[];
  busy: boolean;
  send: (a: Action) => Promise<void>;
}) {
  const [dieIndex, setDieIndex] = useState(0);
  const [intoFray, setIntoFray] = useState(false);
  const u = s.units.find((v) => v.id === selected && v.owner === seat);
  const decision = s.resolution;
  const reaction = s.reaction;
  const play = (a: Action) => void send(a);
  if (decision)
    return (
      <section className="tactical-panel" aria-label="Dice decision">
        <h3>Dice decision · {s.players[decision.meta.player]}</h3>
        <p>
          {decision.roll.reason}: {decision.roll.values.join(" + ")} ={" "}
          {decision.roll.total}
        </p>
        {decision.meta.player === seat ? (
          <>
            <label>
              Die to reroll
              <select
                aria-label="Die to reroll"
                value={dieIndex}
                onChange={(e) => setDieIndex(Number(e.target.value))}
              >
                {decision.roll.values.map((v, i) => (
                  <option key={i} value={i}>
                    Die {i + 1}: {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() => play({ type: "resolveRoll", reroll: false })}
              >
                ACCEPT ROLL
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  play({ type: "resolveRoll", reroll: true, dieIndex })
                }
              >
                COMMAND RE-ROLL · 1 CP
              </button>
            </div>
            <p className="hint">
              Charge rerolls replace both dice. No later rolls have been
              generated.
            </p>
          </>
        ) : (
          <p>Waiting for the rolling commander.</p>
        )}
      </section>
    );
  return (
    <section className="tactical-panel" aria-label="Tactical choices">
      <h3>
        {reaction
          ? `${s.players[reaction.player]} · reaction window`
          : "TACTICAL CHOICES"}
      </h3>
      {reaction && (
        <p className="hint">
          {reaction.kind === "movementEnd"
            ? "End of opponent Movement: Rapid Ingress or Overwatch."
            : reaction.kind === "shootingStart"
              ? "Start of opponent Shooting: Smokescreen."
              : reaction.kind === "chargeEnd"
                ? "End of opponent Charge: Heroic Intervention."
                : "After enemy attacks: Counteroffensive."}
        </p>
      )}
      {u && s.status === "lobby" && (
        <>
          <button
            disabled={busy}
            onClick={() =>
              play({ type: "reserve", unitId: u.id, reserve: !u.reserve })
            }
          >
            {u.reserve
              ? "RETURN TO DEPLOYMENT"
              : "PLACE IN RESERVES · 100 POINTS"}
          </button>
          {!u.reserve && (
            <button
              disabled={busy || !paths.length}
              onClick={() => play({ type: "deploy", unitId: u.id, paths })}
            >
              DEPLOY PLANNED POSITIONS
            </button>
          )}
          <p className="hint">
            Maximum 50% of original army points in reserves. Deploy wholly
            within your 6-inch edge zone.
          </p>
        </>
      )}
      {u && s.status === "active" && (
        <>
          {u.reserve &&
            s.phase === "movement" &&
            s.turn === seat &&
            !reaction && (
              <button
                disabled={busy || !paths.length}
                onClick={() => play({ type: "ingress", unitId: u.id, paths })}
              >
                INGRESS PLANNED POSITIONS
              </button>
            )}
          {!reaction &&
            s.phase === "command" &&
            s.turn === seat &&
            s.commandPending && (
              <button
                disabled={busy || s.cp[seat] < 1}
                onClick={() =>
                  play({ type: "stratagem", name: "bravery", unitId: u.id })
                }
              >
                INSANE BRAVERY · 1 CP / ONCE
              </button>
            )}
          {!reaction &&
            s.phase === "shooting" &&
            s.turn === seat &&
            !u.reserve && (
              <button
                disabled={busy || !target || s.cp[seat] < 1}
                onClick={() =>
                  play({
                    type: "stratagem",
                    name: "grenade",
                    unitId: u.id,
                    targetId: target,
                  })
                }
              >
                GRENADES · 1 CP
              </button>
            )}
          {s.pending?.unitId === u.id &&
            (s.pending.player ?? s.turn) === seat &&
            !s.pending.rerolled && (
              <button
                disabled={busy || s.cp[seat] < 1}
                onClick={() =>
                  play({
                    type: "stratagem",
                    name: "commandReroll",
                    unitId: u.id,
                  })
                }
              >
                RE-ROLL {s.pending.kind.toUpperCase()} · 1 CP
              </button>
            )}
          {reaction?.player === seat && (
            <>
              {reaction.kind === "movementEnd" &&
                (u.reserve ? (
                  <button
                    disabled={busy || !paths.length || s.round < 2}
                    onClick={() =>
                      play({
                        type: "stratagem",
                        name: "rapidIngress",
                        unitId: u.id,
                        paths,
                      })
                    }
                  >
                    RAPID INGRESS · 1 CP
                  </button>
                ) : (
                  <button
                    disabled={busy || !target}
                    onClick={() =>
                      play({
                        type: "stratagem",
                        name: "overwatch",
                        unitId: u.id,
                        targetId: target,
                      })
                    }
                  >
                    FIRE OVERWATCH · 1 CP
                  </button>
                ))}
              {reaction.kind === "shootingStart" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    play({ type: "stratagem", name: "smoke", unitId: u.id })
                  }
                >
                  SMOKESCREEN · 1 CP
                </button>
              )}
              {reaction.kind === "chargeEnd" && (
                <>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={intoFray}
                      onChange={(e) => setIntoFray(e.target.checked)}
                    />
                    Into the Fray · +1 CP, 6-inch limit
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      play({
                        type: "stratagem",
                        name: "heroic",
                        unitId: u.id,
                        intoFray,
                      })
                    }
                  >
                    HEROIC INTERVENTION · {intoFray ? 2 : 1} CP
                  </button>
                </>
              )}
              {reaction.kind === "afterEnemyFight" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    play({
                      type: "stratagem",
                      name: "counteroffensive",
                      unitId: u.id,
                    })
                  }
                >
                  COUNTEROFFENSIVE · 2 CP
                </button>
              )}
            </>
          )}
          {!reaction && !s.pending && (
            <label>
              First casualty (wounded models still take priority)
              <select
                aria-label="First casualty"
                value={u.models[0].id}
                onChange={(e) =>
                  play({
                    type: "allocate",
                    unitId: u.id,
                    modelIds: [
                      e.target.value,
                      ...u.models
                        .map((m) => m.id)
                        .filter((id) => id !== e.target.value),
                    ],
                  })
                }
              >
                {u.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} · {m.wounds} wounds
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      {s.effects.some(
        (e) =>
          (e.owner ?? s.units.find((u) => u.id === e.unitId)?.owner) === seat,
      ) && (
        <details>
          <summary>Effect order and optional choices</summary>
          {s.effects
            .filter(
              (e) =>
                (e.owner ?? s.units.find((u) => u.id === e.unitId)?.owner) ===
                seat,
            )
            .map((e) => (
              <div key={e.id}>
                <p>
                  {e.id} · {e.event} · {e.optional ? "optional" : "mandatory"}
                </p>
                {e.optional && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={s.effectOrders?.[seat].includes(e.id) ?? false}
                      onChange={(event) => {
                        const order = s.effectOrders?.[seat] ?? [];
                        play({
                          type: "orderEffects",
                          ids: event.target.checked
                            ? [...order.filter((id) => id !== e.id), e.id]
                            : order.filter((id) => id !== e.id),
                        });
                      }}
                    />
                    Choose optional effect
                  </label>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    play({
                      type: "orderEffects",
                      ids: [
                        e.id,
                        ...(s.effectOrders?.[seat] ?? []).filter(
                          (id) => id !== e.id,
                        ),
                      ],
                    })
                  }
                >
                  RESOLVE FIRST WITHIN PRIORITY
                </button>
              </div>
            ))}
        </details>
      )}
      {reaction?.player === seat && (
        <button
          className="primary"
          disabled={busy || !!s.pending}
          onClick={() => play({ type: "passReaction" })}
        >
          FINISH REACTIONS
        </button>
      )}
    </section>
  );
}
