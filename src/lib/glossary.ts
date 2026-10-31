/**
 * Plain-language meanings for the words the app and its emails use. The numbers match the tested plan (12% stop, 35% market check,
 * 2% of the account at risk, about 45% of trades winning, worst drop about 21%): change them here when a rule changes.
 */
export type TermKey =
  | "r" | "stop" | "exit50" | "marketCheck" | "rs" | "breakout" | "blueSky" | "multiYear"
  | "positionSize" | "winRate" | "drawdown" | "backtest" | "vsNifty" | "paper" | "target";

export interface GlossaryTerm {
  name: string;
  /** One or two plain sentences. */
  text: string;
}

export const GLOSSARY: Record<TermKey, GlossaryTerm> = {
  r: {
    name: "R",
    text: "R is the money you risk on one trade. Buy at ₹100 with a stop at ₹88 and you risk ₹12 a share: that is 1R. Selling at ₹124 is +2R; selling at the stop is −1R. It lets trades of different sizes be compared.",
  },
  stop: {
    name: "Stop",
    text: "The price where you sell to limit a loss: 12% under your buy price in the main plan. If the stock trades down to it, the rules say you are out. Also set it with your broker, because the app never places orders.",
  },
  exit50: {
    name: "50-day exit",
    text: "The 50-day average is the average closing price of the last 50 sessions. The rules sell when a stock closes under it (at the next open). That lets winners run and cuts weak stocks, instead of selling at a fixed target.",
  },
  marketCheck: {
    name: "Market check",
    text: "The share of liquid stocks trading above their own 50-day average. The plan buys only while it is 35% or higher. Under that most stocks are falling and breakouts fail more often, so the plan stays out.",
  },
  rs: {
    name: "RS (relative strength)",
    text: "A score from 1 to 99 for how much a stock has gained over the past year compared with other stocks. RS 90 means it beat about 90% of them. The plan picks the strongest first.",
  },
  breakout: {
    name: "Breakout",
    text: "A stock closing above the highest price it has reached for a long time. The idea is that nobody is left holding it at a loss above that level, waiting to sell, so it can keep rising.",
  },
  blueSky: {
    name: "Blue sky",
    text: "A stock at or near its highest price in years. There are no old, higher prices above it where holders are waiting to get out.",
  },
  multiYear: {
    name: "Multi-year breakout",
    text: "A stock breaking out of a price range that took one to six years to build, while still above its 200-day average.",
  },
  positionSize: {
    name: "Position size",
    text: "How many shares to buy. The plan buys fewer shares when the stop is further away, so a stopped-out trade costs about 2% of your account, and no single stock is more than 20% of it.",
  },
  winRate: {
    name: "Win rate",
    text: "The share of finished trades that made money. This plan wins about 45% of the time: it loses more often than it wins, and makes money because the winners are bigger than the losers.",
  },
  drawdown: {
    name: "Worst drop",
    text: "The biggest fall of the account from a high point to a later low. In the 10-year test it was about 21%. Expect to sit through falls like that.",
  },
  backtest: {
    name: "Backtest",
    text: "Replaying the rules on past prices to see what would have happened. Real results are likely lower: the history only includes stocks listed today, and real buys are filled at worse prices than the test assumes.",
  },
  vsNifty: {
    name: "Versus the Nifty",
    text: "The stock's move minus the Nifty 50's move over the same days. Above zero means it beat the market.",
  },
  paper: {
    name: "Paper trade",
    text: "A pretend trade tracked with no money. The live strategy check follows the rules this way, so we can see how they do in real time before trusting them.",
  },
  target: {
    name: "Target",
    text: "A price where you may book part of your profit (about +16% and +24% above the buy price). The rules do not sell everything there: the real exit is the stop or the 50-day line.",
  },
};
