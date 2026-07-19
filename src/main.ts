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
import { determineHighWinner, determineLowWinner, type Winner } from "./game/showdown";

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

function renderResults(revealedBottomCards: Card[]): string {
  if (!showdownRevealed) return "";

  const playerPool = [...hand, ...revealedBottomCards];
  const opponentPool = [...opponentHand, ...revealedBottomCards];
  const high = determineHighWinner(playerPool, opponentPool);
  const playerPoints = handPoints(hand);
  const opponentPoints = handPoints(opponentHand);
  const low = determineLowWinner(playerPoints, opponentPoints);

  const highLine =
    high.winner === "tie"
      ? `High ties (${high.playerHandName})`
      : `${winnerVerb(high.winner)} the high with ${high.winner === "player" ? high.playerHandName : high.opponentHandName}`;

  const lowLine =
    low === "tie"
      ? `Low ties at ${playerPoints} points`
      : `${winnerVerb(low)} the low with ${low === "player" ? playerPoints : opponentPoints} points`;

  return `
    <div class="result-line">${highLine}</div>
    <div class="result-line">${lowLine}</div>
  `;
}

function render() {
  const handEl = document.querySelector<HTMLDivElement>("#hand")!;
  const opponentHandEl = document.querySelector<HTMLDivElement>("#opponent-hand")!;
  const boardAEl = document.querySelector<HTMLDivElement>("#board-a")!;
  const boardBEl = document.querySelector<HTMLDivElement>("#board-b")!;
  const nextButton = document.querySelector<HTMLButtonElement>("#next-button")!;
  const handTypeEl = document.querySelector<HTMLDivElement>("#hand-type")!;
  const pointTotalEl = document.querySelector<HTMLDivElement>("#point-total")!;
  const resultsEl = document.querySelector<HTMLDivElement>("#results")!;

  handEl.innerHTML = hand.map((card) => renderCard(card)).join("");
  opponentHandEl.innerHTML = showdownRevealed
    ? opponentHand.map((card) => renderCard(card)).join("")
    : opponentHand.map(() => renderCardBack()).join("");
  boardAEl.innerHTML = deal.boardA
    .map((card, i) => renderBoardSlot(card, i, discardPiles[i]))
    .join("");
  boardBEl.innerHTML = deal.boardB.map((card, i) => renderBoardSlot(card, i, [])).join("");

  const fullyRevealed = revealedCount >= BOARD_SIZE;
  nextButton.textContent = fullyRevealed ? "Showdown" : "Next Round";
  nextButton.disabled = fullyRevealed && showdownRevealed;

  const revealedBottomCards = deal.boardB.slice(0, revealedCount);
  handTypeEl.textContent = classifyHand([...hand, ...revealedBottomCards]);
  pointTotalEl.textContent = String(handPoints(hand));
  resultsEl.innerHTML = renderResults(revealedBottomCards);
}

function dealNewHand() {
  deal = dealScarney(nextDeck());
  revealedCount = 0;
  hand = deal.hand;
  opponentHand = deal.opponentHand;
  discardPiles = Array.from({ length: BOARD_SIZE }, () => []);
  showdownRevealed = false;
  render();
}

function revealNextRound() {
  if (revealedCount < BOARD_SIZE) {
    const slotIndex = revealedCount;
    const revealedTopCard = deal.boardA[slotIndex];
    const playerPartition = partitionByRank(hand, revealedTopCard.rank);
    const opponentPartition = partitionByRank(opponentHand, revealedTopCard.rank);
    hand = playerPartition.remaining;
    opponentHand = opponentPartition.remaining;
    discardPiles[slotIndex] = [...playerPartition.matching, ...opponentPartition.matching];
    revealedCount++;
    render();
  } else if (!showdownRevealed) {
    showdownRevealed = true;
    render();
  }
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
    </div>
    <div id="hand" class="hand"></div>
    <div class="boards">
      <div id="board-a" class="board-row"></div>
      <div id="board-b" class="board-row"></div>
    </div>
    <div id="opponent-hand" class="hand opponent-hand"></div>
    <div id="results" class="results"></div>
    <div class="controls">
      <button id="deal-button">Deal Hand</button>
      <button id="next-button">Next Round</button>
    </div>
  </div>
`;

document.querySelector<HTMLButtonElement>("#deal-button")!.addEventListener("click", dealNewHand);
document.querySelector<HTMLButtonElement>("#next-button")!.addEventListener("click", revealNextRound);

render();
