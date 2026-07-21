import { describe, expect, it } from "vitest";
import type { Card } from "./deck";
import { createSmartOpponentStrategy, type DecisionContext } from "./opponent";

function cards(codes: string[]): Card[] {
  const suits: Record<string, Card["suit"]> = {
    S: "spades",
    H: "hearts",
    D: "diamonds",
    C: "clubs",
  };
  return codes.map((code) => ({
    rank: code.slice(0, -1) as Card["rank"],
    suit: suits[code.slice(-1)],
  }));
}

// Three fixed, deterministic equity scenarios (verified in equity.test.ts's style) used to drive
// the policy without needing to hand-tune a card scenario for every threshold check.

// Opponent holds both remaining aces (the other two are on the board), and the board's other 3
// cards are deliberately unsuited/unconnected (2S, 7H, QC) so no 2-card player draw can ever
// complete a flush or straight flush (the only hands that beat Four of a Kind) - an unbeatable
// high and the cheapest possible low, verified for every possible draw, not just typical ones
// (see equity.test.ts for the same reasoning against the same shape of sample). Equity == 1.
const OVERWHELMING: DecisionContext = {
  opponentHand: cards(["AS", "AH"]),
  knownCards: cards(["AS", "AH"]),
  playerHandCount: 2,
  revealedBoardB: cards(["AD", "AC", "2S", "7H", "QC"]),
  remainingReveals: 0,
  round: 0,
  pot: 0,
  owed: 0,
  raisesThisRound: 0,
};

// The board alone is a locked Ace-high straight neither side's 2 cards can ever improve on (no
// flush is reachable - at most 2 cards of any one suit are in play), so high ties every trial
// (0.25 to the opponent). The opponent holds the other 2 aces, and the 4th is walled off via
// `knownCards` too, so no 2-card player draw (minimum possible value 1 + 2 = 3) can ever match or
// beat the opponent's fixed 1 + 1 = 2 - low is an opponent win every trial (0.5 more). Equity ==
// 0.75, exactly, for every possible draw.
const STRONG: DecisionContext = {
  opponentHand: cards(["AS", "AD"]),
  knownCards: cards(["AS", "AD"]),
  playerHandCount: 2,
  revealedBoardB: cards(["10S", "JD", "QC", "KS", "AH"]),
  remainingReveals: 0,
  round: 0,
  pot: 0,
  owed: 0,
  raisesThisRound: 0,
};

// Both hands are empty against an identical shared board - an exact tie both ways, no sampling
// involved at all. Equity == 0.5.
const MEDIOCRE: DecisionContext = {
  opponentHand: [],
  knownCards: [],
  playerHandCount: 0,
  revealedBoardB: cards(["2S", "5H", "9D", "JC", "KH"]),
  remainingReveals: 0,
  round: 0,
  pot: 0,
  owed: 0,
  raisesThisRound: 0,
};

const TRIALS = 5; // every scenario above is deterministic regardless of trial count or RNG

describe("createSmartOpponentStrategy", () => {
  describe("decideOpening", () => {
    it("checks a mediocre hand instead of betting it", () => {
      const strategy = createSmartOpponentStrategy(() => MEDIOCRE, { trials: TRIALS, random: () => 0.99 });
      expect(strategy.decideOpening()).toBe("check");
    });

    it("bets a strong hand when the slowplay roll doesn't hit", () => {
      const strategy = createSmartOpponentStrategy(() => STRONG, { trials: TRIALS, random: () => 0.99 });
      expect(strategy.decideOpening()).toBe("bet");
    });

    it("slow-plays (checks) a strong hand when the slowplay roll hits", () => {
      const strategy = createSmartOpponentStrategy(() => STRONG, { trials: TRIALS, random: () => 0 });
      expect(strategy.decideOpening()).toBe("check");
    });
  });

  describe("decideFacingBet - pot odds", () => {
    // Synthetic pot/owed values chosen to sit precisely either side of the early/late-round
    // margin, not meant to represent a realistic in-game pot.
    it("calls a mediocre hand when the price is cheap enough (early round)", () => {
      const ctx: DecisionContext = { ...MEDIOCRE, round: 0, pot: 1.3, owed: 1 };
      const strategy = createSmartOpponentStrategy(() => ctx, { trials: TRIALS, random: () => 0.99 });
      expect(strategy.decideFacingBet()).toBe("call");
    });

    it("folds the same mediocre hand at the same price in a later, higher-stake round", () => {
      const ctx: DecisionContext = { ...MEDIOCRE, round: 3, pot: 1.3, owed: 1 };
      const strategy = createSmartOpponentStrategy(() => ctx, { trials: TRIALS, random: () => 0.99 });
      expect(strategy.decideFacingBet()).toBe("fold");
    });

    it("folds a mediocre hand facing a price too steep at any round", () => {
      const ctx: DecisionContext = { ...MEDIOCRE, round: 0, pot: 0.2, owed: 1 };
      const strategy = createSmartOpponentStrategy(() => ctx, { trials: TRIALS, random: () => 0.99 });
      expect(strategy.decideFacingBet()).toBe("fold");
    });
  });

  describe("decideFacingBet - escalating raise threshold", () => {
    it("raises a strong (but not overwhelming) hand with no raises committed yet this round", () => {
      const ctx: DecisionContext = { ...STRONG, raisesThisRound: 0, pot: 10, owed: 1 };
      const strategy = createSmartOpponentStrategy(() => ctx, { trials: TRIALS, random: () => 0.99 });
      expect(strategy.decideFacingBet()).toBe("raise");
    });

    it("stops raising the same hand once enough raises have already happened this round", () => {
      // Same 0.75 equity; the base raise threshold (0.68) would still clear it, but after 2
      // raises this round the bar has climbed to 0.68 + 2*0.06 = 0.80, above it.
      const ctx: DecisionContext = { ...STRONG, raisesThisRound: 2, pot: 10, owed: 1 };
      const strategy = createSmartOpponentStrategy(() => ctx, { trials: TRIALS, random: () => 0.99 });
      // Falls through to a call instead - the generous pot odds (pot 10 vs owed 1) easily clear
      // the call bar even though the raise bar has climbed out of reach.
      expect(strategy.decideFacingBet()).toBe("call");
    });

    it("keeps raising an overwhelming hand even after several raises this round", () => {
      const ctx: DecisionContext = { ...OVERWHELMING, raisesThisRound: 4, pot: 10, owed: 1 };
      const strategy = createSmartOpponentStrategy(() => ctx, { trials: TRIALS, random: () => 0.99 });
      expect(strategy.decideFacingBet()).toBe("raise");
    });
  });
});
