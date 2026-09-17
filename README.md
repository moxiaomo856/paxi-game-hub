# Paxi Game Hub（手机版 · 单页应用）

链上游戏大厅前端。**单页应用 + 底部 Tab + 移动端优先**，写法参照 `paxi-toolbox`。
纯静态、零构建、零后端，丢到 GitHub Pages 就能用。

---

## 1. 为什么改成这样

上一版是「1 个大厅 + 4 个独立 HTML 页 + 7 个 assets 模块」的多页面结构，问题很明显：

| 问题 | 这一版 |
|---|---|
| 每次要手填合约地址 | 默认留空，App 内**填一次永久生效**，也支持 URL 参数（见第 3 节） |
| 4 个游戏页各复制一份 boot 逻辑 | 抽出通用 `openGame()`，游戏只写 UI |
| 15 个文件、跳转白屏 | **5 个文件、SPA 无跳转**，底部 Tab 切换 |
| 桌面排版，手机上要缩放 | `max-width 520px` + 安全区 + 46px 按钮 + `:active` 反馈 |

## 2. 文件结构

```
paxi-game-hub-v2/
├── index.html     唯一入口：移动端样式 + Header + 主区 + 底部 Tab
├── shared.js      ★ 合约地址（可配置）/ 网络 / 交易 / 查询 / 错误映射
├── session.js     会话密钥：生成 / 注册 / 签名 / nonce 链上同步
├── games.js       4 个游戏（猜数字 / 轮盘 / 骰宝 / 卡牌）+ 赔率计算
├── app.js         路由 / 钱包 / 大厅 / 充提 / 游戏引导
└── _old-multipage/（上一版备份，可删）
```

加载顺序：`paxi-cosmjs.umd.js` → noble ESM → `shared.js` → `session.js` → `games.js` → `app.js`

## 3. 合约部署 + 地址配置

### 3.1 是的，必须先 instantiate 才能玩

`wasm store` 只是把 wasm **字节码**存上链，它不是一个能交互的合约 —— 没有地址、没有状态。
必须再 `wasm instantiate` 才会真正生成一个合约实例（有地址），前端才能调。

```text
cargo 编译 → wasm store → 拿到 code_id
                        → wasm instantiate → 拿到 contract address  ★前端要的是这个
                        → AddGame 配置 5 个游戏
                        → 前端填地址，开玩
```

> 类比：store = 上传"类"，instantiate = new 一个"对象"。同一个 wasm 可以 instantiate 很多次，
> 每次都是独立的合约和独立地址（测试网 / 正式网各一个很正常）。

### 3.2 编译 wasm

```bash
cd "tong yong he yue xin"

# 先过一遍类型检查（这个合约至今没编译过，强烈建议先跑这个）
cargo check

# 编译 wasm（需要 wasm32 目标）
rustup target add wasm32-unknown-unknown
cargo wasm
# 产物：target/wasm32-unknown-unknown/release/paxi_game_hub.wasm

# 可选：用 CosmWasm optimizer 压到 600KB 以内（主网 store 有大小限制，且 gas 更省）
# docker run --rm -v "$(pwd)":/code -v "$(pwd)/artifacts":/artifacts \
#   cosmwasm/optimizer:0.16.0
# 产物：artifacts/paxi_game_hub.wasm
```

### 3.3 上传（store）

```bash
paxid tx wasm store target/wasm32-unknown-unknown/release/paxi_game_hub.wasm \
  --from your_key_name --gas auto --gas-adjustment 1.3 --fees 10000000upaxi
```

拿 **code_id**（假设是 `7`）：

```bash
paxid query wasm list-code | tail -20
# 或从交易的 store_code 事件里读 code_id
```

### 3.4 实例化（instantiate）→ 得到合约地址

```bash
CODE_ID=7
ADMIN=$(paxid keys show your_key_name -a)

paxid tx wasm instantiate $CODE_ID '{
  "admins": ["paxi1你的地址"],
  "prc20_whitelist": [],
  "initial_burn_rate": 500,
  "swap_module": "paxi1mfru9azs5nua2wxcd4sq64g5nt7nn4n80r745t",
  "treasury_list": ["paxi1你的地址"],
  "treasury_share": 500
}' \
  --from your_key_name \
  --label "paxi-game-hub" \
  --admin "$ADMIN" \
  --gas auto --gas-adjustment 1.3 --fees 6000000upaxi
```

