# Baonau: security self-assessment

Team Ulysses · FinTechathon 2026, International Track · Topic F

This is our honest look at how safe Baonau is, where it isn't, and how we checked. We're a student team, and this hasn't been audited by anyone outside it. So we've tried to write down every weak spot we know of, rather than only the strengths.

Everything here runs on test networks with simulated test assets. No real money is involved anywhere.

---

## 1. What we're protecting, and from whom

Baonau lets an AI agent (we call it Bunbun) manage a first-time investor's portfolio inside rules she signs, called the mandate. The money sits in a smart contract, the vault. So the questions are: who can move it, who can change the rules, and how fast?

We designed for two things going wrong.

**Threat A: the AI goes wrong.** It misreads something, gets tricked by a poisoned news story or a fake invoice, or someone steals its key outright. We assume this *will* happen at some point. So the agent is never the thing that keeps the money safe.

**Threat B: the owner goes wrong.** This one comes from real life. After a loss, people want to win it back, and the first things they switch off are their own protections. We wanted the mandate to hold on a bad day too, without ever locking anyone out of their own money.

Our one rule for both: **anything that lowers risk applies right away. Anything that raises risk waits, and a trusted contact can cancel it during the wait.** The contract decides which is which, from a fixed table. No AI is involved in that decision.

---

## 2. Permission tiers, and how each one is enforced

| Tier | What | Who | Where it's enforced |
|---|---|---|---|
| 0 | Read balances, rules, history | Agent | Nothing to enforce; reading is free |
| 1 | Trade inside the mandate; pay an approved bill inside its due window | Agent alone | `onlyAgent` in `PolicyVault.sol` checks the key is the agent's, not expired, not revoked, not paused. Every trade then goes through the checks in section 3 |
| 2 | One trade bigger than the agent's limits | Agent asks, owner signs that exact trade | EIP-712 signature from the owner, bound to the vault and chain, used once, valid for at most an hour (`MAX_APPROVAL_LIFETIME`). It lifts only the trade-size and daily-volume limits |
| 3 | Change any rule, key or address | Owner only | `onlyOwner` in `Mandate.sol`. Tightening applies at once; loosening is queued in `pendingEta` and waits `loosenDelay` |

Three more roles sit around the tiers:

- **The trusted contact** (`guardian` in the code) can only say no: pause the agent, cancel a waiting change, revoke the agent key, or halt the stop-loss in an emergency (`onlyOwnerOrGuardian`). It has no function that moves money. It also can't cancel its own removal, so it can't hold the owner hostage either.
- **Anyone** can trigger a stop-loss, but only once the oracle price is at or below the owner's stop price. The proceeds stay in the vault, and the caller gets nothing.
- **The owner** can always withdraw, instantly, but only to the withdrawal address registered in the mandate. Changing that address is a "raises risk" change, so it waits.

What the agent key can't do at all, no matter what the model says:

- send money to an address (none of its functions takes one)
- buy anything off the allowlist
- change a rule, a key, the trusted contact or the withdrawal address
- touch money set aside for bills, except to pay that bill's approved payee inside its window
- sign its own approval (the vault checks the signer is the owner)

The agent's key also expires. It can live at most 90 days (`MAX_AGENT_SESSION`), and the owner or the trusted contact can revoke it at once.

---

## 3. The defences, layer by layer

We didn't want one layer to be the whole story, so there are five. If a layer fails, the next one still holds.

