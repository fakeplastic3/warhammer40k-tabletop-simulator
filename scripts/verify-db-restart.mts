import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { buildApp } from "../apps/server/src/app";
import { canonicalStringify } from "../apps/server/src/service";
import type { GameState } from "@tabletop/shared";
// Run only against an explicitly selected disposable local PostgreSQL cluster.
const directory = process.env.PG_TEST_DATA_DIR;
assert(directory, "PG_TEST_DATA_DIR is required");
assert(process.env.DATABASE_URL, "DATABASE_URL is required");
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
const db = new PrismaClient();
const setting = await db.$queryRaw<
  { data_directory: string }[]
>`SHOW data_directory`;
assert.equal(
  setting[0].data_directory,
  directory,
  "Refusing to restart a different cluster",
);
const { app, service } = await buildApp(db, {
  origin: "http://127.0.0.1:3000",
});
const base = await app.listen({ host: "127.0.0.1", port: 0 });
const a = await service.session("Restart host"),
  b = await service.session("Restart guest");
const room = await service.create(a.user, "sentinels");
const joined = await service.join(
  room.state.id,
  b.user,
  room.invite,
  "raiders",
);
const saved = (
  await service.action(room.state.id, a.user.id, {
    id: randomUUID(),
    revision: joined.state.revision,
    action: { type: "start" },
  })
).state;
const socket = io(base, {
  auth: { token: a.token },
  transports: ["websocket"],
  reconnection: false,
});
try {
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  assert.equal((await socket.emitWithAck("subscribe", room.state.id)).ok, true);
  const recovered = new Promise<GameState>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Notification listener did not recover")),
      15000,
    );
    socket.once("state", (s) => {
      clearTimeout(timer);
      resolve(s);
    });
  });
  execFileSync(
    "pg_ctl",
    ["-D", directory, "-l", directory + "/server.log", "-m", "fast", "restart"],
    { stdio: "pipe" },
  );
  assert.equal(canonicalStringify(await recovered), canonicalStringify(saved));
  assert.equal(
    canonicalStringify((await service.room(room.state.id, a.user.id)).state),
    canonicalStringify(saved),
  );
  const changed = new Promise<GameState>((resolve) =>
    socket.once("state", resolve),
  );
  const next = await service.action(room.state.id, a.user.id, {
    id: randomUUID(),
    revision: saved.revision,
    action: { type: "next" },
  });
  assert.equal((await changed).revision, next.state.revision);
  console.log(
    "PASS: state survived actual PostgreSQL restart; existing socket received catch-up and new committed action.",
  );
} finally {
  socket.disconnect();
  await app.close();
  await db.actionHistory.deleteMany({ where: { matchId: room.state.id } });
  await db.matchPlayer.deleteMany({ where: { matchId: room.state.id } });
  await db.match.delete({ where: { id: room.state.id } });
  await db.armyConfiguration.deleteMany({
    where: { userId: { in: [a.user.id, b.user.id] } },
  });
  await db.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
  await db.$disconnect();
}