字段说明：

| 字段 | 说明 |
|---|---|
| `admins` | 管理员列表。**部署者会自动入管理员**，所以填 `[]` 也行，不会丢管理权 |
| `prc20_whitelist` | 允许的 PRC-20 合约。只玩原生 PAXI 就留 `[]`，之后可用 `AddPrc20` 加 |
| `initial_burn_rate` | 每笔抽水中销毁的比例（**万分之一**为单位，100 = 1%） |
| `swap_module` | Paxi 官方 Swap 模块，全链固定，照抄即可 |
| `treasury_list` | 抽水收款地址，每次交易随机选一个 |
| `treasury_share` | 抽水比例（万分之一，100 = 1%）。**`burn_rate + treasury_share` 必须 ≤ 10000** |

> ⚠️ 通用游戏抽水 5% + 销毁 5%，两者之和必须 ≤ 10000 bps。

> ⚠️ `--admin` 建议设成自己（合约有 `migrate` 入口，方便以后升级）。
> 不想要升级能力就换 `--no-admin`，但那样 ROUND_TIMEOUT / SESSION_DAILY_LIMIT_CAP
> 这类新增存储项就得靠 `migrate` 补，所以**建议保留 admin**。

取合约地址：

```bash
# 方法 1：从交易事件里读
curl -s "https://mainnet-lcd.paxinet.io/cosmos/tx/v1beta1/txs/{TX_HASH}" | jq -r '
  .tx_response.events[]
  | select(.type=="instantiate")
  | .attributes[]
  | select(.key=="_contract_address")
  | .value'

# 方法 2：按 code_id 列
paxid query wasm list-contract-by-code $CODE_ID
```

### 3.5 把地址填进前端（三种方式，任选）

地址**没有写死**，留了空占位。任选一种，都不用改逻辑：

| 方式 | 做法 | 适合 |
|---|---|---|
| ① **App 内填** | 我的 → 合约地址 → 填 `paxi1…` → 保存 | **手机上最方便**，填一次永久生效 |
| ② **URL 参数** | `index.html?contract=paxi1…` | 调试 / 分享给别人试用，自动记住 |
| ③ **改代码** | `shared.js` 顶部 `DEFAULT_GAME_CONTRACT` | 正式上线，最干净 |

优先级：**URL 参数 > localStorage（①②写入的） > 代码默认值（③）**。
所以③改完如果还不对，先看是不是 localStorage 里有旧值（我的 → 「清除本地地址」）。

没配地址时大厅会显示引导卡片，不会发无效请求报错。

> 会话每日额度在 `shared.js` 的 `SESSION_DAILY_LIMIT`（默认 1000 PAXI，
> 必须 ≤ 合约的 `SESSION_DAILY_LIMIT_CAP`，否则注册会话会被拒绝）。

## 4. 移动端适配要点

- `viewport-fit=cover` + `env(safe-area-inset-*)`：iPhone 刘海 / 底部横条不遮挡
- `max-width: 520px` 居中，桌面也是窄栏，和手机观感一致
- 所有可点元素 ≥ 46px（按钮）/ 48px（下注选项），`:active` 缩放反馈（不用 `:hover`）
- 底部固定 Tab（大厅 / 钱包 / 我的），拇指可达
- `-webkit-tap-highlight-color: transparent`、`user-scalable=no`：去掉点击蓝框和误缩放
- 游戏卡片 2 列网格；≤340px 屏再降一档字号

## 5. 使用流程（玩家视角）

1. 用 **PaxiHub App 内置浏览器**打开 → **自动连接钱包**（静默，不弹窗）
2. 大厅点游戏 → 首次会提示「注册会话密钥」，点一次即可（24 小时有效）
3. 之后下注**不再弹钱包**，本地会话密钥签名，秒确认

> 会话过期 / nonce 卡死：我的 → 「清除本地会话密钥」→ 重新注册。

## 5.1 代币：原生 PAXI / TKCC / 任意 PRC-20

