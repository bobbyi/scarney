import type { Card, Rank } from "./deck";

export type HandCategory =
  | "Straight Flush"
  | "Four of a Kind"
  | "Full House"
  | "Flush"
  | "Straight"
  | "Three of a Kind"
  | "Two Pair"
  | "Pair"
  | "High Card";

const RANK_VALUES: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const RANK_POINTS: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 10,
  Q: 10,
  K: 10,
  A: 1,
};

export function handPoints(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + RANK_POINTS[card.rank], 0);
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

// Aces count high (14) and low (1), so a wheel (A-2-3-4-5) is detected alongside ace-high straights.
function hasStraight(rankValues: number[]): boolean {
  const unique = new Set(rankValues);
  if (unique.has(14)) unique.add(1);
  const sorted = [...unique].sort((a, b) => a - b);

  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      run++;
      if (run >= 5) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

export function classifyHand(cards: Card[]): HandCategory {
  const rankCounts = [...countBy(cards, (c) => c.rank).values()].sort((a, b) => b - a);
  const suitCounts = countBy(cards, (c) => c.suit);

  // Straight, flush, and full house all need 5 cards to be structurally possible.
  if (cards.length >= 5) {
    for (const suit of suitCounts.keys()) {
      const suited = cards.filter((c) => c.suit === suit);
      if (suited.length >= 5 && hasStraight(suited.map((c) => RANK_VALUES[c.rank]))) {
        return "Straight Flush";
      }
    }
  }

  if (rankCounts[0] >= 4) return "Four of a Kind";

  if (cards.length >= 5 && rankCounts[0] >= 3 && rankCounts[1] >= 2) return "Full House";

  if (cards.length >= 5) {
    for (const count of suitCounts.values()) {
      if (count >= 5) return "Flush";
    }
  }

  if (cards.length >= 5 && hasStraight(cards.map((c) => RANK_VALUES[c.rank]))) return "Straight";

  if (rankCounts[0] >= 3) return "Three of a Kind";

  if (rankCounts[0] >= 2 && rankCounts[1] >= 2) return "Two Pair";

  if (rankCounts[0] >= 2) return "Pair";

  return "High Card";
}
