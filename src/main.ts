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
import { createSmartOpponentStrategy, type DecisionContext } from "./game/opponent";

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
const DISCARD_FLY_MS = FAST ? 5 : 380;
const DISCARD_FLIP_MS = FAST ? 5 : 260;
const CHIP_FLY_MS = FAST ? 5 : 380;
const BALANCE_FLASH_MS = FAST ? 5 : 1000;

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

// Assembles what the smart opponent strategy needs to know right now, from the live game state -
// called fresh at each decision point since the underlying equity changes every reveal/discard.
function buildDecisionContext(): DecisionContext {
  return {
    opponentHand,
    knownCards: [...deal.opponentHand, ...deal.boardA.slice(0, revealedCount), ...discardPiles.flat()],
    playerHandCount: hand.length,
    revealedBoardB: deal.boardB.slice(0, revealedCount),
    remainingReveals: BOARD_SIZE - revealedCount,
    round: revealedCount,
    pot,
    owed: amountOwed(opponentContributedThisRound, playerContributedThisRound),
    raisesThisRound,
  };
}

// Debug hook: ?opponent=... forces a deterministic placeholder opponent instead of the smart
// one, so specific betting scenarios (fold, raise) can be reproduced for manual/automated testing.
function nextStrategy(): OpponentStrategy {
  const param = new URLSearchParams(window.location.search).get("opponent");
  if (param === "calling-station") return callingStationStrategy;
  if (param === "aggressor") return { decideOpening: () => "bet", decideFacingBet: () => "raise" };
  if (param === "folder") return { decideOpening: () => "check", decideFacingBet: () => "fold" };
  if (param === "random") return randomOpponentStrategy;
  return createSmartOpponentStrategy(buildDecisionContext);
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
let frozenControlsHtml: string | null = null;
let bannerMessage: string | null = null;

// Per-round betting state.
let playerContributedThisRound: number;
let opponentContributedThisRound: number;
let actionsThisRound: number;
let raisesThisRound: number;
let facingBet = false;

function cardImageSrc(card: Card): string {
  return `${import.meta.env.BASE_URL}cards/${RANK_FILE_NAMES[card.rank]}_of_${card.suit}.svg`;
}

function cardBackSrc(): string {
  return `${import.meta.env.BASE_URL}cards/back.svg`;
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
  return `<img class="${cls}" data-card="${cardKey(card)}" src="${cardImageSrc(card)}" alt="${card.rank} of ${card.suit}"${styleAttr}>`;
}

// Still just shows the generic back image regardless of which card it is - the data-card
// attribute exists purely so a discard animation can find this exact card's element later.
function renderCardBack(card: Card): string {
  return `<img class="card back" data-card="${cardKey(card)}" src="${cardBackSrc()}" alt="face-down card">`;
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

// Shows a transient "+$5"/"-$3" above the Stack number for a notable balance change (ante,
// showdown/fold settlement) - fire-and-forget, not awaited by callers since it's pure decoration
// layered on top of a change that's already been applied and rendered.
function flashBalanceDelta(delta: number) {
  if (delta === 0) return;
  // Appended to the .stat container, not #balance directly - render() reassigns #balance's
  // textContent wholesale, which would silently wipe out a child appended straight to it.
  const stackStat = document.querySelector<HTMLDivElement>("#balance")!.closest(".stat")!;
  const flash = document.createElement("div");
  flash.className = `balance-flash ${delta > 0 ? "positive" : "negative"}`;
  flash.textContent = `${delta > 0 ? "+" : "-"}${formatMoney(Math.abs(delta))}`;
  stackStat.appendChild(flash);

  flash
    .animate(
      [
        { opacity: 0, transform: "translate(-50%, -50%) scale(0.85)" },
        { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.2 },
        { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.75 },
        { opacity: 0, transform: "translate(-50%, -50%) scale(0.9)" },
      ],
      { duration: BALANCE_FLASH_MS, easing: "ease-out" },
    )
    .finished.then(() => flash.remove());
}

// What sits in the middle of the table: the running pot while a hand is in progress, or the
// showdown/fold outcome once it's over.
// Caps how big the chip visualization grows - past this, the pot keeps counting up normally,
// the chip art just stops piling on more.
const MAX_VISUAL_POT = 100;
const CHIPS_PER_TOWER = 5;
const CHIP_STACK_OFFSET_PX = 5;

function renderChipTowers(count: number, colorClass: string): string {
  const towers: string[] = [];
  for (let remaining = count; remaining > 0; remaining -= CHIPS_PER_TOWER) {
    const size = Math.min(remaining, CHIPS_PER_TOWER);
    const chips = Array.from(
      { length: size },
      (_, i) => `<div class="chip ${colorClass}" style="bottom: ${i * CHIP_STACK_OFFSET_PX}px"></div>`,
    ).join("");
    towers.push(`<div class="chip-tower">${chips}</div>`);
  }
  return towers.join("");
}

// $1 chips are white, $5 chips are red - (amount mod 5) whites and (amount div 5) reds.
function renderChipStack(amount: number): string {
  const visual = Math.min(Math.floor(amount), MAX_VISUAL_POT);
  const reds = Math.floor(visual / 5);
  const whites = visual % 5;
  if (reds === 0 && whites === 0) return "";
  return `${renderChipTowers(reds, "red")}${renderChipTowers(whites, "white")}`;
}

// The pot display (text + chip stack) only reflects rounds that have already closed - the
// current round's live bets sit visually in front of each hand (their own chip stacks) until
// the round settles and slides them in, at which point this catches up to include them.
function displayedPot(): number {
  return pot - playerContributedThisRound - opponentContributedThisRound;
}

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

    return `<div class="pot-plaque"><div class="center-line">${highLine}</div><div class="center-line">${lowLine}</div></div>`;
  }

  if (handOutcome?.type === "fold") {
    const line =
      handOutcome.folder === "player"
        ? `You fold — Opponent wins ${formatMoney(pot)}`
        : `Opponent folds — You win ${formatMoney(pot)}`;
    return `<div class="pot-plaque"><div class="center-line">${line}</div></div>`;
  }

  return `<div class="pot-amount-plain">${formatMoney(displayedPot())}</div>`;
}

