import "./style.css";
import {
  createDeck,
  shuffleDeck,
  dealScarney,
  partitionByRank,
  parseDeck,
  RANKS,
  SUITS,
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

// Debug hook: ?fast=1 collapses the action-banner timing to near-zero for automated tests.
const FAST = new URLSearchParams(window.location.search).has("fast");
const BANNER_HOLD_MS = FAST ? 5 : 900;
const BANNER_TRANSITION_MS = FAST ? 5 : 220;
const REVEAL_PAUSE_MS = FAST ? 5 : 400;

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
let handOutcome: HandOutcome | null = null;
let playerBalance = 100;
let pot: number;
let buttonHolder: Player = "player";
let opponentFirst: boolean;
let resolving = false;
let bannerMessage: string | null = null;

// Per-round betting state.
let playerContributedThisRound: number;
let opponentContributedThisRound: number;
let actionsThisRound: number;
let facingBet = false;

function cardImageSrc(card: Card): string {
  return `${import.meta.env.BASE_URL}cards/${RANK_FILE_NAMES[card.rank]}_of_${card.suit}.svg`;
}

// Warms the browser's image cache for every card face (+ the back) up front, so that when a
// reveal/discard sets a fresh <img src> mid-hand, the image is already decoded and paints
// instantly alongside the render instead of trailing in a moment after the action banner.
function preloadCardImages() {
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      new Image().src = cardImageSrc({ rank, suit });
    }
  }
  new Image().src = `${import.meta.env.BASE_URL}cards/back.svg`;
}

function cardKey(card: Card): string {
  return `${card.rank}-${card.suit}`;
}

// At showdown, the specific 5 cards making up the winning high hand (opponent's if they won
// outright, otherwise the player's - including on a tie, per the simplification of only ever
// highlighting one side). Null whenever there's nothing to highlight (mid-hand, or a fold).
function highlightedCardKeys(): Set<string> | null {
  if (handOutcome?.type !== "showdown") return null;
  const { high } = handOutcome;
  const winningCards = high.winner === "opponent" ? high.opponentCards : high.playerCards;
  return new Set(winningCards.map(cardKey));
}

function renderCard(card: Card, className = "card", style = "", dim = false): string {
  const styleAttr = style ? ` style="${style}"` : "";
  const cls = dim ? `${className} dimmed` : className;
  return `<img class="${cls}" src="${cardImageSrc(card)}" alt="${card.rank} of ${card.suit}"${styleAttr}>`;
}

function renderCardBack(): string {
  return `<img class="card back" src="${import.meta.env.BASE_URL}cards/back.svg" alt="face-down card">`;
}

function renderBoardSlot(
  card: Card,
  index: number,
  discards: Card[],
  dim: (card: Card) => boolean,
  highlightActive: boolean,
): string {
  if (index >= revealedCount) {
    return `<div class="board-slot"><div class="card placeholder"></div></div>`;
  }
  // Discarded cards never contribute to the high hand, so once highlighting is active they're
  // always dimmed - but not before showdown, when dimming would just look like a stray bug.
  const discardImgs = discards
    .map((discard, i) =>
      renderCard(discard, "card discard", `top: ${(i + 1) * DISCARD_STACK_OFFSET_PX}px`, highlightActive),
    )
    .join("");
  return `<div class="board-slot">${renderCard(card, "card", "", dim(card))}${discardImgs}</div>`;
}

function winnerVerb(winner: Winner): string {
  return winner === "player" ? "You win" : "Opponent wins";
}

function formatMoney(amount: number): string {
  return `$${amount % 1 === 0 ? amount : amount.toFixed(2)}`;
}

