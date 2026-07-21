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
const potAmount = (page: Page) => page.locator("#table-center .pot-amount-plain");

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

  // player holds the button (small blind) and faces the $1 blind differential immediately
  await expect(callButton(page)).toBeEnabled();
  await expect(callButton(page)).toHaveText("Call ($1)");
  await expect(raiseButton(page)).toHaveText("Raise ($3)");
});

test("opponent is dealt 5 face-down cards on load", async ({ page }) => {
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
});

test("posts blinds (button = small blind), announces them, and the big blind's option settles into the pot", async ({ page }) => {
  // real timing here (not ?fast=1) so the banner sequence is actually observable
  await page.goto("/?opponent=calling-station");

  await expect(bannerText(page)).toHaveText("Both players post blinds");
  await expect(callButton(page)).toBeEnabled();
  await expect(callButton(page)).toHaveText("Call ($1)");
  // 1 chip (small blind) in front of the player/button, 2 (big blind) in front of the opponent -
  // the pot itself stays empty until this round closes
  await expect(page.locator("#player-bet-stack .chip")).toHaveCount(1);
  await expect(page.locator("#opponent-bet-stack .chip")).toHaveCount(2);
  await expect(potAmount(page)).toHaveText("$0");
  await expect(page.locator("#player-dealer-badge")).toBeVisible();
  await expect(page.locator("#opponent-dealer-badge")).not.toBeVisible();

  await callButton(page).click();
  // waits out both the big blind's option and (since calling-station checks every opening) round
  // 1's own fresh opening check, which follow back-to-back once round 0 closes
  await expect(checkButton(page)).toBeEnabled();

  await expect(page.locator("#balance")).toHaveText("$98"); // $1 small blind + $1 call
  await expect(potAmount(page)).toHaveText("$4"); // blinds (3) + the call (1)
  // $4 pot = 4 white ($1) chips, 0 red ($5) chips
  await expect(page.locator(".chip.white")).toHaveCount(4);
  await expect(page.locator(".chip.red")).toHaveCount(0);
});

test("shows a chip stack next to the pot - white ($1) and red ($5) chips for pot mod/div 5", async ({ page }) => {
  await page.goto(`/?${FAST_CALLING_STATION}`);

  await raiseButton(page).click(); // blinds (3) + raise (3) + call (2) = pot 8
  await expect(potAmount(page)).toHaveText("$8");
  await expect(page.locator(".chip.red")).toHaveCount(1);
  await expect(page.locator(".chip.white")).toHaveCount(3);

  // the chip stack disappears once the hand ends and the results plaque takes over
  for (let i = 0; i < 5; i++) {
    await checkButton(page).click();
  }
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator(".chip.red")).toHaveCount(0);
  await expect(page.locator(".chip.white")).toHaveCount(0);
});

test("Call closes round 0 (revealing one card each), then Check reveals another with no balance/pot change", async ({ page }) => {
  await page.goto("/?opponent=calling-station"); // real timing to observe the banner
  await expect(callButton(page)).toBeEnabled();

  await callButton(page).click();
  // waits out the big blind's option and round 1's own fresh opening check
  await expect(checkButton(page)).toBeEnabled();

  expect(await revealedCount(page, "#board-a")).toBe(1);
  expect(await revealedCount(page, "#board-b")).toBe(1);
  expect(await placeholderCount(page, "#board-a")).toBe(4);
  expect(await placeholderCount(page, "#board-b")).toBe(4);
  await expect(page.locator("#balance")).toHaveText("$98"); // $1 small blind + $1 call
  await expect(potAmount(page)).toHaveText("$4"); // blinds (3) + the call (1)

  await checkButton(page).click();

  // this check doesn't change balance/pot - it's just round 1's own closing action
  await expect(page.locator("#balance")).toHaveText("$98");
  await expect(potAmount(page)).toHaveText("$4");
  expect(await revealedCount(page, "#board-a")).toBe(2);
  expect(await revealedCount(page, "#board-b")).toBe(2);
});

