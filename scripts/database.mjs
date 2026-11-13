import process from "node:process";
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
config({ quiet: true });
const command = process.argv[2];
if (!["generate", "migrate"].includes(command))
  throw Error("Expected generate or migrate");
const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@tabletop/server",
    "exec",
    "prisma",
    ...(command === "generate" ? ["generate"] : ["migrate", "deploy"]),
  ],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
