import "./style.css";
import {
  createDeck,
  shuffleDeck,
  dealScarney,
  partitionByRank,
  parseDeck,
  type Card,
  type ScarneyDeal,
  type Rank,
} from "./game/deck";
import { classifyHand, handPoints } from "./game/scoring";
import { determineHighWinner, determineLowWinner, type HighResult, type Winner } from "./game/showdown";
import {
  amountOwed,
  ANTE,
  callingStationStrategy,
  contributionForOpening,
  contributionForResponse,
  isRoundClosed,
  opponentActsFirst,
  randomOpponentStrategy,
  settleFold,
  settleShowdown,
  STAKES,
  type FacingBetAction,
  type OpeningAction,
  type OpponentStrategy,
  type Player,
} from "./game/betting";

const RANK_FILE_NAMES: Record<Rank, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  J: "jack",
  Q: "queen",
  K: "king",
  A: "ace",
};

const BOARD_SIZE = 5;
const DISCARD_STACK_OFFSET_PX = 28;

// Debug hook: ?deck=KS,KH,2C,... in the URL fixes the deck for reproducing a specific scenario.
function nextDeck(): Card[] {
  const deckParam = new URLSearchParams(window.location.search).get("deck");
  if (deckParam) {
    const cards = parseDeck(deckParam);
    if (cards && cards.length >= 20) {
      return cards;
    }
    console.warn(
      `Ignoring invalid "deck" URL param (need >= 20 unique cards like "KS,KH,10D,..."); dealing randomly instead.`,
    );
  }
  return shuffleDeck(createDeck());
}

// Debug hook: ?opponent=... forces a deterministic placeholder opponent instead of the random
// one, so specific betting scenarios (fold, raise) can be reproduced for manual/automated testing.
function nextStrategy(): OpponentStrategy {
  const param = new URLSearchParams(window.location.search).get("opponent");
  if (param === "calling-station") return callingStationStrategy;
  if (param === "aggressor") return { decideOpening: () => "bet", decideFacingBet: () => "raise" };
  if (param === "folder") return { decideOpening: () => "check", decideFacingBet: () => "fold" };
  return randomOpponentStrategy;
}

type HandOutcome = { type: "showdown"; high: HighResult; low: Winner } | { type: "fold"; folder: Player };

const strategy: OpponentStrategy = nextStrategy();

let deal: ScarneyDeal;
let revealedCount: number;
let hand: Card[];
let opponentHand: Card[];
let discardPiles: Card[][];
let handOutcome: HandOutcome | null;
let playerBalance = 100;
let pot: number;
let potNotes: string[];
let buttonHolder: Player = "player";
let opponentFirst: boolean;

// Per-round betting state.
let playerContributedThisRound: number;
let opponentContributedThisRound: number;
let actionsThisRound: number;
let facingBet: boolean;

function cardImageSrc(card: Card): string {
  return `/cards/${RANK_FILE_NAMES[card.rank]}_of_${card.suit}.svg`;
}

function renderCard(card: Card, className = "card", style = ""): string {
  const styleAttr = style ? ` style="${style}"` : "";
  return `<img class="${className}" src="${cardImageSrc(card)}" alt="${card.rank} of ${card.suit}"${styleAttr}>`;
}

function renderCardBack(): string {
  return `<img class="card back" src="/cards/back.svg" alt="face-down card">`;
}

function renderBoardSlot(card: Card, index: number, discards: Card[]): string {
  if (index >= revealedCount) {
    return `<div class="board-slot"><div class="card placeholder"></div></div>`;
  }
  const discardImgs = discards
    .map((discard, i) => renderCard(discard, "card discard", `top: ${(i + 1) * DISCARD_STACK_OFFSET_PX}px`))
    .join("");
  return `<div class="board-slot">${renderCard(card)}${discardImgs}</div>`;
}

function winnerVerb(winner: Winner): string {
  return winner === "player" ? "You win" : "Opponent wins";
}

function renderResults(): string {
  let line1 = "";
  let line2 = "";

  if (handOutcome?.type === "showdown") {
    const { high, low } = handOutcome;
    const playerPoints = handPoints(hand);
    const opponentPoints = handPoints(opponentHand);

    line1 =
      high.winner === "tie"
        ? `High ties (${high.playerHandName})`
        : `${winnerVerb(high.winner)} the high with ${high.winner === "player" ? high.playerHandName : high.opponentHandName}`;

    line2 =
      low === "tie"
        ? `Low ties at ${playerPoints} points`
        : `${winnerVerb(low)} the low with ${low === "player" ? playerPoints : opponentPoints} points`;
  } else if (handOutcome?.type === "fold") {
    line1 =
      handOutcome.folder === "player"
        ? `You fold — Opponent wins ${formatMoney(pot)}`
        : `Opponent folds — You win ${formatMoney(pot)}`;
  }

  // Always render both lines (even empty) so the results block holds a constant height and
  // showing the showdown text doesn't grow the page and shift the controls below it.
  return `
    <div class="result-line">${line1}</div>
    <div class="result-line">${line2}</div>
  `;
}

