import process from "node:process";
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
config({ quiet: true });
const commands = {
  dev: [
    [
      "exec",
      "concurrently",
      "-n",
      "api,web",
      "pnpm --filter @tabletop/server dev",
      "pnpm --filter @tabletop/web dev",
    ],
  ],
  build: [
    ["--filter", "@tabletop/server", "build"],
    ["--filter", "@tabletop/web", "build"],
  ],
};
const command = commands[process.argv[2]];
if (!command) throw Error("Expected dev or build");
for (const args of command) {
  const result = spawnSync("pnpm", args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
