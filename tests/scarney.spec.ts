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

test("opponent is dealt 5 face-down cards on load", async ({ page }) => {
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
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

test("clicking Next Round 5 times fully reveals both boards and the button becomes Showdown", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await page.locator("#next-button").click();
  }

  expect(await revealedCount(page, "#board-a")).toBe(5);
  expect(await revealedCount(page, "#board-b")).toBe(5);
  expect(await placeholderCount(page, "#board-a")).toBe(0);
  expect(await placeholderCount(page, "#board-b")).toBe(0);

  await expect(page.locator("#next-button")).toHaveText("Showdown");
  await expect(page.locator("#next-button")).toBeEnabled();
});

test("Deal Hand resets to a new hand and hides both boards again", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await page.locator("#next-button").click();
  }
  await expect(page.locator("#next-button")).toHaveText("Showdown");

  await page.locator("#deal-button").click();

  await expect(page.locator("#hand .card")).toHaveCount(5);
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  expect(await placeholderCount(page, "#board-a")).toBe(5);
  expect(await placeholderCount(page, "#board-b")).toBe(5);
  await expect(page.locator("#next-button")).toHaveText("Next Round");
  await expect(page.locator("#next-button")).toBeEnabled();
});

test("hand cards matching each revealed top-board rank are discarded", async ({ page }) => {
  // Discard-pile content (player + opponent combined) is checked precisely in the fixed-deck
  // tests below; the opponent's hidden hand makes exact pile content unverifiable from a random deal.
  for (let round = 0; round < 5; round++) {
    const handBefore = await handRanks(page);

    await page.locator("#next-button").click();

    const revealedRank = await page
      .locator(`#board-a .board-slot:nth-child(${round + 1}) > img.card:not(.discard)`)
      .evaluate((img) => img.getAttribute("alt")?.split(" ")[0] ?? "");

    const expectedRemaining = handBefore.filter((rank) => rank !== revealedRank);

    const handAfter = await handRanks(page);
    expect(handAfter.sort()).toEqual(expectedRemaining.sort());
  }
});

test("discards both hand cards when two share the revealed rank, via a fixed ?deck= scenario", async ({ page }) => {
  const deck = "KS,KH,2C,3D,4H,KC,5S,6D,7H,8C,9S,10D,JC,QH,AC,2S,2H,2D,3S,3H";
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

test("hand type and points update as the hand shrinks and the bottom board reveals", async ({ page }) => {
  const deck = "KS,KH,2C,3D,4H,KC,5S,6D,7H,8C,9S,10D,JC,QH,AC,2S,2H,2D,3S,3H";
  await page.goto(`/?deck=${deck}`);

  // before any reveal: pool is just the 5-card hand (two kings -> Pair), points = 10+10+2+3+4
  await expect(page.locator("#hand-type")).toHaveText("Pair");
  await expect(page.locator("#point-total")).toHaveText("29");

  // round 1: both kings discard (High Card left: 2,3,4), bottom board reveals 9S -> still High Card
  await page.locator("#next-button").click();
  await expect(page.locator("#hand-type")).toHaveText("High Card");
  await expect(page.locator("#point-total")).toHaveText("9");
});

test("opponent's matching-rank cards discard and slide left with no gaps, staying face-down", async ({ page }) => {
  const deck = "2S,3D,4H,5C,6S,QS,7D,8H,9C,10S,JS,JH,JD,JC,KS,QH,QD,7S,8S,9S";
  await page.goto(`/?deck=${deck}`);

  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);

  await page.locator("#next-button").click();

  // opponent held QH, QD; boardA's first reveal is QS, so both discard, leaving 3 face-down cards
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(3);
  // player's hand (2,3,4,5,6) has no queens, so it is untouched
  expect(await handRanks(page)).toEqual(["2", "3", "4", "5", "6"]);
  expect((await discardRanksInSlot(page, 0)).sort()).toEqual(["Q", "Q"]);
});

test("Showdown reveals the opponent's hand and declares high/low winners", async ({ page }) => {
  const deck = "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S";
  await page.goto(`/?deck=${deck}`);

  for (let i = 0; i < 5; i++) {
    await page.locator("#next-button").click();
  }
  await expect(page.locator("#next-button")).toHaveText("Showdown");
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  await expect(page.locator("#results")).toBeEmpty();

  await page.locator("#next-button").click();

  // opponent's hand (3S,3H,4D,4C,5S) is now revealed face-up, no discards occurred along the way
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(0);
  await expect(page.locator("#opponent-hand .card")).toHaveCount(5);
  await expect(page.locator("#next-button")).toBeDisabled();

  // player has four aces (pool: AS,AH,AD,AC,2S + board 6S,7S,8H,9C,10H) vs opponent's straight (board alone is 6-10)
  await expect(page.locator("#results")).toContainText("You win the high with Four of a Kind");
  // player points: A+A+A+A+2 = 6, opponent: 3+3+4+4+5 = 19
  await expect(page.locator("#results")).toContainText("You win the low with 6 points");
});
