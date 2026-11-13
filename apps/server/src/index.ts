import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env") });
config();
const { PrismaClient } = await import("@prisma/client");
const { buildApp } = await import("./app");
const db = new PrismaClient();
const { app } = await buildApp(db, {
  origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3000",
});
await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "127.0.0.1",
});
console.log(
  `Authoritative tabletop API: http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3001}`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