钱包页顶部有**代币选择器**，充值和提现共用，切换即生效。

代币来源（自动合并去重）：

1. **原生 PAXI**（`upaxi`，永远第一项）
2. **配置的 TKCC** —— `shared.js` 的 `DEFAULT_TKCC_CONTRACT`，或用 `?tkcc=paxi1…`
3. **合约白名单里的 PRC-20** —— 调新增的 `ListPrc20` 查询自动拉取
4. **手动添加** —— 钱包页「＋ 添加 PRC-20 代币」，填地址即写入 localStorage

每个代币的 `symbol` / `decimals` 是实时查它的 `token_info` 得到的，**不假设都是 6 位小数**。

### 充值流程不一样

| 类型 | 步骤 | 说明 |
|---|---|---|
| 原生 PAXI | 1 笔 | `deposit { token: null }` + 附带 `funds` |
| PRC-20 | 可能 2 笔 | 合约用 `transfer_from` **主动拉取**，必须先有 allowance |

前端会自动检查 `allowance`，不够就先发一笔 `increase_allowance`（授权额度 = 本次充值额，不多授权），
等它上链后再发 `deposit { token: 代币地址 }`。玩家只看到"授权中…→充值中…"两个提示。

> ⚠️ **代币必须在合约白名单里**，否则 deposit 直接报 `ContractNotWhitelisted`。
> 管理员执行：
> ```bash
> paxid tx wasm execute $GAME_CONTRACT '{"add_prc20":{"contract":"paxi1代币地址"}}' \
>   --from your_key_name --gas auto --fees 30000upaxi
> ```

### 合约改动（第五轮新增）

原来只有 `AddPrc20` / `RemovePrc20`，**没有任何查询白名单的接口** ——
前端根本无从得知支持哪些代币。已补：

```rust
// msg.rs
QueryMsg::ListPrc20 {}          // 返回 Prc20ListResponse { tokens: Vec<String> }

// admin/config.rs
pub fn list_prc20(deps: Deps) -> Result<Vec<String>, ContractError>
```

> 老合约没这个接口，前端会 catch 住并回落到「原生 PAXI + 配置的 TKCC + 手动添加的」，
> 不会报错，只是不会自动列出白名单代币。**重新部署后才会自动全量列出。**

## 6. 部署

```bash
# GitHub Pages
git add . && git commit -m "paxi game hub" && git push
# 仓库 Settings → Pages → Source: branch main / root

# 或本地预览（钱包只认 https 或 localhost）
python -m http.server 8080
```

> GitHub Pages：本仓库无下划线开头的文件/目录，Jekyll 不会过滤任何内容。
> 若想彻底跳过 Jekyll 处理（略快且无意外），在根目录放一个空 `.nojekyll` 即可。

### 6.1 PaxiCosmJS SDK 与 compat.js —— 实测结论：本仓库**不需要** compat.js

早期项目（三国卡牌）根目录带了一个 `compat.js`，用于给 `paxi-cosmjs.umd.js`
补 `coins / MsgSend / MsgExecuteContract / PubKey` 等符号，于是常有疑问：
本仓库是不是也要放一个？

**结论：不要。** 以下是对官方 UMD 的实测结果，不是推测：

- 实测对象：`https://mainnet-api.paxinet.io/resources/js/paxi-cosmjs.umd.js`
  （`Content-Length: 2611437`；该文件单次下载常被网络截断，需断点续拉取完整后再验）
- 实测方法：在 Node 中用 `vm` 以浏览器全局（`window/self/location/document/URL`…）
  **真实加载**该 UMD，枚举导出符号，并**实际调用编码器**校验输出字节。

SDK 实际导出 18 个符号：

```
StargateClient, SigningStargateClient, coins, Registry, AminoTypes,
MsgSend, MsgVote, MsgDelegate, MsgExecuteContract, TxBody, AuthInfo,
SignDoc, TxRaw, PubKey, Any, MsgSwap, MsgProvideLiquidity, MsgWithdrawLiquidity
```

`shared.js` 用到的 7 个符号**全部存在**：