test("Bet increases the pot, decreases the balance, and announces both the opponent's call and their next check in order", async ({ page }) => {
  await page.goto("/?opponent=calling-station"); // real timing to observe the banner sequence
  await callButton(page).click(); // closes round 0 (blinds + call, opponent's option checks)
  await expect(checkButton(page)).toBeEnabled();
  await expect(page.locator("#balance")).toHaveText("$98");

  await betButton(page).click();

  // both events since our last click show as sequential banners: closing this round (call), then
  // opening the next one (check) — this is the fix for the "opponent takes two actions" bug
  await expect(bannerText(page)).toHaveText("Opponent calls");
  await expect(bannerText(page)).toHaveText("Opponent checks");
  await expect(checkButton(page)).toBeEnabled();

  await expect(page.locator("#balance")).toHaveText("$96"); // $98 - $2 (round 1's stake)
  await expect(potAmount(page)).toHaveText("$8"); // $4 (round 0) + $2 bet + $2 call
  expect(await revealedCount(page, "#board-a")).toBe(2);
});

test("shows the dealer badge next to the player first, then swaps to the opponent the next hand", async ({ page }) => {
  await expect(page.locator("#player-dealer-badge")).toBeVisible();
  await expect(page.locator("#opponent-dealer-badge")).not.toBeVisible();

  await callButton(page).click();
  await expect(checkButton(page)).toBeEnabled();
  for (let i = 0; i < 5; i++) {
    await checkButton(page).click();
  }
  await nextHandButton(page).click();

  await expect(page.locator("#player-dealer-badge")).not.toBeVisible();
  await expect(page.locator("#opponent-dealer-badge")).toBeVisible();
});

