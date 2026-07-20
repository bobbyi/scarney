import { test, expect, type Page } from "@playwright/test";

// Most tests need deterministic opponent behavior (the production default is now a random
// strategy) and don't care about the banner's exact transient text, so they navigate with both
// the calling-station override and ?fast=1 (collapses banner timing to keep the suite quick).
const FAST_CALLING_STATION = "opponent=calling-station&fast=1";

const checkButton = (page: Page) => page.locator('[data-action="check"]');
const betButton = (page: Page) => page.locator('[data-action="bet"]');
const callButton = (page: Page) => page.locator('[data-action="call"]');
const raiseButton = (page: Page) => page.locator('[data-action="raise"]');
const foldButton = (page: Page) => page.locator('[data-action="fold"]');
const nextHandButton = (page: Page) => page.locator('[data-action="next-hand"]');
const bannerText = (page: Page) => page.locator("#banner-text");
const potAmount = (page: Page) => page.locator("#table-center .pot-amount");

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
  await page.goto(`/?${FAST_CALLING_STATION}`);
});

test("deals a hand of 5 cards and hides both boards on load", async ({ page }) => {
  await expect(page.locator("#hand .card")).toHaveCount(5);
  await expect(page.locator("#hand .card.placeholder")).toHaveCount(0);

  expect(await placeholderCount(page, "#board-a")).toBe(5);
  expect(await placeholderCount(page, "#board-b")).toBe(5);
  expect(await revealedCount(page, "#board-a")).toBe(0);
  expect(await revealedCount(page, "#board-b")).toBe(0);

  await expect(checkButton(page)).toBeEnabled();
  await expect(betButton(page)).toHaveText("Bet ($1)");
});

test("opponent is dealt 5 face-down cards on load", async ({ page }) => {
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
});

test("antes $1 from each player, announces it and the opponent's forced check as banners, then settles on the pot", async ({ page }) => {
  // real timing here (not ?fast=1) so the banner sequence is actually observable
  await page.goto("/?opponent=calling-station");

  await expect(bannerText(page)).toHaveText("Both players ante $1");
  await expect(bannerText(page)).toHaveText("Opponent checks");
  await expect(checkButton(page)).toBeEnabled();

  await expect(page.locator("#balance")).toHaveText("$99");
  await expect(potAmount(page)).toHaveText("$2");
  await expect(page.locator("#player-dealer-badge")).toBeVisible();
  await expect(page.locator("#opponent-dealer-badge")).not.toBeVisible();
});

test("Check reveals one card on each board per click and leaves balance/pot unchanged", async ({ page }) => {
  await page.goto("/?opponent=calling-station"); // real timing to observe the banner
  await expect(checkButton(page)).toBeEnabled();

  await checkButton(page).click();
  // the opponent's forced opening check from round 0 already showed; matching it with a check of
  // our own needs no further announcement, so this is just the *next* round's forced opening check
  await expect(bannerText(page)).toHaveText("Opponent checks");
  await expect(checkButton(page)).toBeEnabled();

  expect(await revealedCount(page, "#board-a")).toBe(1);
  expect(await revealedCount(page, "#board-b")).toBe(1);
  expect(await placeholderCount(page, "#board-a")).toBe(4);
  expect(await placeholderCount(page, "#board-b")).toBe(4);
  await expect(page.locator("#balance")).toHaveText("$99");
  await expect(potAmount(page)).toHaveText("$2");

  await checkButton(page).click();

  expect(await revealedCount(page, "#board-a")).toBe(2);
  expect(await revealedCount(page, "#board-b")).toBe(2);
});

test("Bet increases the pot, decreases the balance, and announces both the opponent's call and their next check in order", async ({ page }) => {
  await page.goto("/?opponent=calling-station"); // real timing to observe the banner sequence
  await expect(checkButton(page)).toBeEnabled();

  await betButton(page).click();

  // both events since our last click show as sequential banners: closing this round (call), then
  // opening the next one (check) — this is the fix for the "opponent takes two actions" bug
  await expect(bannerText(page)).toHaveText("Opponent calls");
  await expect(bannerText(page)).toHaveText("Opponent checks");
  await expect(checkButton(page)).toBeEnabled();

  await expect(page.locator("#balance")).toHaveText("$98");
  await expect(potAmount(page)).toHaveText("$4");
  expect(await revealedCount(page, "#board-a")).toBe(1);
});

test("shows the dealer badge next to the player first, then swaps to the opponent the next hand", async ({ page }) => {
  await expect(page.locator("#player-dealer-badge")).toBeVisible();
  await expect(page.locator("#opponent-dealer-badge")).not.toBeVisible();

  for (let i = 0; i < 6; i++) {
    await checkButton(page).click();
  }
  await nextHandButton(page).click();

  await expect(page.locator("#player-dealer-badge")).not.toBeVisible();
  await expect(page.locator("#opponent-dealer-badge")).toBeVisible();
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
  // the table center switches from the running pot to the (random-deck) showdown result
  await expect(page.locator("#table-center .pot-amount")).toHaveCount(0);
  await expect(page.locator("#table-center .center-line").first()).toBeVisible();
});

