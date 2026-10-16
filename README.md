# Baonau

An AI portfolio agent for first-time investors, governed by an investment mandate the investor signs and a smart contract enforces.

Team Ulysses. 2026 Shenzhen International FinTech Competition, International Track, Topic F (Agent Wallet).

> Every asset in this project is a simulated test asset on a public testnet. Nothing here has real value or real backing.

## What it does

1. The investor describes a goal in their own words, in English or Bangla ("I have ৳5,000, I want long-term growth but not much risk").
2. The agent drafts a mandate: which assets, how much of each, how big a trade can be, how much can be lost in a day before buying stops, and how long any loosening of these rules has to wait.
3. The investor reads it in plain language, answers a short understanding check, writes a note to their future self and signs it on-chain.
4. The agent then manages the portfolio on its own: recurring buys, rebalancing, explaining what happened. Every action leaves a receipt that lists each rule it was checked against and links to the transaction.
5. Money that already has a job (rent, bills, tuition, money sent home) is set aside as a commitment. It leaves the portfolio, the agent can never trade it, and it can only be paid to a payee the investor approved, within that commitment's amount and schedule. The agent pays it on time; anything outside those terms comes back to the investor.

The mandate governs two failure modes:

- **A compromised AI.** The model can be wrong, injected or fully taken over. It holds only a session key that can trade inside the mandate and pay approved commitments on their terms. It cannot withdraw, pay anyone else, change a rule or sign for an exception.
- **An impulsive owner.** After a loss, the investor may want to tear down their own protections. Lowering risk applies immediately. Raising risk (a higher loss limit, a bigger cap, switching off the stop-loss, a new withdrawal address, a new payee, moving rent money back into investing) waits out a delay, and the investor's trusted contact can cancel it during the wait.

Risk can be reduced immediately; increasing risk takes time. The owner can always withdraw to their registered address at once: the mandate adds friction to risk escalation, never custody over the owner's funds.

## Architecture

```
investor ── chat / outside items ──▶ quarantined reader (no tools, typed fields only)
                                         │
                                         ▼
                                   agent (DeepSeek, tool calls only)
                                         │ proposes
                                         ▼
                                   risk engine (plain code: scam list, price checks, patterns, source of the instruction)
                                         │ allow / ask the owner / block
                                         ▼
                                   PolicyVault + Mandate (Solidity, enforces every limit on-chain)
                                         ▲
             owner (signs mandate, approves exceptions) · trusted contact (pause, veto) · keeper (prices, stop-loss)
```

| Layer | Where | What it guarantees |
|---|---|---|
| Quarantined reader | `app/lib/reader.ts` | News, token descriptions and messages from strangers are read by a model with no tools. The acting agent only sees typed, pattern-checked fields, never the text. |
| Agent | `app/lib/agent.ts`, `app/lib/tools.ts` | Acts only through validated tool calls. Any model error, timeout or unusable output means no action, logged as an abstention. |
| Risk engine | `app/lib/risk.ts` | Deterministic checks the contract cannot do (scam list, stale or abnormal prices, churn, chasing losses, trades prompted by outside text). It can only make things stricter. |
| Contract | `contracts/src/` | Enforces the mandate on every trade whatever the layers above decide. |
| People | app | The owner signs exceptions with an EIP-712 signature bound to one exact trade; the trusted contact can pause and veto. |

### Contracts

All Solidity, compiled with solc 0.8.11 (EVM `london`) and OpenZeppelin 4.9.6, so the same code can run on FISCO BCOS.

- `Mandate.sol`: every rule, every role, and the classification of each change as tightening (instant) or loosening (timelocked, vetoable). The table at the top of the file is the spec.
- `PolicyVault.sol`: holds the assets and checks the mandate on every `buy`, `sell`, `rebalance` and `tradeWithApproval`. Per-trade and daily volume caps, per-asset exposure caps, a defensive floor, a daily loss limit that starts protect mode, a loss-streak cooldown, slippage limits and a permissionless stop-loss. There is no borrow function, so leverage is impossible by construction.
- `VaultFactory.sol`: clones a mandate and vault pair (EIP-1167). An owner's later vaults only activate after the previous mandate's delay, so opening a new vault is not a way around a waiting period.
- `mocks/`: a clearly labelled mock price oracle (staleness check, maximum change per update), a mock exchange and mock assets.

