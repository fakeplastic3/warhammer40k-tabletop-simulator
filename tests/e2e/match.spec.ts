import { test, expect, type Page, type Locator } from "@playwright/test";
import type { GameState } from "@tabletop/shared";
async function snapshot(page: Page, id: string): Promise<GameState> {
  return page.evaluate(async (id) => {
    const r = await fetch(`http://127.0.0.1:3001/matches/${id}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("tabletop-session")}`,
      },
    });
    return (await r.json()).state;
  }, id);
}
async function committedClick(page: Page, button: Locator) {
  const label = page.locator(".battle-log .panel-heading span");
  const revision = async () =>
    Number((await label.innerText()).match(/REV (\d+)/)![1]);
  const before = await revision();
  await button.click();
  // A click completes before its socket acknowledgement. Wait for the rendered
  // authoritative revision before selecting the commander for the next action.
  await expect.poll(revision).toBeGreaterThan(before);
}
async function advance(page: Page) {
  await committedClick(
    page,
    page.getByRole("button", {
      name: /^(END PHASE|FINISH PILE-IN|END FIGHT STEP|FINISH CONSOLIDATE)/,
    }),
  );
}
async function move(page: Page, x: number) {
  await page.getByLabel("Destination X", { exact: true }).fill(String(x));
  await page.getByLabel("Destination Y", { exact: true }).fill("8");
  await page.getByRole("button", { name: "PREVIEW", exact: true }).click();
  await committedClick(
    page,
    page.getByRole("button", { name: "SUBMIT MOVE", exact: true }),
  );
}
test("two browsers create, join, move, reject, attack, reconnect and finish five rounds", async ({
  browser,
  page: a,
}) => {
  test.setTimeout(180000);
  const contextB = await browser.newContext();
  const b = await contextB.newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  await a.goto("/");
  await a.getByLabel("Commander name").fill("Browser Alpha");
  await a.getByRole("button", { name: /CREATE PRIVATE MATCH/ }).click();
  await expect(a.getByLabel("Shareable invitation")).toBeVisible();
  await a.getByRole("button", { name: "SETTINGS", exact: true }).click();
  await a.getByLabel("Feature name", { exact: true }).fill("Verified relay");
  await committedClick(
    a,
    a.getByRole("button", { name: "APPLY TERRAIN", exact: true }),
  );
  await a.getByRole("button", { name: "CLOSE ×", exact: true }).click();
  const invitation = await a.getByLabel("Shareable invitation").inputValue();
  const id = new URL(invitation).pathname.split("/").at(-1)!;
  await b.goto(invitation);
  await b.getByLabel("Commander name").fill("Browser Beta");
  await b.getByRole("button", { name: "JOIN PRIVATE MATCH" }).click();
  await expect(a.getByRole("button", { name: "BEGIN BATTLE" })).toBeEnabled();
  await committedClick(a, a.getByRole("button", { name: "BEGIN BATTLE" }));
  await expect(a.getByRole("button", { name: /END PHASE/ })).toBeVisible();
  await expect(a.locator("canvas")).toBeVisible();
  await expect(b.locator("canvas")).toBeVisible();
  await advance(a);
  await move(a, 10);
  await expect
    .poll(async () => (await snapshot(b, id)).units[0].models[0].x)
    .toBe(10);
  await a.getByTestId("unit-p0-u1").click();
  await a.getByLabel("Destination X", { exact: true }).fill("44");
  await a.getByLabel("Destination Y", { exact: true }).fill("22");
  await a.getByRole("button", { name: "PREVIEW", exact: true }).click();
  const revision = (await snapshot(a, id)).revision;
  await a.getByRole("button", { name: "SUBMIT MOVE", exact: true }).click();
  await expect(a.locator("p[role=alert]")).toContainText(/edge|exceeds/);
  expect((await snapshot(a, id)).revision).toBe(revision);
  await a.getByRole("button", { name: "CLEAR", exact: true }).click();
  await a.getByTestId("unit-p0-u0").click();
  // Complete each turn, using the UI for all authoritative transitions.
  let attacked = false,
    movedB = false;
  for (let i = 0; i < 180; i++) {
    const s = await snapshot(a, id);
    if (s.status === "finished") break;
    if (s.reaction) {
      const p = s.reaction.player === 0 ? a : b;
      await committedClick(
        p,
        p.getByRole("button", { name: "FINISH REACTIONS", exact: true }),
      );
      continue;
    }
    const active = s.phase === "fight" ? s.fightPlayer : s.turn;
    const p = active === 0 ? a : b;
    await expect(
      p.getByRole("button", {
        name: /^(END PHASE|FINISH PILE-IN|END FIGHT STEP|FINISH CONSOLIDATE)/,
      }),
    ).toBeEnabled();
    if (s.round === 1 && s.turn === 1 && s.phase === "movement" && !movedB) {
      await move(b, 34);
      movedB = true;
    }
    if (s.round === 2 && s.turn === 0 && s.phase === "movement") {
      await move(a, 16);
    }
    if (s.round === 2 && s.turn === 0 && s.phase === "shooting" && !attacked) {
      await a.getByLabel("Enemy target", { exact: true }).selectOption("p1-u0");
      await a.getByLabel("Weapon", { exact: true }).selectOption("carbine");
      await a.getByRole("button", { name: "RESOLVE ATTACK →" }).click();
      await expect(a.locator(".battle-log")).toContainText("hits");
      await expect(b.locator(".battle-log")).toContainText("hits");
      const after = await snapshot(a, id);
      expect(after.events[0].rolls!.length).toBeGreaterThan(0);
      await expect
        .poll(async () => JSON.stringify(await snapshot(b, id)))
        .toBe(JSON.stringify(after));
      attacked = true;
      await a.reload();
      await expect(a.locator("canvas")).toBeVisible();
      expect(await snapshot(a, id)).toEqual(after);
      await expect(a.locator(".connection")).toContainText("SYNCHRONIZED");
    }
    await advance(p);
  }
  expect(attacked).toBe(true);
  const end = await snapshot(a, id);
  expect(end.status).toBe("finished");
  expect(end.round).toBe(5);
  expect(end.vp[0]).toBeGreaterThan(0);
  await expect
    .poll(async () => JSON.stringify(await snapshot(b, id)))
    .toBe(JSON.stringify(end));
  await expect(a.locator(".turn-label")).toContainText("BATTLE COMPLETE");
  await expect(b.locator(".turn-label")).toContainText("BATTLE COMPLETE");
  expect(errors).toEqual([]);
  // Software WebGL screenshot readback can stall on hosted Linux runners.
  // The functional assertions and real canvas checks above still run in CI.
  if (!process.env.CI) {
    await a.screenshot({
      path: "test-results/completed-match.png",
      fullPage: true,
    });
  }
  await contextB.close();
});

test("home adapts to a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Muster your force" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
