import { Hand, type PokerCard } from "pokersolver";
import type { Card } from "./deck";

export type Winner = "player" | "opponent" | "tie";

function cardToPokerCode(card: Card): string {
  const value = card.rank === "10" ? "T" : card.rank;
  return `${value}${card.suit[0]}`;
}

const POKER_SUIT_NAMES: Record<string, Card["suit"]> = {
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
};

function cardKey(card: Card): string {
  return `${card.rank}-${card.suit}`;
}

const BEST_HAND_SIZE = 5;

// pokersolver's own Card objects don't reference the originals, so match its winning hand back
// to the actual pool cards by rank+suit (unambiguous - a pool never has duplicate cards).
//
// pokersolver has a bug where a Flush's `cards` includes *every* card of the flush suit in the
// pool, not just the best 5 (e.g. 6 diamonds in the pool yields 6 cards, not 5) - it only pads
// up to 5 when short, never trims down when long. Its own cards are already sorted best-first
// in every hand type we've checked (confirmed directly against the library for Flush, and by
// reading the source for Straight/Straight Flush, which do trim correctly), so capping at the
// first 5 here is a safe, general fix rather than a Flush-specific patch.
function matchPokerCards(pool: Card[], pokerCards: PokerCard[]): Card[] {
  const byKey = new Map(pool.map((card) => [cardKey(card), card] as const));
  return pokerCards
    .slice(0, BEST_HAND_SIZE)
    .map((pokerCard) => {
      const rank = pokerCard.value === "T" ? "10" : (pokerCard.value as Card["rank"]);
      const suit = POKER_SUIT_NAMES[pokerCard.suit];
      return byKey.get(cardKey({ rank, suit }));
    })
    .filter((card): card is Card => card !== undefined);
}

export interface HighResult {
  winner: Winner;
  playerHandName: string;
  opponentHandName: string;
  playerCards: Card[];
  opponentCards: Card[];
}

// Pool sizes here are always >= 5 at showdown (the bottom board alone contributes 5 revealed cards),
// which is what pokersolver's best-5-of-N evaluator assumes.
export function determineHighWinner(playerPool: Card[], opponentPool: Card[]): HighResult {
  const playerHand = Hand.solve(playerPool.map(cardToPokerCode));
  const opponentHand = Hand.solve(opponentPool.map(cardToPokerCode));
  const winners = Hand.winners([playerHand, opponentHand]);

  const playerWins = winners.includes(playerHand);
  const opponentWins = winners.includes(opponentHand);
  const winner: Winner = playerWins && opponentWins ? "tie" : playerWins ? "player" : "opponent";

  return {
    winner,
    playerHandName: playerHand.name,
    opponentHandName: opponentHand.name,
    playerCards: matchPokerCards(playerPool, playerHand.cards),
    opponentCards: matchPokerCards(opponentPool, opponentHand.cards),
  };
}

export function determineLowWinner(playerPoints: number, opponentPoints: number): Winner {
  if (playerPoints === opponentPoints) return "tie";
  return playerPoints < opponentPoints ? "player" : "opponent";
}
