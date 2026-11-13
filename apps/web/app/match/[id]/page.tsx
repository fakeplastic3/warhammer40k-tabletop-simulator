"use client";
import { use, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { io, Socket } from "socket.io-client";
import { armies, rulesReference } from "@tabletop/game-data";
import {
  phases,
  type Action,
  type ActionResponse,
  type GameState,
  type Player,
  type Point,
  type RoomResponse,
} from "@tabletop/shared";
import { api, API, ensureSession, token } from "../../../components/api";
import AttackPlanner from "../../../components/AttackPlanner";
import TacticalControls from "../../../components/TacticalControls";
import TerrainEditor from "../../../components/TerrainEditor";
import type { Paths } from "../../../components/Battlefield";
const Battlefield = dynamic(() => import("../../../components/Battlefield"), {
  ssr: false,
  loading: () => (
    <div className="battlefield">Initializing tactical display…</div>
  ),
});
export default function Match({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<GameState>();
  const [seat, setSeat] = useState<Player>(0);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState("Commander");
  const [army, setArmy] = useState("sentinels");
  const [invite, setInvite] = useState("");
  const [selected, setSelected] = useState("p0-u0");
  const [modelId, setModelId] = useState("p0-u0-m0");
  const [paths, setPaths] = useState<Paths>([]);
  const [x, setX] = useState("5");
  const [y, setY] = useState("8");
  const [individual, setIndividual] = useState(false);
  const [append, setAppend] = useState(false);
  const [target, setTarget] = useState("");
  const [weapon, setWeapon] = useState("carbine");
  const [mode, setMode] = useState<"normal" | "fallback">("normal");
  const [desperate, setDesperate] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState(false);
  const [settings, setSettings] = useState(false);
  const [grid, setGrid] = useState(true);
  const [measure, setMeasure] = useState(false);
  const [log, setLog] = useState<
    { revision: number; events: GameState["events"] }[]
  >([]);
  const socket = useRef<Socket | null>(null);
  const latest = useRef<GameState | undefined>(undefined);
  const seen = useRef(new Set<number>());
  function accept(s: GameState) {
    if (latest.current && s.revision < latest.current.revision) return;
    latest.current = s;
    setState(s);
    if (!seen.current.has(s.revision)) {
      seen.current.add(s.revision);
      setLog((l) =>
        [...l, { revision: s.revision, events: s.events }].sort(
          (a, b) => a.revision - b.revision,
        ),
      );
    }
  }
  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const incoming =
      fragment.get("invite") ?? sessionStorage.getItem(`invite-${id}`) ?? "";
    setInvite(incoming);
    if (incoming) {
      sessionStorage.setItem(`invite-${id}`, incoming);
      history.replaceState(null, "", location.pathname);
    }
    if (!token()) {
      setJoining(true);
      return;
    }
    api<RoomResponse>(`/matches/${id}`)
      .then((r) => {
        accept(r.state);
        setSeat(r.seat);
        setSelected(`p${r.seat}-u0`);
        setModelId(`p${r.seat}-u0-m0`);
      })
      .catch((e) => {
        if (incoming) setJoining(true);
        else setError(e.message);
      });
  }, [id]);
  useEffect(() => {
    if (!state || !token()) return;
    const s = io(API, {
      auth: { token: token() },
      transports: ["websocket", "polling"],
    });
    socket.current = s;
    s.on("connect", () => {
      s.emit("subscribe", id, (r: RoomResponse & ActionResponse) => {
        if (r.ok) {
          setConnected(true);
          accept(r.state);
          setSeat(r.seat);
        } else setError(r.error ?? "Subscription failed");
      });
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (e) => {
      setConnected(false);
      setError(e.message);
    });
    s.on("state", accept);
    api<{ revision: number; events: GameState["events"] }[]>(
      `/matches/${id}/history`,
    )
      .then((items) => {
        for (const i of items) seen.current.add(i.revision);
        setLog(items);
      })
      .catch((e) => setError(e.message));
    return () => {
      s.disconnect();
      socket.current = null;
    };
  }, [id, !!state]);
  const unit = state?.units.find((u) => u.id === selected);
  const model = unit?.models.find((m) => m.id === modelId);
  const own = unit?.owner === seat;
  const canAct =
    state?.status === "active" &&
    !state.reaction &&
    !state.resolution &&
    (state.phase === "fight"
      ? state.fightPlayer === seat
      : state.turn === seat);
  const enemies =
    state?.units.filter(
      (u) =>
        !u.reserve && u.owner !== seat && u.models.some((m) => m.wounds > 0),
    ) ?? [];
  async function join() {
    setBusy(true);
    try {
      await ensureSession(name);
      const r = await api<RoomResponse>(`/matches/${id}/join`, {
        invite,
        army,
      });
      accept(r.state);
      setSeat(r.seat);
      setSelected(`p${r.seat}-u0`);
      setModelId(`p${r.seat}-u0-m0`);
      setJoining(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(action: Action) {
    if (!state || busy) return;
    setBusy(true);
    setError("");
    const envelope = {
      id: crypto.randomUUID(),
      revision: latest.current!.revision,
      action,
    };
    try {
      const result =
        connected && socket.current
          ? await new Promise<ActionResponse>((resolve, reject) =>
              socket
                .current!.timeout(10000)
                .emit(
                  "action",
                  { matchId: id, envelope },
                  (err: Error | null, response: ActionResponse) =>
                    err
                      ? reject(
                          Error(
                            "Action acknowledgement timed out. Refresh to inspect the saved state before retrying.",
                          ),
                        )
                      : resolve(response),
                ),
            )
          : await api<ActionResponse>(`/matches/${id}/actions`, envelope);
      if (!result.ok) throw Error(result.error);
      if (result.state) accept(result.state);
      setPaths([]);
    } catch (e) {
      setError((e as Error).message);
      api<RoomResponse>(`/matches/${id}`)
        .then((r) => accept(r.state))
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function select(u: string, m: string) {
    const found = state?.units.find((v) => v.id === u);
    if (found?.owner !== seat) {
      setTarget(u);
      return;
    }
    setSelected(u);
    setModelId(m);
    const a = found.models.find((v) => v.id === m)!;
    setX(String(a.x));
    setY(String(a.y));
    if (u !== selected) setPaths([]);
  }
  function preview(p: Point) {
    if (!unit || !model || !own) return;
    setX(String(p.x));
    setY(String(p.y));
    const prior = paths
      .find((path) => path.modelId === model.id)
      ?.points.at(-1);
    const origin = append && prior ? prior : model;
    const dx = p.x - origin.x,
      dy = p.y - origin.y;
    setPaths((prev) => {
      const next = individual ? [...prev] : [];
      for (const m of unit.models.filter(
        (m) => m.wounds > 0 && (individual ? m.id === modelId : true),
      )) {
        const old = prev.find((path) => path.modelId === m.id);
        const start = append && old ? old.points.at(-1)! : m;
        const point = { x: start.x + dx, y: start.y + dy };
        const path = {
          modelId: m.id,
          points: append && old ? [...old.points, point] : [point],
        };
        const idx = next.findIndex((p) => p.modelId === m.id);
        if (idx < 0) next.push(path);
        else next[idx] = path;
      }
      return next;
    });
  }
  function submitMovement() {
    if (!unit || !state) return;
    if (state.pending)
      send({ type: "commit", paths, targets: target ? [target] : [] });
    else if (unit.reserve) send({ type: "ingress", unitId: unit.id, paths });
    else if (state.status === "lobby")
      send({ type: "deploy", unitId: unit.id, paths });
    else if (state.phase === "fight")
      send({ type: "fightMove", unitId: unit.id, paths });
    else
      send({
        type: "move",
        unitId: unit.id,
        mode,
        desperate: mode === "fallback" && desperate,
        paths,
      });
  }
  useEffect(() => {
    if (unit) {
      const preferred = unit.weapons.find(
        (w) => w.kind === (state?.phase === "fight" ? "melee" : "ranged"),
      );
      if (preferred) setWeapon(preferred.id);
    }
  }, [unit?.id, state?.phase]);
  const distancePreview = unit
    ? Math.max(
        0,
        ...paths.map((p) => {
          const m = unit.models.find((m) => m.id === p.modelId)!;
          let last: Point = m,
            total = 0;
          for (const pt of p.points) {
            total += Math.hypot(last.x - pt.x, last.y - pt.y);
            last = pt;
          }
          return total;
        }),
      )
    : 0;
  const limit =
    state?.pending?.distance ??
    (state?.phase === "fight" ? 3 : (unit?.move ?? 0));
  const previewInvalid = distancePreview > limit + 1e-7;
  if (joining)
    return (
      <main className="join-screen">
        <a className="wordmark" href="/">
          ◈ VOIDLINE
        </a>
        <div className="join-box">
          <p className="eyebrow">INCOMING TRANSMISSION</p>
          <h1>Join the engagement.</h1>
          <p>
            Signal Control · original training mission · five rounds · 5 VP per
            controlled objective each round. Limited rules coverage, original
            infantry only.
          </p>
          <label>
            Commander name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
            />
          </label>
          <label>
            Training army
            <select value={army} onChange={(e) => setArmy(e.target.value)}>
              {armies.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            onClick={join}
            disabled={busy || !name.trim() || !invite}
          >
            JOIN PRIVATE MATCH
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  if (!state)
    return (
      <main className="join-screen">
        <a href="/">← Command centre</a>
        <h2>{error || "Connecting to private battlefield…"}</h2>
      </main>
    );
  const recentRolls = log
    .flatMap((l) => l.events.flatMap((e) => e.rolls ?? []))
    .slice(-4);
  const nextLabel =
    state.phase === "fight"
      ? state.fightStep === "combat"
        ? "END FIGHT STEP"
        : `FINISH ${state.fightStep.toUpperCase()}`
      : "END PHASE →";
  return (
    <main className="match-app">
      <header className="match-header">
        <a className="wordmark" href="/">
          ◈ VOIDLINE<span>TABLETOP COMMAND</span>
        </a>
        <div className="match-title">
          <b>SIGNAL CONTROL</b>
          <span>Original training mission / private room</span>
        </div>
        <div className={`connection ${connected ? "online" : ""}`}>
          ● {connected ? "SYNCHRONIZED" : "RECONNECTING"}
        </div>
        <button onClick={() => setRules(true)}>RULES</button>
        <button onClick={() => setSettings(true)}>SETTINGS</button>
      </header>
      <div className="command-bar">
        <div>
          <p className="eyebrow">BATTLE ROUND</p>
          <strong>
            {String(state.round).padStart(2, "0")}
            <small> / 05</small>
          </strong>
        </div>
        <div className="phase-track">
          {phases.map((p, i) => (
            <div key={p} className={state.phase === p ? "current" : ""}>
              <span>0{i + 1}</span>
              {p.toUpperCase()}
            </div>
          ))}
        </div>
        <div className="turn-label">
          <span>
            {state.status === "finished"
              ? "BATTLE COMPLETE"
              : state.players[
                  state.phase === "fight" ? state.fightPlayer : state.turn
                ]}
          </span>
          <b>
            {state.status === "finished"
              ? state.winner === "draw"
                ? "DRAW"
                : `${state.players[state.winner!]} WINS`
              : state.phase === "fight"
                ? state.fightStep.toUpperCase()
                : "ACTIVE COMMANDER"}
          </b>
        </div>
      </div>
      <div className="game-layout">
        <aside className="roster">
          <p className="eyebrow">BATTLEFIELD FORCES</p>
          {([0, 1] as const).map((p) => (
            <section key={p} className={`force force-${p}`}>
              <div className="force-heading">
                <h3>{state.players[p] ?? "Awaiting commander"}</h3>
                <span>{p === seat ? "YOU" : "OPPONENT"}</span>
              </div>
              <div className="score">
                <b>
                  {state.vp[p]}
                  <small> VP</small>
                </b>
                <span>{state.cp[p]} CP</span>
              </div>
              {state.units
                .filter((u) => u.owner === p)
                .map((u) => (
                  <button
                    data-testid={`unit-${u.id}`}
                    key={u.id}
                    className={`unit-card ${selected === u.id ? "active" : ""}`}
                    onClick={() =>
                      p === seat
                        ? select(
                            u.id,
                            u.models.find((m) => m.wounds > 0)?.id ??
                              u.models[0].id,
                          )
                        : setTarget(u.id)
                    }
                  >
                    <span className="unit-symbol">⬡</span>
                    <span>
                      <b>{u.name}</b>
                      <small>
                        {u.reserve ? "RESERVES · " : ""}
                        {u.models.filter((m) => m.wounds > 0).length} /{" "}
                        {u.startingStrength} MODELS{" "}
                        {u.shocked ? "· SHOCKED" : ""}
                      </small>
                    </span>
                    <span className="unit-status">
                      {u.fought
                        ? "F"
                        : u.shotTurn === state.turnNumber
                          ? "S"
                          : u.moved
                            ? "M"
                            : "·"}
                    </span>
                  </button>
                ))}
            </section>
          ))}
          <div className="objective-list">
            <p className="eyebrow">OBJECTIVE CONTROL</p>
            {state.objectives.map((o) => (
              <div key={o.id}>
                <span>◉ {o.id.toUpperCase()}</span>
                <span>
                  {o.owner === null
                    ? "CONTESTED / OPEN"
                    : state.players[o.owner]}
                </span>
              </div>
            ))}
          </div>
          <button onClick={() => setMeasure(!measure)} aria-pressed={measure}>
            {measure ? "EXIT MEASUREMENT" : "⌁ MEASURE DISTANCE"}
          </button>
          <p className="hint">
            Roster targets and coordinate controls also work without interacting
            with the canvas.
          </p>
        </aside>
        <section className="table-area">
          {state.status === "lobby" && (
            <div className="lobby-banner">
              <div>
                <b>Awaiting deployment</b>
                <p>
                  {state.players[1]
                    ? "Both commanders ready. The host can begin."
                    : "Share your invitation with a second commander."}
                </p>
              </div>
              {invite && (
                <button
                  onClick={() =>
                    navigator.clipboard
                      .writeText(
                        `${location.origin}/match/${id}#invite=${invite}`,
                      )
                      .catch(() =>
                        setError("Copy the invitation from the field below."),
                      )
                  }
                >
                  COPY INVITATION ↗
                </button>
              )}
              {seat === 0 && (
                <button
                  className="primary"
                  disabled={!state.players[1] || busy}
                  onClick={() => send({ type: "start" })}
                >
                  BEGIN BATTLE
                </button>
              )}
            </div>
          )}
          {state.status === "lobby" && invite && (
            <input
              aria-label="Shareable invitation"
              readOnly
              value={`${typeof location === "undefined" ? "" : location.origin}/match/${id}#invite=${invite}`}
            />
          )}
          <Battlefield
            state={state}
            selected={selected}
            modelId={modelId}
            paths={paths}
            onSelect={select}
            onPlace={preview}
            grid={grid}
            measure={measure}
          />
          <div className="battle-log">
            <div className="panel-heading">
              <h3>BATTLE CHRONICLE</h3>
              <span>SERVER-VERIFIED / REV {state.revision}</span>
            </div>
            <div className="log-scroll" aria-live="polite">
              {[...log].reverse().flatMap((l) =>
                l.events.map((e, i) => (
                  <p key={`${l.revision}-${i}`}>
                    <span>{String(l.revision).padStart(3, "0")}</span>
                    {e.message}
                    <small>§{e.rule}</small>
                  </p>
                )),
              )}
            </div>
          </div>
        </section>
        <aside className="inspector">
          <p className="eyebrow">UNIT TELEMETRY</p>
          <h2>{unit?.name ?? "Select a unit"}</h2>
          {unit && (
            <>
              <div className="stats">
                <span>
                  M<b>{unit.move}″</b>
                </span>
                <span>
                  T<b>{unit.toughness}</b>
                </span>
                <span>
                  SV<b>{unit.save}+</b>
                </span>
                <span>
                  OC<b>{unit.shocked ? "—" : unit.oc}</b>
                </span>
              </div>
              <label>
                Individual model
                <select
                  aria-label="Individual model"
                  value={modelId}
                  onChange={(e) => select(unit.id, e.target.value)}
                >
                  {unit.models
                    .filter((m) => m.wounds > 0)
                    .map((m, i) => (
                      <option key={m.id} value={m.id}>
                        Model {i + 1} · {m.wounds}W · {m.x.toFixed(2)},{" "}
                        {m.y.toFixed(2)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="base-detail">
                ⌀ 32 mm base / coordinates in inches
              </div>
              {(state.status === "active" || state.status === "lobby") &&
                own && (
                  <>
                    <div className="panel-heading">
                      <h3>MOVEMENT PLAN</h3>
                      <span>
                        {state.pending
                          ? `${state.pending.kind.toUpperCase()} ${limit}″`
                          : (unit.moved?.toUpperCase() ?? "AVAILABLE")}
                      </span>
                    </div>
                    <div className="coordinates">
                      <label>
                        X
                        <input
                          aria-label="Destination X"
                          type="number"
                          step="0.1"
                          value={x}
                          onChange={(e) => setX(e.target.value)}
                        />
                      </label>
                      <label>
                        Y
                        <input
                          aria-label="Destination Y"
                          type="number"
                          step="0.1"
                          value={y}
                          onChange={(e) => setY(e.target.value)}
                        />
                      </label>
                      <button
                        onClick={() => preview({ x: Number(x), y: Number(y) })}
                        disabled={
                          !Number.isFinite(Number(x)) ||
                          !Number.isFinite(Number(y))
                        }
                      >
                        PREVIEW
                      </button>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={individual}
                        onChange={(e) => setIndividual(e.target.checked)}
                      />
                      Move only selected model
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={append}
                        onChange={(e) => setAppend(e.target.checked)}
                      />
                      Append path segment
                    </label>
                    <p className={previewInvalid ? "error" : "hint"}>
                      {paths.length
                        ? `${distancePreview.toFixed(2)}″ planned / ${limit}″ allowed. ${previewInvalid ? "Exceeds movement allowance." : "Server checks collision, engagement and coherency."}`
                        : "Click the board or enter coordinates to preview. Submit the complete unit plan together."}
                    </p>
                    {state.phase === "movement" && !state.pending && (
                      <>
                        <select
                          aria-label="Movement mode"
                          value={mode}
                          onChange={(e) =>
                            setMode(e.target.value as typeof mode)
                          }
                        >
                          <option value="normal">Normal move</option>
                          <option value="fallback">
                            Fall back · ordered retreat
                          </option>
                        </select>
                        {mode === "fallback" && (
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={desperate}
                              onChange={(e) => setDesperate(e.target.checked)}
                            />
                            Desperate escape · hazards per model
                          </label>
                        )}
                        <div className="button-row">
                          <button
                            disabled={!canAct || busy || !!unit.moved}
                            onClick={() =>
                              send({ type: "advance", unitId: unit.id })
                            }
                          >
                            ADVANCE D6
                          </button>
                          <button
                            disabled={!canAct || busy || !!unit.moved}
                            onClick={() =>
                              send({
                                type: "move",
                                unitId: unit.id,
                                mode: "stationary",
                                paths: [],
                              })
                            }
                          >
                            STATIONARY
                          </button>
                        </div>
                      </>
                    )}
                    {state.phase === "charge" && !state.pending && (
                      <button
                        disabled={!canAct || busy}
                        onClick={() =>
                          send({ type: "charge", unitId: unit.id })
                        }
                      >
                        DECLARE CHARGE · 2D6
                      </button>
                    )}
                    <div className="button-row">
                      <button
                        className="primary"
                        disabled={
                          !(
                            canAct ||
                            state.status === "lobby" ||
                            state.pending?.player === seat
                          ) ||
                          busy ||
                          !paths.length ||
                          !(
                            state.status === "lobby" ||
                            ["movement", "charge", "fight"].includes(
                              state.phase,
                            )
                          ) ||
                          (state.phase === "charge" && !state.pending) ||
                          (state.phase === "fight" &&
                            state.fightStep === "combat")
                        }
                        onClick={submitMovement}
                      >
                        SUBMIT MOVE
                      </button>
                      <button onClick={() => setPaths([])}>CLEAR</button>
                    </div>
                    {state.phase === "fight" &&
                      state.fightStep === "combat" && (
                        <button
                          disabled={!canAct || busy}
                          onClick={() =>
                            send({ type: "fightMove", unitId: unit.id, paths })
                          }
                        >
                          OVERRUN / PASS IF UNREACHABLE
                        </button>
                      )}
                    {state.pending?.kind === "charge" && (
                      <button
                        disabled={
                          busy || !(canAct || state.pending?.player === seat)
                        }
                        onClick={() =>
                          send({ type: "commit", paths: [], decline: true })
                        }
                      >
                        DECLINE / FAILED CHARGE
                      </button>
                    )}
                    <div className="panel-heading">
                      <h3>ATTACK SOLUTION</h3>
                    </div>
                    <label>
                      Enemy target
                      <select
                        aria-label="Enemy target"
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                      >
                        <option value="">Select enemy unit</option>
                        {enemies.map((u) => (
                          <option value={u.id} key={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Weapon
                      <select
                        aria-label="Weapon"
                        value={weapon}
                        onChange={(e) => setWeapon(e.target.value)}
                      >
                        {unit.weapons.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ·{" "}
                            {w.kind === "ranged" ? `${w.range}″` : "Melee"} · A
                            {w.attacks} S{w.strength} AP{w.ap} D{w.damage}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      disabled={
                        !canAct ||
                        busy ||
                        !target ||
                        !["shooting", "fight"].includes(state.phase)
                      }
                      onClick={() =>
                        send({
                          type: "attack",
                          unitId: unit.id,
                          targetId: target,
                          weaponId: weapon,
                        })
                      }
                    >
                      RESOLVE ATTACK →
                    </button>
                    <AttackPlanner
                      state={state}
                      unit={unit}
                      target={target}
                      weapon={weapon}
                      busy={busy}
                      enabled={
                        !!canAct && ["shooting", "fight"].includes(state.phase)
                      }
                      send={send}
                    />
                  </>
                )}
            </>
          )}
          <TacticalControls
            state={state}
            seat={seat}
            selected={selected}
            target={target}
            paths={paths}
            busy={busy}
            send={send}
          />
          <div className="dice-panel">
            <p className="eyebrow">DICE TELEMETRY</p>
            {recentRolls.length ? (
              recentRolls.map((r, i) => (
                <div key={i}>
                  <span>{r.reason}</span>
                  <div className="dice">
                    {r.values.map((v, j) => (
                      <b key={j} className={v === 6 ? "critical" : ""}>
                        {v}
                      </b>
                    ))}
                    <small>= {r.total}</small>
                  </div>
                </div>
              ))
            ) : (
              <p className="hint">Server-side dice will appear here.</p>
            )}
          </div>
          {state.status === "active" && (
            <button
              className="primary end-phase"
              disabled={!canAct || busy || !!state.pending}
              onClick={() => send({ type: "next" })}
            >
              {nextLabel}
            </button>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p className="hint">
            {canAct ? "Your activation." : "Waiting for the other commander."}{" "}
            Unsupported actions are rejected by the server.
          </p>
        </aside>
      </div>
      {(rules || settings) && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={rules ? "Rules reference" : "Settings"}
            className="modal"
          >
            <button
              className="close"
              onClick={() => {
                setRules(false);
                setSettings(false);
              }}
            >
              CLOSE ×
            </button>
            <h2>{rules ? "Field reference" : "Display & session"}</h2>
            {rules ? (
              rulesReference.map((r) => (
                <article key={r.id}>
                  <h3>
                    §{r.id} · {r.title}
                  </h3>
                  <p>{r.text}</p>
                  <small>{r.source}</small>
                </article>
              ))
            ) : (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={grid}
                    onChange={(e) => setGrid(e.target.checked)}
                  />
                  Show inch grid
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={state.autoRolls?.[seat] === false}
                    onChange={(e) =>
                      send({ type: "dicePolicy", automatic: !e.target.checked })
                    }
                  />
                  Pause eligible dice for optional Command Re-roll
                </label>
                <p>
                  Session stored in this browser for 30 days. Use the same
                  browser profile to resume. The invitation grants the second
                  seat only.
                </p>
                {state.status === "lobby" && seat === 0 && (
                  <TerrainEditor
                    terrain={state.terrain}
                    busy={busy}
                    onApply={(terrain) => send({ type: "terrain", terrain })}
                  />
                )}
                <p>
                  Ground-level original counter silhouettes use sampled 2D
                  visibility. Infantry reserves, reaction stratagems and
                  optional dice decisions are supported. Advanced unit types and
                  faction rules require supplied profiles.
                </p>
                <button
                  onClick={() => {
                    if (confirm("Concede this match to the other commander?"))
                      send({ type: "resign" });
                  }}
                >
                  CONCEDE MATCH
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
