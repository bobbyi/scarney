import { test, expect, type Page } from "@playwright/test";

// Most tests need deterministic opponent behavior (the production default is now a random
// strategy), so the calling-station debug override is the default navigation for this suite.
const CALLING_STATION = "opponent=calling-station";

const checkButton = (page: Page) => page.locator('[data-action="check"]');
const betButton = (page: Page) => page.locator('[data-action="bet"]');
const callButton = (page: Page) => page.locator('[data-action="call"]');
const raiseButton = (page: Page) => page.locator('[data-action="raise"]');
const foldButton = (page: Page) => page.locator('[data-action="fold"]');
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
  await page.goto(`/?${CALLING_STATION}`);
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

test("antes $1 from each player and, since the player holds the button first, shows the opponent's forced check", async ({ page }) => {
  await expect(page.locator("#balance")).toHaveText("$99");
  await expect(page.locator("#pot-status")).toHaveText("Pot: $2 — Both players ante $1; Opponent checks");
  await expect(page.locator("#player-dealer-badge .dealer-badge")).toHaveCount(1);
  await expect(page.locator("#opponent-dealer-badge .dealer-badge")).toHaveCount(0);
});

test("Check reveals one card on each board per click and leaves balance/pot unchanged", async ({ page }) => {
  await checkButton(page).click();

  expect(await revealedCount(page, "#board-a")).toBe(1);
  expect(await revealedCount(page, "#board-b")).toBe(1);
  expect(await placeholderCount(page, "#board-a")).toBe(4);
  expect(await placeholderCount(page, "#board-b")).toBe(4);
  await expect(page.locator("#balance")).toHaveText("$99");
  // the opponent's forced opening check from round 0 already showed; matching it with a check of
  // our own needs no further note, so this now shows just the *next* round's forced opening check
  await expect(page.locator("#pot-status")).toHaveText("Pot: $2 — Opponent checks");

  await checkButton(page).click();

  expect(await revealedCount(page, "#board-a")).toBe(2);
  expect(await revealedCount(page, "#board-b")).toBe(2);
});

test("Bet increases the pot, decreases the balance, and shows both the opponent's call and their next check", async ({ page }) => {
  await betButton(page).click();

  await expect(page.locator("#balance")).toHaveText("$98");
  // both events since our last click land in one status line: closing this round (call), then
  // opening the next one (check) — this is the fix for the "opponent takes two actions" bug
  await expect(page.locator("#pot-status")).toHaveText("Pot: $4 — Opponent calls; Opponent checks");
  expect(await revealedCount(page, "#board-a")).toBe(1);
});

test("shows the dealer badge next to the player first, then swaps to the opponent the next hand", async ({ page }) => {
  await expect(page.locator("#player-dealer-badge .dealer-badge")).toHaveCount(1);
  await expect(page.locator("#opponent-dealer-badge .dealer-badge")).toHaveCount(0);

  for (let i = 0; i < 6; i++) {
    await checkButton(page).click();
  }
  await nextHandButton(page).click();

  await expect(page.locator("#player-dealer-badge .dealer-badge")).toHaveCount(0);
  await expect(page.locator("#opponent-dealer-badge .dealer-badge")).toHaveCount(1);
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
  // player wins both high and low on this deck (see the showdown test below), so an all-checks
  // hand still nets +$2 from the ante pot, giving a deterministic balance to carry into hand 2
  const deck = "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S";
  await page.goto(`/?deck=${deck}&${CALLING_STATION}`);

  for (let i = 0; i < 6; i++) {
    await checkButton(page).click();
  }
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#balance")).toHaveText("$101");

  await nextHandButton(page).click();

  await expect(page.locator("#hand .card")).toHaveCount(5);
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  expect(await placeholderCount(page, "#board-a")).toBe(5);
  expect(await placeholderCount(page, "#board-b")).toBe(5);
  await expect(checkButton(page)).toBeVisible();
  await expect(betButton(page)).toBeVisible();
  // hand 2: balance carries over ($101), then that hand's own ante is deducted ($100)
  await expect(page.locator("#balance")).toHaveText("$100");
  // hand 2's button goes to the opponent, so the player acts first with no forced opponent check
  await expect(page.locator("#pot-status")).toHaveText("Pot: $2 — Both players ante $1");
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
  await page.goto(`/?deck=${deck}&${CALLING_STATION}`);

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
  await page.goto(`/?deck=${deck}&${CALLING_STATION}`);

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
  await page.goto(`/?deck=${deck}&${CALLING_STATION}`);

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
  await page.goto(`/?deck=${deck}&${CALLING_STATION}`);

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
  await page.goto(`/?deck=${deck}&${CALLING_STATION}`);

  // player bets the first three ($1) rounds, then checks the last three ($2) rounds
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$98");
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$97");
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$96");
  await expect(page.locator("#pot-status")).toHaveText("Pot: $8 — Opponent calls; Opponent checks");

  await checkButton(page).click();
  await checkButton(page).click();
  await checkButton(page).click();

  // player wins both high and low (see the showdown test above), so the full $8 pot (including
  // both antes) comes back
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#balance")).toHaveText("$104");
});

test("an opponent's bet presents Call/Raise/Fold, and calling closes the round", async ({ page }) => {
  await page.goto("/?opponent=aggressor");

  // hand 1: player holds the button, so the opponent (aggressor) acts first and opens with a bet
  await expect(callButton(page)).toHaveText("Call $1");
  await expect(raiseButton(page)).toHaveText("Raise $2");
  await expect(foldButton(page)).toBeVisible();
  await expect(page.locator("#pot-status")).toHaveText("Pot: $3 — Both players ante $1; Opponent bets $1");

  await callButton(page).click();

  // the round closes and the board reveals; the next round opens the same way
  expect(await revealedCount(page, "#board-a")).toBe(1);
  await expect(callButton(page)).toHaveText("Call $1");
  await expect(page.locator("#pot-status")).toHaveText("Pot: $5 — Opponent bets $1");
});

test("raising keeps the round open (no reveal) until someone calls", async ({ page }) => {
  await page.goto("/?opponent=aggressor");
  await expect(callButton(page)).toHaveText("Call $1");

  await raiseButton(page).click();

  // aggressor raises right back; still round 0, no reveal yet, player faces a bet again
  expect(await revealedCount(page, "#board-a")).toBe(0);
  await expect(callButton(page)).toHaveText("Call $1");
  await expect(page.locator("#pot-status")).toHaveText("Pot: $7 — Opponent raises");

  await callButton(page).click();

  // now it closes, board reveals for round 0, and round 1 opens with a fresh bet
  expect(await revealedCount(page, "#board-a")).toBe(1);
  await expect(callButton(page)).toHaveText("Call $1");
});

test("the opponent folding ends the hand immediately without revealing their cards", async ({ page }) => {
  await page.goto("/?opponent=folder");

  // folder always checks when opening, so the player faces Check/Bet first
  await expect(checkButton(page)).toBeVisible();
  await betButton(page).click();

  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#results")).toContainText("Opponent folds — You win $3");
  await expect(page.locator("#balance")).toHaveText("$101"); // $99 after ante + the whole $3 pot
});

test("the player can fold when facing a bet, ending the hand without revealing the opponent's cards", async ({ page }) => {
  await page.goto("/?opponent=aggressor");
  await expect(foldButton(page)).toBeVisible();

  await foldButton(page).click();

  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#results")).toContainText("You fold — Opponent wins $3");
  await expect(page.locator("#balance")).toHaveText("$99"); // just the ante; nothing else was contributed
});
