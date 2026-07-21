import type { Card } from "./deck";
import { estimateOpponentEquity } from "./equity";
import type { FacingBetAction, OpeningAction, OpponentStrategy } from "./betting";

// Everything the opponent's policy needs to know at a single decision point. Built fresh by the
// caller (main.ts) from the live game state right before each decision, since the equity behind
// it changes every time a card is revealed or a discard happens.
export interface DecisionContext {
  opponentHand: Card[];
  knownCards: Card[];
  playerHandCount: number;
  revealedBoardB: Card[];
  remainingReveals: number;
  round: number;
  pot: number;
  owed: number;
  raisesThisRound: number;
}

// Equity required to open with a bet at all.
const BET_EQUITY_THRESHOLD = 0.58;

// Above this much stronger equity, sometimes check anyway instead of betting - without this, a
// strong hand would always bet immediately and a check-raise could never happen, since the
// facing-bet decision (which can legitimately come back "raise") only gets a chance to run at
// all if the opening decision was "check".
const SLOWPLAY_EQUITY_THRESHOLD = 0.72;
const SLOWPLAY_PROBABILITY = 0.3;

// Extra equity required, beyond breakeven pot odds, to call - a cushion for the fact that this is
// a point estimate, not a certainty. Widened in the higher-stake rounds (3-5, $2 stakes) as a
// cheap proxy for reverse implied odds: money that looks fine to put in now can set up a pricier,
// worse spot later, and this at least discourages drifting in cheaply early only to face bigger
// bets later without a real look-ahead.
const CALL_EQUITY_MARGIN_EARLY = 0.05;
const CALL_EQUITY_MARGIN_LATE = 0.1;
const LATE_ROUND_THRESHOLD = 3;

// Equity required to raise, increasing with every raise already committed this round. The equity
// estimate itself treats the player's hidden hand as uniformly random, which stops being a fair
// assumption once they've reraised a couple of times - a repeat reraiser is revealing a stronger
// range than "random", and this is a cheap stand-in for that without actually modeling ranges.
const RAISE_EQUITY_BASE = 0.68;
const RAISE_EQUITY_PER_RAISE = 0.06;

export interface SmartStrategyOptions {
  trials?: number;
  random?: () => number;
}

// Builds an equity-driven OpponentStrategy. `getContext` is called fresh at each decision point
// (not memoized), so it should read live game state - the same interface every other strategy in
// this file implements, just backed by real hand-strength reasoning instead of a fixed script.
export function createSmartOpponentStrategy(
  getContext: () => DecisionContext,
  options: SmartStrategyOptions = {},
): OpponentStrategy {
  const random = options.random ?? Math.random;
  const trials = options.trials;

  function currentEquity(ctx: DecisionContext): number {
    return estimateOpponentEquity(
      {
        opponentHand: ctx.opponentHand,
        knownCards: ctx.knownCards,
        playerHandCount: ctx.playerHandCount,
        revealedBoardB: ctx.revealedBoardB,
        remainingReveals: ctx.remainingReveals,
      },
      trials,
      random,
    );
  }

  return {
    decideOpening(): OpeningAction {
      const ctx = getContext();
      const equity = currentEquity(ctx);
      if (equity >= SLOWPLAY_EQUITY_THRESHOLD && random() < SLOWPLAY_PROBABILITY) return "check";
      return equity >= BET_EQUITY_THRESHOLD ? "bet" : "check";
    },

    decideFacingBet(): FacingBetAction {
      const ctx = getContext();
      const equity = currentEquity(ctx);

      const raiseThreshold = RAISE_EQUITY_BASE + RAISE_EQUITY_PER_RAISE * ctx.raisesThisRound;
      if (equity >= raiseThreshold) return "raise";

      const margin = ctx.round >= LATE_ROUND_THRESHOLD ? CALL_EQUITY_MARGIN_LATE : CALL_EQUITY_MARGIN_EARLY;
      const breakeven = ctx.owed / (ctx.pot + ctx.owed);
      return equity >= breakeven + margin ? "call" : "fold";
    },
  };
}
