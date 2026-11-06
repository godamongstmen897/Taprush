# TapRush: a reaction duel on Celo, played with G$

Five taps, one score in milliseconds. Each round costs a small G$ entry fee. The weekly top 10 lives on-chain, and the three fastest players split that week's G$ prize pool (50 / 30 / 20).

```
contracts/   Solidity (TapRush.sol), Hardhat tests, deploy script
web/         Next.js app: wallet connect, game pad, leaderboard, score-signing API
```

## How the G$ integration works

| Step | What happens | Where |
| --- | --- | --- |
| Entry | Player approves and pays the fee in **G$** (`startRound`) | contract |
| Pool | 95% of every fee goes into that week's prize pool, 5% to the treasury | contract |
| Sponsors | Anyone can add G$ to the pool (`seedPot`), so GoodBuilders funding can boost prizes | contract |
| Payout | After the week ends anyone calls `finalizeWeek`, winners call `claimPrize` | contract |
| Roll-over | Unclaimed share (fewer than 3 players) rolls into the next week's pool | contract |

G$ is spent *inside* the game and paid back out as prizes. It is not just an accepted payment method.

## How scores stay honest

1. The contract only accepts a score that carries a signature from the `verifier` key.
2. The web server signs only after checking: the round was paid on-chain by that wallet and is unscored, reactions are human (100 ms to 2 s), and the round took at least as long as the random waits plus the reactions on the server's own clock.
3. Each round can be scored once. Scores are written to the week the round was paid in.

**Honest limit:** this stops edited and replayed results. It does not stop a well-made bot that taps at plausible human speeds. Treat the leaderboard as casual competition, not a high-stakes one. Raise the fee or add checks before pools get large.

## Run the tests

```bash
cd contracts
npm install
npx hardhat test        # 10 tests: fees, signatures, leaderboard order, prizes, roll-over, admin
```

## Deploy

### 1. Make two fresh wallets (never reuse your main wallet)
- **Deployer**: pays gas, becomes contract owner.
- **Verifier**: its private key goes only on the web server; only its *address* goes to the contract.

### 2. Testnet first (Celo Sepolia, chain id 11142220)
Get free test CELO from https://faucet.celo.org/celo-sepolia, then:

```bash
cd contracts
cp .env.example .env     # fill DEPLOYER_PRIVATE_KEY and VERIFIER_ADDRESS
npx hardhat run scripts/deploy.js --network celoSepolia
```
This deploys a mock G$ (testnet only) and the game, and saves addresses to `contracts/deployments/celoSepolia.json`.

### 3. Mainnet (Celo, chain id 42220)
Put a little real CELO (about $1) in the deployer wallet, then:

```bash
npx hardhat run scripts/deploy.js --network celo
```
This uses the real G$ token `0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A` and never deploys the mock.

Verify the source on Celoscan (set `CELOSCAN_API_KEY` in `.env`):
```bash
npx hardhat verify --network celo <GAME_ADDRESS> <G$_ADDRESS> <VERIFIER_ADDRESS> 100000000000000000000 500 <DEPLOYER_ADDRESS>
```

### 4. Host the web app (Vercel)
Import the `web/` folder, then set these environment variables:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_CHAIN` | `celo` or `celoSepolia` |
| `NEXT_PUBLIC_GAME_ADDRESS` | deployed TapRush address |
| `NEXT_PUBLIC_GD_ADDRESS` | G$ address (mock on testnet) |
| `VERIFIER_PRIVATE_KEY` | verifier wallet key (server only, never `NEXT_PUBLIC_`) |
| `SESSION_SECRET` | long random string |
| `NEXT_PUBLIC_RPC_URL` | optional dedicated RPC |

Redeploy after changing any `NEXT_PUBLIC_` value, since those are baked in at build time.

## Rehearsed locally
A local chain with the real API routes: payment, session, timing checks, signing, on-chain score, leaderboard, plus rejected cheats (wrong wallet, instant finish, superhuman times, forged token, tampered score, replay). All passed. **Not yet tested:** a live run on Celo Sepolia or mainnet, and the real G$ token (the tests use a standard ERC-20 stand-in).
