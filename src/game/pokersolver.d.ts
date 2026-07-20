declare module "pokersolver" {
  export interface PokerCard {
    value: string;
    suit: string;
  }

  export class Hand {
    static solve(cards: string[], game?: string, canDisqualify?: boolean): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    descr: string;
    rank: number;
    cards: PokerCard[];
  }
}
