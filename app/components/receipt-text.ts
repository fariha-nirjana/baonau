// Receipt and event sentences in each language, for display only. The app
// stores and the model reads the English source sentence (first column); the
// screens match it against these templates and show the chosen language.
// {braces} stand for whatever the source filled in there; the names are only
// labels and only have to agree within one row. Rows that do not match fall
// back to the English as stored.
// Columns: source English, English shown, Bangla, Chinese.
export const RECEIPT_TEXT: [string, string, string, string][] = [
  // lib/risk.ts 134:1
  ["{symbol} is not a token this vault knows.", "{symbol} isn't recognized by this vault.", "এই ভল্টে {symbol} চেনা নেই।", "此金库不识别 {symbol}。"],
  // lib/risk.ts 143:1
  ["{name} is on the scam token list: {label}.", "{name} appears on the scam-token list: {label}.", "{name} প্রতারণার টোকেন তালিকায় আছে: {label}।", "{name} 在诈骗代币名单上：{label}。"],
  // lib/risk.ts 143:2
  ["{name} is not on the scam token list.", "{name} isn't on the scam-token list.", "{name} প্রতারণার টোকেন তালিকায় নেই।", "{name} 不在诈骗代币名单上。"],
  // lib/risk.ts 150:1
  ["{name} is in the mandate.", "{name} is approved in your mandate.", "আপনার ম্যান্ডেটে {name} অনুমোদিত।", "{name} 已获你的投资授权允许。"],
  // lib/risk.ts 151:1
  ["The amount must be more than zero.", "Enter an amount greater than zero.", "শূন্যের বেশি পরিমাণ দিন।", "请输入大于零的金额。"],
  // lib/risk.ts 155:1
  ["The price of {name} is out of date, so it is not safe to trade on.", "The price for {name} needs updating before this trade can proceed.", "এই ট্রেডের আগে {name}-এর দামের নতুন তথ্য দরকার।", "此交易需要先更新 {name} 的价格。"],
  // lib/risk.ts 156:1
  ["Priced at {price}, updated {priceUpdatedAt}.", "Price: {price}. Last updated: {priceUpdatedAt}.", "দাম: {price}। শেষ হালনাগাদ: {priceUpdatedAt}।", "价格：{price}。最近更新：{priceUpdatedAt}。"],
  // lib/risk.ts 164:1
  ["Buying is paused until {cooldownUntil} after a loss trigger. Selling still works.", "Buying is paused until {cooldownUntil} after a loss trigger. Selling remains subject to the other rules.", "ক্ষতির ট্রিগারের পর {cooldownUntil} পর্যন্ত কেনা বন্ধ। অন্য নিয়ম মেনে বিক্রি করা যায়।", "亏损触发后，买入暂停至 {cooldownUntil}。卖出仍须遵守其他规则。"],
  // lib/risk.ts 165:1
  ["The portfolio is down {lossPct}% today, at or past the {dailyLossPct}% daily loss limit, so buying is paused.", "Today's portfolio loss is {lossPct}%, reaching the {dailyLossPct}% daily loss limit. Buying is paused.", "আজ পোর্টফোলিওর ক্ষতি {lossPct}%, যা {dailyLossPct}% দৈনিক ক্ষতির সীমায় পৌঁছেছে। কেনা থেমে আছে।", "今日组合亏损 {lossPct}%，已达到 {dailyLossPct}% 的每日亏损上限，买入已暂停。"],
  // lib/risk.ts 166:1
  ["Down {lossPct}% today, under the {dailyLossPct}% limit, and no cooldown is running.", "Today's loss is {lossPct}%, below the {dailyLossPct}% limit. No cooldown is active.", "আজ ক্ষতি {lossPct}%, {dailyLossPct}% সীমার নিচে। এখন কোনো বিরতি চলছে না।", "今日亏损 {lossPct}%，低于 {dailyLossPct}% 的上限，当前没有冷却期。"],
  // lib/risk.ts 172:1
  ["{name} is at {price}, at or below its stop price of {stop}.", "{name} is priced at {price}, at or below its {stop} stop-loss trigger.", "{name}-এর দাম {price}, যা {stop} স্টপ-লস ট্রিগারের সমান বা নিচে।", "{name} 当前价格为 {price}，等于或低于止损触发价 {stop}。"],
  // lib/risk.ts 173:1
  ["No stop price is set for this asset.", "No stop-loss price is set for this asset.", "এই সম্পদের স্টপ-লসের দাম ঠিক করা নেই।", "此资产未设止损价。"],
  // lib/risk.ts 173:2
  ["At {price}, above its stop price of {stop}.", "Current price: {price}, above the {stop} stop-loss trigger.", "এখন দাম {price}, {stop} স্টপ-লস ট্রিগারের ওপরে।", "当前价格 {price}，高于止损触发价 {stop}。"],
  // lib/risk.ts 175:1
  ["There is {cash} in cash, less than the {usd} this needs.", "This needs {usd}, but only {cash} is available in cash.", "এতে {usd} দরকার, কিন্তু নগদ আছে {cash}।", "此操作需要 {usd}，但可用现金只有 {cash}。"],
  // lib/risk.ts 175:2
  ["{cash} in cash.", "Available cash: {cash}.", "ব্যবহারের জন্য খালি নগদ: {cash}।", "可用现金：{cash}。"],
  // lib/risk.ts 180:1
  ["This would make {name} {round(after)}% of the portfolio. The mandate allows at most {maxExposurePct}%.", "This would put {name} at {round(after)}% of your portfolio, above the {maxExposurePct}% cap.", "এতে পোর্টফোলিওতে {name}-এর অংশ হবে {round(after)}%, যা {maxExposurePct}% সীমার ওপরে।", "此操作会使 {name} 占组合的 {round(after)}%，超过 {maxExposurePct}% 的上限。"],
  // lib/risk.ts 181:1
  ["{name} would be {round(after)}% of the portfolio, within its {maxExposurePct}% cap.", "{name} would be {round(after)}% of your portfolio, within its {maxExposurePct}% cap.", "পোর্টফোলিওতে {name}-এর অংশ হবে {round(after)}%, {maxExposurePct}% সীমার মধ্যে।", "{name} 将占组合的 {round(after)}%，在 {maxExposurePct}% 的上限内。"],
  // lib/risk.ts 184:1
  ["{name} is a defensive asset, so buying it does not lower the defensive share.", "{name} counts as defensive, so buying it doesn't reduce the defensive share.", "{name} ঝুঁকি সামলানোর সম্পদ হিসেবে ধরা হয়, তাই এটি কিনলে সেই অংশ কমে না।", "{name} 计为防御型资产，买入它不会降低防御型资产比例。"],
  // lib/risk.ts 190:1
  ["This would leave {round(defensiveAfter)}% in cash and defensive assets. The mandate requires at least {minDefensivePct}%.", "This would leave {round(defensiveAfter)}% in cash and defensive assets. Your rules require at least {minDefensivePct}%.", "এতে নগদ ও ঝুঁকি সামলানোর সম্পদে {round(defensiveAfter)}% থাকবে। আপনার নিয়মে অন্তত {minDefensivePct}% দরকার।", "此操作后，现金和防御型资产占比将为 {round(defensiveAfter)}%，规则要求至少 {minDefensivePct}%。"],
  // lib/risk.ts 191:1
  ["{round(defensiveAfter)}% would stay in cash and defensive assets, above the {minDefensivePct}% minimum.", "Cash and defensive assets would remain at {round(defensiveAfter)}%, meeting the {minDefensivePct}% minimum.", "নগদ ও ঝুঁকি সামলানোর সম্পদে {round(defensiveAfter)}% থাকবে, যা ন্যূনতম {minDefensivePct}% পূরণ করে।", "现金和防御型资产将保持 {round(defensiveAfter)}%，满足 {minDefensivePct}% 的最低要求。"],
  // lib/risk.ts 196:1
  ["The vault holds {money(held)} of {name}, less than this sale.", "The vault holds {money(held)} of {name}, less than this sale requires.", "ভল্টে {money(held)}-এর {name} আছে, এই বিক্রির জন্য যথেষ্ট নয়।", "金库持有 {money(held)} 的 {name}，不足以完成此次卖出。"],
  // lib/risk.ts 196:2
  ["The vault holds {money(held)} of {name}.", "The vault holds {money(held)} of {name}.", "ভল্টে {money(held)}-এর {name} আছে।", "金库持有 {money(held)} 的 {name}。"],
  // lib/risk.ts 205:1
  ["{usd} is above the limit for one trade ({maxTradePct}% of the portfolio, {money(maxTrade)} now).", "{usd} exceeds the single-trade limit of {maxTradePct}% of the portfolio ({money(maxTrade)} now).", "{usd} এক ট্রেডের সীমার বেশি। সীমা পোর্টফোলিওর {maxTradePct}%, এখন {money(maxTrade)}।", "{usd} 超过单笔上限：组合的 {maxTradePct}%，当前为 {money(maxTrade)}。"],
  // lib/risk.ts 206:1
  ["Within the limit for one trade ({maxTradePct}% of the portfolio, {money(maxTrade)} now).", "Within the single-trade limit: {maxTradePct}% of the portfolio ({money(maxTrade)} now).", "এক ট্রেডের সীমার মধ্যে: পোর্টফোলিওর {maxTradePct}%, এখন {money(maxTrade)}।", "在单笔上限内：组合的 {maxTradePct}%，当前为 {money(maxTrade)}。"],
  // lib/risk.ts 215:1
  ["Lifted for this one trade by the owner's signed approval.", "Lifted for this trade only, using your signed approval.", "আপনার সই করা অনুমোদনে শুধু এই ট্রেডের জন্য শিথিল করা হয়েছে।", "凭你签署的批准，仅对此笔交易放宽。"],
  // lib/risk.ts 216:1
  ["Lifted for this one trade by the owner's signed approval.", "Lifted for this trade only, using your signed approval.", "আপনার সই করা অনুমোদনে শুধু এই ট্রেডের জন্য শিথিল করা হয়েছে।", "凭你签署的批准，仅对此笔交易放宽。"],
  // lib/risk.ts 224:2
  ["No recent price history to compare against.", "No recent price history is available for comparison.", "তুলনা করার মতো সাম্প্রতিক দামের তথ্য নেই।", "暂无近期价格记录可供比较。"],
  // lib/risk.ts 232:1
  ["The portfolio is already down {lossPct}% today. Adding risk after a loss needs your confirmation.", "Your portfolio is already down {lossPct}% today. Adding risk now needs your confirmation.", "আজ পোর্টফোলিও {lossPct}% কমেছে। এখন ঝুঁকি বাড়াতে আপনার অনুমোদন দরকার।", "你的组合今日已下跌 {lossPct}%，现在增加风险需要你确认。"],
  // lib/risk.ts 233:1
  ["Down {lossPct}% today, less than half the daily loss limit.", "Today's loss is {lossPct}%, below half the daily loss limit.", "আজ ক্ষতি {lossPct}%, যা দৈনিক ক্ষতির সীমার অর্ধেকের নিচে।", "今日亏损 {lossPct}%，低于每日亏损上限的一半。"],
  // lib/risk.ts 245:1
  ["There is no signed mandate yet, so the agent cannot trade.", "Sign a mandate before the agent can trade.", "এজেন্ট ট্রেড শুরু করার আগে ম্যান্ডেটে সই করুন।", "代理开始交易前，需要先签署投资授权。"],
  // lib/risk.ts 245:2
  ["Signed and in force.", "Signed and active.", "সই করা ও কার্যকর।", "已签署并生效。"],
  // lib/risk.ts 251:1
  ["The agent is paused.", "The agent is paused.", "এজেন্ট থেমে আছে।", "代理已暂停。"],
  // lib/risk.ts 251:2
  ["The agent has no key. The owner must issue one, and a new key waits out the delay.", "The agent needs a new key from the owner. A new key must wait before it can be used.", "এজেন্টের নতুন কী মালিককে দিতে হবে। ব্যবহার করার আগে অপেক্ষা লাগবে।", "代理需要所有者签发新密钥，新密钥须等待后才能使用。"],
  // lib/risk.ts 251:3
  ["The agent's session key has expired.", "The agent's session key has expired.", "এজেন্টের সেশন কী-র মেয়াদ শেষ।", "代理会话密钥已过期。"],
  // lib/risk.ts 261:1
  ["{length} trades in the last 10 minutes. That is churning, and each trade costs a fee, so trading is paused for now.", "There were {length} trades in the last 10 minutes. Trading is paused to limit repeated trades and fees.", "গত 10 মিনিটে {length}টি ট্রেড হয়েছে। ঘন ঘন ট্রেড ও ফি সীমিত রাখতে আপাতত ট্রেড থেমেছে।", "过去 10 分钟内交易了 {length} 次，现已暂停交易，以限制反复交易和手续费。"],
  // lib/risk.ts 262:1
  ["{length} trades in the last 10 minutes.", "{length} trades in the last 10 minutes.", "গত 10 মিনিটে {length}টি ট্রেড।", "过去 10 分钟内有 {length} 笔交易。"],
  // lib/risk.ts 270:1
  ["This trade was prompted by news or other outside text, not by you or by your plan, so you must confirm it.", "This trade came from outside information, rather than you or your plan. It needs your confirmation.", "এই ট্রেডের উৎস বাইরের তথ্য, আপনি বা আপনার পরিকল্পনা নয়। আপনার অনুমোদন দরকার।", "此交易源于外部信息，而非你或你的计划，需要你确认。"],
  // lib/risk.ts 271:1
  ["Prompted by the investor or by the plan.", "Requested by you or your plan.", "আপনার বা আপনার পরিকল্পনার অনুরোধ।", "由你或你的计划发起。"],
  // lib/risk.ts 282:1
  ["There is nothing to trade.", "No trade is needed.", "কোনো ট্রেডের দরকার নেই।", "无需交易。"],
  // lib/risk.ts 325:1
  ["There is no signed mandate yet, so the agent cannot pay anything.", "Sign a mandate before the agent can make payments.", "এজেন্ট পেমেন্ট করার আগে ম্যান্ডেটে সই করুন।", "代理付款前，需要先签署投资授权。"],
  // lib/risk.ts 325:2
  ["Signed and in force.", "Signed and active.", "সই করা ও কার্যকর।", "已签署并生效。"],
  // lib/risk.ts 327:1
  ["The agent has no key.", "The agent has no key.", "এজেন্টের কী নেই।", "代理没有密钥。"],
  // lib/risk.ts 327:2
  ["The agent's key is live.", "The agent's key is active.", "এজেন্টের কী সক্রিয়।", "代理密钥有效。"],
  // lib/risk.ts 331:1
  ["This payment was prompted by outside text, not by you or a schedule you set, so you must confirm it.", "This payment came from outside information, not from you or your schedule. It needs your confirmation.", "এই পেমেন্টের উৎস বাইরের তথ্য, আপনি বা আপনার সময়সূচি নয়। আপনার অনুমোদন দরকার।", "此付款源于外部信息，而非你或你设置的计划，需要你确认。"],
  // lib/risk.ts 332:1
  ["Asked for by you or by a schedule you set.", "Requested by you or a schedule you set.", "আপনার বা আপনার নির্ধারিত সময়সূচির অনুরোধ।", "由你或你设置的时间安排发起。"],
  // lib/risk.ts 337:1
  ["This commitment is not active, so nothing can be paid from it.", "This payment setup isn't active yet.", "এই পেমেন্টের ব্যবস্থা এখনো চালু হয়নি।", "此付款设置尚未生效。"],
  // lib/risk.ts 337:2
  ["This is money set aside with nobody to pay.", "This is a savings reserve with no payee. It can't make payments.", "এটি প্রাপক ছাড়া আলাদা রাখা সঞ্চয়। এখান থেকে পেমেন্ট করা যায় না।", "这是未设收款方的储蓄预留，不能用于付款。"],
  // lib/risk.ts 338:1
  ["Active, with an approved payee.", "Active, with an approved payee.", "চালু আছে, প্রাপকও অনুমোদিত।", "已生效，收款方已获批。"],
  // lib/risk.ts 342:1
  ["The amount must be more than zero.", "Enter an amount greater than zero.", "শূন্যের বেশি পরিমাণ দিন।", "请输入大于零的金额。"],
  // lib/risk.ts 359:1
  ["It is not due yet: {agent} may pay it from {payableFrom}. You can pay it early yourself.", "Not due yet. {agent} may pay from {payableFrom}. You can choose to pay early yourself.", "এখনো দেওয়ার সময় হয়নি। {agent} {payableFrom} থেকে দিতে পারবে। চাইলে আপনি নিজে আগে পরিশোধ করতে পারেন।", "尚未到付款时间。{agent} 可从 {payableFrom} 起付款。你也可以自行提前支付。"],
  // lib/risk.ts 360:1
  ["Due {nextDue}.", "Due: {nextDue}.", "দেওয়ার তারিখ: {nextDue}।", "到期日：{nextDue}。"],
  // lib/errors.ts 21:1
  ["Only the owner key can do this. The agent key cannot.", "This needs the owner key. The agent key can't authorize it.", "এতে মালিকের কী দরকার। এজেন্টের কী দিয়ে অনুমতি দেওয়া যায় না।", "此操作需要所有者密钥，代理密钥无权授权。"],
  // lib/errors.ts 22:1
  ["Only the owner or the trusted contact can do this.", "Only the owner or trusted contact can do this.", "এটি শুধু মালিক বা বিশ্বস্ত ব্যক্তি করতে পারেন।", "只有所有者或信任联系人能执行此操作。"],
  // lib/errors.ts 23:1
  ["This key is not the vault's agent key.", "This isn't the agent key assigned to this vault.", "এটি এই ভল্টের নির্ধারিত এজেন্ট কী নয়।", "此密钥不是分配给该金库的代理密钥。"],
  // lib/errors.ts 24:1
  ["Only the vault itself can end its mandate.", "Only the vault itself can end its mandate.", "শুধু ভল্ট নিজেই তার ম্যান্ডেট শেষ করতে পারে।", "只有金库自身可以终止其投资授权。"],
  // lib/errors.ts 25:1
  ["The agent's session key has expired. The owner must issue a new one.", "The agent key has expired. The owner needs to issue a new one.", "এজেন্ট কী-র মেয়াদ শেষ। মালিককে নতুন কী দিতে হবে।", "代理密钥已过期，需要所有者签发新密钥。"],
  // lib/errors.ts 26:1
  ["The agent is paused.", "The agent is paused.", "এজেন্ট থেমে আছে।", "代理已暂停。"],
  // lib/errors.ts 27:1
  ["The first mandate is already signed. Later changes go through the normal rules.", "The first mandate is already signed. Further changes follow the usual change rules.", "প্রথম ম্যান্ডেটে সই হয়ে গেছে। পরের পরিবর্তনে স্বাভাবিক পরিবর্তনের নিয়ম প্রযোজ্য।", "首份投资授权已签署，后续修改须遵循常规变更规则。"],
  // lib/errors.ts 28:1
  ["This is not the owner's first vault, so its first mandate can only be signed from {when(a[0])}.", "This isn't the owner's first vault. Signing becomes available from {when(a[0])}.", "এটি মালিকের প্রথম ভল্ট নয়। {when(a[0])} থেকে সই করা যাবে।", "这不是所有者的第一个金库，可从 {when(a[0])} 起签署。"],
  // lib/errors.ts 29:1
  ["That address is empty.", "Enter an address.", "একটি ঠিকানা দিন।", "请输入地址。"],
  // lib/errors.ts 30:1
  ["The amount must be more than zero.", "Enter an amount greater than zero.", "শূন্যের বেশি পরিমাণ দিন।", "请输入大于零的金额。"],
  // lib/errors.ts 31:1
  ["That address cannot be used for this role.", "This address can't be used for that role.", "এই ভূমিকায় এই ঠিকানা ব্যবহার করা যায় না।", "此地址不能用于该角色。"],
  // lib/errors.ts 32:1
  ["The agent key's expiry must be in the future and at most 90 days away.", "Choose a key expiry in the future, within the next 90 days.", "কী-র মেয়াদ শেষ হওয়ার সময় দিন, এখন থেকে আগামী 90 দিনের মধ্যে।", "请选择未来 90 天内的密钥到期时间。"],
  // lib/errors.ts 33:1
  ["Those mandate values are outside what the mandate accepts.", "Some mandate values are outside the allowed range. Review the terms and try again.", "ম্যান্ডেটের কিছু মান অনুমোদিত সীমার বাইরে। শর্ত দেখে আবার চেষ্টা করুন।", "部分投资授权数值超出允许范围，请检查条款后重试。"],
  // lib/errors.ts 34:1
  ["The waiting period must be between one minute and 30 days.", "Choose a waiting period between one minute and 30 days.", "এক মিনিট থেকে 30 দিনের মধ্যে অপেক্ষার সময় দিন।", "请选择一分钟至 30 天之间的等待期。"],
  // lib/errors.ts 35:1
  ["The trusted contact cannot cancel their own removal or replacement.", "A trusted contact can't cancel their own removal or replacement.", "বিশ্বস্ত ব্যক্তি নিজের অপসারণ বা বদলি বাতিল করতে পারেন না।", "信任联系人不能取消对自己的移除或替换。"],
  // lib/errors.ts 36:1
  ["This is not an approval the owner signed for exactly this trade on this vault.", "This approval doesn't match the owner's signature for this exact trade and vault.", "এই নির্দিষ্ট ট্রেড ও ভল্টের জন্য মালিকের সইয়ের সাথে অনুমোদনটি মিলছে না।", "此批准与所有者为这笔指定交易和金库所签署的内容不匹配。"],
  // lib/errors.ts 37:1
  ["Approval {a[0]} has already been used or cancelled. Each approval works once.", "Approval {a[0]} was already used or cancelled. Approvals work once.", "অনুমোদন {a[0]} ব্যবহার বা বাতিল হয়ে গেছে। এক অনুমোদন একবারই ব্যবহার করা যায়।", "批准 {a[0]} 已使用或取消。每项批准只能使用一次。"],
  // lib/errors.ts 38:1
  ["This approval is only valid from {when(a[0])} to {when(a[1])}.", "This approval is valid only from {when(a[0])} to {when(a[1])}.", "এই অনুমোদন শুধু {when(a[0])} থেকে {when(a[1])} পর্যন্ত কার্যকর।", "此批准仅在 {when(a[0])} 至 {when(a[1])} 期间有效。"],
  // lib/errors.ts 39:1
  ["An approval may be valid for one hour at most.", "An approval can stay valid for up to one hour.", "এক অনুমোদনের মেয়াদ সর্বোচ্চ এক ঘণ্টা হতে পারে।", "批准的有效期最长为一小时。"],
  // lib/errors.ts 40:1
  ["The vault cannot list more assets.", "This vault has reached its asset-list limit.", "এই ভল্টে সম্পদের তালিকার সীমা পূর্ণ হয়েছে।", "此金库已达到资产列表数量上限。"],
  // lib/errors.ts 41:1
  ["That is too many trades for one transaction.", "Too many trades in one transaction. Use fewer trades.", "এক লেনদেনে বেশি ট্রেড আছে। ট্রেডের সংখ্যা কমান।", "单次交易包含的买卖操作过多，请减少数量。"],
  // lib/errors.ts 42:1
  ["The cash token cannot be listed as an investment.", "The cash token can't be added as an investment asset.", "নগদের টোকেন বিনিয়োগের সম্পদ হিসেবে যোগ করা যায় না।", "现金代币不能添加为投资资产。"],
  // lib/errors.ts 43:1
  ["{asset(a[0])} has never been in the mandate, so there is nothing to sell.", "{asset(a[0])} has never been in this mandate, so it can't be sold here.", "{asset(a[0])} এই ম্যান্ডেটে কখনো ছিল না, তাই এখানে বিক্রি করা যায় না।", "{asset(a[0])} 从未列入此投资授权，无法在此卖出。"],
  // lib/errors.ts 44:1
  ["{asset(a[0])} is not in the mandate, so the agent cannot buy it.", "{asset(a[0])} isn't approved in the mandate. The agent can't buy it.", "ম্যান্ডেটে {asset(a[0])} অনুমোদিত নয়। এজেন্ট এটি কিনতে পারে না।", "{asset(a[0])} 未获投资授权允许，代理不能买入。"],
  // lib/errors.ts 45:1
  ["The price of {asset(a[0])} was last updated {when(a[1])}, which is too old to trade on.", "The price for {asset(a[0])} was last updated {when(a[1])}. It needs refreshing before trading.", "{asset(a[0])}-এর দাম শেষ হালনাগাদ হয়েছে {when(a[1])}। ট্রেডের আগে নতুন তথ্য দরকার।", "{asset(a[0])} 的价格最近更新于 {when(a[1])}，交易前需要刷新。"],
  // lib/errors.ts 46:1
  ["{usd(a[0])} is above the limit for a single trade, which is {usd(a[1])} right now.", "{usd(a[0])} exceeds the current single-trade limit of {usd(a[1])}.", "{usd(a[0])} এখনকার এক ট্রেডের সীমা {usd(a[1])}-এর বেশি।", "{usd(a[0])} 超过当前单笔上限 {usd(a[1])}。"],
  // lib/errors.ts 47:1
  ["{usd(a[0])} is more than the {usd(a[1])} of trading left for today.", "{usd(a[0])} exceeds the {usd(a[1])} left in today's trading allowance.", "{usd(a[0])} আজকের বাকি ট্রেডের অনুমোদিত পরিমাণ {usd(a[1])}-এর বেশি।", "{usd(a[0])} 超过今日剩余额度 {usd(a[1])}。"],
  // lib/errors.ts 48:1
  ["This would make {asset(a[0])} {pct(a[1])} of the portfolio. The mandate allows at most {pct(a[2])}.", "This would put {asset(a[0])} at {pct(a[1])} of the portfolio, above the {pct(a[2])} cap.", "এতে পোর্টফোলিওতে {asset(a[0])}-এর অংশ হবে {pct(a[1])}, যা {pct(a[2])} সীমার ওপরে।", "此操作会使 {asset(a[0])} 占组合的 {pct(a[1])}，超过 {pct(a[2])} 的上限。"],
  // lib/errors.ts 49:1
  ["The portfolio is down {pct(a[0])} today, at or past the {pct(a[1])} daily loss limit, so buying is blocked.", "Today's loss is {pct(a[0])}, reaching the {pct(a[1])} daily loss limit. Buying is blocked.", "আজ ক্ষতি {pct(a[0])}, যা {pct(a[1])} দৈনিক ক্ষতির সীমায় পৌঁছেছে। কেনা বন্ধ।", "今日亏损 {pct(a[0])}，已达到 {pct(a[1])} 的每日亏损上限，买入被阻止。"],
  // lib/errors.ts 50:1
  ["This would leave {pct(a[0])} in cash and defensive assets. The mandate requires at least {pct(a[1])}.", "This leaves {pct(a[0])} in cash and defensive assets, below the required {pct(a[1])}.", "এতে নগদ ও ঝুঁকি সামলানোর সম্পদে {pct(a[0])} থাকে, যা দরকারি {pct(a[1])}-এর নিচে।", "此操作后现金和防御型资产占比为 {pct(a[0])}，低于要求的 {pct(a[1])}。"],
  // lib/errors.ts 51:1
  ["The stop-loss is halted until {when(a[0])}.", "The stop-loss is halted until {when(a[0])}.", "স্টপ-লস {when(a[0])} পর্যন্ত স্থগিত।", "止损暂停至 {when(a[0])}。"],
  // lib/errors.ts 52:1
  ["Buying is blocked until {when(a[0])} after a loss trigger. Selling still works.", "Buying is paused until {when(a[0])} after a loss trigger. Selling still follows the other rules.", "ক্ষতির ট্রিগারের পর {when(a[0])} পর্যন্ত কেনা বন্ধ। বিক্রিতে অন্য নিয়ম কার্যকর।", "亏损触发后，买入暂停至 {when(a[0])}。卖出仍须遵守其他规则。"],
  // lib/errors.ts 53:1
  ["{asset(a[0])} is at {price(a[1])}, at or below its stop price of {price(a[2])}, so it cannot be bought.", "{asset(a[0])} is at {price(a[1])}, at or below its {price(a[2])} stop-loss trigger. Buying is blocked.", "{asset(a[0])}-এর দাম {price(a[1])}, {price(a[2])} স্টপ-লস ট্রিগারের সমান বা নিচে। কেনা বন্ধ।", "{asset(a[0])} 价格为 {price(a[1])}，等于或低于止损触发价 {price(a[2])}，买入被阻止。"],
  // lib/errors.ts 54:1
  ["{asset(a[0])} is at {price(a[1])}, above its stop price of {price(a[2])}.", "{asset(a[0])} is priced at {price(a[1])}, above its {price(a[2])} stop-loss trigger.", "{asset(a[0])}-এর দাম {price(a[1])}, {price(a[2])} স্টপ-লস ট্রিগারের ওপরে।", "{asset(a[0])} 价格为 {price(a[1])}，高于止损触发价 {price(a[2])}。"],
  // lib/errors.ts 55:1
  ["The vault holds no {asset(a[0])}.", "The vault doesn't hold any {asset(a[0])}.", "ভল্টে কোনো {asset(a[0])} নেই।", "金库没有持有 {asset(a[0])}。"],
  // lib/errors.ts 56:1
  ["The vault holds less than this trade needs (asked for {a[1]}, available {a[2]}, in the token's smallest units).", "Not enough of this asset. Requested: {a[1]}; available: {a[2]} (smallest token units).", "এই সম্পদ যথেষ্ট নেই। চাওয়া হয়েছে: {a[1]}; আছে: {a[2]} (টোকেনের ক্ষুদ্রতম এককে)।", "此资产余额不足。请求：{a[1]}；可用：{a[2]}（代币最小单位）。"],
  // lib/errors.ts 57:1
  ["The exchange offered a worse price than the mandate accepts.", "The exchange price is outside your mandate's allowed price difference.", "এক্সচেঞ্জের দাম ম্যান্ডেটের অনুমোদিত পার্থক্যের বাইরে।", "交易所报价超出投资授权允许的价差。"],
  // lib/errors.ts 58:1
  ["There is no change waiting.", "No change is waiting.", "কোনো পরিবর্তন অপেক্ষায় নেই।", "没有待生效的变更。"],
  // lib/errors.ts 59:1
  ["This change raises the risk, so it waits. It can be applied from {when(a[0])}, unless the trusted contact cancels it.", "This raises risk and must wait until {when(a[0])}. Your trusted contact can cancel it during the wait.", "এতে ঝুঁকি বাড়ে, তাই {when(a[0])} পর্যন্ত অপেক্ষা লাগবে। এ সময় আপনার বিশ্বস্ত ব্যক্তি বাতিল করতে পারেন।", "此变更提高风险，须等待至 {when(a[0])}。等待期间，信任联系人可以取消。"],
  // lib/errors.ts 61:1
  ["Only the oracle's updater key can set prices.", "Only the authorized price-updater key can set prices.", "শুধু অনুমোদিত দাম হালনাগাদের কী দিয়ে দাম ঠিক করা যায়।", "只有获授权的价格更新密钥可以设置价格。"],
  // lib/errors.ts 62:1
  ["The oracle has no price for that token.", "No price is available for this token from the oracle.", "ওরাকলে এই টোকেনের দাম নেই।", "预言机暂无此代币的价格。"],
  // lib/errors.ts 63:1
  ["That price was just updated. The next update is allowed from {when(a[1])}.", "The price was updated recently. The next update is allowed from {when(a[1])}.", "একটু আগেই দাম হালনাগাদ হয়েছে। পরের আপডেট {when(a[1])} থেকে করা যাবে।", "价格刚更新过，下次可从 {when(a[1])} 起更新。"],
  // lib/errors.ts 64:1
  ["The oracle refused a price of {price(a[1])}. One update may only move it between {price(a[2])} and {price(a[3])}.", "Price {price(a[1])} was rejected. This update must stay between {price(a[2])} and {price(a[3])}.", "{price(a[1])} দাম গ্রহণ করা হয়নি। এই আপডেটে দাম {price(a[2])} থেকে {price(a[3])}-এর মধ্যে থাকতে হবে।", "价格 {price(a[1])} 被拒绝，本次更新必须在 {price(a[2])} 至 {price(a[3])} 之间。"],
  // lib/errors.ts 66:1
  ["The exchange could not fill the trade at the minimum the vault asked for.", "The exchange couldn't meet the vault's minimum execution amount.", "এক্সচেঞ্জ ভল্টের চাওয়া ন্যূনতম পরিমাণ দিতে পারেনি।", "交易所无法满足金库要求的最低成交数量。"],
  // lib/owner-actions.ts 81:1
  ["There is no draft {id}.", "Draft {id} couldn't be found.", "খসড়া {id} পাওয়া যায়নি।", "找不到草稿 {id}。"],
  // lib/owner-actions.ts 82:1
  ["Draft {id} is already {status}.", "Draft {id} is already {status}.", "খসড়া {id} ইতিমধ্যেই {status}।", "草稿 {id} 已处于 {status} 状态。"],
  // lib/owner-actions.ts 146:1
  ["Waiting period over: {what}", "Waiting period complete: {what}", "অপেক্ষার সময় শেষ: {what}", "等待期已结束：{what}"],
  // lib/owner-actions.ts 152:1
  ["{name} rule", "Rule for {name}", "{name}-এর নিয়ম", "{name} 的规则"],
  // lib/owner-actions.ts 176:1
  ["There is no request {id}.", "Request {id} couldn't be found.", "অনুরোধ {id} পাওয়া যায়নি।", "找不到申请 {id}。"],
  // lib/owner-actions.ts 177:1
  ["Request {id} is already {status}.", "Request {id} is already {status}.", "অনুরোধ {id} ইতিমধ্যেই {status}।", "申请 {id} 已处于 {status} 状态。"],
  // lib/owner-actions.ts 203:1
  ["Owner signed for request {id}: {side} {symbol}", "Owner signed request {id}: {side} {symbol}", "মালিক অনুরোধ {id}-এ সই করেছেন: {side} {symbol}", "所有者已签署申请 {id}：{side} {symbol}"],
  // lib/owner-actions.ts 214:1
  ["There is no request {id}.", "Request {id} couldn't be found.", "অনুরোধ {id} পাওয়া যায়নি।", "找不到申请 {id}。"],
  // lib/owner-actions.ts 215:1
  ["Rejected by the {by}", "Declined by {by}", "{by} ফিরিয়ে দিয়েছেন", "由 {by} 拒绝"],
  // lib/owner-actions.ts 217:1
  ["Cancelled the signed approval for request {id}", "Signed approval cancelled for request {id}", "অনুরোধ {id}-এর সই করা অনুমোদন বাতিল", "申请 {id} 的已签署批准已取消"],
  // lib/owner-actions.ts 219:1
  ["The {by} rejected request {id}", "{by} declined request {id}", "{by} অনুরোধ {id} ফিরিয়ে দিয়েছেন", "{by} 已拒绝申请 {id}"],
  // lib/owner-actions.ts 234:1
  ["Owner dropped the waiting change: {what}", "Owner cancelled the waiting change: {what}", "মালিক অপেক্ষমাণ পরিবর্তন বাতিল করেছেন: {what}", "所有者已取消等待中的变更：{what}"],
  // lib/owner-actions.ts 236:1
  ["Owner paused the agent", "Owner paused the agent", "মালিক এজেন্ট থামিয়েছেন", "所有者已暂停代理"],
  // lib/owner-actions.ts 238:1
  ["Owner asked to unpause the agent", "Owner requested to resume the agent", "মালিক এজেন্ট আবার চালুর অনুরোধ করেছেন", "所有者已申请恢复代理"],
  // lib/owner-actions.ts 239:1
  ["Owner switched the stop-loss back on", "Owner turned stop-loss back on", "মালিক স্টপ-লস আবার চালু করেছেন", "所有者已重新开启止损"],
  // lib/owner-actions.ts 241:1
  ["Owner asked to change the withdrawal address", "Owner requested a new withdrawal address", "মালিক টাকা তোলার নতুন ঠিকানার অনুরোধ করেছেন", "所有者已申请更换提现地址"],
  // lib/owner-actions.ts 243:1
  ["Owner asked to remove the trusted contact", "Owner requested to remove the trusted contact", "মালিক বিশ্বস্ত ব্যক্তিকে সরানোর অনুরোধ করেছেন", "所有者已申请移除信任联系人"],
  // lib/owner-actions.ts 274:1
  ["Trusted contact tried to cancel their own removal", "Trusted contact attempted to cancel their own removal", "বিশ্বস্ত ব্যক্তি নিজের অপসারণ বাতিলের চেষ্টা করেছেন", "信任联系人尝试取消对自己的移除"],
  // lib/owner-actions.ts 275:1
  ["Trusted contact paused the agent", "Trusted contact paused the agent", "বিশ্বস্ত ব্যক্তি এজেন্ট থামিয়েছেন", "信任联系人已暂停代理"],
  // lib/owner-actions.ts 276:1
  ["Trusted contact lifted the pause", "Trusted contact lifted the pause", "বিশ্বস্ত ব্যক্তি বিরতি তুলে নিয়েছেন", "信任联系人已解除暂停"],
  // lib/owner-actions.ts 278:1
  ["Trusted contact halted the stop-loss (price feed emergency)", "Trusted contact halted stop-loss for a price-feed emergency", "দামের তথ্যের জরুরি সমস্যায় বিশ্বস্ত ব্যক্তি স্টপ-লস স্থগিত করেছেন", "信任联系人因价格源紧急情况暂停了止损"],
  // lib/owner-actions.ts 279:1
  ["Trusted contact switched the stop-loss back on", "Trusted contact turned stop-loss back on", "বিশ্বস্ত ব্যক্তি স্টপ-লস আবার চালু করেছেন", "信任联系人已重新开启止损"],
  // lib/owner-actions.ts 285:1
  ["Commitment {id}", "Commitment {id}", "অঙ্গীকার {id}", "资金安排 {id}"],
  // lib/owner-actions.ts 294:1
  ["A new commitment needs its terms and a name.", "Add a name and terms for this commitment.", "এই অঙ্গীকারের নাম ও শর্ত দিন।", "请为此资金安排填写名称和条款。"],
  // lib/owner-actions.ts 317:1
  ["Owner set money aside", "Owner set money aside", "মালিক টাকা আলাদা রেখেছেন", "所有者已预留资金"],
  // lib/owner-actions.ts 320:1
  ["Owner asked to move money back into investing", "Owner requested to release money for investing", "মালিক বিনিয়োগের জন্য টাকা ছাড়ের অনুরোধ করেছেন", "所有者已申请释放资金用于投资"],
  // lib/owner-actions.ts 328:1
  ["Owner paid request {requestId}", "Owner paid request {requestId}", "মালিক অনুরোধ {requestId}-এর টাকা পরিশোধ করেছেন", "所有者已支付申请 {requestId}"],
  // lib/owner-actions.ts 328:2
  ["Owner paid it now", "Owner made the payment", "মালিক পেমেন্ট করেছেন", "所有者已付款"],
  // lib/owner-actions.ts 339:1
  ["There is no commitment {id}.", "Commitment {id} couldn't be found.", "অঙ্গীকার {id} পাওয়া যায়নি।", "找不到资金安排 {id}。"],
  // lib/owner-actions.ts 348:1
  ["Owner ended the commitment", "Owner ended the commitment", "মালিক অঙ্গীকারটি শেষ করেছেন", "所有者已终止该资金安排"],
  // lib/owner-actions.ts 352:1
  ["Commitment {id}", "Commitment {id}", "অঙ্গীকার {id}", "资金安排 {id}"],
  // lib/owner-actions.ts 357:1
  ["There is no payment request {requestId}.", "Payment request {requestId} couldn't be found.", "পেমেন্টের অনুরোধ {requestId} পাওয়া যায়নি।", "找不到付款申请 {requestId}。"],
  // lib/keeper.ts 141:1
  ["First touch of the day: record the day-start value", "Today's starting value recorded", "আজ দিনের শুরুর মূল্য রেকর্ড হয়েছে", "已记录今日起始价值"],
  // lib/risk.ts 211 (written from source)
  ["{a} is more than the {b} of trading left for today.", "{a} is more than the {b} left in today's trading allowance.", "{a} আজকের বাকি ট্রেডের অনুমোদিত পরিমাণ {b}-এর বেশি।", "{a} 超过今日剩余交易额度 {b}。"],
  // lib/risk.ts 212 (written from source)
  ["{b} of today's trading allowance is left.", "{b} left in today's trading allowance.", "আজকের ট্রেডের অনুমোদিত পরিমাণ থেকে {b} বাকি।", "今日剩余交易额度为 {b}。"],
  // lib/risk.ts 223 (written from source)
  ["{name} has risen {n}% in the last {m} minutes, which is unusual. A person should confirm a trade in a market like this.", "{name} has risen {n}% in the last {m} minutes, which is unusual. A person should confirm a trade in a market like this.", "গত {m} মিনিটে {name}-এর দাম {n}% বেড়েছে, যা অস্বাভাবিক। এমন বাজারে ট্রেডের আগে একজন মানুষের নিশ্চিত করা উচিত।", "{name} 在过去 {m} 分钟内上涨了 {n}%，波动异常。这种行情下，交易前应由人确认。"],
  // lib/risk.ts 223 (written from source)
  ["{name} has fallen {n}% in the last {m} minutes, which is unusual. A person should confirm a trade in a market like this.", "{name} has fallen {n}% in the last {m} minutes, which is unusual. A person should confirm a trade in a market like this.", "গত {m} মিনিটে {name}-এর দাম {n}% কমেছে, যা অস্বাভাবিক। এমন বাজারে ট্রেডের আগে একজন মানুষের নিশ্চিত করা উচিত।", "{name} 在过去 {m} 分钟内下跌了 {n}%，波动异常。这种行情下，交易前应由人确认。"],
  // lib/risk.ts 224 (written from source)
  ["{name} has moved {n}% in the last {m} minutes.", "{name} has moved {n}% in the last {m} minutes.", "গত {m} মিনিটে {name}-এর দাম {n}% ওঠানামা করেছে।", "{name} 在过去 {m} 分钟内变动了 {n}%。"],
  // lib/risk.ts 252 (written from source)
  ["Key valid until {d}.", "Key valid until {d}.", "কী-র মেয়াদ {d} পর্যন্ত।", "密钥有效至 {d}。"],
  // lib/risk.ts 346 (written from source)
  ["{a} is more than this commitment allows in one payment ({b}).", "{a} is more than this commitment allows in one payment ({b}).", "{a} এই অঙ্গীকারে এক পেমেন্টে অনুমোদিত পরিমাণের ({b}) বেশি।", "{a} 超过此资金安排单笔允许的金额（{b}）。"],
  // lib/risk.ts 347 (written from source)
  ["Within the {b} this commitment allows.", "Within the {b} this commitment allows.", "এই অঙ্গীকারে অনুমোদিত {b}-এর মধ্যে।", "在此资金安排允许的 {b} 以内。"],
  // lib/risk.ts 352 (written from source)
  ["Only {b} is set aside for it. Top it up first; nothing is taken from your investments.", "Only {b} is set aside for it. Top it up first; nothing is taken from your investments.", "এর জন্য আলাদা রাখা আছে মাত্র {b}। আগে টপ আপ করুন; আপনার বিনিয়োগ থেকে কিছু নেওয়া হয় না।", "此项仅预留了 {b}。请先补足；不会动用你的投资。"],
  // lib/risk.ts 341 (written from source)
  ["The payee is not on the scam list.", "The payee is not on the scam list.", "প্রাপক প্রতারণার তালিকায় নেই।", "收款方不在诈骗名单上。"],
  // lib/risk.ts 341 (written from source)
  ["The payee is on the scam list: {label}.", "The payee is on the scam list: {label}.", "প্রাপক প্রতারণার তালিকায় আছে: {label}।", "收款方在诈骗名单上：{label}。"],
  // lib/risk.ts 353 (written from source)
  ["{b} is set aside.", "{b} is set aside.", "{b} আলাদা রাখা আছে।", "已预留 {b}。"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to put all the cash into the token that is pumping", "Tried to put all the cash into the token that is pumping", "চেষ্টা: সব নগদ দিয়ে লাফিয়ে ওঠা টোকেনটি কেনা", "尝试：将全部现金买入正在暴涨的代币"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to put all the cash into the index fund in one trade", "Tried to put all the cash into the index fund in one trade", "চেষ্টা: এক ট্রেডে সব নগদ দিয়ে ইনডেক্স ফান্ড কেনা", "尝试：用一笔交易将全部现金买入指数基金"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to send the cash to the attacker", "Tried to send the cash to the attacker", "চেষ্টা: নগদ আক্রমণকারীর কাছে পাঠানো", "尝试：将现金转给攻击者"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to sign its own approval for a trade above the limits", "Tried to sign its own approval for a trade above the limits", "চেষ্টা: সীমার বাইরের ট্রেডের জন্য নিজেই অনুমোদনে সই করা", "尝试：自行签署超限交易的批准"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to point withdrawals at the attacker's address", "Tried to point withdrawals at the attacker's address", "চেষ্টা: টাকা তোলার ঠিকানা আক্রমণকারীর দিকে ঘোরানো", "尝试：将提现地址改为攻击者的地址"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to rewrite the mandate with no limits", "Tried to rewrite the mandate with no limits", "চেষ্টা: কোনো সীমা ছাড়া ম্যান্ডেট নতুন করে লেখা", "尝试：将投资授权改为无限制"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to switch off the stop-loss", "Tried to switch off the stop-loss", "চেষ্টা: স্টপ-লস বন্ধ করা", "尝试：关闭止损"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to give itself a new key with a longer life", "Tried to give itself a new key with a longer life", "চেষ্টা: নিজেকে দীর্ঘ মেয়াদের নতুন কী দেওয়া", "尝试：给自己签发更长有效期的新密钥"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to remove the trusted contact", "Tried to remove the trusted contact", "চেষ্টা: বিশ্বস্ত ব্যক্তিকে সরানো", "尝试：移除信任联系人"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to use the owner's earlier approval a second time", "Tried to use the owner's earlier approval a second time", "চেষ্টা: মালিকের আগের অনুমোদন দ্বিতীয়বার ব্যবহার", "尝试：第二次使用所有者之前的批准"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to reuse the owner's earlier signature for a larger amount under a fresh number", "Tried to reuse the owner's earlier signature for a larger amount under a fresh number", "চেষ্টা: মালিকের আগের সই বড় অঙ্কের জন্য আবার ব্যবহার", "尝试：将所有者之前的签名复用于更大金额"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to trade as much as the mandate allows in one go", "Tried to trade as much as the mandate allows in one go", "চেষ্টা: ম্যান্ডেট যতটা দেয়, এক ধাক্কায় ততটা ট্রেড", "尝试：一次用尽投资授权允许的交易额度"],
  // lib/compromised.ts goal, translated as on the Security demo
  ["Tried to make one more trade today, after the day's allowance is used or buying is paused", "Tried to make one more trade today, after the day's allowance is used or buying is paused", "চেষ্টা: দৈনিক সীমা শেষ হওয়ার পর আজ আরও একটি ট্রেড", "尝试：今日额度用完后再进行一笔交易"],
  // lib/receipts.ts headline (written from source)
  ["Bought {name} for {amt} at {price}", "Bought {name} for {amt} at {price}", "{name} কেনা হয়েছে {amt}-তে, দাম {price}", "以 {price} 的价格买入 {name}，金额 {amt}"],
  // lib/receipts.ts headline (written from source)
  ["Sold {name} for {amt} at {price}", "Sold {name} for {amt} at {price}", "{name} বিক্রি হয়েছে {amt}-তে, দাম {price}", "以 {price} 的价格卖出 {name}，金额 {amt}"],
  // lib/receipts.ts headline (written from source)
  ["Stop-loss sold all {name} for {amt} at {price}", "Stop-loss sold all {name} for {amt} at {price}", "স্টপ-লস সব {name} বিক্রি করেছে {amt}-তে, দাম {price}", "止损以 {price} 的价格卖出全部 {name}，金额 {amt}"],
  // lib/receipts.ts headline (written from source)
  ["Buying paused until {t}", "Buying paused until {t}", "{t} পর্যন্ত কেনা বন্ধ", "买入暂停至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["Used the owner's signed approval, which now cannot be used again", "Used the owner's signed approval, which now cannot be used again", "মালিকের সই করা অনুমোদন ব্যবহার হয়েছে, এটি আর ব্যবহার করা যাবে না", "已使用所有者签署的批准，该批准不能再次使用"],
  // lib/receipts.ts headline (written from source)
  ["Everything was withdrawn, so the mandate ended and the agent's key was revoked", "Everything was withdrawn, so the mandate ended and the agent's key was revoked", "সব টাকা তোলা হয়েছে, তাই ম্যান্ডেট শেষ হয়েছে আর এজেন্টের কী বাতিল হয়েছে", "资金已全部提取，投资授权随之终止，代理密钥已撤销"],
  // lib/receipts.ts headline (written from source)
  ["First mandate signed", "First mandate signed", "প্রথম ম্যান্ডেটে সই হয়েছে", "首份投资授权已签署"],
  // lib/receipts.ts headline (written from source)
  ["New agent key signed for, waiting until {t}", "New agent key signed for, waiting until {t}", "এজেন্টের নতুন কী-তে সই হয়েছে, {t} পর্যন্ত অপেক্ষা", "已签署新的代理密钥，等待至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["Trusted contact change signed for, waiting until {t}", "Trusted contact change signed for, waiting until {t}", "বিশ্বস্ত ব্যক্তি বদলের অনুরোধে সই হয়েছে, {t} পর্যন্ত অপেক্ষা", "已签署信任联系人变更，等待至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["Lifting the trusted contact's pause signed for, waiting until {t}", "Lifting the trusted contact's pause signed for, waiting until {t}", "বিশ্বস্ত ব্যক্তির বিরতি তোলার অনুরোধে সই হয়েছে, {t} পর্যন্ত অপেক্ষা", "已签署解除信任联系人暂停的申请，等待至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["Shorter waiting period signed for, waiting until {t}", "Shorter waiting period signed for, waiting until {t}", "কম অপেক্ষার সময়ে সই হয়েছে, {t} পর্যন্ত অপেক্ষা", "已签署缩短等待期，等待至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["New withdrawal address signed for, waiting until {t}", "New withdrawal address signed for, waiting until {t}", "টাকা তোলার নতুন ঠিকানায় সই হয়েছে, {t} পর্যন্ত অপেক্ষা", "已签署新提现地址，等待至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["Looser rule for {name} signed for, waiting until {t}", "Looser rule for {name} signed for, waiting until {t}", "{name}-এর শিথিল নিয়মে সই হয়েছে, {t} পর্যন্ত অপেক্ষা", "已签署放宽 {name} 的规则，等待至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["The agent was paused", "The agent was paused", "এজেন্ট থামানো হয়েছে", "代理已暂停"],
  // lib/receipts.ts headline (written from source)
  ["The agent was unpaused", "The agent was unpaused", "এজেন্ট আবার চালু হয়েছে", "代理已恢复"],
  // lib/receipts.ts headline (written from source)
  ["Stop-loss halted until {t}", "Stop-loss halted until {t}", "{t} পর্যন্ত স্টপ-লস স্থগিত", "止损暂停至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["Stop-loss switched back on", "Stop-loss switched back on", "স্টপ-লস আবার চালু হয়েছে", "止损已重新开启"],
  // lib/receipts.ts headline (written from source)
  ["Mandate change signed, waiting until {t}", "Mandate change signed, waiting until {t}", "ম্যান্ডেট পরিবর্তনে সই হয়েছে, {t} পর্যন্ত অপেক্ষা", "投资授权变更已签署，等待至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["Stop-loss halt signed, waiting until {t}", "Stop-loss halt signed, waiting until {t}", "স্টপ-লস স্থগিতে সই হয়েছে, {t} পর্যন্ত অপেক্ষা", "暂停止损已签署，等待至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["A waiting change was cancelled", "A waiting change was cancelled", "একটি অপেক্ষমাণ পরিবর্তন বাতিল হয়েছে", "一项等待中的变更已取消"],
  // lib/receipts.ts headline (written from source)
  ["Mandate limits in force", "Mandate limits in force", "ম্যান্ডেটের সীমা কার্যকর", "投资授权限额已生效"],
  // lib/receipts.ts headline (written from source)
  ["Paid {amt} for {what} (exactly {x} tUSD sent)", "Paid {amt} for {what} (exactly {x} tUSD sent)", "{what}-এর জন্য {amt} পরিশোধ হয়েছে (ঠিক {x} tUSD পাঠানো হয়েছে)", "已为{what}支付 {amt}（实际发送 {x} tUSD）"],
  // lib/receipts.ts headline (written from source)
  ["{what} signed for, waiting until {t} before it can be paid", "{what} signed for, waiting until {t} before it can be paid", "{what}-এ সই হয়েছে, পেমেন্টের আগে {t} পর্যন্ত অপেক্ষা", "{what} 已签署，须等待至 {t} 后才能付款"],
  // lib/receipts.ts headline (written from source)
  ["Set aside {amt} for {what}", "Set aside {amt} for {what}", "{what}-এর জন্য {amt} আলাদা রাখা হয়েছে", "已为{what}预留 {amt}"],
  // lib/receipts.ts headline (written from source)
  ["Asked to move {amt} from {what} back into investing, waiting until {t}", "Asked to move {amt} from {what} back into investing, waiting until {t}", "{what} থেকে {amt} বিনিয়োগে ফেরানোর অনুরোধ, {t} পর্যন্ত অপেক্ষা", "已申请将 {amt} 从{what}转回投资，等待至 {t}"],
  // lib/receipts.ts headline (written from source)
  ["Moved {amt} from {what} back into investing", "Moved {amt} from {what} back into investing", "{what} থেকে {amt} বিনিয়োগে ফেরানো হয়েছে", "已将 {amt} 从{what}转回投资"],
  // lib/receipts.ts headline (written from source)
  ["Recorded today's starting value", "Recorded today's starting value", "আজ দিনের শুরুর মূল্য রেকর্ড হয়েছে", "已记录今日起始价值"],
  // lib/receipts.ts headline (written from source)
  ["Could not record today's starting value", "Could not record today's starting value", "আজ দিনের শুরুর মূল্য রেকর্ড করা যায়নি", "未能记录今日起始价值"],
  // lib/receipts.ts headline (written from source)
  ["Decided not to act", "Decided not to act", "কিছু না করার সিদ্ধান্ত", "决定不执行"],
  // lib/receipts.ts headline (written from source)
  ["Decided not to: {x}", "Decided not to: {x}", "যা না করার সিদ্ধান্ত: {x}", "决定不执行：{x}"],
  // lib/receipts.ts headline (written from source)
  ["Signed an approval for one trade", "Signed an approval for one trade", "একটি ট্রেডের জন্য অনুমোদনে সই হয়েছে", "已为一笔交易签署批准"],
  // lib/receipts.ts headline (written from source)
  ["Asked the owner to sign for: {x}", "Asked the owner to sign for: {x}", "মালিকের সইয়ের অনুরোধ: {x}", "已请所有者签署：{x}"],
  // lib/receipts.ts headline (written from source)
  ["Tried to {x}", "Tried to {x}", "চেষ্টা: {x}", "尝试：{x}"],
  // lib/receipts.ts headline (written from source)
  ["{what} in force", "{what} in force", "{what} কার্যকর", "{what} 已生效"],
];
