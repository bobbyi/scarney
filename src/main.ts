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
const DISCARD_STACK_OFFSET_PX = 14;

// Debug hook: ?deck=KS,KH,2C,... in the URL fixes the deck for reproducing a specific scenario.
function nextDeck(): Card[] {
  const deckParam = new URLSearchParams(window.location.search).get("deck");
  if (deckParam) {
    const cards = parseDeck(deckParam);
    if (cards && cards.length >= 15) {
      return cards;
    }
    console.warn(
      `Ignoring invalid "deck" URL param (need >= 15 unique cards like "KS,KH,10D,..."); dealing randomly instead.`,
    );
  }
  return shuffleDeck(createDeck());
}

let deal: ScarneyDeal = dealScarney(nextDeck());
let revealedCount = 0;
let hand: Card[] = deal.hand;
let discardPiles: Card[][] = Array.from({ length: BOARD_SIZE }, () => []);

function cardImageSrc(card: Card): string {
  return `/cards/${RANK_FILE_NAMES[card.rank]}_of_${card.suit}.svg`;
}

function renderCard(card: Card, className = "card", style = ""): string {
  const styleAttr = style ? ` style="${style}"` : "";
  return `<img class="${className}" src="${cardImageSrc(card)}" alt="${card.rank} of ${card.suit}"${styleAttr}>`;
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

function render() {
  const handEl = document.querySelector<HTMLDivElement>("#hand")!;
  const boardAEl = document.querySelector<HTMLDivElement>("#board-a")!;
  const boardBEl = document.querySelector<HTMLDivElement>("#board-b")!;
  const nextButton = document.querySelector<HTMLButtonElement>("#next-button")!;

  handEl.innerHTML = hand.map((card) => renderCard(card)).join("");
  boardAEl.innerHTML = deal.boardA
    .map((card, i) => renderBoardSlot(card, i, discardPiles[i]))
    .join("");
  boardBEl.innerHTML = deal.boardB.map((card, i) => renderBoardSlot(card, i, [])).join("");
  nextButton.disabled = revealedCount >= BOARD_SIZE;
}

function dealNewHand() {
  deal = dealScarney(nextDeck());
  revealedCount = 0;
  hand = deal.hand;
  discardPiles = Array.from({ length: BOARD_SIZE }, () => []);
  render();
}

function revealNextRound() {
  if (revealedCount < BOARD_SIZE) {
    const slotIndex = revealedCount;
    const revealedTopCard = deal.boardA[slotIndex];
    const { matching, remaining } = partitionByRank(hand, revealedTopCard.rank);
    hand = remaining;
    discardPiles[slotIndex] = matching;
    revealedCount++;
    render();
  }
}

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="table">
    <h1>Scarney</h1>
    <div id="hand" class="hand"></div>
    <div class="boards">
      <div id="board-a" class="board-row"></div>
      <div id="board-b" class="board-row"></div>
    </div>
    <div class="controls">
      <button id="deal-button">Deal Hand</button>
      <button id="next-button">Next Round</button>
    </div>
  </div>
`;

document.querySelector<HTMLButtonElement>("#deal-button")!.addEventListener("click", dealNewHand);
document.querySelector<HTMLButtonElement>("#next-button")!.addEventListener("click", revealNextRound);

render();
