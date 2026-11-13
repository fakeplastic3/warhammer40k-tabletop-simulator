# Private deployment guide

Public deployment is not authorized. These instructions prepare a private environment; they do not claim production hardening or tested remote access.

## Build and run

Use Node.js 22.12+, pnpm 10.28.2 and PostgreSQL 17. Install dependencies with `pnpm install --frozen-lockfile`, configure `.env`, run `pnpm db:generate`, `pnpm db:migrate`, then `pnpm build`. Start API and frontend independently using `pnpm --filter @tabletop/server start` and `pnpm --filter @tabletop/web start` from the workspace root. Keep workspace dependencies and generated Prisma client installed. A process supervisor should restart each service after failures.

For a private network, set `HOST=0.0.0.0` for the API, `WEB_ORIGIN` to the exact frontend origin, and `NEXT_PUBLIC_API_URL` to the API origin reachable by browsers. Rebuild the frontend after changing the public API URL. Frontend production start listens on all interfaces; firewall access explicitly. Development binds the frontend to loopback.

Use a TLS reverse proxy with WebSocket upgrades and suitable timeouts. Permit the exact frontend origin, preserve authorization headers, and keep the database inaccessible to browsers and the public network. Prefer one application instance until load/failover testing is complete. PostgreSQL LISTEN/NOTIFY broadcasts only committed state; notification reconnection renews the Prisma pool and reloads subscribed snapshots. In-flight requests during an outage may fail and must refresh/retry from the latest state. Clients reauthenticate membership on socket reconnect.

## Database operations

Use a dedicated database and least-privilege application role. Back up with `pg_dump` using credentials from a protected environment or `.pgpass`, store backups encrypted, and verify restore in an isolated database. Apply migrations before launching a newly built API. Snapshot the database before schema upgrades. Current migrations are additive, but future incompatible rule changes need an explicit saved-match migration policy; do not edit `ruleVersion` by hand to bypass validation.

Saved demo-2 training snapshots upgrade on a newly accepted action to demo-3; other unrecognized versions are rejected. Guest credentials expire after 30 days. There is no account recovery, administrative UI or automatic record-retention job. Application-level match history is a canonical-JSON SHA-256 chain, with resulting snapshots for new actions. This supports audit against persisted data; it does not prove that a server operator cannot alter dice or rewrite a chain.

## Checks and limitations

Run all README checks against a dedicated test database. Check `/health` and establish a two-browser match after launch. Confirm a real database backup/restore and restart before relying on persistence. Log collection, monitoring, password rotation, robust rate limiting across instances, guest recovery and load testing remain deployment work. Session tokens are bearer credentials in browser storage; use trusted hosts and maintain an XSS-safe application. No production security certification is claimed.

GitHub Actions runs locked installation, PostgreSQL migrations, typecheck, lint, tests, production builds and five browser checks. Audit staged files for `.env`, reference assets and credentials before each private push. Remote workflow results must be checked independently of local results.