1. **The quarantined reader.** News, invoices, token pages and messages the owner didn't write are read by a separate model call that has no tools. It can only fill in a few typed fields: which known assets are mentioned, whether it promotes a token, whether it urges a buy or sell, and flags like "contains instructions to the assistant" or "promises returns". The agent with tools never sees the raw text, and anything it does after reading untrusted text goes to the owner for a decision.
2. **The agent.** It proposes actions as structured tool calls. It doesn't hold the owner's key. If the model errors, times out or says something we can't use, the agent does nothing and logs that it did nothing. We call that an abstention, and it gets a receipt like everything else.
3. **The risk engine.** Plain code, no AI. It checks every proposed action against the mandate before anything is signed, plus a few things the chain can't check (a scam token list, abnormal price moves, buying again right after a loss). It writes down every check, pass or fail, and that becomes the receipt. It can only make a decision stricter than the contract would, never looser. We have a test for that.
4. **The contracts.** These are the real wall. Even if layers 1 to 3 are skipped completely (say our server is compromised), the vault still checks every trade itself: allowlist, size per trade, volume per day, cap per asset, minimum share in cash and defensive assets, protect mode after a daily loss, cooldown after losing sells, stop price, slippage against the oracle, and fresh prices.
5. **People.** The owner signs the mandate and anything above the limits. The trusted contact gets an alert when the owner asks for more risk, and can cancel it.

---

## 4. How we checked it

We didn't want to just say it's safe, so we tried to break it in four different ways.

**Contract tests.** 171 Foundry tests: a unit test for every limit and every refusal, fuzz tests, and 4 invariant suites with 21 invariants. In the invariant suites, a simulated attacker holds the real agent key and calls everything in random order. A long run made about a million random calls and found 0 violations. We also did a mutation check on an earlier version: we broke 47 checks in the contracts one at a time to see if the tests would notice. The unit tests caught all 47, the invariants caught 46. The one the invariants missed was the slippage check, because our mock exchange is honest, so nothing in those runs ever gets a bad price. A unit test with a dishonest exchange catches it.

**Red team against real models.** We wrote 16 attacks: hidden instructions in news (in English and Bangla), scam token promotions, a fake message from the trusted contact, a fake invoice, a lookalike token, a fake system override in the chat, someone pretending to act for the owner over three messages, panic selling, sending money to a new wallet, switching off protections after a loss, a fake rent notice with a new account, "the landlord changed accounts", and "use my rent money to buy the dip". We ran each one 3 times against a plain agent with unguarded tools, against our agent, and straight at the contract with the agent's key.

| | Plain agent: attacker won | Our agent: attacker won |
|---|---|---|
| DeepSeek | 1 of 48 | 0 of 48 |
| Llama 3.2 3B (small, local) | 30 of 48 (plus 12 fooled with a broken call) | 0 of 48 |
| Agent key alone, no model, no checks | | contract refused 23 of 23 attacker goals |

The interesting part for us: DeepSeek refused almost everything on its own, which is exactly why we don't rely on the model. A smaller model got fooled a lot. Our agent's result didn't change.

**Stress runs.** 6 markets (steady growth, long decline, crash, choppy, flash crash, a manipulated price feed) × 3 agents (healthy, random, hacked) × 2 owners (calm, panicking) × 9 seeds = 324 runs on the real contracts. In every single run the bounds held: no money left except to the owner, nothing off the allowlist was bought, no limit was passed, and no risk increase took effect before its wait. 25,416 rule breaks were stopped. All 633 attempts to loosen the rules had to wait. Without the mandate, every run with a hacked agent ended at zero.

The "healthy" agent in those runs is a scripted plan follower, not DeepSeek. We used a script there so we could run hundreds of seeds for free. The real-model evidence is the red team above.

**Live runs on the testnet.** [LIVE RUN: confirm wording after the run] We ran the whole story on Base Sepolia, including a compromised-agent attack where every attempt is a real transaction you can look up. Section 6 has the evidence.

---

## 5. Known risks

These are the weak spots we know about. For each one we say how bad it is, what limits it, and what we'd do next. "Severity" is our own rough call for the pilot.