| 符号 | 用途 | SDK |
|---|---|---|
| `coins` | 组装 fee | ✅ function |
| `PubKey` | 组装 signerInfos | ✅ object |
| `MsgExecuteContract` | 合约调用消息体 | ✅ object |
| `TxBody` / `AuthInfo` / `SignDoc` / `TxRaw` | 交易组装与签名 | ✅ object |

功能性验证（不仅"存在"，且编码结果正确）：

- `coins('25000','upaxi')` → `[{"amount":"25000","denom":"upaxi"}]`
- `PubKey.encode({key:<33B>}).finish()` → `0a21` + 33 字节（field1 / wiretype2 / len33）
- `MsgExecuteContract` 带 `funds` 编码 → 102 字节，首字段 `0a28` = sender
- `TxBody` / `AuthInfo` / `SignDoc` / `TxRaw` 均编码通过

两点补充说明，避免误解：

1. `shared.js` 里的 `toBase64(...)` 是**本仓库自己实现的**（`shared.js:220`），
   不是 `PaxiCosmJS.toBase64`。官方 SDK 确实**没有**导出 `toBase64`，
   但 `compat.js` 是把 `toBase64` 挂到 `PaxiCosmJS` 命名空间下的，
   救不了**裸调用** —— 所以本仓库从未依赖过 SDK 的这个符号。
2. `compat.js` 是**非破坏性**的（仅当 `typeof PaxiCosmJS[x] === 'undefined'` 才补），
   放进来也不会覆盖 SDK 已有实现；代价只是多 11KB 和一批用不到的
   治理/质押消息（`MsgGrant` / `MsgExec` / `MsgSubmitProposal` 等）。

> 若将来 Paxi 更换 SDK 构建导致符号缺失，再引入 `compat.js`：放进仓库根目录，
> 并在 `index.html` 里 **在 `shared.js` 之前** 加一行 `<script src="compat.js"></script>`。

## 7. 管理员：配置 5 个游戏

金额单位 **upaxi**（1 PAXI = 1000000）。

> 📌 通用游戏下注单位是 **TKCC**（合约内余额），不是 PAXI。
>    所有 `min_bet` / `max_bet` / `max_daily_bet` 单位均为 TKCC 的 6 位小数 raw 值，
>    例如 `"10000000000"` = 1 万 TKCC。

> ⚠️ `max_payout_multiplier` 是**派彩/本金的百分制**：`300` = 3.00x、`1000` = 10x、上限 `10000`。
> **千万别填 100**（= 1.00x，赢局被压成退回本金）。取值必须 ≥ 该游戏最高派彩倍数，
> 否则 `play` 静默截断、`settle` 直接报 `PayoutTooHigh`。

### 开局前先给庄家准备金注资（必做）

```bash
paxid tx wasm execute <GAME> \
  '{"fund_bankroll":{"token":null}}' --amount 1000000000upaxi \
  --from your_key_name --gas auto --fees 30000upaxi
```

### ① 猜数字 `guess`

```bash
paxid tx wasm execute <GAME> '{
  "add_game": {
    "game_id": "guess",
    "limit": { "enabled": true, "min_bet": "1000000", "max_bet": "100000000",
               "max_payout_multiplier": 1000, "max_daily_bet": "1000000000", "max_daily_rounds": 500 },
    "engine_config": { "engine": "Guess",
      "params": { "Guess": { "min": 1, "max": 10, "multiplier": 710 } } }
  }
}' --from your_key_name --gas auto --fees 30000upaxi
```

`multiplier` 710 = 利润 7.1×bet → 派彩 8.10x，10 个数字 → **RTP 81.0%**（庄家净 +10%：扣 5% 抽水 + 5% 销毁后仍留约 10%）。
> `guess_elite`（若另开一档）同样用 `710`。

### ② 幸运轮盘 `roulette`

```bash
paxid tx wasm execute <GAME> '{
  "add_game": {
    "game_id": "roulette",
    "limit": { "enabled": true, "min_bet": "1000000", "max_bet": "100000000",
               "max_payout_multiplier": 1000, "max_daily_bet": "1000000000", "max_daily_rounds": 500 },
    "engine_config": { "engine": "Roulette",
      "params": { "Roulette": { "slots": 8, "payouts": [0,0,0,0,0,0,0,550] } } }
  }
}' --from your_key_name --gas auto --fees 30000upaxi
```