test("checking through all 6 rounds fully reveals both boards, then shows the showdown and a Next Hand button", async ({ page }) => {
  await callButton(page).click(); // round 0
  await expect(checkButton(page)).toBeEnabled();
  for (let i = 0; i < 4; i++) {
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
  // player wins both high and low on this deck (see the showdown test below), so an all-passive
  // hand (call the blind, then check the rest) nets the whole small pot, giving a deterministic
  // balance to carry into hand 2
  const deck = "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S";
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

  await callButton(page).click();
  await expect(checkButton(page)).toBeEnabled();
  for (let i = 0; i < 5; i++) {
    await checkButton(page).click();
  }
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#balance")).toHaveText("$102");

  await nextHandButton(page).click();

  await expect(page.locator("#hand .card")).toHaveCount(5);
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  expect(await placeholderCount(page, "#board-a")).toBe(5);
  expect(await placeholderCount(page, "#board-b")).toBe(5);
  // hand 2's button goes to the opponent (small blind); calling-station calls automatically,
  // leaving the player (now the big blind) with their own check/raise option
  await expect(checkButton(page)).toBeVisible();
  await expect(betButton(page)).toBeVisible();
  await expect(page.locator("#balance")).toHaveText("$100"); // $102 - $2 big blind
  await expect(potAmount(page)).toHaveText("$0");
});

test("hand cards matching each revealed top-board rank are discarded", async ({ page }) => {
  // Discard-pile content (player + opponent combined) is checked precisely in the fixed-deck
  // tests below; the opponent's hidden hand makes exact pile content unverifiable from a random deal.
  for (let round = 0; round < 5; round++) {
    const handBefore = await handRanks(page);

    if (round === 0) {
      await callButton(page).click();
      await expect(checkButton(page)).toBeEnabled();
    } else {
      await checkButton(page).click();
    }

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

  await callButton(page).click();
  await expect(checkButton(page)).toBeEnabled();

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

  // round 0 (closed via the blind call): both kings discard (High Card left: 2,3,4), bottom board
  // reveals 9S -> still High Card
  await callButton(page).click();
  await expect(checkButton(page)).toBeEnabled();
  await expect(page.locator("#hand-type")).toHaveText("High Card");
  await expect(page.locator("#point-total")).toHaveText("9");
});

test("opponent's matching-rank cards discard and slide left with no gaps, staying face-down", async ({ page }) => {
  const deck = "2S,3D,4H,5C,6S,QS,7D,8H,9C,10S,JS,JH,JD,JC,KS,QH,QD,7S,8S,9S";
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);

  await callButton(page).click();
  await expect(checkButton(page)).toBeEnabled();

  // opponent held QH, QD; boardA's first reveal is QS, so both discard, leaving 3 face-down cards
  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(3);
  // player's hand (2,3,4,5,6) has no queens, so it is untouched
  expect(await handRanks(page)).toEqual(["2", "3", "4", "5", "6"]);
  // opponent discards fly over face-down and only reveal their rank once the flip animation
  // finishes landing in the pile, so this needs to poll rather than read the DOM once
  await expect
    .poll(async () => (await discardRanksInSlot(page, 0)).sort())
    .toEqual(["Q", "Q"]);
});

test("Showdown reveals the opponent's hand and declares high/low winners", async ({ page }) => {
  const deck = "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S";
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

  await callButton(page).click();
  await expect(checkButton(page)).toBeEnabled();
  for (let i = 0; i < 4; i++) {
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

  await callButton(page).click();
  await expect(checkButton(page)).toBeEnabled();
  for (let i = 0; i < 5; i++) {
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

test("regression: a 6-card flush pool highlights only the best 5, not the 6th lowest card", async ({ page }) => {
  // opponent's pool (hand + boardB) has 6 diamonds: 2D,3D,9D (hand) + 4D,5D,JD (boardB). The
  // winning flush is the top 5 (J,9,5,4,3) - the 2D must stay dimmed, not highlighted.
  const deck = "2C,5H,9S,JC,4H,KS,QH,8C,10H,6C,4D,5D,JD,6S,7S,2D,3D,9D,2S,3S";
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

  await callButton(page).click();
  await expect(checkButton(page)).toBeEnabled();
  for (let i = 0; i < 5; i++) {
    await checkButton(page).click();
  }
  await expect(page.locator("#table-center")).toContainText("Opponent wins the high with Flush");

  for (const alt of [
    "J of diamonds",
    "9 of diamonds",
    "5 of diamonds",
    "4 of diamonds",
    "3 of diamonds",
  ]) {
    await expect(page.locator(`img[alt="${alt}"]`)).not.toHaveClass(/dimmed/);
  }

  // the 6th (lowest) diamond is part of the pool but not the winning 5 - it must stay dimmed
  await expect(page.locator('img[alt="2 of diamonds"]')).toHaveClass(/dimmed/);
});

test("betting through a hand settles the pot into the winner's balance at showdown", async ({ page }) => {
  const deck = "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S";
  await page.goto(`/?deck=${deck}&${FAST_CALLING_STATION}`);

  // player raises the blind (round 0), then bets the next two ($2) rounds, then checks the last
  // three ($4) rounds
  await raiseButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$96");
  await expect(checkButton(page)).toBeEnabled();
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$94");
  await betButton(page).click();
  await expect(page.locator("#balance")).toHaveText("$92");
  await expect(potAmount(page)).toHaveText("$16");

  await checkButton(page).click();
  await checkButton(page).click();
  await checkButton(page).click();

  // player wins both high and low (see the showdown test above), so the full $16 pot comes back
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#balance")).toHaveText("$108");
});

test("facing the blinds shows Fold/Call/Raise; calling triggers the big blind's raise option", async ({ page }) => {
  await page.goto("/?opponent=aggressor"); // real timing to observe the banner sequence

  // hand 1: player holds the button (small blind), facing the $1 blind differential immediately -
  // no banner is needed for this, blinds are posted silently the moment the hand deals
  await expect(bannerText(page)).toHaveText("Both players post blinds");
  await expect(callButton(page)).toBeEnabled();
  await expect(callButton(page)).toHaveText("Call ($1)");
  await expect(raiseButton(page)).toHaveText("Raise ($3)");
  await expect(foldButton(page)).toBeVisible();
  await expect(potAmount(page)).toHaveText("$0");
  await expect(page.locator("#player-bet-stack .chip")).toHaveCount(1);
  await expect(page.locator("#opponent-bet-stack .chip")).toHaveCount(2);

  await callButton(page).click();

  // aggressor (big blind) exercises its option by raising instead of checking, reopening round 0 -
  // real poker calls this a raise (the blind already established a live bet), not a fresh bet
  await expect(bannerText(page)).toHaveText("Opponent raises");
  await expect(callButton(page)).toBeEnabled();
  await expect(callButton(page)).toHaveText("Call ($2)");
  await expect(potAmount(page)).toHaveText("$0"); // round 0 is still open, nothing settled yet

  await callButton(page).click();

  // the round closes (bet stacks slide into the pot) and the board reveals; round 1 opens the
  // same way, with the settled pot now including round 0's total
  await expect(bannerText(page)).toHaveText("Opponent bets $2");
  await expect(callButton(page)).toBeEnabled();
  expect(await revealedCount(page, "#board-a")).toBe(1);
  await expect(callButton(page)).toHaveText("Call ($2)");
  // blinds (3) + the player's first call (1) + the opponent's bet-option (2) + the player's
  // second call matching it (2) = 8
  await expect(potAmount(page)).toHaveText("$8");
});

test("raising keeps the round open (no reveal) until someone calls", async ({ page }) => {
  await page.goto("/?opponent=aggressor"); // real timing to observe the banner
  await expect(callButton(page)).toBeEnabled();
  await expect(callButton(page)).toHaveText("Call ($1)");

  await raiseButton(page).click();

  // aggressor raises right back; still round 0, no reveal yet
  await expect(bannerText(page)).toHaveText("Opponent raises");
  await expect(callButton(page)).toBeEnabled();
  expect(await revealedCount(page, "#board-a")).toBe(0);
  await expect(callButton(page)).toHaveText("Call ($2)");
  // still just the blinds and this raise war sitting in front of each hand, not yet in the pot
  await expect(potAmount(page)).toHaveText("$0");
  await expect(page.locator("#player-bet-stack .chip")).toHaveCount(4);
  await expect(page.locator("#opponent-bet-stack .chip")).toHaveCount(2);

  await callButton(page).click();

  // now it closes (both bet stacks slide into the pot), board reveals for round 0, and round 1
  // opens with a fresh bet
  await expect(callButton(page)).toBeEnabled();
  expect(await revealedCount(page, "#board-a")).toBe(1);
  await expect(callButton(page)).toHaveText("Call ($2)");
  await expect(potAmount(page)).toHaveText("$12");
  await expect(page.locator("#player-bet-stack .chip")).toHaveCount(0);
  await expect(page.locator("#opponent-bet-stack .chip")).toHaveCount(2); // opponent's fresh $2 bet for round 1
});

test("the opponent folding ends the hand immediately without revealing their cards", async ({ page }) => {
  await page.goto("/?opponent=folder&fast=1");

  // player (small blind) raises the blind; folder always folds when facing a bet
  await expect(raiseButton(page)).toBeVisible();
  await raiseButton(page).click();

  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#table-center")).toContainText("Opponent folds — You win $6");
  await expect(page.locator("#balance")).toHaveText("$102"); // $96 after blinds+raise + the whole $6 pot
});

test("the player can fold when facing a bet, ending the hand without revealing the opponent's cards", async ({ page }) => {
  await page.goto("/?opponent=aggressor&fast=1");
  await expect(foldButton(page)).toBeVisible();

  await foldButton(page).click();

  await expect(page.locator("#opponent-hand .card.back")).toHaveCount(5);
  await expect(nextHandButton(page)).toBeVisible();
  await expect(page.locator("#table-center")).toContainText("You fold — Opponent wins $3");
  await expect(page.locator("#balance")).toHaveText("$99"); // just the small blind; nothing else was contributed
});