## Evidence

Deployed on Base Sepolia (chain id 84532) on Oct 15, 2026. Every contract is verified on Sourcify. The vault and mandate are 45-byte EIP-1167 clones of the verified templates, so they have no source of their own to verify.

| Contract | Address |
|---|---|
| Vault | `0x213F465d03C3E008cE6f4562D92Ed90e3F6c0B21` |
| Mandate | `0x1C344fB4C23Aa939D8f917E2e6095Fced975B42a` |
| Factory | `0x45170Cf431e66A495C513FE9412512b335a56106` |
| Mandate template | `0x29eC0050152Fe913092BD45e93aa5bE4Aea2A38D` |
| Vault template | `0x762155474Fec6aE0A734bc4A4518ac8f7661d827` |
| tUSD | `0xD1D79F4946BaDc69B492c3316a8cEA543e16bb99` |
| Price oracle (mock) | `0xf91fdB1e0eB25C2A3b1DC5FE233Ab169079Bc9C1` |
| Exchange (mock) | `0x570aa6d177862c17A0F06905681C7908Ae241299` |
| tIDX / tBOND / tGOLD / MEME | `0x8a7206F9943CA413045b9fa11c20cc9AA203cEA5` / `0x0971e818fF02C76bE10876ED3AF9CD6Ed226AFE5` / `0x1f0297097138649ff965e1932a544Fc1b38887c5` / `0x1a95281b9AfE38a1275891b5307ee0E437A9048A` |

**FISCO BCOS.** The same contracts, unchanged, also run on a local one-node FISCO BCOS 3.16 chain through its Ethereum-compatible RPC (`scripts/fisco-chain.sh` builds it). Trades, the compromised agent's calls, an owner-signed approval, a queued loosening with a veto and a commitment payment all behave as on Base Sepolia there. That chain is local, so its hashes are not publicly visible; the Base Sepolia hashes are the public evidence.

TODO before submission: the full list of transaction hashes (trades, the owner-approved trade, the compromised agent's reverted calls, the queued loosening and the trusted contact's veto) exported from the audit log into `docs/evidence/`.

## Results

**Contracts.** 171 Foundry tests: unit, fuzz and four invariant suites with 21 invariants, including one that spends every call on commitments. A long run (`FOUNDRY_PROFILE=deep`) made about a million random calls with zero invariant violations. A mutation check on the contracts before commitments broke 47 checks one at a time: the unit tests caught all 47, the invariants 46 (the miss is the slippage check, which the honest mock exchange cannot exercise).

**Evaluation harness** (`app/harness/`). The real contracts on a local chain, 6 markets (bull, bear, crash, choppy, flash crash, oracle manipulation) x 3 agent brains (plan follower, random, compromised) x 2 users (calm, panicking), 9 seeds, each run against an unguarded copy. 324 runs on the current contracts, and the bounds held in every one: 25,416 rule breaks stopped, all 633 attempts to loosen the mandate made to wait (381 vetoed), and no planned task refused without a rule behind it. Median final value 985.81 guarded against 933.71 unguarded, from 1,000. The unguarded portfolio with a compromised agent ends at 0 every time.

**Red-team suite** (`app/redteam/`). 16 attacks (injected news in English and Bangla, scam token promotions, a fake message from the trusted contact, a fake invoice, a lookalike token, hidden HTML instructions, a fake system override, someone claiming to act for the owner, panic, sending money to a new wallet, switching off protections after a loss, a fake rent notice asking to pay a new account, a chat claim that the landlord changed accounts, and putting the rent money into the dip) plus 2 genuine requests, 3 repeats each. Each one runs against a plain agent that reads the text itself and has unguarded tools, against our agent, and straight at the contract with the agent's real key, as if the model were completely taken over. On a local fork of Base Sepolia, with a rent commitment and a small portfolio set up first.

| | Plain agent fooled | Our agent fooled | Genuine requests refused (plain / ours) |
|---|---|---|---|
| DeepSeek (`deepseek-flash`) | 1 of 48 runs (1 more timed out) | 0 of 48 | 0 / 0 of 6 |
| Llama 3.2 3B (local, via Ollama) | 30 of 48 runs, 12 more fooled with a broken call | 0 of 48 | 6 / 0 of 6 |
| Contract with the agent key, no off-chain checks | | 23 of 23 attacker goals reverted | |

