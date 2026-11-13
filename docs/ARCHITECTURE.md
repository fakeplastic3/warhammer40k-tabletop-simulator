# Architecture

## Decisions

pnpm monorepo: Next.js/React/Tailwind application in apps/web, Fastify/Socket.IO service in apps/server, independent deterministic TypeScript engine in packages/game-engine, Zod protocol in packages/shared, original demonstration profiles in packages/game-data. PixiJS renders original geometric soldier icons, bases and board overlays in logical inches. React provides accessible controls and a parallel coordinate movement interface.

PostgreSQL/Prisma stores guest users with hashed bearer credentials, army configurations, player seats, full current state and immutable accepted-action records. Invite capabilities are separate from player identity, stored hashed. The first two authenticated guests with the secret invitation claim seats. Never put session tokens in invitation links. Guests can resume with the same browser credential; cross-device recovery requires manually preserving that credential.

Only the server generates secure dice via node:crypto.randomInt. The engine accepts an injected die source for reproducible tests. Actions use UUID idempotency keys and expected revisions. A transactional revision compare-and-swap serializes commits; database uniqueness protects races across service instances. No state broadcasts occur before persistence commits. Reconnect reauthenticates membership and receives a fresh snapshot. Engine results contain ordered dice records and log entries; history persists their complete resulting snapshot for audit, with a canonical-JSON SHA-256 chain added by the server.

## Milestones and verification gates

1. Source inventory, complete mechanical map, boundaries and architecture before engine work.
2. Authoritative state, geometry, phases, combat and original demo mission; focused boundary tests.
3. Durable two-player rooms, capabilities, revision conflict prevention, action deduplication and reconnection.
4. Pixi battlefield, unit selection, per-model path editing, controls, rules, logs and objectives.
5. Type checks, lint, unit/integration tests, actual PostgreSQL restart/resume, two-browser Playwright match through victory, production builds.
6. Only after all required coverage and acceptance gates pass, audit staged files and create private GitHub repository. Publish only the verified original-profile release and retain explicit source/data/geometry limits; never claim complete official coverage.

## Supported geometry and operation

Flat 44 × 30-inch demonstration board, circular bases, rectangular terrain footprints. Distance uses closest base edges; paths are measured as segment sums. All unit model endpoints are submitted together and accepted atomically. Rendering never grants authority. The server validates identity, membership, active seat, phase, action schema, revision and rule legality.

## Security and deployment

Restrict CORS and Socket.IO origins, rate-limit HTTP, cap payloads, redact tokens, hash credentials, validate all protocol inputs. Use TLS reverse proxy and PostgreSQL backups in production. No public deployment is authorized. PostgreSQL LISTEN/NOTIFY delivers committed snapshots to each service instance; listener reconnection catches up subscribed rooms. Production scaling and failover remain unverified. Battle history is server-auditable, not a cryptographic proof of fair random generation.

## Dice decisions and reaction protocol

Command provides a pre-test choice window. Phase-boundary reactions suspend progression until the designated opponent explicitly finishes; Heroic pending movement resolves before that window closes. CP usage records enforce player/stratagem/unit/phase restrictions. Optional dice review records a generated prefix and deterministic action checkpoint, then pauses before future random results. Accept/reroll resumes the same action from that prefix. Checkpoints and CP-paying decisions use the same transactional persistence and idempotency protocol as every other action.
