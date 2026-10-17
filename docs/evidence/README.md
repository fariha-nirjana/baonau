# Execution evidence: Base Sepolia, 16 and 17 October 2026

This file has two runs on the public Base Sepolia testnet: the live run on 16 October, and the demo-video recording on 17 October. Every line is a real transaction you can open on the explorer, including the ones the contract refused. Everything uses simulated test assets; no real money is involved.

## First run: the live run, 16 October 2026

We ran the whole Baonau story on the public Base Sepolia testnet (chain 84532), on a fresh vault, in one sitting, with DeepSeek as the agent.

- Vault `0x4F39604cdF8078a48a20DFFc39d79b3551ea7D6F`, mandate `0xA75F62d72e9c5Ddf303A7Bd4d1A8899FEb2cef8F` (EIP-1167 clones of the verified templates; factory and templates are listed in the README)
- The raw audit log for this run, with the reason and rule checks for every action, is `live-run-2026-10-16.audit.jsonl` next to this file. Each trade's `ref` on-chain is the hash of its record in that log.

| Time (UTC) | What happened | Result | Transaction |
|---|---|---|---|
| 10:52 | Owner creates a fresh vault and mandate from the factory | done | [0x97232f3f…](https://sepolia.basescan.org/tx/0x97232f3f162dede74c1974584166d2ebddbb8e611ff6754f05ad20021436f74b) |
| 10:52 | Owner mints ৳5,000 (≈ 40.98 tUSD) of test cash | done | [0x61325df9…](https://sepolia.basescan.org/tx/0x61325df9da40d9108107c876843a0c760a8f889898dc788c7c343a7292d31410) |
| 10:52 | Owner approves the vault to take the deposit | done | [0x50917d91…](https://sepolia.basescan.org/tx/0x50917d917d26fa14fad39e22eed8b518a41f59a511aded078b2c7c58c98bb934) |
| 10:52 | Owner deposits ৳5,000 into the vault | done | [0x0b9e8c69…](https://sepolia.basescan.org/tx/0x0b9e8c699990676aa1759ea9741bb69485f25a8297fca3fb440e4c7833108b91) |
| 10:53 | Keeper pushes prices to the mock feed | done | [0xb04477aa…](https://sepolia.basescan.org/tx/0xb04477aa3d46997f7b69091e22f70dcf017e63cb3d557e62a0e8eca6cda6a562) |
| 10:58 | Owner signs the mandate Bunbun drafted from a goal typed in Bangla | done | [0xa85975ad…](https://sepolia.basescan.org/tx/0xa85975ad926b25d49b4d81fbc72d461dc62e1cdc7816d26fd1b0a277b79eefcf) |
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

## Second run: the demo-video recording, 17 October 2026

We recorded the demo video on another fresh vault, also on Base Sepolia, so every scene in the video is a real transaction too. The demo user is Tanvir, the rent is shared rent paid to a testnet payee, and everything uses simulated test assets.

- Vault `0xC3Da7a268e4B373093D1e3A6f0789CE8e5fac08d`, mandate `0x6d4C768bFCCEC456fCe81E812078F422e47c172C`
- Raw audit log: `recording-run-2026-10-17.audit.jsonl` next to this file.
- We took the bad-day scene twice. The first take was cut short after one cancel, so the trusted contact cancelled the second waiting change (13:05) before we recorded it again (13:08). Both takes are in the table.

| Time (UTC) | What happened | Result | Transaction |
|---|---|---|---|
| 12:51 | Owner creates a fresh vault and mandate from the factory | done | [0x7890851a…](https://sepolia.basescan.org/tx/0x7890851aa93713720fa9ca2e9d8773f9217ad93b65aac4811ffb054e005741fa) |
| 12:51 | Owner mints ৳5,000 (≈ 40.98 tUSD) of test cash | done | [0x5a99cf5a…](https://sepolia.basescan.org/tx/0x5a99cf5add4f1549158623b7a23b8f6ce823773670d4193ed3f8121fa3bf33a2) |
| 12:51 | Owner approves the vault to take the deposit | done | [0xfb275318…](https://sepolia.basescan.org/tx/0xfb27531847167495586fc2f44eef1580075b9157779df5e307eaffed5f7efc1b) |
| 12:51 | Owner deposits ৳5,000 into the vault | done | [0x5991a367…](https://sepolia.basescan.org/tx/0x5991a3675814e0cd9ee083932fcc0867466d60a7a2a45745bd1f4184197fff73) |
| 12:53 | Owner signs the mandate Bunbun drafted from a goal typed in Bangla | done | [0xbedf3ead…](https://sepolia.basescan.org/tx/0xbedf3ead197178aa530adb7377aa702ebbebb4e63a687e6dc319bc6cd4b5be9b) |
| 12:54 | Owner adds shared rent (৳500 a month, new payee): queued for the waiting period | done | [0x6bae6834…](https://sepolia.basescan.org/tx/0x6bae683430f6b0beaaeafb4a9f5b63537664e13d1e0f6245894962f11cacfc0c) |
| 12:54 | Owner sets ৳500 aside for the rent (instant) | done | [0xc3dc1078…](https://sepolia.basescan.org/tx/0xc3dc1078d0f6e69070dd39b6319cb599dff90f9312ab21425001cd83f1972588) |
| 12:56 | Waiting period over: the rent payee is applied | done | [0x1b81884b…](https://sepolia.basescan.org/tx/0x1b81884b0f32792e6101a64c41091e2fb486719cedecd92895533738586e9e2e) |
| 12:57 | Bunbun makes the weekly ৳200 recurring buy | done | [0x270394e7…](https://sepolia.basescan.org/tx/0x270394e7438e7d79d480ec7521726b249e6e4ed8a98f4937b45fc7c73100aae0) |
| 12:57 | Bunbun pays the shared rent on time, to the approved payee | done | [0x28254010…](https://sepolia.basescan.org/tx/0x28254010cc1f7c1968b6c9635a5c36dbccf017ea13117396b2d03497c5f417f7) |
| 12:57 | Bunbun rebalances toward the plan | done | [0x0950a988…](https://sepolia.basescan.org/tx/0x0950a988fcb76886279e0b0ce3c5eac9c390f67ac0b1d459b7acefcabbc0e8d0) |
| 12:58 | Compromised agent (real agent key, no checks): put all the cash into the token that is pumping | refused by the contract: `AssetNotAllowed` | [0xdfea98ca…](https://sepolia.basescan.org/tx/0xdfea98ca0626b540bc8d812821982396e8f833939bccefcdc9dc9a847e6eb975) |
| 12:58 | Compromised agent (real agent key, no checks): put all the cash into the index fund in one trade | refused by the contract: `ExceedsTradeLimit` | [0xeb7cbc01…](https://sepolia.basescan.org/tx/0xeb7cbc019856385d51fd627946b693de1e23b58a28024dcfa5e04c7913ea86a2) |
| 12:58 | Compromised agent (real agent key, no checks): send the cash to the attacker | refused by the contract: `NotOwner` | [0xf8a71cec…](https://sepolia.basescan.org/tx/0xf8a71cec8604350cec1dee5abd06a248ea03c695382bd67da6c90c15e9b0b380) |
| 12:58 | Compromised agent (real agent key, no checks): sign its own approval for a trade above the limits | refused by the contract: `BadApproval` | [0x84beae44…](https://sepolia.basescan.org/tx/0x84beae442e2832d4e94f99e54f52c9ad38e24d9a72b5b50033a3668d77a31ceb) |
| 12:58 | Compromised agent (real agent key, no checks): point withdrawals at the attacker's address | refused by the contract: `NotOwner` | [0x493a0c48…](https://sepolia.basescan.org/tx/0x493a0c485b03a723b34fd6aeac5940c7690ae8e062db5f2a10f46a48f42ea9b3) |
| 12:59 | Compromised agent (real agent key, no checks): rewrite the mandate with no limits | refused by the contract: `NotOwner` | [0xad17eb54…](https://sepolia.basescan.org/tx/0xad17eb546b6dde7a829c0782d78f209bd17ccf976e05c4239f15890417563fde) |
| 12:59 | Compromised agent (real agent key, no checks): switch off the stop-loss | refused by the contract: `NotOwnerOrGuardian` | [0x8165a4d8…](https://sepolia.basescan.org/tx/0x8165a4d8afed0a54aff5689e76d94f15096c0092ca9b0f9a2fe2658ed52973dd) |
| 12:59 | Compromised agent (real agent key, no checks): give itself a new key with a longer life | refused by the contract: `NotOwner` | [0x0c767ab2…](https://sepolia.basescan.org/tx/0x0c767ab2307c7849ea7bbbee1d11a551e0ac7d59e4c4a6fc42ca265f4c4b17e3) |
| 12:59 | Compromised agent (real agent key, no checks): remove the trusted contact | refused by the contract: `NotOwner` | [0x099d875e…](https://sepolia.basescan.org/tx/0x099d875e51663a62797f31c7ed0abe8e437c327b182b0d6d980863904231405b) |
| 12:59 | Compromised agent (real agent key, no checks): make one more trade today, after the day's allowance is used or buying is paused | refused by the contract: `ExceedsDailyVolume` | [0x4570c0a2…](https://sepolia.basescan.org/tx/0x4570c0a299eda7f58f75e66d25b4846224b3461737a7b565650444c09704943a) |
| 13:01 | Keeper (no AI) fires the stop-loss; protect mode starts | done | [0x208cba8e…](https://sepolia.basescan.org/tx/0x208cba8e39f7274a134ce35cecb3cad0a44ef721dc6e179473994d2b81e4ad57) |
| 13:03 | Owner asks to triple the daily loss limit (4% to 12%): queued, not applied | done | [0xdebd6607…](https://sepolia.basescan.org/tx/0xdebd6607523f9e02be2838bebe6e14a304f8f11fd5b3d08b2fd52dfcfccf501d) |
| 13:03 | Owner asks to switch the stop-loss off: queued, not applied | done | [0xbb1d2f7a…](https://sepolia.basescan.org/tx/0xbb1d2f7a5ee47ef324f0007d4dafef1daf4b3b09083c1fd77900c3d6ba8ed32a) |
| 13:03 | Trusted contact cancels the waiting change (loss limit) | done | [0xcb745988…](https://sepolia.basescan.org/tx/0xcb74598886be712509dffb2a9477e980e43fdc1494f2b74e683d5f6a99caf25d) |
| 13:05 | Trusted contact cancels the waiting change (stop-loss off) | done | [0xd29ec714…](https://sepolia.basescan.org/tx/0xd29ec714a205c04442068c2eb593d6125d4e15509bdae422bbe38d07ab1bc5a9) |
| 13:08 | Owner asks to triple the daily loss limit (4% to 12%): queued, not applied | done | [0xb0eb64cf…](https://sepolia.basescan.org/tx/0xb0eb64cfa2140dd358c9be58ce0f9032312679cb164ed7b0474d88203efd3598) |
| 13:08 | Owner asks to switch the stop-loss off: queued, not applied | done | [0x9a9fb339…](https://sepolia.basescan.org/tx/0x9a9fb3394a48d676c13c64e54428c9030bc0ddb9a34e1efdcdf3f8a5a724399b) |
| 13:08 | Trusted contact cancels the waiting change (loss limit) | done | [0x78a87fe2…](https://sepolia.basescan.org/tx/0x78a87fe29a0602ebdb682756880a6d02e6f5665b764e741f5c475830e1956ef7) |
| 13:08 | Trusted contact cancels the waiting change (stop-loss off) | done | [0xea23cf46…](https://sepolia.basescan.org/tx/0xea23cf4625ca93d13ee12c9d3f2e882ebcf669971ec231bda77190601b03d9b3) |
