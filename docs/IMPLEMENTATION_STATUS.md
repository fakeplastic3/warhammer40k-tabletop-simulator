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

The completed local original-profile acceptance gates passed before repository creation. README, deployment instructions, environment template, migrations, CI workflow and source traceability are present. Environment credentials, source DOCX, reference assets, generated artifacts and browser traces are excluded from version control. Publication status and remote CI verification are recorded after the private push; this document does not claim a public deployment or production security certification.
