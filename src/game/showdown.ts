import { Hand } from "pokersolver";
import type { Card } from "./deck";

export type Winner = "player" | "opponent" | "tie";

function cardToPokerCode(card: Card): string {
  const value = card.rank === "10" ? "T" : card.rank;
  return `${value}${card.suit[0]}`;
}

export interface HighResult {
  winner: Winner;
  playerHandName: string;
  opponentHandName: string;
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

  return { winner, playerHandName: playerHand.name, opponentHandName: opponentHand.name };
}

export function determineLowWinner(playerPoints: number, opponentPoints: number): Winner {
  if (playerPoints === opponentPoints) return "tie";
  return playerPoints < opponentPoints ? "player" : "opponent";
}
