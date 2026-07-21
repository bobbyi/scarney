import { createDeck, shuffleDeck, type Card } from "./deck";
import { handPoints } from "./scoring";
import { determineHighWinner, determineLowWinner } from "./showdown";
import { settleShowdown } from "./betting";

function cardKey(card: Card): string {
  return `${card.rank}-${card.suit}`;
}

// Everything an equity estimate needs to know about the current, in-progress hand from the
// opponent's point of view. `knownCards` is every card whose identity is already public: the
// opponent's own original 5 dealt cards (whether still held or since discarded), every boardA/
// boardB card revealed so far, and every card either side has discarded (face-up, so public) -
// the remaining deck (used to sample the player's hidden hand and the rest of the game) excludes
// all of it. `remainingReveals` is shared by both boards since they always reveal in lockstep.
export interface EquitySample {
  opponentHand: Card[];
  knownCards: Card[];
  playerHandCount: number;
  revealedBoardB: Card[];
  remainingReveals: number;
}

const DEFAULT_TRIALS = 400;

// Monte Carlo estimate of the opponent's expected share of the pot if the hand ran to showdown
// from here with every unknown card (the player's hidden hand and the rest of both boards) drawn
// uniformly at random - no inference from the player's betting is folded in here, this is pure
// card equity. Reuses the same showdown logic the real game uses, run against sampled endings.
export function estimateOpponentEquity(
  sample: EquitySample,
  trials: number = DEFAULT_TRIALS,
  random: () => number = Math.random,
): number {
  // opponentHand and revealedBoardB are folded in here too (not just knownCards) so the caller
  // can't accidentally leave them out and have the same physical card dealt twice.
  const knownKeys = new Set(
    [...sample.knownCards, ...sample.opponentHand, ...sample.revealedBoardB].map(cardKey),
  );
  const unknownPool = createDeck().filter((card) => !knownKeys.has(cardKey(card)));

  let totalOpponentShare = 0;

  for (let trial = 0; trial < trials; trial++) {
    const shuffled = shuffleDeck(unknownPool, random);
    let cursor = 0;
    const playerHiddenHand = shuffled.slice(cursor, cursor + sample.playerHandCount);
    cursor += sample.playerHandCount;
    const futureBoardA = shuffled.slice(cursor, cursor + sample.remainingReveals);
    cursor += sample.remainingReveals;
    const futureBoardB = shuffled.slice(cursor, cursor + sample.remainingReveals);

    const futureDiscardRanks = new Set(futureBoardA.map((card) => card.rank));
    const finalPlayerHand = playerHiddenHand.filter((card) => !futureDiscardRanks.has(card.rank));
    const finalOpponentHand = sample.opponentHand.filter((card) => !futureDiscardRanks.has(card.rank));
    const finalBoardB = [...sample.revealedBoardB, ...futureBoardB];

    const low = determineLowWinner(handPoints(finalPlayerHand), handPoints(finalOpponentHand));
    const high = determineHighWinner(
      [...finalPlayerHand, ...finalBoardB],
      [...finalOpponentHand, ...finalBoardB],
    );

    totalOpponentShare += settleShowdown(1, high.winner, low).opponentShare;
  }

  return totalOpponentShare / trials;
}
