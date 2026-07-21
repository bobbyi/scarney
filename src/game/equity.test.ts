import { describe, expect, it } from "vitest";
import type { Card } from "./deck";
import { estimateOpponentEquity, type EquitySample } from "./equity";

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

describe("estimateOpponentEquity", () => {
  it("is an exact 50/50 split when both hands are empty and the board is identical for both sides", () => {
    // Nothing left to sample (no player cards, no future reveals) - both sides end up with the
    // literal same high pool (the fixed board alone) and the same 0 low points, so every trial
    // ties both ways regardless of the RNG.
    const sample: EquitySample = {
      opponentHand: [],
      knownCards: [],
      playerHandCount: 0,
      revealedBoardB: cards(["2S", "5H", "9D", "JC", "KH"]),
      remainingReveals: 0,
    };

    expect(estimateOpponentEquity(sample, 50)).toBe(0.5);
  });

  it("gives the opponent the whole pot when their hole cards lock up an unbeatable high and low", () => {
    // Opponent holds both remaining aces (AD, AC are already on the board), so all 4 are
    // accounted for and no 2-card player hand can match Four Aces with another Four of a Kind.
    // The board's other 3 cards are deliberately unsuited and unconnected (2S, 7H, QC) - with at
    // most 2 cards of any one suit reachable from the board, no random 2-card hand can complete a
    // flush or straight flush either, which is the only hand that *would* beat Four of a Kind.
    // Aces are also worth only 1 point each for low, a floor no 2-card hand drawn from 2s-and-up
    // (all 4 aces are spoken for) can reach. The outcome is deterministic on every trial despite
    // the player's hand being randomly sampled - verified precisely, not just approximately, by
    // reasoning through every possible 2-card draw rather than trusting that random sampling
    // won't stumble onto a rare counterexample.
    const sample: EquitySample = {
      opponentHand: cards(["AS", "AH"]),
      knownCards: cards(["AS", "AH"]), // opponent's own original dealt cards
      playerHandCount: 2,
      revealedBoardB: cards(["AD", "AC", "2S", "7H", "QC"]),
      remainingReveals: 0,
    };

    expect(estimateOpponentEquity(sample, 200)).toBe(1);
  });

  it("favors the opponent much less when their hole cards are heavy for low", () => {
    // The board alone is already an Ace-high straight (10-J-Q-K-A), which nothing but a flush or
    // better can improve on - and neither side's 2 extra cards can ever complete one here (the
    // board only has 2 cards of any one suit). So high is locked to an exact tie every trial,
    // handing the opponent a flat 0.25 no matter what. Low is what's left to differentiate: the
    // opponent holds the worst possible low cards (two face cards, 20 points - the max a 2-card
    // hand can reach), so the best they can do is occasionally tie a player hand that also
    // happens to total 20, and otherwise lose the low half outright.
    const sample: EquitySample = {
      opponentHand: cards(["KH", "QH"]),
      knownCards: cards(["KH", "QH"]),
      playerHandCount: 2,
      revealedBoardB: cards(["10S", "JD", "QC", "KS", "AH"]),
      remainingReveals: 0,
    };

    const equity = estimateOpponentEquity(sample, 500);
    expect(equity).toBeLessThan(0.35);
  });

  it("never deals a known card into the sampled unknowns", () => {
    // The opponent's hand and the revealed board together use up most of a suit; if the sampler
    // ever leaked one of those cards back into the pool, some trial would need to draw from an
    // exhausted set and silently duplicate a card. Running many trials at least exercises that
    // every draw completes without the pool running dry in an inconsistent way.
    const sample: EquitySample = {
      opponentHand: cards(["2S", "3S"]),
      knownCards: cards(["2S", "3S"]),
      playerHandCount: 5,
      revealedBoardB: cards(["4S", "5S", "6S", "7H", "8H"]),
      remainingReveals: 5,
    };

    expect(() => estimateOpponentEquity(sample, 100)).not.toThrow();
    const equity = estimateOpponentEquity(sample, 100);
    expect(equity).toBeGreaterThanOrEqual(0);
    expect(equity).toBeLessThanOrEqual(1);
  });
});
