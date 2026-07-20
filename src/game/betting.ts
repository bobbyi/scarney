import type { Winner } from "./showdown";

export const STAKES: readonly number[] = [1, 1, 1, 2, 2, 2];

export type BettingAction = "check" | "bet";
export type OpponentAction = "check" | "call";

export interface BettingRoundResult {
  potContribution: number;
  opponentAction: OpponentAction;
}

// Opponent is a scripted calling station: checks back if checked to, calls if bet into.
export function resolveBettingRound(action: BettingAction, round: number): BettingRoundResult {
  const stake = action === "bet" ? STAKES[round] : 0;
  return { potContribution: stake, opponentAction: action === "bet" ? "call" : "check" };
}

export interface ShowdownSettlement {
  playerShare: number;
  opponentShare: number;
}

export function settleShowdown(pot: number, highWinner: Winner, lowWinner: Winner): ShowdownSettlement {
  const half = pot / 2;
  const shareFor = (winner: Winner, side: "player" | "opponent") =>
    winner === side ? half : winner === "tie" ? half / 2 : 0;

  const playerShare = shareFor(highWinner, "player") + shareFor(lowWinner, "player");
  return { playerShare, opponentShare: pot - playerShare };
}
