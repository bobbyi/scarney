import { test, expect, type Page } from "@playwright/test";

async function revealedCount(page: Page, boardSelector: string): Promise<number> {
  return page.locator(`${boardSelector} .board-slot > .card:not(.placeholder):not(.discard)`).count();
}

async function placeholderCount(page: Page, boardSelector: string): Promise<number> {
  return page.locator(`${boardSelector} .card.placeholder`).count();
}

async function handRanks(page: Page): Promise<string[]> {
  return page
    .locator("#hand .card")
    .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")?.split(" ")[0] ?? ""));
}

async function discardRanksInSlot(page: Page, slotIndex: number): Promise<string[]> {
  return page
    .locator(`#board-a .board-slot:nth-child(${slotIndex + 1}) .card.discard`)
    .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")?.split(" ")[0] ?? ""));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("deals a hand of 5 cards and hides both boards on load", async ({ page }) => {
  await expect(page.locator("#hand .card")).toHaveCount(5);
  await expect(page.locator("#hand .card.placeholder")).toHaveCount(0);

  expect(await placeholderCount(page, "#board-a")).toBe(5);
  expect(await placeholderCount(page, "#board-b")).toBe(5);
  expect(await revealedCount(page, "#board-a")).toBe(0);
  expect(await revealedCount(page, "#board-b")).toBe(0);

  await expect(page.locator("#next-button")).toBeEnabled();
});

test("Next Round reveals one card on each board per click", async ({ page }) => {
  await page.locator("#next-button").click();

  expect(await revealedCount(page, "#board-a")).toBe(1);
  expect(await revealedCount(page, "#board-b")).toBe(1);
  expect(await placeholderCount(page, "#board-a")).toBe(4);
  expect(await placeholderCount(page, "#board-b")).toBe(4);

  await page.locator("#next-button").click();

  expect(await revealedCount(page, "#board-a")).toBe(2);
  expect(await revealedCount(page, "#board-b")).toBe(2);
});

test("clicking Next Round 5 times fully reveals both boards and disables the button", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await page.locator("#next-button").click();
  }

  expect(await revealedCount(page, "#board-a")).toBe(5);
  expect(await revealedCount(page, "#board-b")).toBe(5);
  expect(await placeholderCount(page, "#board-a")).toBe(0);
  expect(await placeholderCount(page, "#board-b")).toBe(0);

  await expect(page.locator("#next-button")).toBeDisabled();
});

test("Deal Hand resets to a new hand and hides both boards again", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await page.locator("#next-button").click();
  }
  await expect(page.locator("#next-button")).toBeDisabled();

  await page.locator("#deal-button").click();

  await expect(page.locator("#hand .card")).toHaveCount(5);
  expect(await placeholderCount(page, "#board-a")).toBe(5);
  expect(await placeholderCount(page, "#board-b")).toBe(5);
  await expect(page.locator("#next-button")).toBeEnabled();
});

test("discards hand cards matching each revealed top-board rank into that slot's pile", async ({ page }) => {
  for (let round = 0; round < 5; round++) {
    const handBefore = await handRanks(page);

    await page.locator("#next-button").click();

    const revealedRank = await page
      .locator(`#board-a .board-slot:nth-child(${round + 1}) > img.card:not(.discard)`)
      .evaluate((img) => img.getAttribute("alt")?.split(" ")[0] ?? "");

    const expectedRemaining = handBefore.filter((rank) => rank !== revealedRank);
    const expectedDiscarded = handBefore.filter((rank) => rank === revealedRank);

    const handAfter = await handRanks(page);
    expect(handAfter.sort()).toEqual(expectedRemaining.sort());

    const discarded = await discardRanksInSlot(page, round);
    expect(discarded.sort()).toEqual(expectedDiscarded.sort());
  }
});

test("discards both hand cards when two share the revealed rank, via a fixed ?deck= scenario", async ({ page }) => {
  const deck = "KS,KH,2C,3D,4H,KC,5S,6D,7H,8C,9S,10D,JC,QH,AC";
  await page.goto(`/?deck=${deck}`);

  await expect(page.locator("#hand .card")).toHaveCount(5);
  expect(await handRanks(page)).toEqual(["K", "K", "2", "3", "4"]);

  await page.locator("#next-button").click();

  expect(await handRanks(page)).toEqual(["2", "3", "4"]);
  expect((await discardRanksInSlot(page, 0)).sort()).toEqual(["K", "K"]);

  // the override should also survive re-dealing, for repeatable manual/automated debugging
  await page.locator("#deal-button").click();
  expect(await handRanks(page)).toEqual(["K", "K", "2", "3", "4"]);
});
