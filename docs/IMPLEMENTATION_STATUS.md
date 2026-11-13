# Implementation status · 13 November 2026

## Completed local release

The supplied-reference, original-infantry simulator is implemented and locally verified: two-player private matches, editable deployment/terrain, individual models and units, coherent movement, reserves/ingress, five phases, command tests/CP, ranged and split melee attacks, defender casualty order, fight alternation/overrun/consolidation, eight infantry-applicable stratagems, explicit reactions, optional dice decisions and rerolls, objectives, five-round victory/draw and concession.

PixiJS provides original model art, pan/zoom, measurement and path previews alongside accessible coordinate controls. PostgreSQL stores guests, seats, roster choices, current state and accepted action snapshots. Strict Zod input, membership checks, idempotent request IDs and transactional revision comparison prevent forged/random/stale/conflicting actions. Canonical-JSON SHA-256 history chains preserve an auditable sequence. Browser/API/database reconnection restores authoritative state, including paused dice decisions. Prior demo-2 saves upgrade to demo-3 on an accepted action; existing CP and history are preserved.

## Verification completed

- **68 Vitest tests:** 62 engine/protocol tests and 6 real PostgreSQL integration tests. Covers movement boundaries/atomicity, deployment/reserves, dice/combat/abilities, split pools, casualty choices, command/fight/reaction timing, CP limits, reroll checkpoints, source-version upgrade, private room access, simultaneous joins/actions, deduplication and socket synchronization.
- **Five Chromium browser checks:** a realistic two-browser match from creation through five-round scored victory; narrow-screen layout; paused dice/reload/reroll; two-browser melee with Counteroffensive; reserve selection/ingress. Specialized tactical tests use explicitly seeded legal checkpoints; the full-game scenario reaches its phases through ordinary play.
- TypeScript (including Next route type generation), ESLint, formatting, locked dependency installation and both production builds pass.
- Both database migrations applied to a clean disposable PostgreSQL 17 cluster. The complete test suite also passes there.
- An actual PostgreSQL process restart preserves match state. An existing socket receives catch-up and a newly committed action after notification/Prisma-pool recovery. `scripts/verify-db-restart.mts` verifies the selected local data directory before restarting it.
- Production API health/create/join/start/read and production frontend HTTP smoke checks passed. No public deployment was performed.

During a database outage, in-flight requests may fail; refresh/retry from the latest authoritative revision after recovery. Browser test artifacts are ignored under `test-results/`.

## Coverage boundary

This release is a complete playable original-infantry training game, **not complete official Warhammer matched play**. See RULES_IMPLEMENTATION.md, RULES_TRACEABILITY.md and UNRESOLVED_RULES.md. The supplied DOCX omits the full Appendix and authorized official army/mission supplements. Official factions, mixed CHARACTER allocation, transports/attachments, aircraft/flying/FRAME and vertical model geometry require additional inputs and implementation. Their absence is explicit; no official data is fabricated.

Remaining known training assumptions include conservative rectangular path/visibility geometry, straight-line compulsory reach checks, and an explicit unreachable-fighter passing procedure because the summary does not supply the full special-passing text. Broad internal weapon helpers are verified with fixtures; the original playable roster uses its declared Assault/Rapid Fire weapons.

## Publishing

Published to the verified private repository [fakeplastic3/warhammer40k-tabletop-simulator](https://github.com/fakeplastic3/warhammer40k-tabletop-simulator). All local acceptance gates passed before repository creation. The clean hosted [GitHub Actions run](https://github.com/fakeplastic3/warhammer40k-tabletop-simulator/actions/runs/43377539466) passed for application commit `ecfc3c2`: locked install, migrations, typecheck, lint, formatting, 68 tests, production builds and all five browser scenarios. This final publication record changes documentation only.

The hosted test waits for acknowledged revisions between actions. The battlefield renders only when visible board state changes; optional screenshot capture stays local because software WebGL readback can stall hosted runners. Functional canvas/gameplay assertions remain active in CI.

README, deployment instructions, environment template, migrations and traceability were uploaded. Remote file inventory and private visibility were verified. Environment credentials, source DOCX, reference assets, generated artifacts and browser traces are excluded. No public deployment was performed and no production security certification is claimed.
