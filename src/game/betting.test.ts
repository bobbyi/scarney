import { describe, expect, it } from "vitest";
import { dealScarney, parseDeck } from "./deck";
import { handPoints } from "./scoring";
import { determineHighWinner, determineLowWinner } from "./showdown";
import {
  amountOwed,
  BIG_BLIND,
  callingStationStrategy,
  contributionForOpening,
  contributionForResponse,
  createRandomOpponentStrategy,
  isRoundClosed,
  opponentActsFirst,
  settleFold,
  settleShowdown,
  SMALL_BLIND,
  STAKES,
  type OpponentStrategy,
} from "./betting";

describe("opponentActsFirst", () => {
  it("is true when the player holds the dealer button", () => {
    expect(opponentActsFirst("player")).toBe(true);
  });

  it("is false when the opponent holds the dealer button", () => {
    expect(opponentActsFirst("opponent")).toBe(false);
  });
});

describe("amountOwed", () => {
  it("is zero when both sides have contributed the same amount", () => {
    expect(amountOwed(2, 2)).toBe(0);
  });

  it("is positive when the actor has contributed less than the other side", () => {
    expect(amountOwed(0, 3)).toBe(3);
  });
});

describe("contributionForOpening", () => {
  it("costs nothing to check", () => {
    expect(contributionForOpening("check", 0)).toBe(0);
  });

  it("costs the round's stake to bet", () => {
    expect(contributionForOpening("bet", 0)).toBe(2);
    expect(contributionForOpening("bet", 3)).toBe(4);
  });
});

describe("contributionForResponse", () => {
  it("costs exactly the owed amount to call", () => {
    expect(contributionForResponse("call", 1, 0)).toBe(1);
    expect(contributionForResponse("call", 2, 3)).toBe(2);
  });

  it("costs the owed amount plus the round's stake to raise", () => {
    expect(contributionForResponse("raise", 1, 0)).toBe(3);
    expect(contributionForResponse("raise", 1, 3)).toBe(5);
  });
});

describe("isRoundClosed", () => {
  it("is not closed after only one action, even if contributions trivially match (both zero)", () => {
    expect(isRoundClosed(1, 0, 0)).toBe(false);
  });

  it("closes once both sides have acted and contributions match", () => {
    expect(isRoundClosed(2, 0, 0)).toBe(true); // check, check
    expect(isRoundClosed(2, 1, 1)).toBe(true); // bet, call
  });

  it("stays open when a raise leaves contributions unequal, regardless of action count", () => {
    expect(isRoundClosed(3, 1, 2)).toBe(false);
    expect(isRoundClosed(4, 3, 2)).toBe(false);
  });
});

describe("settleShowdown", () => {
  it("gives the player the whole pot when they win both high and low", () => {
    expect(settleShowdown(10, "player", "player")).toEqual({ playerShare: 10, opponentShare: 0 });
  });

  it("gives the opponent the whole pot when they win both high and low", () => {
    expect(settleShowdown(10, "opponent", "opponent")).toEqual({ playerShare: 0, opponentShare: 10 });
  });

  it("splits the pot when high and low have different winners", () => {
    expect(settleShowdown(10, "player", "opponent")).toEqual({ playerShare: 5, opponentShare: 5 });
  });

  it("splits a tied half evenly, allowing a non-integral share", () => {
    // player wins high (gets the whole high half), high/low ties on low (that half splits in two)
    expect(settleShowdown(10, "player", "tie")).toEqual({ playerShare: 7.5, opponentShare: 2.5 });
  });
});

describe("settleFold", () => {
  it("gives the player the whole pot when the opponent folds", () => {
    expect(settleFold(10, "opponent")).toEqual({ playerShare: 10, opponentShare: 0 });
  });

  it("gives the player nothing when the player folds", () => {
    expect(settleFold(10, "player")).toEqual({ playerShare: 0, opponentShare: 10 });
  });
});

describe("callingStationStrategy", () => {
  it("always checks when opening and always calls when facing a bet", () => {
    expect(callingStationStrategy.decideOpening()).toBe("check");
    expect(callingStationStrategy.decideFacingBet()).toBe("call");
  });
});

describe("createRandomOpponentStrategy", () => {
  it("bets on a low roll and checks on a high roll when opening", () => {
    const aggressive = createRandomOpponentStrategy(() => 0);
    const passive = createRandomOpponentStrategy(() => 0.99);
    expect(aggressive.decideOpening()).toBe("bet");
    expect(passive.decideOpening()).toBe("check");
  });

  it("raises, calls, or folds depending on the roll when facing a bet", () => {
    const raiser = createRandomOpponentStrategy(() => 0);
    const caller = createRandomOpponentStrategy(() => 0.5);
    const folder = createRandomOpponentStrategy(() => 0.99);
    expect(raiser.decideFacingBet()).toBe("raise");
    expect(caller.decideFacingBet()).toBe("call");
    expect(folder.decideFacingBet()).toBe("fold");
  });
});

