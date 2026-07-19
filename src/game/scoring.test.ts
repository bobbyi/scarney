import { describe, expect, test } from "vitest";
import { classifyHand, handPoints } from "./scoring";
import type { Card } from "./deck";

function c(spec: string): Card {
  const suitChar = spec.slice(-1);
  const rank = spec.slice(0, -1) as Card["rank"];
  const suit = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" }[suitChar] as Card["suit"];
  return { rank, suit };
}

function cards(...specs: string[]): Card[] {
  return specs.map(c);
}

describe("classifyHand", () => {
  test("high card", () => {
    expect(classifyHand(cards("2S", "5H", "9D", "JC", "KS"))).toBe("High Card");
  });

  test("pair", () => {
    expect(classifyHand(cards("2S", "2H", "9D", "JC", "KS"))).toBe("Pair");
  });

  test("two pair", () => {
    expect(classifyHand(cards("2S", "2H", "9D", "9C", "KS"))).toBe("Two Pair");
  });

  test("three of a kind", () => {
    expect(classifyHand(cards("2S", "2H", "2D", "9C", "KS"))).toBe("Three of a Kind");
  });

  test("straight, ace-high", () => {
    expect(classifyHand(cards("10S", "JH", "QD", "KC", "AS"))).toBe("Straight");
  });

  test("straight, ace-low wheel", () => {
    expect(classifyHand(cards("AS", "2H", "3D", "4C", "5S"))).toBe("Straight");
  });

  test("four consecutive ranks with a gap is not a straight", () => {
    expect(classifyHand(cards("2S", "3H", "4D", "5C", "7S"))).toBe("High Card");
  });

  test("flush", () => {
    expect(classifyHand(cards("2S", "5S", "9S", "JS", "KS"))).toBe("Flush");
  });

  test("full house", () => {
    expect(classifyHand(cards("2S", "2H", "2D", "9C", "9S"))).toBe("Full House");
  });

  test("four of a kind", () => {
    expect(classifyHand(cards("2S", "2H", "2D", "2C", "9S"))).toBe("Four of a Kind");
  });

  test("straight flush", () => {
    expect(classifyHand(cards("5S", "6S", "7S", "8S", "9S"))).toBe("Straight Flush");
  });

  test("straight flush, ace-low wheel", () => {
    expect(classifyHand(cards("AS", "2S", "3S", "4S", "5S"))).toBe("Straight Flush");
  });

  test("picks the best hand from a larger pool (flush available)", () => {
    expect(classifyHand(cards("2S", "5S", "9S", "JS", "KS", "3H", "4D"))).toBe("Flush");
  });

  test("picks the best hand from a larger pool (full house beats trips)", () => {
    expect(classifyHand(cards("2S", "2H", "2D", "9C", "9S", "3H", "4D"))).toBe("Full House");
  });

  test("fewer than 5 cards: flush pattern doesn't count as a flush", () => {
    expect(classifyHand(cards("2S", "5S", "9S", "JS"))).toBe("High Card");
  });

  test("fewer than 5 cards: three of a kind is still detected", () => {
    expect(classifyHand(cards("2S", "2H", "2D"))).toBe("Three of a Kind");
  });

  test("2 cards: pair", () => {
    expect(classifyHand(cards("KS", "KH"))).toBe("Pair");
  });

  test("1 card: high card", () => {
    expect(classifyHand(cards("KS"))).toBe("High Card");
  });

  test("4 cards: two pair", () => {
    expect(classifyHand(cards("KS", "KH", "2D", "2C"))).toBe("Two Pair");
  });
});

describe("handPoints", () => {
  test("sums face-value, face-card, and ace points", () => {
    expect(handPoints(cards("AS", "2H", "KD", "10C", "JS"))).toBe(1 + 2 + 10 + 10 + 10);
  });

  test("empty hand is 0", () => {
    expect(handPoints([])).toBe(0);
  });

  test("single ace is 1", () => {
    expect(handPoints(cards("AS"))).toBe(1);
  });
});