// Renders the live Check/Bet or Call/Raise/Fold set from current state (amounts included).
function renderActionButtons(disabled: boolean): string {
  const disabledAttr = disabled ? " disabled" : "";
  if (facingBet) {
    const owed = amountOwed(playerContributedThisRound, opponentContributedThisRound);
    const raiseCost = contributionForResponse("raise", owed, revealedCount);
    return `
      <button data-action="call"${disabledAttr}>Call (${formatMoney(owed)})</button>
      <button data-action="raise"${disabledAttr}>Raise (${formatMoney(raiseCost)})</button>
      <button data-action="fold"${disabledAttr}>Fold</button>
    `;
  }
  const stake = STAKES[revealedCount];
  return `
    <button data-action="check"${disabledAttr}>Check</button>
    <button data-action="bet"${disabledAttr}>Bet (${formatMoney(stake)})</button>
  `;
}

function renderControls(): string {
  if (handOutcome) {
    return `<button data-action="next-hand"${resolving ? " disabled" : ""}>Next Hand</button>`;
  }
  if (resolving) {
    // The player's own contribution is applied (so Stack/Pot can update immediately) before the
    // round's state fully settles, which would make a live-recomputed Call/Raise amount flash as
    // stale (e.g. "Call ($0)"). Show whatever the buttons said right before the click instead of
    // recomputing, so the label stays put instead of visibly changing while disabled.
    return frozenControlsHtml ?? renderActionButtons(true);
  }
  return renderActionButtons(false);
}

