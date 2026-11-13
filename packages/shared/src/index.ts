import { z } from "zod";
export const RULE_VERSION = "docx-summary-2026-11-12.demo-3";
export const phases = [
  "command",
  "movement",
  "shooting",
  "charge",
  "fight",
] as const;
export type Phase = (typeof phases)[number];
export type Player = 0 | 1;
export type Point = { x: number; y: number };
export type RollMeta = {
  player: Player;
  unitId: string;
  kind:
    | "hit"
    | "wound"
    | "save"
    | "hazard"
    | "advance"
    | "charge"
    | "damage"
    | "attacks"
    | "other";
  rerolled?: boolean;
};
export type StratagemUse = {
  turn: number;
  phase: Phase;
  actor: Player;
  name: string;
  unitId: string;
};
export type Roll = {
  reason: string;
  values: number[];
  modifier: number;
  total: number;
  rerolled?: number[];
};
export type Weapon = {
  id: string;
  name: string;
  kind: "ranged" | "melee";
  range: number;
  attacks: number;
  skill: number;
  strength: number;
  ap: number;
  damage: number;
  abilities: Partial<
    Record<
      | "assault"
      | "close-quarters"
      | "one-shot"
      | "torrent"
      | "heavy"
      | "ignores-cover"
      | "lethal-hits"
      | "twin-linked"
      | "devastating-wounds"
      | "hazardous"
      | "indirect-fire"
      | "psychic"
      | "extra-attacks",
      boolean
    >
  > &
    Partial<
      Record<
        | "rapid-fire"
        | "blast"
        | "cleave"
        | "sustained-hits"
        | "lance"
        | "melta",
        number
      >
    > & { anti?: { keyword: string; threshold: number } };
};
export type Model = Point & {
  id: string;
  radius: number;
  wounds: number;
  maxWounds: number;
};
export type Army = {
  id: string;
  name: string;
  description: string;
  move: number;
  toughness: number;
  save: number;
  wounds: number;
  leadership: number;
  oc: number;
  weapons: Weapon[];
};
export type Unit = Omit<Army, "description" | "wounds"> & {
  owner: Player;
  reserve?: boolean;
  arrivedTurn?: number;
  points?: number;
  keywords?: string[];
  feelNoPain?: number;
  stealth?: boolean;
  fightsFirst?: boolean;
  deepStrike?: boolean;
  models: Model[];
  startingStrength: number;
  shocked: boolean;
  invulnerable?: number;
  moved?: "normal" | "advance" | "fallback" | "stationary";
  movedDistance: number;
  shotTurn: number;
  charged: boolean;
  fought: boolean;
  piled: boolean;
  consolidated: boolean;
  oneShotUsed: string[];
};
export type Terrain = {
  id: string;
  name: string;
  category: "exposed" | "light" | "dense";
  x: number;
  y: number;
  width: number;
  height: number;
  solid: boolean;
};
export type Objective = Point & {
  id: string;
  radius: number;
  owner: Player | null;
  secured?: Player;
};
export type GameEvent = {
  kind: "rule" | "dice";
  message: string;
  rule: string;
  rolls?: Roll[];
};
export type TimedEffect = {
  id: string;
  event: string;
  unitId: string;
  priority: number;
  owner?: Player;
  optional?: boolean;
  until?: { turn: number; phase?: Phase };
  exclusiveKey?: string;
  operation: "hit-modifier" | "wound-modifier";
  value: number;
  expiresRevision?: number;
};
export type GameState = {
  id: string;
  ruleVersion: string;
  revision: number;
  status: "lobby" | "active" | "finished";
  players: [string | null, string | null];
  armies: [string, string];
  turn: Player;
  turnNumber: number;
  round: number;
  phase: Phase;
  width: number;
  height: number;
  units: Unit[];
  terrain: Terrain[];
  objectives: Objective[];
  cp: [number, number];
  vp: [number, number];
  winner?: Player | "draw";
  events: GameEvent[];
  effects: TimedEffect[];
  effectActor?: Player;
  effectOrders?: [string[], string[]];
  fightPlayer: Player;
  fightStep: "pile-in" | "combat" | "consolidate";
  fightPassed: Player[];
  fightEligible: string[];
  fightEngagedStart?: string[];
  smokeUnits?: { unitId: string; turn: number }[];
  commandPending?: boolean;
  stratagemUses?: StratagemUse[];
  autoRolls?: [boolean, boolean];
  reaction?: {
    player: Player;
    kind: "movementEnd" | "shootingStart" | "chargeEnd" | "afterEnemyFight";
    advance: boolean;
  };
  resolution?: {
    original: GameState;
    actor: Player;
    action: Action;
    tape: number[];
    accepted: number;
    overrides: Record<number, Roll>;
    roll: Roll;
    meta: RollMeta;
  };
  pending?: {
    kind: "advance" | "charge";
    unitId: string;
    distance: number;
    player?: Player;
    allowedTargets?: string[];
    maxDistance?: number;
    rerolled?: boolean;
  };
};
const point = z
  .object({
    x: z.number().finite().min(0).max(200),
    y: z.number().finite().min(0).max(200),
  })
  .strict();