`payouts[i]` 是**利润**百分制，0 = 空槽。RTP = `sum(1+payouts[i]/100)/slots`，上例 = 6.5/8 = **81.25%**。
> `roulette_vip`（若另开一档）同样用 `550`。

### ③ 骰宝 `dice`

```bash
paxid tx wasm execute <GAME> '{
  "add_game": {
    "game_id": "dice",
    "limit": { "enabled": true, "min_bet": "1000000", "max_bet": "100000000",
               "max_payout_multiplier": 500, "max_daily_bet": "1000000000", "max_daily_rounds": 500 },
    "engine_config": { "engine": "Dice",
      "params": { "Dice": { "dice_count": 3, "sides": 6,
                            "bet_types": ["big","small","specific"] } } }
  }
}' --from your_key_name --gas auto --fees 30000upaxi
```

ℹ️ `odd`/`even` 现已可安全开启：`profit_mult` 由合约常量固定为 **74**，RTP 恒 ≈ 84.6%（不再有 100% 套利，见第 8 节）。
1d100 的 specific 派彩 ≈ **84.45x**（`DICE_SPECIFIC_EDGE_BPS = 1570`），若开 1d100 的 specific，`max_payout_multiplier` 要填 ≥ **8500**；
上面示例的 `500` 只覆盖到 3d6 的 big/small/specific（3d6 specific 派彩 2.15x）。

### ④ 卡牌对决 `card`

```bash
paxid tx wasm execute <GAME> '{
  "add_game": {
    "game_id": "card",
    "limit": { "enabled": true, "min_bet": "1000000", "max_bet": "100000000",
               "max_payout_multiplier": 10000, "max_daily_bet": "1000000000", "max_daily_rounds": 500 },
    "engine_config": { "engine": "Card",
      "params": { "Card": { "deck_count": 1, "min_cards": 5, "max_cards": 5,
        "multiplier_by_hand": [0, 50, 90, 180, 450, 550, 750, 1400, 2800, 5500] } } }
  }
}' --from your_key_name --gas auto --fees 30000upaxi
```

`multiplier_by_hand` **必须 10 项**：
`0高牌 1一对 2两对 3三条 4顺子 5同花 6葫芦 7四条 8同花顺 9皇家同花顺`。
**用游戏页实时算出的「合计 RTP」回调**，直到落在 **85%~90%**（旧版 90%~97% 的目标已作废）。`min_cards` 必须 ≥ 5。
> `card_rank` / `card_vs_dealer` 用同一张表；`vs_dealer` 的赔率不走这张表，由合约 `profit_mult = 78` 决定（RTP 89~90%）。

### ⑤ 疯狂骰子 `crazydice`

```bash
paxid tx wasm execute <GAME> '{
  "add_game": {
    "game_id": "crazydice",
    "limit": { "enabled": true, "min_bet": "1000000", "max_bet": "100000000",
               "max_payout_multiplier": 600, "max_daily_bet": "1000000000", "max_daily_rounds": 500 },
    "engine_config": { "engine": "Dice",
      "params": { "Dice": { "dice_count": 1, "sides": 6,
                            "bet_types": ["specific"] } } }
  }
}' --from your_key_name --gas auto --fees 30000upaxi
```

⚠️ **必须 `dice_count: 1` + `sides: 6` 且 `bet_types` 含 `specific`** —— `crazydice.js` 启动即校验
（`n<1||n>10||sides<2||sides>100` 抛「引擎参数越界」；不含 `specific` 抛「合约未启用 specific 玩法」）。

- 命中率：1d6 specific = **1/6**
- 利润倍率：`diceSpecificMult(6,1) ≈ 421`（庄家优势 `DICE_SPECIFIC_EDGE_BPS = 1570`，即 15.7%）
- 派彩 ≈ **5.21x** → `max_payout_multiplier` 填 **600**（百分制 521%，留 15% 余量）

`crazydice.js` 已注册进 `GAME_REGISTRY`，但**必须管理员执行上面的 AddGame 后**才会在大厅出现并可玩。

