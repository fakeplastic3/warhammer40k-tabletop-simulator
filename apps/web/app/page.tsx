"use client";
import { useEffect, useState } from "react";
import { armies, mission } from "@tabletop/game-data";
import type { RoomResponse, GameState } from "@tabletop/shared";
import { api, ensureSession, token } from "../components/api";
export default function Home() {
  const [name, setName] = useState("Commander");
  const [army, setArmy] = useState("sentinels");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<
    { seat: number; match: { id: string; state: GameState } }[]
  >([]);
  const [link, setLink] = useState("");
  useEffect(() => {
    if (token())
      api<typeof rooms>("/matches")
        .then(setRooms)
        .catch((e) => setError(e.message));
  }, []);
  async function create() {
    setBusy(true);
    setError("");
    try {
      await ensureSession(name);
      const result = await api<RoomResponse>("/matches", { army });
      sessionStorage.setItem(`invite-${result.state.id}`, result.invite!);
      location.href = `/match/${result.state.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  function join() {
    try {
      const url = new URL(link, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith("/match/"))
        throw Error("Paste an invitation link from this server");
      location.href = url.pathname + url.hash;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="home">
      <header className="site-header">
        <a className="wordmark" href="/">
          ◈ VOIDLINE<span>TABLETOP COMMAND</span>
        </a>
        <div className="tag">PRIVATE MULTIPLAYER / 11E SOURCE</div>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">TACTICAL SIMULATION / 001</p>
          <h1>
            Every inch.
            <br />
            Every decision.
          </h1>
          <p className="intro">
            A shared battlefield. An authoritative rules engine.
            <br />
            Your next engagement begins here.
          </p>
          <div className="hero-facts">
            <span>02 COMMANDERS</span>
            <span>05 BATTLE ROUNDS</span>
            <span>44 × 30 INCHES</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit o1" />
          <div className="orbit o2" />
          <div className="orbit o3" />
          <div className="crosshair">✦</div>
          <span className="coordinate">
            SECTOR 44 / 30
            <br />
            SIGNAL ACQUIRED
          </span>
        </div>
      </section>
      <section className="muster">
        <div className="section-heading">
          <p className="eyebrow">PREPARE FOR DEPLOYMENT</p>
          <h2>Muster your force</h2>
          <p>Original training armies · no faction datasheets required</p>
        </div>
        <div className="army-grid">
          {armies.map((a, i) => (
            <button
              key={a.id}
              className={`army-card ${army === a.id ? "chosen" : ""}`}
              onClick={() => setArmy(a.id)}
              aria-pressed={army === a.id}
            >
              <span className="army-number">0{i + 1} / TRAINING FORCE</span>
              <div className={`army-emblem e${i}`}>{["⬡", "⟐", "▱"][i]}</div>
              <h3>{a.name}</h3>
              <p>{a.description}</p>
              <div className="stats">
                <span>
                  M <b>{a.move}″</b>
                </span>
                <span>
                  T <b>{a.toughness}</b>
                </span>
                <span>
                  SV <b>{a.save}+</b>
                </span>
                <span>
                  W <b>{a.wounds}</b>
                </span>
              </div>
              <span className="selected-text">
                {army === a.id ? "● SELECTED" : "○ SELECT FORCE"}
              </span>
            </button>
          ))}
        </div>
        <div className="launch-panel">
          <div>
            <h3>{mission.name}</h3>
            <p>
              Original training mission. Two squads each. Score 5 VP per
              controlled objective at each round end; most VP after five rounds
              wins. Ground-level geometry and limited rules coverage.
            </p>
          </div>
          <div className="launch-controls">
            <label>
              Commander name
              <input
                aria-label="Commander name"
                value={name}
                maxLength={32}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !name.trim()}
              onClick={create}
            >
              {busy ? "ESTABLISHING LINK…" : "CREATE PRIVATE MATCH ↗"}
            </button>
          </div>
        </div>
        <div className="join-panel">
          <label>
            Have an invitation?
            <input
              aria-label="Invitation link"
              placeholder="Paste your private invitation link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </label>
          <button onClick={join} disabled={!link}>
            JOIN ENGAGEMENT →
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      {rooms.length > 0 && (
        <section className="resume">
          <h2>Resume an engagement</h2>
          {rooms.map((r) => (
            <a key={r.match.id} href={`/match/${r.match.id}`}>
              <span>{r.match.state.players.join(" / ")}</span>
              <span>
                Round {r.match.state.round} · {r.match.state.status} →
              </span>
            </a>
          ))}
        </section>
      )}
      <footer>
        UNOFFICIAL FAN PROJECT · ORIGINAL GRAPHICS · NO COMPLETE RULES COVERAGE
        CLAIMED
        <br />
        Your private invite grants the second seat. Keep your browser session to
        resume.
      </footer>
    </main>
  );
}
