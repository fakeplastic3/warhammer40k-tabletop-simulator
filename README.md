# VOIDLINE · Warhammer tabletop simulator

A local browser-based two-player training simulator with original infantry graphics, an authoritative TypeScript engine, PixiJS battlefield, Fastify/Socket.IO multiplayer, and PostgreSQL persistence.

**This is a limited training implementation.** It is not complete official Warhammer play. The supplied reference is a condensed DOCX claiming 11th edition; it omits the full Rules Appendix, missions and faction datasheets. No official faction profiles, points or artwork are included. See [implementation status](docs/IMPLEMENTATION_STATUS.md), [coverage](docs/RULES_IMPLEMENTATION.md) and [unresolved rules](docs/UNRESOLVED_RULES.md).

## Requirements and setup

Use Node.js 22.12+ and pnpm 10.28.2, plus PostgreSQL 17 (Docker Compose or an existing local installation).

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

Edit `.env`: replace both database password placeholders with the same local password. For Docker:

```sh
docker compose up -d db
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Open **http://127.0.0.1:3000**. The API listens at `http://127.0.0.1:3001`; `/health` checks PostgreSQL. Root development, database and build commands read `.env`. Environment variables already exported by the shell take precedence. Next.js embeds `NEXT_PUBLIC_API_URL` at build time.

An existing PostgreSQL installation also works: set `DATABASE_URL` to a dedicated database you own, then run the generate/migrate commands above. Never point automated tests at a production database. Integration tests create and clean their own records; browser tests leave their completed training matches in the test database.

## Play

1. Enter a commander name, select a training force and create a private match.
2. Copy the invitation. Open it in a second browser profile or private window; enter a second name and join. The host begins the battle.
3. Click your unit/model, then click the battlefield or enter X/Y coordinates and select **Preview**. Default movement translates the whole squad. Use individual mode and appended segments for model-specific paths. Submit the entire plan together. The server checks distance, terrain, bases, engagement and coherency.
4. Advance rolls D6 before you commit a path. Charges roll 2D6 before you choose a target; submit a legal charge or explicitly decline it. A pending roll must be resolved before ending the phase. Shocked units falling back must select desperate escape, which permits enemy-base traversal but causes per-model hazard rolls.
5. Select an enemy and weapon to attack. The attack-pool planner supports per-model targets and melee splits; declare all pools before resolving. The tactical panel lets the defender choose casualty priority. Attacks and dice are server-controlled. At reaction windows the indicated opponent chooses a stratagem or selects **Finish Reactions**. In Fight, both players finish Pile In, alternate mandatory attacks, then both finish Consolidate. The interface selects melee weapons in Fight. An unengaged eligible fighter can use an extra pile-in with **Overrun**. If no enemy is within reach, an explicit, logged training pass prevents a stuck phase.
6. End phases to progress through five rounds. Each controlled marker scores 5 VP at the end of each round. Highest VP wins; ties draw. Settings offers concession and optional per-roll review for Command Re-roll. Advance and Charge also offer a reroll before committing movement. The training mission does not end early on army elimination.

Two original squads of three models deploy in editable default positions on a 44×30 inch board. Each squad has one ranged and one melee weapon, costs 100 original training points, and has infantry Grenades/Smoke keywords. You may place one squad in reserves before battle; ingress starts in round 2. Plan all model endpoints and choose **Ingress Planned Positions**. Both squads in reserve exceed the 50% cap. Training roster selection supplies all profile data; clients cannot import arbitrary units or abilities. Drag the board to pan, scroll to zoom and enable measurement to select two points. Rules and display settings are available in the match header. Before starting, the host can configure terrain in Settings; the server rejects terrain overlapping units or crossing board edges.

Invitation links grant the second seat and should remain private. The bearer session is separate and stays in local storage for 30 days. Keep the same browser profile to resume from the home page. Clearing browser storage or allowing the session to expire loses access to that guest identity; there is no account recovery. Invite fragments are removed from the address bar after capture. They are not session tokens.

## Verify

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

`pnpm test` includes real PostgreSQL integration tests when `DATABASE_URL` is available. Without it, database tests are explicitly skipped; that does **not** satisfy acceptance. Playwright starts the development servers automatically if they are not already running and exercises two isolated browser sessions through a five-round result, including a rejected move, synchronized attack and browser reload. Additional controlled-checkpoint scenarios verify paused dice/reload/reroll, melee with Counteroffensive, and reserve ingress; a fifth check verifies a narrow viewport. Its screenshot and failure traces go to ignored `test-results/`.

The API production bundle includes the shared engine/data packages; no TypeScript runtime loader is needed:

```sh
pnpm --filter @tabletop/server start
pnpm --filter @tabletop/web start
```

Build first. Start each in its own terminal. Server startup reads root `.env`; frontend production environment is determined at build time. See [deployment guide](docs/DEPLOYMENT.md) for private hosting and database backups. The verified release is intended for private use. No public deployment is authorized. See implementation status for publishing and verification details.

## Layout

- `apps/web`: Next.js, responsive match interface and PixiJS battlefield.
- `apps/server`: authenticated HTTP/socket API, transactional persistence and migrations.
- `packages/game-engine`: deterministic rules, geometry, combat, dice and effect ordering.
- `packages/game-data`: original training armies, mission and concise rules reference.
- `packages/shared`: state types and strict Zod action protocol.
- `tests`: boundary tests, PostgreSQL integration and two-browser Playwright scenario.
- `docs`: source inventory, architecture, traceability and remaining work.

The original DOCX and proprietary reference material are excluded from version control. Source references use paragraph/table numbers because the supplied DOCX has no stable page numbering.
