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
import { resolveBettingRound, settleShowdown, STAKES, type BettingAction, type OpponentAction } from "./game/betting";

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

let deal: ScarneyDeal = dealScarney(nextDeck());
let revealedCount = 0;
let hand: Card[] = deal.hand;
let opponentHand: Card[] = deal.opponentHand;
let discardPiles: Card[][] = Array.from({ length: BOARD_SIZE }, () => []);
let showdownRevealed = false;
let playerBalance = 100;
let pot = 0;
let lastOpponentAction: OpponentAction | null = null;
let showdownResult: { high: HighResult; low: Winner } | null = null;

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
  let highLine = "";
  let lowLine = "";

  if (showdownResult) {
    const { high, low } = showdownResult;
    const playerPoints = handPoints(hand);
    const opponentPoints = handPoints(opponentHand);

    highLine =
      high.winner === "tie"
        ? `High ties (${high.playerHandName})`
        : `${winnerVerb(high.winner)} the high with ${high.winner === "player" ? high.playerHandName : high.opponentHandName}`;

    lowLine =
      low === "tie"
        ? `Low ties at ${playerPoints} points`
        : `${winnerVerb(low)} the low with ${low === "player" ? playerPoints : opponentPoints} points`;
  }

  // Always render both lines (even empty) so the results block holds a constant height and
  // showing the showdown text doesn't grow the page and shift the controls below it.
  return `
    <div class="result-line">${highLine}</div>
    <div class="result-line">${lowLine}</div>
  `;
}

function formatMoney(amount: number): string {
  return `$${amount % 1 === 0 ? amount : amount.toFixed(2)}`;
}

function renderControls(): string {
  if (showdownRevealed) {
    return `<button data-action="next-hand">Next Hand</button>`;
  }
  const stake = STAKES[revealedCount];
  return `
    <button data-action="check">Check</button>
    <button data-action="bet">Bet ${formatMoney(stake)}</button>
  `;
}

function renderPotStatus(): string {
  if (showdownRevealed) return "";
  const opponentLine =
    lastOpponentAction === "check" ? " — Opponent checks" : lastOpponentAction === "call" ? " — Opponent calls" : "";
  return `Pot: ${formatMoney(pot)}${opponentLine}`;
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

  handEl.innerHTML = hand.map((card) => renderCard(card)).join("");
  opponentHandEl.innerHTML = showdownRevealed
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

function dealNewHand() {
  deal = dealScarney(nextDeck());
  revealedCount = 0;
  hand = deal.hand;
  opponentHand = deal.opponentHand;
  discardPiles = Array.from({ length: BOARD_SIZE }, () => []);
  showdownRevealed = false;
  pot = 0;
  lastOpponentAction = null;
  showdownResult = null;
  render();
}

function resolveRound(action: BettingAction) {
  const { potContribution, opponentAction } = resolveBettingRound(action, revealedCount);
  playerBalance -= potContribution;
  pot += potContribution * 2;
  lastOpponentAction = opponentAction;

  if (revealedCount < BOARD_SIZE) {
    const slotIndex = revealedCount;
    const revealedTopCard = deal.boardA[slotIndex];
    const playerPartition = partitionByRank(hand, revealedTopCard.rank);
    const opponentPartition = partitionByRank(opponentHand, revealedTopCard.rank);
    hand = playerPartition.remaining;
    opponentHand = opponentPartition.remaining;
    discardPiles[slotIndex] = [...playerPartition.matching, ...opponentPartition.matching];
    revealedCount++;
  } else {
    showdownRevealed = true;
    const revealedBottomCards = deal.boardB;
    const high = determineHighWinner([...hand, ...revealedBottomCards], [...opponentHand, ...revealedBottomCards]);
    const low = determineLowWinner(handPoints(hand), handPoints(opponentHand));
    showdownResult = { high, low };
    playerBalance += settleShowdown(pot, high.winner, low).playerShare;
  }
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
    <div id="hand" class="hand"></div>
    <div class="boards">
      <div id="board-a" class="board-row"></div>
      <div id="board-b" class="board-row"></div>
    </div>
    <div id="opponent-hand" class="hand opponent-hand"></div>
    <div id="results" class="results"></div>
    <div id="pot-status" class="pot-status"></div>
    <div id="controls" class="controls"></div>
  </div>
`;

document.querySelector<HTMLDivElement>("#controls")!.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).dataset.action;
  if (action === "check" || action === "bet") {
    resolveRound(action);
  } else if (action === "next-hand") {
    dealNewHand();
  }
});

render();