function formatMoney(amount: number): string {
  return `$${amount % 1 === 0 ? amount : amount.toFixed(2)}`;
}

function renderControls(): string {
  if (handOutcome) {
    return `<button data-action="next-hand">Next Hand</button>`;
  }
  if (facingBet) {
    const owed = amountOwed(playerContributedThisRound, opponentContributedThisRound);
    const raiseCost = contributionForResponse("raise", owed, revealedCount);
    return `
      <button data-action="call">Call ${formatMoney(owed)}</button>
      <button data-action="raise">Raise ${formatMoney(raiseCost)}</button>
      <button data-action="fold">Fold</button>
    `;
  }
  const stake = STAKES[revealedCount];
  return `
    <button data-action="check">Check</button>
    <button data-action="bet">Bet ${formatMoney(stake)}</button>
  `;
}

function renderPotStatus(): string {
  if (handOutcome) return "";
  const notes = potNotes.length ? ` — ${potNotes.join("; ")}` : "";
  return `Pot: ${formatMoney(pot)}${notes}`;
}

function renderDealerBadge(holder: Player): string {
  return buttonHolder === holder ? `<span class="dealer-badge">D</span>` : "";
}

function render() {
  const handEl = document.querySelector<HTMLDivElement>("#hand")!;
  const opponentHandEl = document.querySelector<HTMLDivElement>("#opponent-hand")!;
  const boardAEl = document.querySelector<HTMLDivElement>("#board-a")!;
  const boardBEl = document.querySelector<HTMLDivElement>("#board-b")!;
  const controlsEl = document.querySelector<HTMLDivElement>("#controls")!;
  const potStatusEl = document.querySelector<HTMLDivElement>("#pot-status")!;
  const handTypeEl = document.querySelector<HTMLDivElement>("#hand-type")!;
  const pointTotalEl = document.querySelector<HTMLDivElement>("#point-total")!;
  const balanceEl = document.querySelector<HTMLDivElement>("#balance")!;
  const resultsEl = document.querySelector<HTMLDivElement>("#results")!;
  const playerDealerBadgeEl = document.querySelector<HTMLDivElement>("#player-dealer-badge")!;
  const opponentDealerBadgeEl = document.querySelector<HTMLDivElement>("#opponent-dealer-badge")!;

  playerDealerBadgeEl.innerHTML = renderDealerBadge("player");
  opponentDealerBadgeEl.innerHTML = renderDealerBadge("opponent");

  handEl.innerHTML = hand.map((card) => renderCard(card)).join("");
  opponentHandEl.innerHTML =
    handOutcome?.type === "showdown"
      ? opponentHand.map((card) => renderCard(card)).join("")
      : opponentHand.map(() => renderCardBack()).join("");
  boardAEl.innerHTML = deal.boardA
    .map((card, i) => renderBoardSlot(card, i, discardPiles[i]))
    .join("");
  boardBEl.innerHTML = deal.boardB.map((card, i) => renderBoardSlot(card, i, [])).join("");

  potStatusEl.textContent = renderPotStatus();
  controlsEl.innerHTML = renderControls();

  const revealedBottomCards = deal.boardB.slice(0, revealedCount);
  handTypeEl.textContent = classifyHand([...hand, ...revealedBottomCards]);
  pointTotalEl.textContent = String(handPoints(hand));
  balanceEl.textContent = formatMoney(playerBalance);
  resultsEl.innerHTML = renderResults();
}

// Resolves the opponent's single turn: responds to a live bet (call/raise/fold) if one is
// owed, otherwise makes their own opening decision (check/bet). Never called more than once
// per player click, since with two players every action is answered by exactly one response.
function resolveOpponentTurn() {
  const owed = amountOwed(opponentContributedThisRound, playerContributedThisRound);
  actionsThisRound++;
  if (owed > 0) {
    const decision = strategy.decideFacingBet();
    if (decision === "fold") {
      handOutcome = { type: "fold", folder: "opponent" };
      playerBalance += settleFold(pot, "opponent").playerShare;
      potNotes.push("Opponent folds");
      return;
    }
    const contribution = contributionForResponse(decision, owed, revealedCount);
    opponentContributedThisRound += contribution;
    pot += contribution;
    potNotes.push(decision === "call" ? "Opponent calls" : "Opponent raises");
  } else {
    const decision = strategy.decideOpening();
    if (decision === "bet") {
      const contribution = contributionForOpening("bet", revealedCount);
      opponentContributedThisRound += contribution;
      pot += contribution;
      potNotes.push(`Opponent bets ${formatMoney(contribution)}`);
    } else {
      potNotes.push("Opponent checks");
    }
  }
}