function render() {
  const handEl = document.querySelector<HTMLDivElement>("#hand")!;
  const opponentHandEl = document.querySelector<HTMLDivElement>("#opponent-hand")!;
  const boardAEl = document.querySelector<HTMLDivElement>("#board-a")!;
  const boardBEl = document.querySelector<HTMLDivElement>("#board-b")!;
  const tableCenterEl = document.querySelector<HTMLDivElement>("#table-center")!;
  const chipStackEl = document.querySelector<HTMLDivElement>("#chip-stack")!;
  const playerBetStackEl = document.querySelector<HTMLDivElement>("#player-bet-stack")!;
  const opponentBetStackEl = document.querySelector<HTMLDivElement>("#opponent-bet-stack")!;
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
      : opponentHand.map((card) => renderCardBack(card)).join("");
  // boardA never feeds the high hand (it only ever triggers discards), so once highlighting is
  // active every card there is dimmed regardless of rank.
  boardAEl.innerHTML = deal.boardA
    .map((card, i) => renderBoardSlot(card, i, discardPiles[i], () => highlightActive, highlightActive))
    .join("");
  boardBEl.innerHTML = deal.boardB
    .map((card, i) => renderBoardSlot(card, i, [], isDimmed, highlightActive))
    .join("");

  tableCenterEl.innerHTML = renderTableCenter();
  chipStackEl.innerHTML = handOutcome ? "" : renderChipStack(displayedPot());
  playerBetStackEl.innerHTML = handOutcome ? "" : renderChipStack(playerContributedThisRound);
  opponentBetStackEl.innerHTML = handOutcome ? "" : renderChipStack(opponentContributedThisRound);
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
      // Settling (handOutcome + balance) is deferred to the caller, which flies the pot to the
      // winner before applying it - see settlePotToWinners.
      return { message: "Opponent folds", folded: true };
    }
    const contribution = contributionForResponse(decision, owed, revealedCount);
    opponentContributedThisRound += contribution;
    pot += contribution;
    if (decision === "raise") raisesThisRound++;
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
  raisesThisRound = 0;
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

interface PendingDiscard {
  key: string;
  fromRect: DOMRect;
  isOpponent: boolean;
}

// Captures where a card about to be discarded currently sits on screen, before the DOM changes -
// call this before mutating hand/opponentHand and re-rendering.
function capturePendingDiscard(card: Card, containerSelector: string, isOpponent: boolean): PendingDiscard | null {
  const el = document.querySelector<HTMLImageElement>(`${containerSelector} img[data-card="${cardKey(card)}"]`);
  if (!el) return null;
  return { key: cardKey(card), fromRect: el.getBoundingClientRect(), isOpponent };
}

// Flies each discarded card from where it used to sit (in the hand) to where it now sits (in
// the discard pile), using the FLIP technique: the render() that already happened put the card
// in its final position, so this just fakes the starting offset and animates it away. Opponent
// cards fly over still showing the card back (matching how they looked a moment ago), then flip
// to reveal the real face once they land.
async function animateDiscards(pending: PendingDiscard[]) {
  const flights = pending
    .map(({ key, fromRect, isOpponent }) => {
      const el = document.querySelector<HTMLImageElement>(`#board-a img[data-card="${key}"]`);
      if (!el) return null;
      const toRect = el.getBoundingClientRect();
      return { el, dx: fromRect.left - toRect.left, dy: fromRect.top - toRect.top, isOpponent };
    })
    .filter((f): f is { el: HTMLImageElement; dx: number; dy: number; isOpponent: boolean } => f !== null);

  if (flights.length === 0) return;

  const trueFaces = new Map<HTMLImageElement, { src: string; alt: string }>();
  for (const { el, isOpponent } of flights) {
    if (isOpponent) {
      trueFaces.set(el, { src: el.src, alt: el.alt });
      el.src = cardBackSrc();
      el.alt = "face-down card";
    }
  }

  await Promise.all(
    flights.map(
      ({ el, dx, dy }) =>
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
          duration: DISCARD_FLY_MS,
          easing: "ease-in",
        }).finished,
    ),
  );

  const opponentFlights = flights.filter((f) => f.isOpponent);
  if (opponentFlights.length === 0) return;

  await Promise.all(
    opponentFlights.map(({ el }) => {
      const animation = el.animate(
        [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
        { duration: DISCARD_FLIP_MS, easing: "ease-in-out" },
      );
      setTimeout(() => {
        const face = trueFaces.get(el);
        if (face) {
          el.src = face.src;
          el.alt = face.alt;
        }
      }, DISCARD_FLIP_MS / 2);
      return animation.finished;
    }),
  );
}

