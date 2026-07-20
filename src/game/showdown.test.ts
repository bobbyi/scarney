import { describe, expect, it } from "vitest";
import type { Card } from "./deck";
import { determineHighWinner, determineLowWinner } from "./showdown";

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

function byCode(a: Card, b: Card): number {
  const codeOf = (c: Card) => `${c.rank}-${c.suit}`;
  return codeOf(a).localeCompare(codeOf(b));
}

describe("determineHighWinner", () => {
  it("picks the player when their pool makes a stronger hand", () => {
    const playerPool = cards(["KS", "KH", "KD", "KC", "2S"]); // Four of a Kind
    const opponentPool = cards(["QS", "QH", "2D", "3C", "4H"]); // Pair

    const result = determineHighWinner(playerPool, opponentPool);

    expect(result.winner).toBe("player");
    expect(result.playerHandName).toBe("Four of a Kind");
    expect(result.opponentHandName).toBe("Pair");
    // exactly the 5 cards forming the hand - all four kings plus the kicker, nothing left behind
    expect(result.playerCards.sort(byCode)).toEqual(cards(["KS", "KH", "KD", "KC", "2S"]).sort(byCode));
  });

  it("picks the best available kickers when the pool is larger than 5", () => {
    // pair of kings among 7 cards - the best hand is K,K + the three highest kickers (9,7,6),
    // leaving the 3 and 5 out; which physical kicker card gets used is pokersolver's call, not ours
    const playerPool = cards(["KS", "KH", "9C", "3D", "7H", "5S", "6D"]);
    const opponentPool = cards(["2S", "2H", "2D", "3C", "4H"]); // Three of a Kind beats the pair

    const result = determineHighWinner(playerPool, opponentPool);

    expect(result.playerHandName).toBe("Pair");
    expect(result.playerCards).toHaveLength(5);
    expect(result.playerCards.sort(byCode)).toEqual(cards(["KS", "KH", "9C", "7H", "6D"]).sort(byCode));
  });

  it("picks the opponent when their pool makes a stronger hand", () => {
    const playerPool = cards(["2S", "5H", "9D", "JC", "4H"]); // High Card
    const opponentPool = cards(["7S", "7H", "7D", "3C", "3H"]); // Full House

    const result = determineHighWinner(playerPool, opponentPool);

    expect(result.winner).toBe("opponent");
    expect(result.playerHandName).toBe("High Card");
    expect(result.opponentHandName).toBe("Full House");
    expect(result.opponentCards.sort(byCode)).toEqual(cards(["7S", "7H", "7D", "3C", "3H"]).sort(byCode));
  });

  it("declares a tie when both pools make the exact same hand", () => {
    const pool = cards(["AS", "KH", "QD", "JC", "10H"]); // Straight

    const result = determineHighWinner(pool, pool);

    expect(result.winner).toBe("tie");
  });
});

describe("determineLowWinner", () => {
  it("picks the player with fewer points", () => {
    expect(determineLowWinner(9, 20)).toBe("player");
  });

  it("picks the opponent with fewer points", () => {
    expect(determineLowWinner(25, 12)).toBe("opponent");
  });

  it("declares a tie on equal points", () => {
    expect(determineLowWinner(14, 14)).toBe("tie");
  });
});