// What sits in the middle of the table: the running pot while a hand is in progress, or the
// showdown/fold outcome once it's over.
function renderTableCenter(): string {
  if (handOutcome?.type === "showdown") {
    const { high, low } = handOutcome;
    const playerPoints = handPoints(hand);
    const opponentPoints = handPoints(opponentHand);

    const highLine =
      high.winner === "tie"
        ? `High ties (${high.playerHandName})`
        : `${winnerVerb(high.winner)} the high with ${high.winner === "player" ? high.playerHandName : high.opponentHandName}`;

    const lowLine =
      low === "tie"
        ? `Low ties at ${playerPoints} points`
        : `${winnerVerb(low)} the low with ${low === "player" ? playerPoints : opponentPoints} points`;

    return `<div class="center-line">${highLine}</div><div class="center-line">${lowLine}</div>`;
  }

  if (handOutcome?.type === "fold") {
    const line =
      handOutcome.folder === "player"
        ? `You fold — Opponent wins ${formatMoney(pot)}`
        : `Opponent folds — You win ${formatMoney(pot)}`;
    return `<div class="center-line">${line}</div>`;
  }

  return `<div class="pot-amount">${formatMoney(pot)}</div><div class="center-label">Pot</div>`;
}

function renderControls(): string {
  if (handOutcome) {
    return `<button data-action="next-hand"${resolving ? " disabled" : ""}>Next Hand</button>`;
  }
  if (resolving) {
    // While an action is resolving, the player's own contribution has already been applied (so
    // the Stack/Pot numbers can update immediately), which makes a live-recomputed Call/Raise
    // amount read as stale (e.g. "Call ($0)") relative to the decision that was just made. Show
    // plain disabled labels instead until the round's state has fully settled for next time.
    return facingBet
      ? `<button disabled>Call</button><button disabled>Raise</button><button disabled>Fold</button>`
      : `<button disabled>Check</button><button disabled>Bet</button>`;
  }
  if (facingBet) {
    const owed = amountOwed(playerContributedThisRound, opponentContributedThisRound);
    const raiseCost = contributionForResponse("raise", owed, revealedCount);
    return `
      <button data-action="call">Call (${formatMoney(owed)})</button>
      <button data-action="raise">Raise (${formatMoney(raiseCost)})</button>
      <button data-action="fold">Fold</button>
    `;
  }
  const stake = STAKES[revealedCount];
  return `
    <button data-action="check">Check</button>
    <button data-action="bet">Bet (${formatMoney(stake)})</button>
  `;
}

