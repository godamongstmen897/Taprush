# GoodBuilders Season 5: application draft (edit before sending)

Fill the bracketed items after deploying. Numbers are proposals: set targets you believe you can hit, because you will report against them every two weeks.

## Product
**TapRush** is a reaction-speed game on Celo. Players pay a small G$ entry fee, tap five times as fast as they can, and compete on a weekly on-chain leaderboard. The three fastest players each week split the G$ prize pool.

- Live app: [Vercel URL]
- Game contract (Celo mainnet): [0x… address] ([Celoscan link])
- G$ token used: 0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A
- Source code: [GitHub link]

## G$ integration (more than accepting it as payment)
- G$ is the entry ticket for every round and the only way the prize pool is funded.
- 95% of each fee goes into a weekly prize pool held by the contract; winners claim G$ directly from it.
- Anyone, including GoodBuilders sponsors, can add G$ to the pool through `seedPot`, so streamed funding can be recycled into player prizes.
- Unclaimed prize shares roll over, so the pool grows when participation is low.
- G$ stays in circulation: it goes in as fees and comes back out as prizes.

## Why people come back (beyond rewards)
- The leaderboard resets every week, so everyone gets a fresh chance to place.
- Rounds take under a minute and improvement is visible: beat your own best average.
- Rank is public and verifiable on-chain, so a score is something to share and challenge friends with.

## Goals (numbers)
| Metric | By end of week 2 | By end of the 3-month season |
| --- | --- | --- |
| Unique players (on-chain `uniquePlayers`) | [100] | [1,000] |
| Rounds played (`totalRounds`) | [800] | [15,000] |
| G$ spent inside the game (`totalGdSpent`) | [80,000] | [1,500,000] |
| Weekly returning players | [30%] | [40%] |

All four are readable straight from the contract, so they can be verified without trusting any dashboard.

## Verifiable on-chain data
- Contract: [address]
- Read functions: `uniquePlayers`, `totalRounds`, `totalGdSpent`, `totalGdPaidOut`, `getTop(week)`, `pot(week)`

## Commitments
- Two-week targets, weekly 1:1s, Demo Days, and progress updates on Flow State.

## Known limits (be upfront with reviewers)
- Scores are validated by a server and signed, which blocks edited results but not well-built bots. Plan for week 2-4: tighter anti-bot checks and a small per-wallet daily cap if abuse appears.
