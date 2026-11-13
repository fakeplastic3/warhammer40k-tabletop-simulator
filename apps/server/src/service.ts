import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { createState } from "@tabletop/game-data";
import { applyAction, addSecondPlayer } from "@tabletop/game-engine";
import {
  RULE_VERSION,
  type Envelope,
  type GameState,
  type Player,
} from "@tabletop/shared";
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalStringify).join(",") + "]";
  const object = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(object)
      .filter((k) => object[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalStringify(object[k]))
      .join(",") +
    "}"
  );
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export class ServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export class MatchService {
  constructor(public db: PrismaClient) {}
  async session(name: string) {
    const token = randomBytes(32).toString("hex");
    const user = await this.db.user.create({
      data: {
        name,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    return { token, user: { id: user.id, name: user.name } };
  }
  async authenticate(token: unknown) {
    if (typeof token !== "string" || token.length > 100)
      throw new ServiceError("Authentication required", 401);
    const u = await this.db.user.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (!u || u.expiresAt < new Date())
      throw new ServiceError("Session expired or invalid", 401);
    return u;
  }
  async member(matchId: string, userId: string) {
    const seat = await this.db.matchPlayer.findUnique({
      where: { matchId_userId: { matchId, userId } },
    });
    if (!seat) throw new ServiceError("Private match membership required", 403);
    return seat.seat as Player;
  }
  async room(matchId: string, userId: string) {
    const seat = await this.member(matchId, userId);
    const match = await this.db.match.findUniqueOrThrow({
      where: { id: matchId },
    });
    return { state: match.state as unknown as GameState, seat };
  }
  async create(user: { id: string; name: string }, army: string) {
    const id = randomUUID();
    const invite = randomBytes(32).toString("hex");
    const state = createState(id, user.name, army);
    await this.db.$transaction(async (tx) => {
      await tx.match.create({
        data: {
          id,
          inviteHash: hash(invite),
          ruleVersion: RULE_VERSION,
          state: json(state),
          players: { create: { userId: user.id, seat: 0 } },
        },
      });
      await tx.armyConfiguration.create({
        data: {
          userId: user.id,
          name: army,
          configuration: { army, ruleVersion: RULE_VERSION },
        },
      });
    });
    return { state, seat: 0 as Player, invite };
  }
  async join(
    id: string,
    user: { id: string; name: string },
    invite: string,
    army: string,
  ) {
    const existing = await this.db.matchPlayer.findUnique({
      where: { matchId_userId: { matchId: id, userId: user.id } },
    });
    if (existing) return this.room(id, user.id);
    return this.db.$transaction(async (tx) => {
      const row = await tx.match.findUnique({ where: { id } });
      if (!row || row.inviteHash !== hash(invite))
        throw new ServiceError("Invalid invitation", 403);
      let state: GameState;
      try {
        state = addSecondPlayer(
          row.state as unknown as GameState,
          user.name,
          army,
        );
      } catch (e) {
        throw new ServiceError((e as Error).message, 409);
      }
      const update = await tx.match.updateMany({
        where: { id, revision: row.revision },
        data: { state: json(state), revision: state.revision },
      });
      if (update.count !== 1)
        throw new ServiceError("Room changed; retry join", 409);
      await tx.matchPlayer.create({
        data: { matchId: id, userId: user.id, seat: 1 },
      });
      await tx.armyConfiguration.create({
        data: {
          userId: user.id,
          name: army,
          configuration: { army, ruleVersion: RULE_VERSION },
        },
      });
      await tx.$executeRaw`SELECT pg_notify('tabletop_changes', ${id})`;
      return { state, seat: 1 as Player };
    });
  }
  async action(id: string, userId: string, envelope: Envelope) {
    const actor = await this.member(id, userId);
    return this.db.$transaction(async (tx) => {
      const duplicate = await tx.actionHistory.findUnique({
        where: { matchId_requestId: { matchId: id, requestId: envelope.id } },
      });
      const row = await tx.match.findUniqueOrThrow({ where: { id } });
      if (duplicate) {
        if (
          duplicate.actor !== actor ||
          canonicalStringify(duplicate.action) !==
            canonicalStringify(json(envelope.action))
        )
          throw new ServiceError(
            "Action ID reused with different content",
            409,
          );
        return {
          ok: true,
          state: row.state as unknown as GameState,
          duplicate: true,
        };
      }
      if (
        row.ruleVersion !== RULE_VERSION &&
        row.ruleVersion !== "docx-summary-2026-11-12.demo-2"
      )
        throw new ServiceError("Unsupported saved rule version", 409);
      if (row.revision !== envelope.revision)
        throw new ServiceError(
          "Stale revision: refresh the authoritative state and retry",
          409,
        );
      const saved = row.state as unknown as GameState;
      const upgraded = row.ruleVersion !== RULE_VERSION;
      if (upgraded) {
        saved.ruleVersion = RULE_VERSION;
        for (const u of saved.units) {
          u.points ??= 100;
          u.keywords ??= ["INFANTRY", "GRENADES", "SMOKE"];
        }
        if (saved.resolution)
          saved.resolution.original.ruleVersion = RULE_VERSION;
      }
      const state = applyAction(saved, actor, envelope.action, () =>
        randomInt(1, 7),
      );
      const updated = await tx.match.updateMany({
        where: { id, revision: envelope.revision },
        data: {
          state: json(state),
          revision: state.revision,
          ruleVersion: RULE_VERSION,
        },
      });
      if (updated.count !== 1)
        throw new ServiceError(
          "Conflicting update; retry from latest state",
          409,
        );
      const previous = await tx.actionHistory.findFirst({
        where: { matchId: id },
        orderBy: { revision: "desc" },
      });
      const previousHash = previous?.hash ?? "genesis";
      const stateHash = hash(canonicalStringify(state));
      const payload = canonicalStringify({
        requestId: envelope.id,
        actor,
        revision: state.revision,
        action: envelope.action,
        events: state.events,
        stateHash,
        previousHash,
      });
      await tx.actionHistory.create({
        data: {
          matchId: id,
          requestId: envelope.id,
          actor,
          revision: state.revision,
          action: json(envelope.action),
          events: json(state.events),
          previousHash,
          stateHash,
          stateSnapshot: json(state),
          hash: hash(payload),
        },
      });
      await tx.$executeRaw`SELECT pg_notify('tabletop_changes', ${id})`;
      return { ok: true, state };
    });
  }
  async history(id: string, userId: string) {
    await this.member(id, userId);
    return this.db.actionHistory.findMany({
      where: { matchId: id },
      orderBy: { revision: "asc" },
    });
  }
  async list(userId: string) {
    return this.db.matchPlayer.findMany({
      where: { userId },
      select: {
        seat: true,
        match: { select: { id: true, updatedAt: true, state: true } },
      },
      orderBy: { match: { updatedAt: "desc" } },
      take: 20,
    });
  }
}
