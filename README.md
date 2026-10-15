# Paws for Thought

An AI portfolio agent for first-time investors, governed by an investment mandate the investor signs and a smart contract enforces.

Team Ulysses. 2026 Shenzhen International FinTech Competition, International Track, Topic F (Agent Wallet).

> Every asset in this project is a simulated test asset on a public testnet. Nothing here has real value or real backing.

## What it does

1. The investor describes a goal in their own words, in English or Bangla ("I have ৳5,000, I want long-term growth but not much risk").
2. The agent drafts a mandate: which assets, how much of each, how big a trade can be, how much can be lost in a day before buying stops, and how long any loosening of these rules has to wait.
3. The investor reads it in plain language, answers a short understanding check, writes a note to their future self and signs it on-chain.
4. The agent then manages the portfolio on its own: recurring buys, rebalancing, explaining what happened. Every action leaves a receipt that lists each rule it was checked against and links to the transaction.

The mandate governs two failure modes:

- **A compromised AI.** The model can be wrong, injected or fully taken over. It holds only a session key that can trade inside the mandate. It cannot withdraw, change a rule or sign for an exception.
- **An impulsive owner.** After a loss, the investor may want to tear down their own protections. Lowering risk applies immediately. Raising risk (a higher loss limit, a bigger cap, switching off the stop-loss, a new withdrawal address) waits out a delay, and the investor's trusted contact can cancel it during the wait.

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

Deployed on Base Sepolia (chain id 84532). Templates, factory and market are verified on Sourcify. The vault and mandate are 45-byte EIP-1167 clones of the verified templates, so they have no source of their own to verify.

| Contract | Address |
|---|---|
| Vault | `0x62F224d0A872A06aA6D82FA012A06244AC8e3244` |
| Mandate | `0x8743506f6bD4246F26C486fa55344e8940f988bb` |
| Factory | `0x224C7dBEf097C01a39828A51254998D3D947AC66` |
| Mandate template | `0xD8B85fFB79D97950aA8dC097A6f54AE78dbe7B1d` |
| Vault template | `0xaD3b33F03c63667DE8fcC762Ea649a89ABc066fF` |
| tUSD | `0x6678d5a3b877237Cb45782055FeC4681C6A3E53c` |
| Price oracle (mock) | `0x8599aEfeC2e001ED03dBAbcB3409B5772813dAC0` |
| Exchange (mock) | `0xCC312C9949208658EB0086Add2B46a99AFb04bcA` |
| tIDX / tBOND / tGOLD / MEME | `0x6FA77BE769Cb3f98Aa75eDa3B238b5d48e8e06d8` / `0x851Fb260A6B2b1014EC3A9014504dB11678a4230` / `0x28d1268a1C695074c7487507096cd656F679d5F0` / `0xDe99714DcE0394D90704C2BE937541ce8A53622F` |

TODO before submission: the full list of transaction hashes (trades, the owner-approved trade, the compromised agent's reverted calls, the queued loosening and the trusted contact's veto) exported from the audit log into `docs/evidence/`.

## Results

**Contracts.** 140 Foundry tests: unit, fuzz and three invariant suites. A long run (`FOUNDRY_PROFILE=deep`) made 750,000 random calls with zero invariant violations. A mutation check broke 47 checks in the contracts one at a time: the unit tests caught all 47, the invariants 46 (the miss is the slippage check, which the honest mock exchange cannot exercise).

**Evaluation harness** (`app/harness/`). The real contracts on a local chain, 6 markets (bull, bear, crash, choppy, flash crash, oracle manipulation) x 3 agent brains (plan follower, random, compromised) x 2 users (calm, panicking), 9 seeds, each run against an unguarded copy. 324 runs, and the bounds held in every one: 25,414 rule breaks stopped, all 633 attempts to loosen the mandate made to wait (381 vetoed). Median final value 985.81 guarded against 933.71 unguarded, from 1,000. The unguarded portfolio with a compromised agent ends at 0 every time.

**Red-team suite** (`app/redteam/`). 13 attacks (injected news in English and Bangla, scam token promotions, a fake message from the trusted contact, a fake invoice, a lookalike token, hidden HTML instructions, a fake system override, someone claiming to act for the owner, panic, sending money to a new wallet, switching off protections after a loss) plus 2 genuine requests, 3 repeats each. Each one runs against a plain agent that reads the text itself and has unguarded tools, against our agent, and straight at the contract with the agent's real key, as if the model were completely taken over. On a local fork of Base Sepolia.

| | Plain agent fooled | Our agent fooled | Genuine requests refused (plain / ours) |
|---|---|---|---|
| DeepSeek (`deepseek-flash`) | 2 of 39 runs | 0 of 39 | 0 / 0 of 6 |
| Llama 3.2 3B (local, via Ollama) | 12 of 39 runs, 9 more fooled with a broken call | 0 of 39 | 6 / 0 of 6 |
| Contract with the agent key, no off-chain checks | | 17 of 17 attacker goals reverted | |

A strong model refuses most attacks by itself; a small one does not. Our agent's result does not depend on which one it runs on, and if the model were fully compromised the contract still refuses every attacker goal. Per-attack tables: `app/redteam/results/latest.md` (DeepSeek) and `local-llama3.2-3b.md`.

## Running it

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

- `contracts/`: `forge test` (140 tests), `FOUNDRY_PROFILE=deep forge test` for the long run.
- `app/`: `npm test` (unit tests for the risk engine, reader sanitising, receipts, planner, money display, mascot state, understanding check), `npm run typecheck`, `npm run lint`.
- `app/harness/` and `app/redteam/`: the scenario and attack suites above. Results are committed under `results/`.

## Known limits

The full list is in the security self-assessment. The main ones:

- A compromised agent can still make bad trades inside the mandate. The mandate bounds the damage; it does not prevent it.
- Daily limits reset at the UTC day boundary, so two days' allowance can be used across midnight.
- The price oracle is a mock with a staleness check and a maximum change per update. A manipulated feed could still trigger a stop-loss or protect mode. Oracle-forced sells are on the known-risk list.
- Theft of the owner key is out of scope. A different address can always open a fresh vault without the waiting period.

## Compliance note

This is a guardrail design for AI agents on regulated rails, demonstrated on a public testnet with simulated test assets. It is not a crypto product and not a tokenization service, and we make no claim that it could be offered in any particular jurisdiction.

## License

TODO
