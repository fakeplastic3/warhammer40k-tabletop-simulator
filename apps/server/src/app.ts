import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Server } from "socket.io";
import { Client } from "pg";
import type { PrismaClient } from "@prisma/client";
import {
  sessionSchema,
  createSchema,
  joinSchema,
  envelopeSchema,
} from "@tabletop/shared";
import { ZodError } from "zod";
import { MatchService, ServiceError } from "./service";
export async function buildApp(
  db: PrismaClient,
  options: { origin: string; notifications?: boolean; logger?: boolean },
) {
  const app = Fastify({
    bodyLimit: 128 * 1024,
    logger: options.logger ?? false,
  });
  const service = new MatchService(db);
  await app.register(cors, { origin: options.origin });
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
  app.setErrorHandler((err, _req, reply) => {
    const status =
      err instanceof ServiceError
        ? err.status
        : err instanceof ZodError
          ? 400
          : (err as { code?: string }).code?.startsWith("P")
            ? 409
            : 400;
    reply.code(status).send({
      error:
        err instanceof ZodError
          ? "Invalid request"
          : (err as { code?: string }).code?.startsWith("P")
            ? "Database conflict; refresh and retry"
            : (err as Error).message,
    });
  });
  const auth = (req: { headers: { authorization?: string } }) =>
    service.authenticate(req.headers.authorization?.replace(/^Bearer /, ""));
  const id = (params: unknown) => {
    const value = (params as { id?: string })?.id;
    if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value))
      throw new ServiceError("Invalid room ID");
    return value;
  };
  app.get("/health", async () => {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  });
  app.post(
    "/sessions",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => service.session(sessionSchema.parse(req.body).name),
  );
  app.get("/matches", async (req) => service.list((await auth(req)).id));
  app.post("/matches", async (req) =>
    service.create(await auth(req), createSchema.parse(req.body).army),
  );
  app.get("/matches/:id", async (req) =>
    service.room(id(req.params), (await auth(req)).id),
  );
  app.post("/matches/:id/join", async (req) => {
    const u = await auth(req);
    const b = joinSchema.parse(req.body);
    return service.join(id(req.params), u, b.invite, b.army);
  });
  app.post("/matches/:id/actions", async (req) =>
    service.action(
      id(req.params),
      (await auth(req)).id,
      envelopeSchema.parse(req.body),
    ),
  );
  app.get("/matches/:id/history", async (req) =>
    service.history(id(req.params), (await auth(req)).id),
  );
  const io = new Server(app.server, {
    cors: { origin: options.origin },
    maxHttpBufferSize: 128 * 1024,
  });
  io.use(async (socket, next) => {
    try {
      const u = await service.authenticate(socket.handshake.auth.token);
      socket.data.userId = u.id;
      next();
    } catch {
      next(Error("Authentication required"));
    }
  });
  io.on("connection", (socket) => {
    socket.on(
      "subscribe",
      async (roomId: unknown, ack: (response: unknown) => void) => {
        try {
          await service.authenticate(socket.handshake.auth.token);
          if (typeof roomId !== "string") throw Error("Invalid room");
          const room = await service.room(roomId, socket.data.userId);
          await socket.join(roomId);
          if (typeof ack === "function") ack({ ok: true, ...room });
        } catch (e) {
          if (typeof ack === "function")
            ack({ ok: false, error: (e as Error).message });
        }
      },
    );
    socket.on(
      "action",
      async (payload: unknown, ack: (response: unknown) => void) => {
        try {
          await service.authenticate(socket.handshake.auth.token);
          if (typeof payload !== "object" || !payload)
            throw Error("Invalid payload");
          const { matchId, envelope } = payload as {
            matchId: unknown;
            envelope: unknown;
          };
          if (typeof matchId !== "string") throw Error("Invalid match");
          const result = await service.action(
            matchId,
            socket.data.userId,
            envelopeSchema.parse(envelope),
          );
          if (typeof ack === "function") ack(result);
        } catch (e) {
          if (typeof ack === "function")
            ack({
              ok: false,
              error:
                e instanceof ZodError ? "Invalid action" : (e as Error).message,
            });
        }
      },
    );
  });
  let listener: Client | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closing = false;
  let hasListened = false;
  async function listenForChanges() {
    if (closing) return;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    listener = client;
    const reconnect = () => {
      if (closing || retry) return;
      retry = setTimeout(() => {
        retry = undefined;
        void listenForChanges();
      }, 1000);
    };
    client.on("error", (err) => {
      app.log.error(err);
      void client.end().catch(() => {});
      reconnect();
    });
    client.on("end", reconnect);
    client.on("notification", async (note) => {
      if (!note.payload) return;
      try {
        const row = await db.match.findUnique({ where: { id: note.payload } });
        if (row) io.to(row.id).emit("state", row.state);
      } catch (e) {
        app.log.error(e);
      }
    });
    try {
      await client.connect();
      await client.query("LISTEN tabletop_changes");
      if (hasListened) {
        await db.$disconnect();
        await db.$connect();
      }
      hasListened = true;
      // Recover any committed snapshots missed while the LISTEN connection was down.
      const ids = [...io.sockets.adapter.rooms.keys()].filter((id) =>
        /^[a-f0-9-]{36}$/.test(id),
      );
      if (ids.length)
        for (const row of await db.match.findMany({
          where: { id: { in: ids } },
        }))
          io.to(row.id).emit("state", row.state);
    } catch (err) {
      app.log.error(err);
      await client.end().catch(() => {});
      reconnect();
    }
  }
  if (options.notifications !== false) await listenForChanges();
  app.addHook("onClose", async () => {
    closing = true;
    if (retry) clearTimeout(retry);
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await listener?.end().catch(() => {});
  });
  return { app, io, service };
}
