import "./style.css";
import {
  createDeck,
  shuffleDeck,
  dealScarney,
  type Card,
  type ScarneyDeal,
  type Suit,
} from "./game/deck";

const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const RED_SUITS: Suit[] = ["hearts", "diamonds"];
const BOARD_SIZE = 5;

let deal: ScarneyDeal = dealScarney(shuffleDeck(createDeck()));
let revealedCount = 0;

function renderCard(card: Card): string {
  const colorClass = RED_SUITS.includes(card.suit) ? "red" : "black";
  return `
    <div class="card ${colorClass}">
      <span class="rank">${card.rank}</span>
      <span class="suit">${SUIT_SYMBOLS[card.suit]}</span>
    </div>
  `;
}

function renderPlaceholder(): string {
  return `<div class="card placeholder"></div>`;
}

function renderBoardRow(board: Card[]): string {
  return board
    .map((card, i) => (i < revealedCount ? renderCard(card) : renderPlaceholder()))
    .join("");
}

function render() {
  const handEl = document.querySelector<HTMLDivElement>("#hand")!;
  const boardAEl = document.querySelector<HTMLDivElement>("#board-a")!;
  const boardBEl = document.querySelector<HTMLDivElement>("#board-b")!;
  const nextButton = document.querySelector<HTMLButtonElement>("#next-button")!;

  handEl.innerHTML = deal.hand.map(renderCard).join("");
  boardAEl.innerHTML = renderBoardRow(deal.boardA);
  boardBEl.innerHTML = renderBoardRow(deal.boardB);
  nextButton.disabled = revealedCount >= BOARD_SIZE;
}

function dealNewHand() {
  deal = dealScarney(shuffleDeck(createDeck()));
  revealedCount = 0;
  render();
}

function revealNextRound() {
  if (revealedCount < BOARD_SIZE) {
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