test("Next Hand deals a new hand, hides both boards again, and keeps the balance", async ({ page }) => {
  // player wins both high and low on this deck (see the showdown test below), so an all-checks
  // hand still nets +$2 from the ante pot, giving a deterministic balance to carry into hand 2
  const deck = "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S";
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

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
  await expect(potAmount(page)).toHaveText("$2");
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
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

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
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

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
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

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
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

  for (let i = 0; i < 5; i++) {
    await checkButton(page).click();
  }
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);

  await checkButton(page).click();

  // opponent's hand (3S,3H,4D,4C,5S) is now revealed face-up, no discards occurred along the way
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(0);
  await expect(page.locator("#opponent-hand .card")).toHaveCount(5);
  await expect(nextHandButton(page)).toBeVisible();

  // player has four aces (pool: AS,AH,AD,AC,2S + board 6S,7S,8H,9C,10H) vs opponent's straight (board alone is 6-10)
  await expect(page.locator("#table-center")).toContainText("You win the high with Four of a Kind");
  // player points: A+A+A+A+2 = 6, opponent: 3+3+4+4+5 = 19
  await expect(page.locator("#table-center")).toContainText("You win the low with 6 points");
});

test("highlights exactly the 5 cards making up the winning high hand and dims everything else", async ({ page }) => {
  const deck = "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S";
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

  for (let i = 0; i < 6; i++) {
    await checkButton(page).click();
  }
  await expect(page.locator("#table-center")).toContainText("You win the high with Four of a Kind");

  // the winning hand is the four aces plus the ten of hearts as the best available kicker
  // (confirmed directly against pokersolver - which exact kicker it is isn't something we control)
  for (const alt of ["A of spades", "A of hearts", "A of diamonds", "A of clubs", "10 of hearts"]) {
    await expect(page.locator(`img[alt="${alt}"]`)).not.toHaveClass(/dimmed/);
  }

  // everything else on the table is dimmed: the player's non-winning card, the rest of boardB,
  // all of boardA (it never feeds the high hand), and the opponent's entire (losing) hand
  for (const alt of [
    "2 of spades",
    "6 of spades",
    "7 of spades",
    "8 of hearts",
    "9 of clubs",
    "6 of hearts",
    "7 of clubs",
    "8 of spades",
    "9 of hearts",
    "10 of clubs",
    "3 of spades",
    "3 of hearts",
    "4 of diamonds",
    "4 of clubs",
    "5 of spades",
  ]) {
    await expect(page.locator(`img[alt="${alt}"]`)).toHaveClass(/dimmed/);
  }
});

test("betting through a hand settles the pot into the winner's balance at showdown", async ({ page }) => {
  const deck = "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S";
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

  // player bets the first three ($1) rounds, then checks the last three ($2) rounds
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$98");
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$97");
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$96");
  await expect(potAmount(page)).toHaveText("$8");

  await checkButton(page).click();
  await checkButton(page).click();
  await checkButton(page).click();

  // player wins both high and low (see the showdown test above), so the full $8 pot (including
  // both antes) comes back
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#balance")).toHaveText("$104");
});

test("an opponent's bet presents Call/Raise/Fold, and calling closes the round", async ({ page }) => {
  await page.goto("/?opponent=aggressor"); // real timing to observe the banner sequence

  // hand 1: player holds the button, so the opponent (aggressor) acts first and opens with a bet
  await expect(bannerText(page)).toHaveText("Both players ante $1");
  await expect(bannerText(page)).toHaveText("Opponent bets $1");
  await expect(callButton(page)).toBeEnabled();

  await expect(callButton(page)).toHaveText("Call ($1)");
  await expect(raiseButton(page)).toHaveText("Raise ($2)");
  await expect(foldButton(page)).toBeVisible();
  await expect(potAmount(page)).toHaveText("$3");

  await callButton(page).click();

  // the round closes and the board reveals; the next round opens the same way
  await expect(bannerText(page)).toHaveText("Opponent bets $1");
  await expect(callButton(page)).toBeEnabled();
  expect(await revealedCount(page, "#board-a")).toBe(1);
  await expect(callButton(page)).toHaveText("Call ($1)");
  await expect(potAmount(page)).toHaveText("$5");
});

test("raising keeps the round open (no reveal) until someone calls", async ({ page }) => {
  await page.goto("/?opponent=aggressor"); // real timing to observe the banner
  await expect(callButton(page)).toBeEnabled();
  await expect(callButton(page)).toHaveText("Call ($1)");

  await raiseButton(page).click();

  // aggressor raises right back; still round 0, no reveal yet, player faces a bet again
  await expect(bannerText(page)).toHaveText("Opponent raises");
  await expect(callButton(page)).toBeEnabled();
  expect(await revealedCount(page, "#board-a")).toBe(0);
  await expect(callButton(page)).toHaveText("Call ($1)");
  await expect(potAmount(page)).toHaveText("$7");

  await callButton(page).click();

  // now it closes, board reveals for round 0, and round 1 opens with a fresh bet
  await expect(callButton(page)).toBeEnabled();
  expect(await revealedCount(page, "#board-a")).toBe(1);
  await expect(callButton(page)).toHaveText("Call ($1)");
});

test("the opponent folding ends the hand immediately without revealing their cards", async ({ page }) => {
  await page.goto("/?opponent=folder&fast=1");

  // folder always checks when opening, so the player faces Check/Bet first
  await expect(checkButton(page)).toBeVisible();
  await betButton(page).click();

  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#table-center")).toContainText("Opponent folds — You win $3");
  await expect(page.locator("#balance")).toHaveText("$101"); // $99 after ante + the whole $3 pot
});

test("the player can fold when facing a bet, ending the hand without revealing the opponent's cards", async ({ page }) => {
  await page.goto("/?opponent=aggressor&fast=1");
  await expect(foldButton(page)).toBeVisible();

  await foldButton(page).click();

  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#table-center")).toContainText("You fold — Opponent wins $3");
  await expect(page.locator("#balance")).toHaveText("$99"); // just the ante; nothing else was contributed
});