function render() {
  const handEl = document.querySelector<HTMLDivElement>("#hand")!;
  const opponentHandEl = document.querySelector<HTMLDivElement>("#opponent-hand")!;
  const boardAEl = document.querySelector<HTMLDivElement>("#board-a")!;
  const boardBEl = document.querySelector<HTMLDivElement>("#board-b")!;
  const tableCenterEl = document.querySelector<HTMLDivElement>("#table-center")!;
  const controlsEl = document.querySelector<HTMLDivElement>("#controls")!;
  const handTypeEl = document.querySelector<HTMLDivElement>("#hand-type")!;
  const pointTotalEl = document.querySelector<HTMLDivElement>("#point-total")!;
  const balanceEl = document.querySelector<HTMLDivElement>("#balance")!;
  const playerDealerBadgeEl = document.querySelector<HTMLSpanElement>("#player-dealer-badge")!;
  const opponentDealerBadgeEl = document.querySelector<HTMLSpanElement>("#opponent-dealer-badge")!;
  const bannerTextEl = document.querySelector<HTMLDivElement>("#banner-text")!;

  playerDealerBadgeEl.classList.toggle("hidden", buttonHolder !== "player");
  opponentDealerBadgeEl.classList.toggle("hidden", buttonHolder !== "opponent");

  const highlight = highlightedCardKeys();
  const highlightActive = highlight !== null;
  const isDimmed = (card: Card) => highlightActive && !highlight!.has(cardKey(card));

  handEl.innerHTML = hand.map((card) => renderCard(card, "card", "", isDimmed(card))).join("");
  opponentHandEl.innerHTML =
    handOutcome?.type === "showdown"
      ? opponentHand.map((card) => renderCard(card, "card", "", isDimmed(card))).join("")
      : opponentHand.map(() => renderCardBack()).join("");
  // boardA never feeds the high hand (it only ever triggers discards), so once highlighting is
  // active every card there is dimmed regardless of rank.
  boardAEl.innerHTML = deal.boardA
    .map((card, i) => renderBoardSlot(card, i, discardPiles[i], () => highlightActive, highlightActive))
    .join("");
  boardBEl.innerHTML = deal.boardB
    .map((card, i) => renderBoardSlot(card, i, [], isDimmed, highlightActive))
    .join("");

  tableCenterEl.innerHTML = renderTableCenter();
  controlsEl.innerHTML = renderControls();

  const revealedBottomCards = deal.boardB.slice(0, revealedCount);
  handTypeEl.textContent = classifyHand([...hand, ...revealedBottomCards]);
  pointTotalEl.textContent = String(handPoints(hand));
  balanceEl.textContent = formatMoney(playerBalance);

  bannerTextEl.textContent = bannerMessage ?? "";
  bannerTextEl.classList.toggle("visible", bannerMessage !== null);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shows a large transient banner (e.g. "Opponent calls") over the whole screen, then clears it.
// Used only for the opponent's actions - the player already sees their own click reflected.
async function showBanner(message: string) {
  bannerMessage = message;
  render();
  await delay(BANNER_TRANSITION_MS + BANNER_HOLD_MS);
  bannerMessage = null;
  render();
  await delay(BANNER_TRANSITION_MS);
}

interface OpponentTurnResult {
  message: string;
  folded: boolean;
}

// Resolves the opponent's single turn: responds to a live bet (call/raise/fold) if one is
// owed, otherwise makes their own opening decision (check/bet). Never called more than once
// per player click, since with two players every action is answered by exactly one response.
function resolveOpponentTurn(): OpponentTurnResult {
  const owed = amountOwed(opponentContributedThisRound, playerContributedThisRound);
  actionsThisRound++;
  if (owed > 0) {
    const decision = strategy.decideFacingBet();
    if (decision === "fold") {
      handOutcome = { type: "fold", folder: "opponent" };
      playerBalance += settleFold(pot, "opponent").playerShare;
      return { message: "Opponent folds", folded: true };
    }
    const contribution = contributionForResponse(decision, owed, revealedCount);
    opponentContributedThisRound += contribution;
    pot += contribution;
    return { message: decision === "call" ? "Opponent calls" : "Opponent raises", folded: false };
  }
  const decision = strategy.decideOpening();
  if (decision === "bet") {
    const contribution = contributionForOpening("bet", revealedCount);
    opponentContributedThisRound += contribution;
    pot += contribution;
    return { message: `Opponent bets ${formatMoney(contribution)}`, folded: false };
  }
  return { message: "Opponent checks", folded: false };
}

// Resets a round's betting state and, if the opponent holds priority this hand, immediately
// resolves and announces their opening move (check or bet) before the player's turn.
async function startRound() {
  playerContributedThisRound = 0;
  opponentContributedThisRound = 0;
  actionsThisRound = 0;
  facingBet = false;
  if (opponentFirst) {
    // Give the just-dealt/discarded cards a beat on screen before announcing what the opponent
    // does with them - otherwise the two land in the same paint and read as simultaneous.
    await delay(REVEAL_PAUSE_MS);
    const { message } = resolveOpponentTurn();
    facingBet = opponentContributedThisRound > playerContributedThisRound;
    render();
    await showBanner(message);
  }
}

async function advanceRoundOrShowdown() {
  if (revealedCount < BOARD_SIZE) {
    const slotIndex = revealedCount;
    const revealedTopCard = deal.boardA[slotIndex];
    const playerPartition = partitionByRank(hand, revealedTopCard.rank);
    const opponentPartition = partitionByRank(opponentHand, revealedTopCard.rank);
    hand = playerPartition.remaining;
    opponentHand = opponentPartition.remaining;
    discardPiles[slotIndex] = [...playerPartition.matching, ...opponentPartition.matching];
    revealedCount++;
    render(); // show the newly revealed cards before any "opening" banner for the next round
    await startRound();
  } else {
    const revealedBottomCards = deal.boardB;
    const high = determineHighWinner([...hand, ...revealedBottomCards], [...opponentHand, ...revealedBottomCards]);
    const low = determineLowWinner(handPoints(hand), handPoints(opponentHand));
    handOutcome = { type: "showdown", high, low };
    playerBalance += settleShowdown(pot, high.winner, low).playerShare;
  }
}

// Called after the player's own action settles their side of this exchange: closes the round
// immediately if the player's action already matched the opponent, otherwise announces the
// opponent's response and re-checks — closing, ending the hand (a fold), or handing it back to
// the player if the opponent raised.
async function continueRound() {
  if (isRoundClosed(actionsThisRound, playerContributedThisRound, opponentContributedThisRound)) {
    await advanceRoundOrShowdown();
    render();
    return;
  }
  const { message, folded } = resolveOpponentTurn();
  render();
  await showBanner(message);
  if (folded) {
    render();
    return;
  }
  if (isRoundClosed(actionsThisRound, playerContributedThisRound, opponentContributedThisRound)) {
    await advanceRoundOrShowdown();
  } else {
    facingBet = true;
  }
  render();
}

async function resolveOpening(action: OpeningAction) {
  if (resolving) return;
  resolving = true;
  const contribution = contributionForOpening(action, revealedCount);
  playerBalance -= contribution;
  pot += contribution;
  playerContributedThisRound += contribution;
  actionsThisRound++;
  render();
  await continueRound();
  resolving = false;
  render();
}

async function resolveFacingBet(action: FacingBetAction) {
  if (resolving) return;
  resolving = true;
  if (action === "fold") {
    handOutcome = { type: "fold", folder: "player" };
    playerBalance += settleFold(pot, "player").playerShare; // always 0, kept for symmetry/clarity
    resolving = false;
    render();
    return;
  }
  const owed = amountOwed(playerContributedThisRound, opponentContributedThisRound);
  const contribution = contributionForResponse(action, owed, revealedCount);
  playerBalance -= contribution;
  pot += contribution;
  playerContributedThisRound += contribution;
  actionsThisRound++;
  render();
  await continueRound();
  resolving = false;
  render();
}

// Deals a fresh hand under the current dealer button assignment: applies the ante, announces
// it, then starts round 0 (which announces the opponent's opening move if they act first).
async function startHand() {
  opponentFirst = opponentActsFirst(buttonHolder);
  deal = dealScarney(nextDeck());
  revealedCount = 0;
  hand = deal.hand;
  opponentHand = deal.opponentHand;
  discardPiles = Array.from({ length: BOARD_SIZE }, () => []);
  handOutcome = null;
  facingBet = false;

  pot = ANTE * 2;
  playerBalance -= ANTE;
  render();
  await showBanner("Both players ante $1");
  await startRound();
}

async function beginHand() {
  resolving = true;
  await startHand();
  resolving = false;
  render();
}

async function dealNewHand() {
  if (resolving) return;
  buttonHolder = buttonHolder === "player" ? "opponent" : "player";
  await beginHand();
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
        <div class="stat-label">Stack</div>
        <div class="stat-value" id="balance"></div>
      </div>
    </div>

    <div class="hand-wrap">
      <span id="player-dealer-badge" class="dealer-badge hidden">D</span>
      <div id="hand" class="hand"></div>
    </div>

    <div class="boards">
      <div id="board-a" class="board-row"></div>
      <div id="table-center" class="table-center"></div>
      <div id="board-b" class="board-row"></div>
    </div>

    <div class="hand-wrap">
      <span id="opponent-dealer-badge" class="dealer-badge hidden">D</span>
      <div id="opponent-hand" class="hand opponent-hand"></div>
    </div>

    <div id="controls" class="controls"></div>
  </div>

  <div id="action-banner" class="action-banner"><div id="banner-text" class="banner-text"></div></div>
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

preloadCardImages();
beginHand();