A strong model refuses most attacks by itself; a small one does not. Our agent's result does not depend on which one it runs on, and if the model were fully compromised the contract still refuses every attacker goal. Per-attack tables: `app/redteam/results/latest.md` (DeepSeek) and `local-llama3.2-3b.md`.

## Running it

### Quick local demo (no keys, no testnet)

Requirements: Node 24 and [Foundry](https://getfoundry.sh).

```bash
git clone --recurse-submodules https://github.com/fariha-nirjana/policy-wallet
cd policy-wallet/app
npm install
npm run demo            # or: npm run demo -- --signed  to skip the first-time setup
```

This starts a fresh local chain, deploys every contract with throwaway test keys, and opens the app at http://localhost:3002 on the first-time setup. Chat needs a model key (`LLM_API_KEY=... npm run demo`); everything else works without one. Each run starts from nothing.

### Full setup on Base Sepolia

Requirements: Node 24, [Foundry](https://getfoundry.sh) (tested with 1.8.5), a Base Sepolia RPC (the public one works) and an OpenAI-compatible model API key (we use DeepSeek).

```bash
git clone --recurse-submodules https://github.com/fariha-nirjana/policy-wallet
cd policy-wallet

# keys: generates fresh testnet keys into .env (or copy .env.example and fill it in)
scripts/new-env.sh
# fund the owner, agent, guardian and oracle updater addresses with Base Sepolia ETH from a faucet
# add LLM_API_KEY to .env

# contracts
cd contracts
forge test
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
# copy the printed addresses into .env

# app
cd ../app
npm install
npm test
npm run dev            # http://localhost:3000
```

Useful scripts, all from `app/`:

| Command | What it does |
|---|---|
| `npm run ask -- "message"` | Send one message to the agent and print every tool call and receipt |
| `npm run attack` | Run the compromised-agent playbook with the real agent key (every call should revert) |
| `npm run keeper` | Refresh prices and fire any stop-loss that is due |
| `npm run autopilot` | Run the scheduled check: recurring buys and rebalancing |
| `npm run owner -- requests` | Owner and trusted contact actions from the terminal (see `scripts/owner.ts`) |
| `npm run harness` | The evaluation harness on a local chain (free brains; add `--brains deepseek --merge` for the model) |
| `npm run redteam -- --dry` | The red-team suite's contract column on a local fork of Base Sepolia, no model calls |
| `npm run redteam` | The full red-team suite (uses the model API) |

To try things without touching the testnet vault, fork it locally: `anvil --fork-url $RPC_URL --port 8548 --block-time 1`, then run the app with `RPC_URL=http://127.0.0.1:8548 DATA_DIR=<scratch folder>`.

## Tests

- `contracts/`: `forge test` (171 tests), `FOUNDRY_PROFILE=deep forge test` for the long run.
- `app/`: `npm test` (unit tests for the risk engine, reader sanitising, receipts, planner, money display, mascot state, understanding check), `npm run typecheck`, `npm run lint`.
- `app/harness/` and `app/redteam/`: the scenario and attack suites above. Results are committed under `results/`.

## Known limits

The full list is in the security self-assessment. The main ones:

- A compromised agent can still make bad trades inside the mandate. The mandate bounds the damage; it does not prevent it.
- A compromised agent can pay an approved commitment early, once its due window has opened (three days by default), to the approved payee and within its amount. It cannot pay anyone else or pay the same due date twice.
- Daily limits reset at the UTC day boundary, so two days' allowance can be used across midnight.
- The price oracle is a mock with a staleness check and a maximum change per update. A manipulated feed could still trigger a stop-loss or protect mode. Oracle-forced sells are on the known-risk list.
- Theft of the owner key is out of scope. A different address can always open a fresh vault without the waiting period.

## Compliance note

This is a guardrail design for AI agents on regulated rails, demonstrated on a public testnet with simulated test assets. It is not a crypto product and not a tokenization service, and we make no claim that it could be offered in any particular jurisdiction.

## License

TODO
