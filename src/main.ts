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
  ANTE,
  opponentActsFirst,
  resolveBettingRound,
  settleShowdown,
  STAKES,
  type BettingAction,
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

let deal: ScarneyDeal;
let revealedCount: number;
let hand: Card[];
let opponentHand: Card[];
let discardPiles: Card[][];
let showdownRevealed: boolean;
let showdownResult: { high: HighResult; low: Winner } | null;
let playerBalance = 100;
let pot: number;
let potNotes: string[];
let buttonHolder: Player = "player";
let opponentFirst: boolean;

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

// Deals a fresh hand under the current dealer button assignment: applies the ante and, if
// the opponent acts first this hand, their forced opening check (they never open with a bet).
function startHand() {
  opponentFirst = opponentActsFirst(buttonHolder);
  deal = dealScarney(nextDeck());
  revealedCount = 0;
  hand = deal.hand;
  opponentHand = deal.opponentHand;
  discardPiles = Array.from({ length: BOARD_SIZE }, () => []);
  showdownRevealed = false;
  showdownResult = null;

  pot = ANTE * 2;
  playerBalance -= ANTE;
  potNotes = ["Both players ante $1"];
  if (opponentFirst) potNotes.push("Opponent checks");
}

function dealNewHand() {
  buttonHolder = buttonHolder === "player" ? "opponent" : "player";
  startHand();
  render();
}

function resolveRound(action: BettingAction) {
  const { potContribution, opponentAction } = resolveBettingRound(action, revealedCount);
  playerBalance -= potContribution;
  pot += potContribution * 2;

  potNotes = [];
  // If the opponent already checked to open this round, only a bet requires a further response
  // from them (a call); a matching check needs no additional note, it just closes the round.
  if (!opponentFirst || action === "bet") {
    potNotes.push(opponentAction === "check" ? "Opponent checks" : "Opponent calls");
  }

  if (revealedCount < BOARD_SIZE) {
    const slotIndex = revealedCount;
    const revealedTopCard = deal.boardA[slotIndex];
    const playerPartition = partitionByRank(hand, revealedTopCard.rank);
    const opponentPartition = partitionByRank(opponentHand, revealedTopCard.rank);
    hand = playerPartition.remaining;
    opponentHand = opponentPartition.remaining;
    discardPiles[slotIndex] = [...playerPartition.matching, ...opponentPartition.matching];
    revealedCount++;
    if (opponentFirst) potNotes.push("Opponent checks");
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
  if (action === "check" || action === "bet") {
    resolveRound(action);
  } else if (action === "next-hand") {
    dealNewHand();
  }
});

startHand();
render();
