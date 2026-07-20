export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
export const RANKS: Rank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealHand(deck: Card[], count: number): Card[] {
  return deck.slice(0, count);
}

export interface ScarneyDeal {
  hand: Card[];
  boardA: Card[];
  boardB: Card[];
  opponentHand: Card[];
}

export function dealScarney(deck: Card[]): ScarneyDeal {
  return {
    hand: deck.slice(0, 5),
    boardA: deck.slice(5, 10),
    boardB: deck.slice(10, 15),
    opponentHand: deck.slice(15, 20),
  };
}

export interface RankPartition {
  matching: Card[];
  remaining: Card[];
}

export function partitionByRank(cards: Card[], rank: Rank): RankPartition {
  return {
    matching: cards.filter((card) => card.rank === rank),
    remaining: cards.filter((card) => card.rank !== rank),
  };
}

const SUIT_CODES: Record<string, Suit> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
};

export function cardToCode(card: Card): string {
  return `${card.rank}${card.suit[0].toUpperCase()}`;
}

export function parseCard(code: string): Card | null {
  const trimmed = code.trim().toUpperCase();
  const suit = SUIT_CODES[trimmed.slice(-1)];
  const rankPart = trimmed.slice(0, -1) as Rank;
  if (!suit || !RANKS.includes(rankPart)) {
    return null;
  }
  return { rank: rankPart, suit };
}

/** Parses a comma-separated list of card codes (e.g. "KS,KH,10D"). Returns null if any code is invalid or duplicated. */
export function parseDeck(param: string): Card[] | null {
  const codes = param
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  const cards: Card[] = [];
  const seen = new Set<string>();

  for (const code of codes) {
    const card = parseCard(code);
    if (!card) return null;
    const key = cardToCode(card);
    if (seen.has(key)) return null;
    seen.add(key);
    cards.push(card);
  }

  return cards;
}
