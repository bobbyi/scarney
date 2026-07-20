import { test, expect, type Page } from "@playwright/test";

const checkButton = (page: Page) => page.locator('[data-action="check"]');
const betButton = (page: Page) => page.locator('[data-action="bet"]');
const nextHandButton = (page: Page) => page.locator('[data-action="next-hand"]');

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

  await expect(checkButton(page)).toBeEnabled();
  await expect(betButton(page)).toHaveText("Bet $1");
});

test("opponent is dealt 5 face-down cards on load", async ({ page }) => {
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
});

test("starts with a $100 balance and an empty pot", async ({ page }) => {
  await expect(page.locator("#balance")).toHaveText("$100");
  await expect(page.locator("#pot-status")).toHaveText("Pot: $0");
});

test("Check reveals one card on each board per click and leaves balance/pot unchanged", async ({ page }) => {
  await checkButton(page).click();

  expect(await revealedCount(page, "#board-a")).toBe(1);
  expect(await revealedCount(page, "#board-b")).toBe(1);
  expect(await placeholderCount(page, "#board-a")).toBe(4);
  expect(await placeholderCount(page, "#board-b")).toBe(4);
  await expect(page.locator("#balance")).toHaveText("$100");
  await expect(page.locator("#pot-status")).toHaveText("Pot: $0 — Opponent checks");

  await checkButton(page).click();

  expect(await revealedCount(page, "#board-a")).toBe(2);
  expect(await revealedCount(page, "#board-b")).toBe(2);
});

test("Bet increases the pot, decreases the balance, and the opponent auto-calls", async ({ page }) => {
  await betButton(page).click();

  await expect(page.locator("#balance")).toHaveText("$99");
  await expect(page.locator("#pot-status")).toHaveText("Pot: $2 — Opponent calls");
  expect(await revealedCount(page, "#board-a")).toBe(1);
});

test("checking through all 6 rounds fully reveals both boards, then shows the showdown and a Next Hand button", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await checkButton(page).click();
  }

  expect(await revealedCount(page, "#board-a")).toBe(5);
  expect(await revealedCount(page, "#board-b")).toBe(5);
  expect(await placeholderCount(page, "#board-a")).toBe(0);
  expect(await placeholderCount(page, "#board-b")).toBe(0);
  await expect(checkButton(page)).toBeVisible();

  await checkButton(page).click();

  await expect(nextHandButton(page)).toBeVisible();
  await expect(checkButton(page)).toHaveCount(0);
  // the pot's been paid out and there's no more "last opponent action" to report, so hide the line
  await expect(page.locator("#pot-status")).toBeEmpty();
});

test("Next Hand deals a new hand, hides both boards again, and keeps the balance", async ({ page }) => {
  for (let i = 0; i < 6; i++) {
    await checkButton(page).click();
  }
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#balance")).toHaveText("$100");

  await nextHandButton(page).click();

  await expect(page.locator("#hand .card")).toHaveCount(5);
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  expect(await placeholderCount(page, "#board-a")).toBe(5);
  expect(await placeholderCount(page, "#board-b")).toBe(5);
  await expect(checkButton(page)).toBeVisible();
  await expect(betButton(page)).toBeVisible();
  await expect(page.locator("#balance")).toHaveText("$100");
  await expect(page.locator("#pot-status")).toHaveText("Pot: $0");
});

test("hand cards matching each revealed top-board rank are discarded", async ({ page }) => {
  // Discard-pile content (player + opponent combined) is checked precisely in the fixed-deck
  // tests below; the opponent's hidden hand makes exact pile content unverifiable from a random deal.
  for (let round = 0; round < 5; round++) {
    const handBefore = await handRanks(page);

    await checkButton(page).click();

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

  await checkButton(page).click();

  expect(await handRanks(page)).toEqual(["2", "3", "4"]);
  expect((await discardRanksInSlot(page, 0)).sort()).toEqual(["K", "K"]);

  // the override should also survive dealing a new hand, for repeatable manual/automated debugging
  for (let i = 0; i < 5; i++) {
    await checkButton(page).click();
  }
  await nextHandButton(page).click();
  expect(await handRanks(page)).toEqual(["K", "K", "2", "3", "4"]);
});

test("hand type and points update as the hand shrinks and the bottom board reveals", async ({ page }) => {
  const deck = "KS,KH,2C,3D,4H,KC,5S,6D,7H,8C,9S,10D,JC,QH,AC,2S,2H,2D,3S,3H";
  await page.goto(`/?deck=${deck}`);

  // before any reveal: pool is just the 5-card hand (two kings -> Pair), points = 10+10+2+3+4
  await expect(page.locator("#hand-type")).toHaveText("Pair");
  await expect(page.locator("#point-total")).toHaveText("29");

  // round 1: both kings discard (High Card left: 2,3,4), bottom board reveals 9S -> still High Card
  await checkButton(page).click();
  await expect(page.locator("#hand-type")).toHaveText("High Card");
  await expect(page.locator("#point-total")).toHaveText("9");
});

test("opponent's matching-rank cards discard and slide left with no gaps, staying face-down", async ({ page }) => {
  const deck = "2S,3D,4H,5C,6S,QS,7D,8H,9C,10S,JS,JH,JD,JC,KS,QH,QD,7S,8S,9S";
  await page.goto(`/?deck=${deck}`);

  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);

  await checkButton(page).click();

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
    await checkButton(page).click();
  }
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  await expect(page.locator("#results")).toBeEmpty();

  await checkButton(page).click();

  // opponent's hand (3S,3H,4D,4C,5S) is now revealed face-up, no discards occurred along the way
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(0);
  await expect(page.locator("#opponent-hand .card")).toHaveCount(5);
  await expect(nextHandButton(page)).toBeVisible();

  // player has four aces (pool: AS,AH,AD,AC,2S + board 6S,7S,8H,9C,10H) vs opponent's straight (board alone is 6-10)
  await expect(page.locator("#results")).toContainText("You win the high with Four of a Kind");
  // player points: A+A+A+A+2 = 6, opponent: 3+3+4+4+5 = 19
  await expect(page.locator("#results")).toContainText("You win the low with 6 points");
});

test("betting through a hand settles the pot into the winner's balance at showdown", async ({ page }) => {
  const deck = "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S";
  await page.goto(`/?deck=${deck}`);

  // player bets the first three ($1) rounds, then checks the last three ($2) rounds
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$99");
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$98");
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$97");
  await expect(page.locator("#pot-status")).toHaveText("Pot: $6 — Opponent calls");

  await checkButton(page).click();
  await checkButton(page).click();
  await checkButton(page).click();

  // player wins both high and low (see the showdown test above), so the full $6 pot comes back
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#balance")).toHaveText("$103");
});