// Flies each side's live bet-stack (whatever's in front of their hand this round) into the pot
// as a single clone-and-remove ghost per stack (chips are interchangeable, so unlike discarded
// cards there's no need to track individual chip identity - the whole stack just moves as one).
// pot itself already includes this round's contributions (updated as each action happens), so
// there's nothing to settle numerically here - only the bet stacks (in front of each hand) and
// the live pot display (which subtracts them back out) need to visually catch up.
async function settleBetsIntoPot() {
  const sources = [
    { el: document.querySelector<HTMLDivElement>("#player-bet-stack")!, amount: playerContributedThisRound },
    { el: document.querySelector<HTMLDivElement>("#opponent-bet-stack")!, amount: opponentContributedThisRound },
  ].filter(({ amount }) => amount > 0);

  if (sources.length === 0) return;

  // Snapshot the current (pre-settle) bet-stacks as detached ghost clones before anything moves.
  const ghosts = sources.map(({ el }) => {
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true) as HTMLDivElement;
    ghost.removeAttribute("id");
    ghost.style.position = "fixed";
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.margin = "0";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "15";
    document.body.appendChild(ghost);
    return { ghost, rect };
  });

  // Settle immediately (same pattern as the discard flip: mutate + render first, then animate a
  // visual ghost over the top) - the real bet-stacks empty out and the pot jumps to its new total
  // in one shot, with the ghosts providing the illusion of the chips still being in flight.
  playerContributedThisRound = 0;
  opponentContributedThisRound = 0;
  render();

  const potChipStackEl = document.querySelector<HTMLDivElement>("#chip-stack")!;
  const potRect = potChipStackEl.getBoundingClientRect();

  await Promise.all(
    ghosts.map(({ ghost, rect }) => {
      const dx = potRect.left - rect.left;
      const dy = potRect.top - rect.top;
      return ghost.animate([{ transform: "translate(0, 0)" }, { transform: `translate(${dx}px, ${dy}px)` }], {
        duration: CHIP_FLY_MS,
        easing: "ease-in",
      }).finished;
    }),
  );

  ghosts.forEach(({ ghost }) => ghost.remove());
}

// Flies the settled pot out to whichever side(s) won it - the reverse direction of
// settleBetsIntoPot, and for the same reason (chips are interchangeable, only the total matters).
// Here a split pot needs one *rendered* ghost per non-zero share rather than two clones of one
// element, since the two shares are usually different amounts, not the same stack moving as a
// unit. `applyOutcome` sets handOutcome (+ balance) - called here, right before the settling
// render, so the real pot chip-stack can be measured while it's still populated, before it's
// cleared in favor of the outcome plaque.
async function settlePotToWinners(playerShare: number, opponentShare: number, applyOutcome: () => void) {
  const potChipStackEl = document.querySelector<HTMLDivElement>("#chip-stack")!;
  const potRect = potChipStackEl.getBoundingClientRect();

  applyOutcome();
  render();

  const destinations = [
    { el: document.querySelector<HTMLDivElement>("#player-bet-stack")!, amount: playerShare },
    { el: document.querySelector<HTMLDivElement>("#opponent-bet-stack")!, amount: opponentShare },
  ].filter(({ amount }) => amount > 0);

  if (destinations.length === 0) return;

  const ghosts = destinations.map(({ el, amount }) => {
    const rect = el.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "bet-stack";
    ghost.innerHTML = renderChipStack(amount);
    ghost.style.position = "fixed";
    ghost.style.left = `${potRect.left}px`;
    ghost.style.top = `${potRect.top}px`;
    ghost.style.margin = "0";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "15";
    document.body.appendChild(ghost);
    return { ghost, rect };
  });

  await Promise.all(
    ghosts.map(({ ghost, rect }) => {
      const dx = rect.left - potRect.left;
      const dy = rect.top - potRect.top;
      return ghost.animate([{ transform: "translate(0, 0)" }, { transform: `translate(${dx}px, ${dy}px)` }], {
        duration: CHIP_FLY_MS,
        easing: "ease-in",
      }).finished;
    }),
  );

  ghosts.forEach(({ ghost }) => ghost.remove());
}

