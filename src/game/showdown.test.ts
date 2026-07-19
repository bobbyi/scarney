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

describe("determineHighWinner", () => {
  it("picks the player when their pool makes a stronger hand", () => {
    const playerPool = cards(["KS", "KH", "KD", "KC", "2S"]); // Four of a Kind
    const opponentPool = cards(["QS", "QH", "2D", "3C", "4H"]); // Pair

    const result = determineHighWinner(playerPool, opponentPool);

    expect(result.winner).toBe("player");
    expect(result.playerHandName).toBe("Four of a Kind");
    expect(result.opponentHandName).toBe("Pair");
  });

  it("picks the opponent when their pool makes a stronger hand", () => {
    const playerPool = cards(["2S", "5H", "9D", "JC", "4H"]); // High Card
    const opponentPool = cards(["7S", "7H", "7D", "3C", "3H"]); // Full House

    const result = determineHighWinner(playerPool, opponentPool);

    expect(result.winner).toBe("opponent");
    expect(result.playerHandName).toBe("High Card");
    expect(result.opponentHandName).toBe("Full House");
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
