import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { buildApp } from "../apps/server/src/app";
import { hash, canonicalStringify } from "../apps/server/src/service";
import { RULE_VERSION, type GameState, type Action } from "@tabletop/shared";
config({ quiet: true });
describe.skipIf(!process.env.DATABASE_URL)(
  "PostgreSQL authoritative multiplayer",
  () => {
    const db = new PrismaClient();
    let server: Awaited<ReturnType<typeof buildApp>>;
    let base: string;
    const users: string[] = [],
      rooms: string[] = [];
    const sockets: Socket[] = [];
    async function request(
      method: "GET" | "POST",
      url: string,
      token?: string,
      payload?: unknown,
    ) {
      const response = await server.app.inject({
        method,
        url,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        ...(payload ? { payload: payload as object } : {}),
      });
      return { status: response.statusCode, data: response.json() };
    }
    async function guest(name: string) {
      const r = await request("POST", "/sessions", undefined, { name });
      users.push(r.data.user.id);
      return r.data.token as string;
    }
    async function create(token: string) {
      const r = await request("POST", "/matches", token, { army: "sentinels" });
      rooms.push(r.data.state.id);
      return r.data as { state: GameState; invite: string };
    }
    async function act(
      id: string,
      token: string,
      state: GameState,
      action: Action,
      requestId = randomUUID(),
    ) {
      return request("POST", `/matches/${id}/actions`, token, {
        id: requestId,
        revision: state.revision,
        action,
      });
    }
    beforeAll(async () => {
      server = await buildApp(db, { origin: "http://127.0.0.1:3000" });
      base = await server.app.listen({ host: "127.0.0.1", port: 0 });
    });
    afterAll(async () => {
      for (const s of sockets) s.disconnect();
      await server?.app.close();
      await db.actionHistory.deleteMany({ where: { matchId: { in: rooms } } });
      await db.matchPlayer.deleteMany({ where: { matchId: { in: rooms } } });
      await db.match.deleteMany({ where: { id: { in: rooms } } });
      await db.armyConfiguration.deleteMany({
        where: { userId: { in: users } },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    });
    it("validates requests and credentials without exposing private rooms", async () => {
      expect(
        (await request("POST", "/sessions", undefined, { name: "" })).status,
      ).toBe(400);
      expect((await request("GET", "/matches")).status).toBe(401);
      const a = await guest("Test A"),
        other = await guest("Other");
      const r = await create(a);
      expect(
        (await request("GET", `/matches/${r.state.id}`, other)).status,
      ).toBe(403);
      expect(
        (
          await request("POST", `/matches/${r.state.id}/join`, other, {
            army: "raiders",
            invite: "0".repeat(64),
          })
        ).status,
      ).toBe(403);
      expect((await request("GET", "/matches", a)).data).toHaveLength(1);
    });
    it("persists actions, rejects illegal/stale actions, deduplicates, broadcasts and resumes after a service restart", async () => {
      const a = await guest("Host"),
        b = await guest("Guest");
      const room = await create(a),
        id = room.state.id;
      expect(
        (
          await request("POST", `/matches/${id}/join`, b, {
            invite: room.invite,
            army: "raiders",
          })
        ).status,
      ).toBe(200);
      let s = (await request("GET", `/matches/${id}`, a)).data
        .state as GameState;
      const socket = io(base, {
        auth: { token: b },
        transports: ["websocket"],
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
      });
      const subscribed = await socket.emitWithAck("subscribe", id);
      expect(subscribed.ok).toBe(true);
      const broadcast = new Promise<GameState>((resolve) =>
        socket.once("state", resolve),
      );
      const startId = randomUUID();
      const start = await act(id, a, s, { type: "start" }, startId);
      expect(start.status).toBe(200);
      s = start.data.state;
      expect((await broadcast).revision).toBe(s.revision);
      const duplicate = await request("POST", `/matches/${id}/actions`, a, {
        id: startId,
        revision: 1,
        action: { type: "start" },
      });
      expect(duplicate.data.duplicate).toBe(true);
      expect(duplicate.data.state.cp).toEqual([1, 1]);
      expect((await act(id, a, s, { type: "next" }, startId)).status).toBe(409);
      expect(
        (
          await request("POST", `/matches/${id}/actions`, a, {
            id: randomUUID(),
            revision: 0,
            action: { type: "next" },
          })
        ).status,
      ).toBe(409);
      expect((await act(id, b, s, { type: "next" })).status).toBe(400);
      s = (await act(id, a, s, { type: "next" })).data.state;
      const paths = s.units[0].models.map((m) => ({
        modelId: m.id,
        points: [{ x: m.x + 4, y: m.y }],
      }));
      const legal = await act(id, a, s, {
        type: "move",
        unitId: "p0-u0",
        mode: "normal",
        paths,
      });
      expect(legal.status).toBe(200);
      s = legal.data.state;
      const revision = s.revision;
      expect(
        (
          await act(id, a, s, {
            type: "move",
            unitId: "p0-u1",
            mode: "normal",
            paths: s.units[1].models.map((m) => ({
              modelId: m.id,
              points: [{ x: 44, y: m.y }],
            })),
          })
        ).status,
      ).toBe(400);
      expect(
        (await request("GET", `/matches/${id}`, b)).data.state.revision,
      ).toBe(revision);
      const history = (await request("GET", `/matches/${id}/history`, b)).data;
      expect(history).toHaveLength(3);
      expect(history[1].previousHash).toBe(history[0].hash);
      expect(history[0].hash).toBe(
        hash(
          canonicalStringify({
            requestId: history[0].requestId,
            actor: history[0].actor,
            revision: history[0].revision,
            action: history[0].action,
            events: history[0].events,
            stateHash: history[0].stateHash,
            previousHash: "genesis",
          }),
        ),
      );
      socket.disconnect();
      await server.app.close();
      await db.$disconnect();
      await db.$connect();
      server = await buildApp(db, { origin: "http://127.0.0.1:3000" });
      base = await server.app.listen({ host: "127.0.0.1", port: 0 });
      expect((await request("GET", `/matches/${id}`, a)).data.state).toEqual(s);
      const resumed = io(base, {
        auth: { token: a },
        transports: ["websocket"],
        reconnection: false,
      });
      sockets.push(resumed);
      await new Promise<void>((resolve, reject) => {
        resumed.once("connect", () => resolve());
        resumed.once("connect_error", reject);
      });
      expect((await resumed.emitWithAck("subscribe", id)).state).toEqual(s);
    });
    it("serializes simultaneous joins and revision conflicts through database constraints", async () => {
      const a = await guest("Race host"),
        b = await guest("Race B"),
        c = await guest("Race C");
      const r = await create(a),
        id = r.state.id;
      const joins = await Promise.all(
        [b, c].map((t) =>
          request("POST", `/matches/${id}/join`, t, {
            invite: r.invite,
            army: "raiders",
          }),
        ),
      );
      expect(joins.filter((r) => r.status === 200)).toHaveLength(1);
      const s = (await request("GET", `/matches/${id}`, a)).data.state;
      const starts = await Promise.all([
        act(id, a, s, { type: "start" }),
        act(id, a, s, { type: "start" }),
      ]);
      expect(starts.filter((r) => r.status === 200)).toHaveLength(1);
      expect(starts.filter((r) => r.status === 409)).toHaveLength(1);
    });
    it("rejects unauthenticated socket connections and private subscriptions", async () => {
      const socket = io(base, {
        auth: { token: "invalid" },
        transports: ["websocket"],
        reconnection: false,
      });
      sockets.push(socket);
      const message = await new Promise<string>((resolve) =>
        socket.once("connect_error", (e) => resolve(e.message)),
      );
      expect(message).toContain("Authentication");
      socket.disconnect();
    });
    it("upgrades the previous training version on an accepted action without repeating command effects", async () => {
      const a = await guest("Upgrade A"),
        b = await guest("Upgrade B");
      const r = await create(a),
        id = r.state.id;
      await request("POST", `/matches/${id}/join`, b, {
        invite: r.invite,
        army: "raiders",
      });
      const s = (await request("GET", `/matches/${id}`, a)).data
        .state as GameState;
      s.ruleVersion = "docx-summary-2026-11-12.demo-2";
      await db.match.update({
        where: { id },
        data: {
          ruleVersion: s.ruleVersion,
          state: JSON.parse(JSON.stringify(s)),
        },
      });
      const started = await act(id, a, s, { type: "start" });
      expect(started.status).toBe(200);
      expect(started.data.state.ruleVersion).toBe(RULE_VERSION);
      expect(started.data.state.cp).toEqual([1, 1]);
      expect(
        (await db.match.findUniqueOrThrow({ where: { id } })).ruleVersion,
      ).toBe(RULE_VERSION);
    });
    it("persists a paused dice decision and deduplicates the CP-paying resolution", async () => {
      const a = await guest("Review A"),
        b = await guest("Review B");
      const r = await create(a),
        id = r.state.id;
      await request("POST", `/matches/${id}/join`, b, {
        invite: r.invite,
        army: "raiders",
      });
      let s = (await request("GET", `/matches/${id}`, a)).data
        .state as GameState;
      s.status = "active";
      s.phase = "shooting";
      s.cp = [2, 2];
      s.autoRolls = [false, true];
      s.units[2].models.forEach((m) => (m.x = 20));
      s.terrain = [];
      await db.match.update({
        where: { id },
        data: { state: JSON.parse(JSON.stringify(s)) },
      });
      const attack = await act(id, a, s, {
        type: "attack",
        unitId: "p0-u0",
        targetId: "p1-u0",
        weaponId: "carbine",
      });
      expect(attack.status).toBe(200);
      s = attack.data.state;
      expect(s.resolution!.meta.kind).toBe("hit");
      const secondClient = new PrismaClient();
      try {
        expect(
          (await secondClient.match.findUniqueOrThrow({ where: { id } })).state,
        ).toEqual(s);
      } finally {
        await secondClient.$disconnect();
      }
      const requestId = randomUUID();
      const resolved = await act(
        id,
        a,
        s,
        { type: "resolveRoll", reroll: true },
        requestId,
      );
      expect(resolved.status).toBe(200);
      expect(resolved.data.state.cp[0]).toBe(1);
      expect(resolved.data.state.resolution).toBeUndefined();
      const retry = await act(
        id,
        a,
        s,
        { type: "resolveRoll", reroll: true },
        requestId,
      );
      expect(retry.data.duplicate).toBe(true);
      expect(retry.data.state.cp[0]).toBe(1);
    });
  },
);
