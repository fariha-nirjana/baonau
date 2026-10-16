# Execution evidence: live run on Base Sepolia, 16 October 2026

We ran the whole Baonau story on the public Base Sepolia testnet (chain 84532), on a fresh vault, in one sitting. Every line below is a real transaction you can open on the explorer, including the ones the contract refused. Everything uses simulated test assets; no real money is involved.

- Vault `0x4F39604cdF8078a48a20DFFc39d79b3551ea7D6F`, mandate `0xA75F62d72e9c5Ddf303A7Bd4d1A8899FEb2cef8F` (EIP-1167 clones of the verified templates; factory and templates are listed in the README)
- The raw audit log for this run, with the reason and rule checks for every action, is `live-run-2026-10-16.audit.jsonl` next to this file. Each trade's `ref` on-chain is the hash of its record in that log.

| Time (UTC) | What happened | Result | Transaction |
|---|---|---|---|
| 10:52 | Owner creates a fresh vault and mandate from the factory | done | [0x97232f3f…](https://sepolia.basescan.org/tx/0x97232f3f162dede74c1974584166d2ebddbb8e611ff6754f05ad20021436f74b) |
| 10:52 | Owner mints ৳5,000 (≈ 40.98 tUSD) of test cash | done | [0x61325df9…](https://sepolia.basescan.org/tx/0x61325df9da40d9108107c876843a0c760a8f889898dc788c7c343a7292d31410) |
| 10:52 | Owner approves the vault to take the deposit | done | [0x50917d91…](https://sepolia.basescan.org/tx/0x50917d917d26fa14fad39e22eed8b518a41f59a511aded078b2c7c58c98bb934) |
| 10:52 | Owner deposits ৳5,000 into the vault | done | [0x0b9e8c69…](https://sepolia.basescan.org/tx/0x0b9e8c699990676aa1759ea9741bb69485f25a8297fca3fb440e4c7833108b91) |
| 10:53 | Keeper pushes prices to the mock feed | done | [0xb04477aa…](https://sepolia.basescan.org/tx/0xb04477aa3d46997f7b69091e22f70dcf017e63cb3d557e62a0e8eca6cda6a562) |
| 10:58 | Owner signs the mandate Bunbun drafted from her Bangla goal | done | [0xa85975ad…](https://sepolia.basescan.org/tx/0xa85975ad926b25d49b4d81fbc72d461dc62e1cdc7816d26fd1b0a277b79eefcf) |
| 10:58 | Owner adds rent (Riverbend Housing, ৳500 a month); the new payee waits | done | [0x2e244081…](https://sepolia.basescan.org/tx/0x2e244081dd080e94d730cc4901d99c51ee695676a1e9429ef331df8ee52d7371) |
| 10:58 | Owner sets ৳500 aside for rent (instant) | done | [0x753f6075…](https://sepolia.basescan.org/tx/0x753f6075b495deda2e3e917eb9b7f52e637f2afd1af5964bbf50f5d80a8fd944) |
| 11:00 | New rent payee applies after its 2-minute wait | done | [0x91ed657f…](https://sepolia.basescan.org/tx/0x91ed657fddab00342c6ce55128861a21fda15d3735a95c8594293c39006f8ea3) |
| 11:01 | Bunbun makes the weekly ৳300 recurring buy | done | [0x6ca75f82…](https://sepolia.basescan.org/tx/0x6ca75f82106ad480c63bb10c2f623525d757e5e295cee0a389f5916e4346530a) |
| 11:01 | Bunbun pays rent on time, to the approved payee | done | [0x9267c7df…](https://sepolia.basescan.org/tx/0x9267c7dfd7af751ee8040914e1ce392191ba267e11a1a8910091da41b0733dbb) |
| 11:01 | Bunbun rebalances toward the plan | done | [0xd27cde08…](https://sepolia.basescan.org/tx/0xd27cde081ffe159c633dbc629fdb82935bbd26495555014ad24a1db71a4dc244) |
| 11:01 | Compromised agent (real agent key, no checks) tries to buy the scam asset (MEME) | refused by the contract: `AssetNotAllowed` | [0x44f15852…](https://sepolia.basescan.org/tx/0x44f15852505311fc6a51df0433ee3eca6f6f494f9828f38cedf2c33b993893a5) |
| 11:01 | Compromised agent (real agent key, no checks) tries to put all the cash into one trade | refused by the contract: `ExceedsTradeLimit` | [0x03ce4b93…](https://sepolia.basescan.org/tx/0x03ce4b93aa069fcc25689260d20d6839e68c1a432fef90f464d02a8900456888) |
| 11:02 | Compromised agent (real agent key, no checks) tries to send the cash to the attacker | refused by the contract: `NotOwner` | [0xbf0b4ac9…](https://sepolia.basescan.org/tx/0xbf0b4ac9c5d1ea58e2851a774ab963b37e3990ef3a80694384ba2e7596bbc74a) |
| 11:02 | Compromised agent (real agent key, no checks) tries to forge the owner's approval | refused by the contract: `BadApproval` | [0x7b87fe8b…](https://sepolia.basescan.org/tx/0x7b87fe8bdff716b3d6997b39cb88d1a45ddbb1fd0f1366d316e75c50205a6c62) |
| 11:02 | Compromised agent (real agent key, no checks) tries to point withdrawals at the attacker | refused by the contract: `NotOwner` | [0x87fd917c…](https://sepolia.basescan.org/tx/0x87fd917c4ecb0c3c36a211311f35b16ef08a305edc0c51bbc7e8a3cf72738981) |
| 11:02 | Compromised agent (real agent key, no checks) tries to rewrite the mandate with no limits | refused by the contract: `NotOwner` | [0x8f94c468…](https://sepolia.basescan.org/tx/0x8f94c468c4be4339907a32a6abda7bd1f5afa56a8d82bf77087d54ad1fb12de4) |
| 11:02 | Compromised agent (real agent key, no checks) tries to switch off the stop-loss | refused by the contract: `NotOwnerOrGuardian` | [0xa7147799…](https://sepolia.basescan.org/tx/0xa7147799b7c3e831bfaa34a50363b2ccf6b7fdb67ea9ef47c8ecd2369cc04858) |
| 11:02 | Compromised agent (real agent key, no checks) tries to give itself a new, longer key | refused by the contract: `NotOwner` | [0xdffee61a…](https://sepolia.basescan.org/tx/0xdffee61a2edaf8ec7ef7892703a197051334d8b240efb92bae0a5fc5ac99f960) |
| 11:02 | Compromised agent (real agent key, no checks) tries to remove the trusted contact | refused by the contract: `NotOwner` | [0x96434a06…](https://sepolia.basescan.org/tx/0x96434a0631e06b6e8fdbed5140587feed17352865f0d346604a1f42a83ebd196) |
| 11:02 | Compromised agent (real agent key, no checks) tries to trade after the day's allowance was used | refused by the contract: `ExceedsDailyVolume` | [0x222dadba…](https://sepolia.basescan.org/tx/0x222dadbab8179e8c3176d82c08acc6dea8a3e4db2fc3d9571d0f6a5897a77233) |
| 11:03 | Keeper pushes prices to the mock feed | done | [0x88099487…](https://sepolia.basescan.org/tx/0x88099487509153e1c846f95218d2be1ed8ebb919e7d0f424610de869f40ca229) |
| 11:03 | Keeper pushes prices to the mock feed | done | [0xda058b62…](https://sepolia.basescan.org/tx/0xda058b6234e7d6c00ff2fbd2f6c6e0a1b64db6725aa3b7cd20d086522c2ec928) |
| 11:03 | Keeper (no AI) fires the stop-loss; protect mode starts | done | [0x35d5d6c3…](https://sepolia.basescan.org/tx/0x35d5d6c3a380aa01a0e52184ddac4c8f4e919e00a2ac97e7eb10b364cfa1b4e1) |
| 11:04 | Owner asks to triple the daily loss limit (3% to 9%): queued, not applied | done | [0xca111f1f…](https://sepolia.basescan.org/tx/0xca111f1f33e068fd8838f350f52fd4272405076526f2b14b890d17d92bc4cbc5) |
| 11:04 | Owner asks to switch off the stop-loss: queued, not applied | done | [0x87a33b65…](https://sepolia.basescan.org/tx/0x87a33b6501e71c9305f5122879edb86831af0b804cf7bb97853aff5e1c882c58) |
| 11:05 | Trusted contact cancels the loss-limit increase | done | [0xdc841a45…](https://sepolia.basescan.org/tx/0xdc841a45fc49e5cd6f1ba098720152762dc8f1cb93446ef33711efa826fbffd7) |
| 11:05 | Trusted contact cancels the stop-loss switch-off | done | [0x5eeb1b5d…](https://sepolia.basescan.org/tx/0x5eeb1b5d5d8c882c8635c23ccf4639a812141bdbb4d6fe7613f2f54336aef166) |
| 11:05 | Owner lowers the daily loss limit to 2%: applies in the same transaction | done | [0x7d408668…](https://sepolia.basescan.org/tx/0x7d40866899133a37557b8c16d5f4eddaef4337c01ab8288629761d6693609875) |
| 11:06 | Owner sets next month's ৳500 aside for rent (instant) | done | [0xeabc2778…](https://sepolia.basescan.org/tx/0xeabc2778b43364dc864581e46c42a6608d20b300527b0a5b4ce46e96dad264cc) |
| 11:06 | Owner asks to move rent money back into investing: queued, not applied | done | [0xda545bad…](https://sepolia.basescan.org/tx/0xda545badfcadcdc94ae0aa6624b2f467b7e388459c6a424f0ac9921488a284af) |
| 11:07 | Trusted contact cancels the rent-money release | done | [0x74ad2afd…](https://sepolia.basescan.org/tx/0x74ad2afddad650edbd3e94c8ff13a718b0c592132d40da5e60796725741f8698) |

Also in the log, not on-chain: two abstentions where Bunbun decided not to act (the rent money was not set aside yet, and buying was paused), each with its reason.
