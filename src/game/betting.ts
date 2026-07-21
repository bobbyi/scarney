import type { Winner } from "./showdown";

export const STAKES: readonly number[] = [1, 1, 1, 2, 2, 2];
export const ANTE = 1;

export type Player = "player" | "opponent";
export type OpeningAction = "check" | "bet";
export type FacingBetAction = "call" | "raise" | "fold";

// The player without the dealer button acts first each round.
export function opponentActsFirst(buttonHolder: Player): boolean {
  return buttonHolder === "player";
}

export interface OpponentStrategy {
  decideOpening(): OpeningAction;
  decideFacingBet(): FacingBetAction;
}

// The original placeholder: never bets or raises on its own, never folds.
export const callingStationStrategy: OpponentStrategy = {
  decideOpening: () => "check",
  decideFacingBet: () => "call",
};

// A simple placeholder that exercises every action (bet, raise, fold) with no regard for hand
// strength, so the full set of betting mechanics can be seen in play before real strategy is
// designed. Raise probability is kept low enough that raising wars fizzle out on their own.
export function createRandomOpponentStrategy(random: () => number = Math.random): OpponentStrategy {
  return {
    decideOpening: () => (random() < 0.35 ? "bet" : "check"),
    decideFacingBet: () => {
      const roll = random();
      if (roll < 0.2) return "raise";
      if (roll < 0.75) return "call";
      return "fold";
    },
  };
}

export const randomOpponentStrategy: OpponentStrategy = createRandomOpponentStrategy();

// How much more the actor needs to add to match the other side's contribution this round.
// Zero means it's the actor's turn to open (nobody's bet yet).
export function amountOwed(actorContributed: number, otherContributed: number): number {
  return otherContributed - actorContributed;
}

export function contributionForOpening(action: OpeningAction, round: number): number {
  return action === "bet" ? STAKES[round] : 0;
}

export function contributionForResponse(action: "call" | "raise", owed: number, round: number): number {
  return action === "call" ? owed : owed + STAKES[round];
}

// A round closes once both sides have acted at least once this round and their contributions
// match (a raise always leaves them unequal, keeping the round open for uncapped back-and-forth).
export function isRoundClosed(
  actionsThisRound: number,
  playerContributed: number,
  opponentContributed: number,
): boolean {
  return actionsThisRound >= 2 && playerContributed === opponentContributed;
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

export function settleFold(pot: number, folder: Player): ShowdownSettlement {
  const playerShare = folder === "opponent" ? pot : 0;
  return { playerShare, opponentShare: pot - playerShare };
}
