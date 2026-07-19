import "./style.css";
import { createDeck, shuffleDeck, dealHand, type Card, type Suit } from "./game/deck";

const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const RED_SUITS: Suit[] = ["hearts", "diamonds"];

function renderCard(card: Card): string {
  const colorClass = RED_SUITS.includes(card.suit) ? "red" : "black";
  return `
    <div class="card ${colorClass}">
      <span class="rank">${card.rank}</span>
      <span class="suit">${SUIT_SYMBOLS[card.suit]}</span>
    </div>
  `;
}

function dealNewHand(handEl: HTMLElement) {
  const deck = shuffleDeck(createDeck());
  const hand = dealHand(deck, 5);
  handEl.innerHTML = hand.map(renderCard).join("");
}

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="table">
    <h1>Poker</h1>
    <div id="hand" class="hand"></div>
    <button id="deal-button">Deal Hand</button>
  </div>
`;

const handEl = document.querySelector<HTMLDivElement>("#hand")!;
const dealButton = document.querySelector<HTMLButtonElement>("#deal-button")!;

dealButton.addEventListener("click", () => dealNewHand(handEl));
dealNewHand(handEl);