async function advanceRoundOrShowdown() {
  if (revealedCount < BOARD_SIZE) {
    const slotIndex = revealedCount;
    const revealedTopCard = deal.boardA[slotIndex];
    const playerPartition = partitionByRank(hand, revealedTopCard.rank);
    const opponentPartition = partitionByRank(opponentHand, revealedTopCard.rank);

    const pendingDiscards = [
      ...playerPartition.matching.map((card) => capturePendingDiscard(card, "#hand", false)),
      ...opponentPartition.matching.map((card) => capturePendingDiscard(card, "#opponent-hand", true)),
    ].filter((p): p is PendingDiscard => p !== null);

    hand = playerPartition.remaining;
    opponentHand = opponentPartition.remaining;
    discardPiles[slotIndex] = [...playerPartition.matching, ...opponentPartition.matching];
    revealedCount++;
    render(); // show the newly revealed cards before any "opening" banner for the next round
    await animateDiscards(pendingDiscards);
    await startRound();
  } else {
    const revealedBottomCards = deal.boardB;
    const high = determineHighWinner([...hand, ...revealedBottomCards], [...opponentHand, ...revealedBottomCards]);
    const low = determineLowWinner(handPoints(hand), handPoints(opponentHand));
    const { playerShare, opponentShare } = settleShowdown(pot, high.winner, low);
    await settlePotToWinners(playerShare, opponentShare, () => {
      handOutcome = { type: "showdown", high, low };
      playerBalance += playerShare;
      flashBalanceDelta(playerShare);
    });
  }
}

// Called after the player's own action settles their side of this exchange: closes the round
// immediately if the player's action already matched the opponent, otherwise announces the
// opponent's response and re-checks — closing, ending the hand (a fold), or handing it back to
// the player if the opponent raised.
async function continueRound() {
  if (isRoundClosed(actionsThisRound, playerContributedThisRound, opponentContributedThisRound)) {
    await settleBetsIntoPot();
    await advanceRoundOrShowdown();
    render();
    return;
  }
  const { message, folded } = resolveOpponentTurn();
  render();
  await showBanner(message);
  if (folded) {
    const { playerShare, opponentShare } = settleFold(pot, "opponent");
    await settlePotToWinners(playerShare, opponentShare, () => {
      handOutcome = { type: "fold", folder: "opponent" };
      playerBalance += playerShare;
      flashBalanceDelta(playerShare);
    });
    render();
    return;
  }
  if (isRoundClosed(actionsThisRound, playerContributedThisRound, opponentContributedThisRound)) {
    await settleBetsIntoPot();
    await advanceRoundOrShowdown();
  } else {
    facingBet = true;
  }
  render();
}

async function resolveOpening(action: OpeningAction) {
  if (resolving) return;
  frozenControlsHtml = renderActionButtons(true);
  resolving = true;
  const contribution = contributionForOpening(action, revealedCount);
  playerBalance -= contribution;
  pot += contribution;
  playerContributedThisRound += contribution;
  actionsThisRound++;
  render();
  await continueRound();
  resolving = false;
  frozenControlsHtml = null;
  render();
}

async function resolveFacingBet(action: FacingBetAction) {
  if (resolving) return;
  frozenControlsHtml = renderActionButtons(true);
  resolving = true;
  if (action === "fold") {
    const { playerShare, opponentShare } = settleFold(pot, "player"); // playerShare always 0
    await settlePotToWinners(playerShare, opponentShare, () => {
      handOutcome = { type: "fold", folder: "player" };
      playerBalance += playerShare; // always 0, kept for symmetry with the other settlement sites
      flashBalanceDelta(playerShare); // always a no-op here, same reason
    });
    resolving = false;
    frozenControlsHtml = null;
    render();
    return;
  }
  const owed = amountOwed(playerContributedThisRound, opponentContributedThisRound);
  const contribution = contributionForResponse(action, owed, revealedCount);
  playerBalance -= contribution;
  pot += contribution;
  playerContributedThisRound += contribution;
  actionsThisRound++;
  if (action === "raise") raisesThisRound++;
  render();
  await continueRound();
  resolving = false;
  frozenControlsHtml = null;
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
  // reset before the ante's own render(), not just inside startRound() - otherwise that render
  // would briefly show displayedPot() subtracting out stale contributions from the previous
  // hand's final round (startRound() doesn't reset these until after this ante banner plays)
  playerContributedThisRound = 0;
  opponentContributedThisRound = 0;

  pot = ANTE * 2;
  playerBalance -= ANTE;
  flashBalanceDelta(-ANTE);
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

    <div id="player-bet-stack" class="bet-stack"></div>

    <div class="boards">
      <div id="board-a" class="board-row"></div>
      <div id="chip-stack" class="chip-stack"></div>
      <div id="table-center" class="table-center"></div>
      <div id="board-b" class="board-row"></div>
    </div>

    <div id="opponent-bet-stack" class="bet-stack"></div>

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
