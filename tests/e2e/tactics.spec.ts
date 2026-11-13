import { test, expect, type Page } from "@playwright/test";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import type { GameState } from "@tabletop/shared";
config({ quiet: true });
const db = new PrismaClient();
async function snapshot(page: Page, id: string): Promise<GameState> {
  return page.evaluate(
    async (id) =>
      (
        await (
          await fetch(`http://127.0.0.1:3001/matches/${id}`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("tabletop-session")}`,
            },
          })
        ).json()
      ).state,
    id,
  );
}
async function room(a: Page, b: Page) {
  await a.goto("/");
  await a.getByLabel("Commander name").fill("Tactical A");
  await a.getByRole("button", { name: /CREATE PRIVATE MATCH/ }).click();
  const invitation = await a.getByLabel("Shareable invitation").inputValue();
  const id = new URL(invitation).pathname.split("/").at(-1)!;
  await b.goto(invitation);
  await b.getByLabel("Commander name").fill("Tactical B");
  await b
    .getByRole("button", { name: "JOIN PRIVATE MATCH", exact: true })
    .click();
  await expect(a.getByRole("button", { name: "BEGIN BATTLE" })).toBeEnabled();
  return id;
}
async function cleanup(id: string) {
  const seats = await db.matchPlayer.findMany({ where: { matchId: id } });
  await db.actionHistory.deleteMany({ where: { matchId: id } });
  await db.matchPlayer.deleteMany({ where: { matchId: id } });
  await db.match.delete({ where: { id } });
  await db.armyConfiguration.deleteMany({
    where: { userId: { in: seats.map((s) => s.userId) } },
  });
  await db.user.deleteMany({
    where: { id: { in: seats.map((s) => s.userId) } },
  });
}
test.afterAll(async () => {
  await db.$disconnect();
});
test("browser dice review survives reload and consumes CP on an actual reroll", async ({
  browser,
  page: a,
}) => {
  const ctx = await browser.newContext(),
    b = await ctx.newPage(),
    id = await room(a, b);
  try {
    // Controlled legal shooting checkpoint; the full-game test covers reaching phases via play.
    const s = await snapshot(a, id);
    s.status = "active";
    s.phase = "shooting";
    s.commandPending = false;
    s.cp = [3, 3];
    s.autoRolls = [false, true];
    s.units[2].models.forEach((m) => (m.x = 20));
    s.terrain = [];
    s.revision++;
    await db.match.update({
      where: { id },
      data: { state: JSON.parse(JSON.stringify(s)), revision: s.revision },
    });
    await a.reload();
    await b.reload();
    await a.getByLabel("Enemy target", { exact: true }).selectOption("p1-u0");
    await a.getByRole("button", { name: "RESOLVE ATTACK →" }).click();
    await expect(
      a.getByRole("region", { name: "Dice decision" }),
    ).toBeVisible();
    const pending = await snapshot(a, id);
    expect(pending.resolution?.tape).toHaveLength(1);
    await a.reload();
    await expect(
      a.getByRole("region", { name: "Dice decision" }),
    ).toBeVisible();
    await a
      .getByRole("button", { name: "COMMAND RE-ROLL · 1 CP", exact: true })
      .click();
    await expect(a.getByRole("region", { name: "Dice decision" })).toBeHidden();
    const result = await snapshot(a, id);
    expect(result.cp[0]).toBe(2);
    expect(result.resolution).toBeUndefined();
    expect(
      result.events.flatMap((e) => e.rolls ?? []).some((r) => r.rerolled),
    ).toBe(true);
    await expect
      .poll(async () => JSON.stringify(await snapshot(b, id)))
      .toBe(JSON.stringify(result));
  } finally {
    await ctx.close();
    await cleanup(id);
  }
});
test("two browsers fight in melee with a Counteroffensive reaction", async ({
  browser,
  page: a,
}) => {
  const ctx = await browser.newContext(),
    b = await ctx.newPage(),
    id = await room(a, b);
  try {
    // A bounded combat checkpoint ensures both squads survive long enough to test alternation.
    const s = await snapshot(a, id);
    s.status = "active";
    s.phase = "fight";
    s.fightStep = "combat";
    s.fightPlayer = 0;
    s.commandPending = false;
    s.cp = [3, 3];
    s.terrain = [];
    s.fightEligible = ["p0-u0", "p1-u0"];
    s.fightEngagedStart = [...s.fightEligible];
    s.units[2].models.forEach((m) => (m.x = 6.5));
    for (const u of s.units) {
      u.weapons.find((w) => w.kind === "melee")!.attacks = 1;
    }
    s.revision++;
    await db.match.update({
      where: { id },
      data: { state: JSON.parse(JSON.stringify(s)), revision: s.revision },
    });
    await a.reload();
    await b.reload();
    await a.getByLabel("Enemy target", { exact: true }).selectOption("p1-u0");
    await expect(a.getByLabel("Weapon", { exact: true })).toHaveValue("blade");
    await a.getByRole("button", { name: "RESOLVE ATTACK →" }).click();
    await expect(
      b.getByRole("button", { name: "COUNTEROFFENSIVE · 2 CP", exact: true }),
    ).toBeVisible();
    await b
      .getByRole("button", { name: "COUNTEROFFENSIVE · 2 CP", exact: true })
      .click();
    await b
      .getByRole("button", { name: "FINISH REACTIONS", exact: true })
      .click();
    await b.getByLabel("Enemy target", { exact: true }).selectOption("p0-u0");
    await b.getByRole("button", { name: "RESOLVE ATTACK →" }).click();
    const result = await snapshot(b, id);
    expect(result.units[0].fought).toBe(true);
    expect(result.units[2].fought).toBe(true);
    expect(result.cp[1]).toBe(1);
    await expect
      .poll(async () => JSON.stringify(await snapshot(a, id)))
      .toBe(JSON.stringify(result));
  } finally {
    await ctx.close();
    await cleanup(id);
  }
});
test("reserve selection and ingress use the visible model-path controls", async ({
  browser,
  page: a,
}) => {
  const ctx = await browser.newContext(),
    b = await ctx.newPage(),
    id = await room(a, b);
  try {
    await a
      .getByRole("button", {
        name: "PLACE IN RESERVES · 100 POINTS",
        exact: true,
      })
      .click();
    await expect(a.getByTestId("unit-p0-u0")).toContainText("RESERVES");
    const s = await snapshot(a, id);
    s.status = "active";
    s.round = 2;
    s.turnNumber = 3;
    s.phase = "movement";
    s.commandPending = false;
    s.revision++;
    await db.match.update({
      where: { id },
      data: { state: JSON.parse(JSON.stringify(s)), revision: s.revision },
    });
    await a.reload();
    await b.reload();
    await a.getByLabel("Destination X", { exact: true }).fill("4");
    await a.getByLabel("Destination Y", { exact: true }).fill("8");
    await a.getByRole("button", { name: "PREVIEW", exact: true }).click();
    await a
      .getByRole("button", { name: "INGRESS PLANNED POSITIONS", exact: true })
      .click();
    await expect(a.getByTestId("unit-p0-u0")).not.toContainText("RESERVES");
    const result = await snapshot(a, id);
    expect(result.units[0].arrivedTurn).toBe(3);
    await expect
      .poll(async () => JSON.stringify(await snapshot(b, id)))
      .toBe(JSON.stringify(result));
  } finally {
    await ctx.close();
    await cleanup(id);
  }
});
