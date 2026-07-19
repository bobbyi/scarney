import { describe, expect, test } from "vitest";
import {
  createDeck,
  shuffleDeck,
  dealHand,
  dealScarney,
  partitionByRank,
  cardToCode,
  parseCard,
  parseDeck,
} from "./deck";

describe("createDeck", () => {
  test("has 52 unique cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    const unique = new Set(deck.map((c) => `${c.rank}-${c.suit}`));
    expect(unique.size).toBe(52);
  });
});

describe("shuffleDeck", () => {
  test("preserves the same 52 cards without mutating the input", () => {
    const original = createDeck();
    const shuffled = shuffleDeck(original);

    expect(shuffled).toHaveLength(52);
    expect(original[0]).toEqual({ rank: "2", suit: "spades" });

    const originalKeys = new Set(original.map((c) => `${c.rank}-${c.suit}`));
    const shuffledKeys = new Set(shuffled.map((c) => `${c.rank}-${c.suit}`));
    expect(shuffledKeys).toEqual(originalKeys);
  });
});

describe("dealHand", () => {
  test("takes the top N cards", () => {
    const deck = createDeck();
    expect(dealHand(deck, 5)).toEqual(deck.slice(0, 5));
  });
});

describe("dealScarney", () => {
  test("deals 15 non-overlapping cards across hand, boardA, boardB", () => {
    const deck = shuffleDeck(createDeck());
    const { hand, boardA, boardB } = dealScarney(deck);

    expect(hand).toHaveLength(5);
    expect(boardA).toHaveLength(5);
    expect(boardB).toHaveLength(5);

    const all = [...hand, ...boardA, ...boardB];
    const uniqueKeys = new Set(all.map((c) => `${c.rank}-${c.suit}`));
    expect(uniqueKeys.size).toBe(15);
  });
});

describe("partitionByRank", () => {
  test("splits matching and non-matching cards by rank", () => {
    const hand = [
      { rank: "K", suit: "spades" },
      { rank: "K", suit: "hearts" },
      { rank: "2", suit: "clubs" },
    ] as const;

    const { matching, remaining } = partitionByRank([...hand], "K");
    expect(matching).toEqual([hand[0], hand[1]]);
    expect(remaining).toEqual([hand[2]]);
  });

  test("matching is empty when no cards share the rank", () => {
    const hand = [{ rank: "2", suit: "clubs" }] as const;
    const { matching, remaining } = partitionByRank([...hand], "K");
    expect(matching).toEqual([]);
    expect(remaining).toEqual(hand);
  });
});

describe("cardToCode / parseCard round-trip", () => {
  test("every real card round-trips through its code", () => {
    for (const card of createDeck()) {
      const code = cardToCode(card);
      expect(parseCard(code)).toEqual(card);
    }
  });

  test("parseCard is case-insensitive", () => {
    expect(parseCard("ks")).toEqual({ rank: "K", suit: "spades" });
  });

  test("parseCard rejects an invalid suit", () => {
    expect(parseCard("KZ")).toBeNull();
  });

  test("parseCard rejects an invalid rank", () => {
    expect(parseCard("1S")).toBeNull();
  });
});

describe("parseDeck", () => {
  test("parses a valid comma-separated list in order", () => {
    const result = parseDeck("KS,KH,2C,3D,4H");
    expect(result).toEqual([
      { rank: "K", suit: "spades" },
      { rank: "K", suit: "hearts" },
      { rank: "2", suit: "clubs" },
      { rank: "3", suit: "diamonds" },
      { rank: "4", suit: "hearts" },
    ]);
  });

  test("rejects a duplicate card", () => {
    expect(parseDeck("KS,KS,2C")).toBeNull();
  });

  test("rejects an invalid code anywhere in the list", () => {
    expect(parseDeck("KS,ZZ,2C")).toBeNull();
  });
});