## 8. ⚠️ 经济模型与风险说明

通用游戏统一采用「输局抽水 5% + 销毁 5%」结构（`SetBurnRate(500)` +
`SetTreasuryShare(500)`），庄家净收益目标 +10%，通过「降赔率」而非提高抽水实现。

| 玩法             | profit_mult | 派彩   | RTP     | 庄家净 |
|------------------|-------------|--------|---------|--------|
| Guess 猜数字     | 710         | 8.10x  | 81.0%   | +10%   |
| Roulette 轮盘    | 550         | 6.50x  | 81.25%  | +10%   |
| Dice big/small   | 74          | 1.74x  | 84.6%   | +10%   |
| Dice specific    | 1570 bps    | 随面数 | ~85%    | +10%   |
| Card vs_dealer   | 78          | 1.78x  | 89~90%  | +10%   |
| Card rank_only   | 见 mult 表  | —      | ~85%    | +10%   |
| CrazyDice        | 1570 bps    | ~5.21x | ~86.9%  | +10%   |

销毁实际占比 = 输局率 × 5%：
  - 猜数字（胜率 10%）→ 总流水销毁 4.5%
  - 轮盘（胜率 12.5%）→ 4.375%
  - 疯狂骰子（胜率 16.7%）→ 4.17%
  - 骰宝（胜率 42%~49%）→ 2.5%~2.9%

⚠️ 仍存在的风险：
- 链上无 VRF：随机性依赖 `env.transaction.index`，若排序者被收买可操纵结果
- PRC-20 decimals 未登记：前端从 `token_info` 实时查，不要假设都是 6 位
- Swap 事件属性名待实测：`extract_swap_receive` 依赖 Swap 模块事件字段命名

已不再存在的风险（旧版曾列）：
- ~~Dice odd/even RTP 100% 或 >100%~~ → 已改 profit_mult=74，RTP 恒 ~84.6%
- ~~Dice big/small 1d6/2d6 RTP 100%~~ → 同上，恒定 ~84.6%
- ~~Card vs_dealer RTP 100%~~ → 已改 profit_mult=78，RTP ~89~90%

其他未解项：链上无 VRF（随机性依赖排序器）、PRC-20 decimals 未登记、Swap 事件属性名待实测。

## 9. 故障排查

| 现象 | 处理 |
|---|---|
| 提示「请在 PaxiHub 钱包内打开」 | 必须用 PaxiHub App 内置浏览器 |
| 大厅卡片显示「已停用」 | 合约 `add_game` 时 `enabled: false`，或没配这个游戏 |
| 报「引擎不匹配」 | 合约绑的引擎和游戏 id 对不上，检查 `SetGameEngineConfig` |
| `InvalidNonce` | 已自动同步链上 nonce；仍失败说明上笔还在 mempool，稍等重试 |
| 赢局失败提示准备金不足 | 按第 7 节注资 |
| 白屏 / noble 未定义 | 需能访问 `cdn.jsdelivr.net`；内网把 noble 三个包下到本地改路径 |

## 10. 加一个新游戏

1. 合约 `add_game`
2. `games.js` 写一个对象 `{ meta, body(ctx), bind(ctx), result(ctx,out) }`，加进 `window.GAMES`
3. 其余（读配置、校验引擎、签名、广播、解析事件、刷新余额）全由 `app.js` 兜住

> ⚠️ **合约消息大小写（必看）**：CosmWasm 的 `#[cw_serde]` 宏会对 `ExecuteMsg` / `QueryMsg` 枚举
> 强制展开为 `#[serde(deny_unknown_fields, rename_all = "snake_case")]`。因此链上实际消息名是**蛇形**
> （例如 `SanguoDraw` → `"sanguo_draw"`），且 `deny_unknown_fields` 会直接拒绝未知变体名/多余字段。
> 若你的新游戏像三国一样直接发枚举变体名，必须把 `PascalCase` 转成 `snake_case` 再放入 payload，
> 参考 `sanguo.js` 的 `sanguoExec`：
> `const msgKey = variant.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();`
> 查询消息同理必须用蛇形（如 `sanguo_params`、`sanguo_player_cards`）。
