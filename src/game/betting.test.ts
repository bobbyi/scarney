import { describe, expect, it } from "vitest";
import { dealScarney, parseDeck } from "./deck";
import { handPoints } from "./scoring";
import { determineHighWinner, determineLowWinner } from "./showdown";
import { resolveBettingRound, settleShowdown, STAKES } from "./betting";

describe("resolveBettingRound", () => {
  it("charges nothing and has the opponent check back when the player checks", () => {
    const result = resolveBettingRound("check", 0);
    expect(result).toEqual({ potContribution: 0, opponentAction: "check" });
  });

  it("charges the round's stake and has the opponent call when the player bets", () => {
    expect(resolveBettingRound("bet", 0)).toEqual({ potContribution: 1, opponentAction: "call" });
    expect(resolveBettingRound("bet", 2)).toEqual({ potContribution: 1, opponentAction: "call" });
    expect(resolveBettingRound("bet", 3)).toEqual({ potContribution: 2, opponentAction: "call" });
    expect(resolveBettingRound("bet", 5)).toEqual({ potContribution: 2, opponentAction: "call" });
  });

  it("stakes are $1 for the first three rounds and $2 for the last three", () => {
    expect(STAKES).toEqual([1, 1, 1, 2, 2, 2]);
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

describe("betting composed with a full deal and showdown", () => {
  it("tracks the player's balance across a scripted sequence of bets and checks", () => {
    const deck = parseDeck(
      "AS,AH,AD,AC,2S,6H,7C,8S,9H,10C,6S,7S,8H,9C,10H,3S,3H,4D,4C,5S",
    )!;
    const deal = dealScarney(deck);

    const actions = ["bet", "bet", "bet", "check", "check", "check"] as const;
    let playerBalance = 100;
    let pot = 0;

    for (const [round, action] of actions.entries()) {
      const { potContribution, opponentAction } = resolveBettingRound(action, round);
      playerBalance -= potContribution;
      pot += potContribution * (opponentAction === "call" ? 2 : 1);
    }

    // this deck's board ranks never match either hand, so no discards occur before showdown
    const high = determineHighWinner([...deal.hand, ...deal.boardB], [...deal.opponentHand, ...deal.boardB]);
    const low = determineLowWinner(handPoints(deal.hand), handPoints(deal.opponentHand));

    expect(high.winner).toBe("player");
    expect(high.playerHandName).toBe("Four of a Kind");

    const { playerShare } = settleShowdown(pot, high.winner, low);
    playerBalance += playerShare;

    expect(pot).toBe(6);
    expect(playerBalance).toBe(103);
  });
});