// Drives a full hand (deal, blinds, a scripted sequence of actions from both sides, showdown)
// through the pure engine only, with no DOM involved - the decoupling the tests here rely on.
// Always uses buttonHolder = "player", so the player posts the small blind and - per heads-up
// convention - acts first in round 0 only (facing the blind differential, not a fresh opening
// decision); every later round reverts to the non-button (opponent) acting first as normal.
function playHand(
  deck: ReturnType<typeof parseDeck>,
  strategy: OpponentStrategy,
  playerActions: ("check" | "bet" | "call" | "raise" | "fold")[],
) {
  const deal = dealScarney(deck!);
  let playerBalance = 100;
  let pot = SMALL_BLIND + BIG_BLIND;
  playerBalance -= SMALL_BLIND;

  for (let round = 0; round < STAKES.length; round++) {
    let playerContributed = round === 0 ? SMALL_BLIND : 0;
    let opponentContributed = round === 0 ? BIG_BLIND : 0;
    let actionsThisRound = 0;
    let folded: "player" | "opponent" | null = null;

    const takeOpponentTurn = () => {
      const owed = amountOwed(opponentContributed, playerContributed);
      actionsThisRound++;
      if (owed > 0) {
        const decision = strategy.decideFacingBet();
        if (decision === "fold") {
          folded = "opponent";
          return;
        }
        const contribution = contributionForResponse(decision, owed, round);
        opponentContributed += contribution;
        pot += contribution;
      } else {
        const decision = strategy.decideOpening();
        if (decision === "bet") {
          const contribution = contributionForOpening("bet", round);
          opponentContributed += contribution;
          pot += contribution;
        }
      }
    };

    // Round 0: the small blind (player, since buttonHolder = "player") acts first, facing the
    // blind differential. Every later round: the non-button (opponent, per opponentActsFirst)
    // acts first as a fresh opening decision, same as before blinds existed.
    if (round === 0 ? false : opponentActsFirst("player")) takeOpponentTurn();

    while (!folded && !isRoundClosed(actionsThisRound, playerContributed, opponentContributed)) {
      const action = playerActions.shift();
      if (!action) throw new Error("ran out of scripted player actions");
      actionsThisRound++;
      if (action === "fold") {
        folded = "player";
        break;
      }
      const contribution =
        action === "check" || action === "bet"
          ? contributionForOpening(action, round)
          : contributionForResponse(action, amountOwed(playerContributed, opponentContributed), round);
      playerBalance -= contribution;
      pot += contribution;
      playerContributed += contribution;

      if (!isRoundClosed(actionsThisRound, playerContributed, opponentContributed)) {
        takeOpponentTurn();
      }
    }

    if (folded) {
      playerBalance += settleFold(pot, folded).playerShare;
      return { playerBalance, pot, foldedBy: folded as "player" | "opponent" };
    }
  }

  const high = determineHighWinner([...deal.hand, ...deal.boardB], [...deal.opponentHand, ...deal.boardB]);
  const low = determineLowWinner(handPoints(deal.hand), handPoints(deal.opponentHand));
  playerBalance += settleShowdown(pot, high.winner, low).playerShare;
  return { playerBalance, pot, high, low };
}

describe("a full hand played through the engine", () => {
  const winningDeck = parseDeck(
    "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S",
  );

  it("settles the pot into the player's balance when they win both high and low", () => {
    const strategy: OpponentStrategy = { decideOpening: () => "check", decideFacingBet: () => "call" };
    // round 0: player (small blind) calls the $1 difference, opponent takes the big-blind option
    // and checks; rounds 1-2 ($2 stakes): player bets, opponent calls; rounds 3-5 ($4 stakes,
    // unreached financially since both check): both check.
    const result = playHand(winningDeck, strategy, [
      "call",
      "bet",
      "bet",
      "check",
      "check",
      "check",
    ]);

    // blinds (1+2) + round 0's call (1) + 2 rounds of $2 bet+call (8) = 12
    expect(result.pot).toBe(12);
    expect(result.playerBalance).toBe(106);
  });

  it("ends the hand immediately and awards the pot when the opponent folds", () => {
    const strategy: OpponentStrategy = { decideOpening: () => "check", decideFacingBet: () => "fold" };
    // player (small blind) raises the big blind in round 0; the opponent, now facing a bet, folds
    const result = playHand(winningDeck, strategy, ["raise"]);

    expect(result.foldedBy).toBe("opponent");
    // blinds (1+2) + the player's raise (owed $1 + the $2 stake = $3) = 6
    expect(result.pot).toBe(6);
    // 100 - $1 small blind - $3 raise + the whole $6 pot back = 102
    expect(result.playerBalance).toBe(102);
  });
});
