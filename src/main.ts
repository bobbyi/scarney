import "./style.css";
import { createDeck, shuffleDeck, dealScarney, type Card, type ScarneyDeal, type Rank } from "./game/deck";

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

let deal: ScarneyDeal = dealScarney(shuffleDeck(createDeck()));
let revealedCount = 0;

function cardImageSrc(card: Card): string {
  return `/cards/${RANK_FILE_NAMES[card.rank]}_of_${card.suit}.svg`;
}

function renderCard(card: Card): string {
  return `<img class="card" src="${cardImageSrc(card)}" alt="${card.rank} of ${card.suit}">`;
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