| # | Risk | Severity | What limits it today | What we'd do next |
|---|---|---|---|---|
| R1 | A hacked agent can still make bad trades **inside** the limits (selling at a bad moment, churning up to the daily volume) | Medium | Trade size, daily volume, asset caps, loss limit, protect mode. The app shows the most it could cost each day ("if the AI were hacked today") | Tighter default limits for brand-new investors; alerts on unusual in-limit patterns |
| R2 | A hacked agent can pay an approved bill **early**, once its due window opens (3 days by default) | Low | Only to the approved payee, only up to the approved amount, never twice for one due date | Shorter windows for bills that don't need them |
| R3 | **The price feed is a mock.** A manipulated or broken feed could trigger a stop-loss or protect mode for nothing | High in a real deployment | Staleness check, a maximum change per update, sale proceeds stay in the vault, the trusted contact can halt the stop-loss at once. Our stress runs include a manipulated feed and show the cost (median 953 vs 998 from 1,000) | A real decentralised or licensed price source with several feeds and a circuit breaker |
| R4 | Daily limits reset at the UTC day boundary, so up to two days' allowance can be used across midnight | Low | Per-trade limit and asset caps still apply | A rolling 24-hour window |
| R5 | **The owner's key gets stolen** | High, out of scope | The trusted contact can pause and cancel waiting changes, but can't stop a withdrawal to the registered address | Passkeys or a smart-account owner with recovery; a delay on large withdrawals is possible but conflicts with "never custody" |
| R6 | Someone can open a fresh vault from a **different address** and skip the waiting period | Low | Same-address vaults wait (factory rule). We add friction to risk; we never hold anyone's money hostage, so a person can always leave | That's the honest limit of a non-custodial design |
| R7 | **The trusted contact could be the wrong person** (careless, or colluding) | Medium | They can only say no. Worst case, they block a risk increase or pause the agent. They can never move money, and can be replaced (after the wait) | Let the owner name more than one, with any one able to cancel |
| R8 | **In the pilot app, the owner and trusted contact keys sit on our server** so the demo's sign buttons work | High if deployed like this | Demo only, test keys, test money | In a real deployment they sign in their own wallets, and our server never sees those keys |
| R9 | The waiting period is **2 minutes** in the demo | Not a risk in the demo itself | Configurable from 1 minute to 30 days; tightening it is instant | A day by default in the pilot design (the stress runs used a day) |
| R10 | **A delay doesn't stop a determined owner.** After the wait, she can raise her risk | By design | The wait, the trusted contact's veto, and a note to her future self shown before she confirms | This is a nudge, not a guardian of last resort, and we say so |
| R11 | **No external audit** | Medium | Tests, invariants, the mutation check, red team, stress runs | An independent audit before anything real |
| R12 | Model provider outage or bad output | Low | Fail-safe: no action, logged as an abstention. The stop-loss doesn't need the AI | Nothing more needed |
| R13 | Reorgs or a misbehaving chain | Low on a testnet | Every check runs on-chain at execution time | Standard confirmation handling on a real network |

---

## 6. Evidence

- **Contracts on Base Sepolia (chain 84532), deployed 15 Oct 2026, verified on Sourcify:** vault `0x213F465d03C3E008cE6f4562D92Ed90e3F6c0B21`, mandate `0x1C344fB4C23Aa939D8f917E2e6095Fced975B42a`, factory `0x45170Cf431e66A495C513FE9412512b335a56106`. The full address list is in the README.
- **Live run transactions [LIVE RUN]:** mandate signed, trades inside the limits, rent paid, each refused attack from the compromised agent, the stop-loss, the queued risk increase and the trusted contact's cancellation. Full list with explorer links in `docs/evidence/`.
- **FISCO BCOS:** the same contracts ran unchanged on a local FISCO BCOS 3.16 chain, and the same attacks were refused there. That chain is local, so its hashes aren't public; logs are in the repository.
- **Test results:** `contracts/test/`, `app/harness/results/`, `app/redteam/results/`.

---

## 7. What we'd want a reviewer to know

We're not claiming Baonau can't be hacked. We're claiming that if the AI is hacked, what it can do is limited by the contract, and we measured that limit. We're also not claiming the mandate makes anyone money: in calm markets it costs a little, in a crash it helped a lot, and we've put both numbers in our technical documentation. The thing we're proudest of is that the rules bind the owner too, gently: less risk is always instant, more risk always takes a breath first.