// Resets a round's betting state and, if the opponent holds priority this hand, immediately
// resolves their opening move (check or bet) before the player's controls are shown.
function startRound() {
  playerContributedThisRound = 0;
  opponentContributedThisRound = 0;
  actionsThisRound = 0;
  facingBet = false;
  if (opponentFirst) {
    resolveOpponentTurn();
    facingBet = opponentContributedThisRound > playerContributedThisRound;
  }
}

function advanceRoundOrShowdown() {
  if (revealedCount < BOARD_SIZE) {
    const slotIndex = revealedCount;
    const revealedTopCard = deal.boardA[slotIndex];
    const playerPartition = partitionByRank(hand, revealedTopCard.rank);
    const opponentPartition = partitionByRank(opponentHand, revealedTopCard.rank);
    hand = playerPartition.remaining;
    opponentHand = opponentPartition.remaining;
    discardPiles[slotIndex] = [...playerPartition.matching, ...opponentPartition.matching];
    revealedCount++;
    startRound();
  } else {
    const revealedBottomCards = deal.boardB;
    const high = determineHighWinner([...hand, ...revealedBottomCards], [...opponentHand, ...revealedBottomCards]);
    const low = determineLowWinner(handPoints(hand), handPoints(opponentHand));
    handOutcome = { type: "showdown", high, low };
    playerBalance += settleShowdown(pot, high.winner, low).playerShare;
  }
}

// Called after the player's own action settles their side of this exchange: closes the round
// immediately if the player's action already matched the opponent, otherwise lets the opponent
// respond once and re-checks — closing, ending the hand (a fold), or handing it back to the
// player if the opponent raised.
function continueRound() {
  if (isRoundClosed(actionsThisRound, playerContributedThisRound, opponentContributedThisRound)) {
    advanceRoundOrShowdown();
    render();
    return;
  }
  resolveOpponentTurn();
  if (handOutcome) {
    render();
    return;
  }
  if (isRoundClosed(actionsThisRound, playerContributedThisRound, opponentContributedThisRound)) {
    advanceRoundOrShowdown();
  } else {
    facingBet = true;
  }
  render();
}

function resolveOpening(action: OpeningAction) {
  potNotes = [];
  const contribution = contributionForOpening(action, revealedCount);
  playerBalance -= contribution;
  pot += contribution;
  playerContributedThisRound += contribution;
  actionsThisRound++;
  continueRound();
}

function resolveFacingBet(action: FacingBetAction) {
  potNotes = [];
  if (action === "fold") {
    handOutcome = { type: "fold", folder: "player" };
    playerBalance += settleFold(pot, "player").playerShare; // always 0, kept for symmetry/clarity
    render();
    return;
  }
  const owed = amountOwed(playerContributedThisRound, opponentContributedThisRound);
  const contribution = contributionForResponse(action, owed, revealedCount);
  playerBalance -= contribution;
  pot += contribution;
  playerContributedThisRound += contribution;
  actionsThisRound++;
  continueRound();
}

// Deals a fresh hand under the current dealer button assignment: applies the ante and starts
// round 0 (which resolves the opponent's opening move first if they hold priority this hand).
function startHand() {
  opponentFirst = opponentActsFirst(buttonHolder);
  deal = dealScarney(nextDeck());
  revealedCount = 0;
  hand = deal.hand;
  opponentHand = deal.opponentHand;
  discardPiles = Array.from({ length: BOARD_SIZE }, () => []);
  handOutcome = null;

  pot = ANTE * 2;
  playerBalance -= ANTE;
  potNotes = ["Both players ante $1"];
  startRound();
}

function dealNewHand() {
  buttonHolder = buttonHolder === "player" ? "opponent" : "player";
  startHand();
  render();
}

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="table">
    <div class="stats">
      <div class="stat">
        <div class="stat-label">Hand</div>
        <div class="stat-value" id="hand-type"></div>
      </div>
      <div class="stat">
        <div class="stat-label">Points</div>
        <div class="stat-value" id="point-total"></div>
      </div>
      <div class="stat">
        <div class="stat-label">Balance</div>
        <div class="stat-value" id="balance"></div>
      </div>
    </div>
    <div id="player-dealer-badge" class="dealer-row"></div>
    <div id="hand" class="hand"></div>
    <div class="boards">
      <div id="board-a" class="board-row"></div>
      <div id="board-b" class="board-row"></div>
    </div>
    <div id="opponent-hand" class="hand opponent-hand"></div>
    <div id="opponent-dealer-badge" class="dealer-row"></div>
    <div id="results" class="results"></div>
    <div id="pot-status" class="pot-status"></div>
    <div id="controls" class="controls"></div>
  </div>
`;

document.querySelector<HTMLDivElement>("#controls")!.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).dataset.action;
  switch (action) {
    case "check":
    case "bet":
      resolveOpening(action);
      break;
    case "call":
    case "raise":
    case "fold":
      resolveFacingBet(action);
      break;
    case "next-hand":
      dealNewHand();
      break;
  }
});

startHand();
render();