const unitId = z.string().min(1).max(80);
const paths = z
  .array(
    z
      .object({ modelId: unitId, points: z.array(point).min(1).max(24) })
      .strict(),
  )
  .max(30);
export const actionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("orderEffects"), ids: z.array(unitId).max(100) })
    .strict(),
  z.object({ type: z.literal("dicePolicy"), automatic: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("resolveRoll"),
      reroll: z.boolean(),
      dieIndex: z.number().int().min(0).max(999).optional(),
    })
    .strict(),
  z.object({ type: z.literal("passReaction") }).strict(),
  z
    .object({
      type: z.literal("stratagem"),
      name: z.enum([
        "bravery",
        "grenade",
        "overwatch",
        "rapidIngress",
        "smoke",
        "heroic",
        "counteroffensive",
        "commandReroll",
      ]),
      unitId,
      targetId: unitId.optional(),
      paths: paths.optional(),
      dieIndex: z.number().int().min(0).max(999).optional(),
      intoFray: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("next") }).strict(),
  z.object({ type: z.literal("resign") }).strict(),
  z
    .object({
      type: z.literal("move"),
      unitId,
      mode: z.enum(["normal", "fallback", "stationary"]),
      desperate: z.boolean().optional(),
      paths,
    })
    .strict(),
  z.object({ type: z.literal("advance"), unitId }).strict(),
  z.object({ type: z.literal("charge"), unitId }).strict(),
  z
    .object({
      type: z.literal("commit"),
      paths,
      targets: z.array(unitId).max(30).optional(),
      decline: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("volley"),
      unitId,
      pools: z
        .array(
          z
            .object({
              weaponId: unitId,
              targetId: unitId,
              allocations: z
                .array(
                  z
                    .object({
                      modelId: unitId,
                      attacks: z.number().int().min(1).max(100),
                    })
                    .strict(),
                )
                .min(1)
                .max(30),
            })
            .strict(),
        )
        .min(1)
        .max(30),
      lethal: z.boolean().optional(),
      twinLinked: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("attack"),
      unitId,
      targetId: unitId,
      weaponId: unitId,
      lethal: z.boolean().optional(),
      twinLinked: z.boolean().optional(),
      shootingType: z
        .enum(["normal", "assault", "close-quarters", "indirect"])
        .optional(),
      ignorePsychicModifiers: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("reserve"), unitId, reserve: z.boolean() })
    .strict(),
  z.object({ type: z.literal("deploy"), unitId, paths }).strict(),
  z.object({ type: z.literal("ingress"), unitId, paths }).strict(),
  z
    .object({
      type: z.literal("allocate"),
      unitId,
      modelIds: z.array(unitId).min(1).max(30),
    })
    .strict(),
  z
    .object({
      type: z.literal("fightMove"),
      unitId,
      paths,
      targets: z.array(unitId).max(30).optional(),
      objectiveId: unitId.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("terrain"),
      terrain: z
        .object({
          id: unitId,
          name: z.string().trim().min(1).max(40),
          category: z.enum(["exposed", "light", "dense"]),
          x: z.number().finite().min(0),
          y: z.number().finite().min(0),
          width: z.number().finite().positive().max(12),
          height: z.number().finite().positive().max(12),
          solid: z.boolean(),
        })
        .strict(),
    })
    .strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export const envelopeSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().min(0),
    action: actionSchema,
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export const armySchema = z.enum(["sentinels", "raiders"]);
export const sessionSchema = z
  .object({ name: z.string().trim().min(1).max(32) })
  .strict();
export const createSchema = z.object({ army: armySchema }).strict();
export const joinSchema = z
  .object({ invite: z.string().regex(/^[a-f0-9]{64}$/), army: armySchema })
  .strict();
export type RoomResponse = { state: GameState; seat: Player; invite?: string };
export type ActionResponse =
  | { ok: true; state: GameState; duplicate?: boolean }
  | { ok: false; error: string };
