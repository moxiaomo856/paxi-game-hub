# Paxi 游戏大厅 · 合约 + 前端 重新审核报告（第八轮）

> 审核基准：官方 **DApp 开发指南**（DApp 指南.txt）+ **PAXI CLI 指令**（PAXI CLI 指令.txt）
> 审核方式：专家视角（软件工坊 + 火眼眼）静态复核，**不编译合约**，逐条比对官方文档与合约源码
> 范围：`paxi-game-hub-v2/` 前端 6 文件 + `src/` 合约关键路径
> 结论：**已发现并修复 1 个严重阻断缺陷 + 1 个中危一致性缺陷；其余与官方指南逐条对齐，部署后游戏可正常玩。**

---

## 一、官方指南基线核对（前端 ↔ 官方文档）

| 检查项 | 官方要求 | 前端实现 | 结论 |
|---|---|---|---|
| 网络端点 | `mainnet-rpc/lcd.paxinet.io`，denom `upaxi`，prefix `paxi` | shared.js:79-87 完全一致 | ✅ |
| 钱包注入 | `window.paxihub.paxi.getAddress()` / `signAndSendTransaction` | connectWallet + sendTx 使用一致 | ✅ |
| PaxiCosmJS | `https://mainnet-api.paxinet.io/resources/js/paxi-cosmjs.umd.js` | index.html:322 已引入 | ✅ |
| 交易广播 | LCD `/cosmos/tx/v1beta1/txs` + `BROADCAST_MODE_SYNC` | shared.js:546，并 `waitForTx` 轮询确认 | ✅ |
| Swap 模块 | `paxi1mfru9azs5nua2wxcd4sq64g5nt7nn4n80r745t` | shared.js:29 一致 | ✅ |
| PRC-20 | `{transfer:{recipient,amount}}` / `{increase_allowance}` | shared.js/approvePrc20 一致 | ✅ |
| 区块时间 | `/cosmos/base/tendermint/v1beta1/blocks/latest` | getBlockTime() 一致（CLI 2.4） | ✅ |
| 签名/验签 | SHA-256 + secp256k1 | 前端 SHA-256+lowS 64字节；合约 `Sha256→secp256k1_verify` | ✅ 逐字对齐 |

---

## 二、合约 ↔ 前端 关键一致性（已逐条核对）

1. **会话签名原文**：合约 `validate_and_consume_session` 拼装
   `{chain_id}:{contract}:{game_id}:{action}:{round_id}:{amount_payout}:{nonce}:{pubkey}`
   前端 `Session.buildMessage` 完全一致（session.js:106-111）。两端哈希均用裸 SHA-256，签名均用 secp256k1 compact（64 字节）+ low-S，Cosmos SDK 强制项满足。
2. **register_session**：合约校验 bech32 格式、强制 `daily_limit ≤ 硬顶`、防跨钱包抢注、存 `pubkey+user`；前端 `Session.register` 上传 `session_addr/pubkey_hex/daily_limit`（=1000 PAXI ≤ 硬顶）一致。
3. **Play（通用引擎）**：前端 `doPlay` 构造 `play:{game_id,round_id,token,bet,各类_input,session_addr,nonce,signature}`，与合约 `Play` 消息字段一致；`openGame` 先查 `game_engine_config_query`+`game_limit` 并校验 `engineKey===meta.engine`。
4. **Sanguo\***（第七轮已核）：`round_id` 公式逐字复刻合约 `sanguo_auth`；payload 额外 `round_id` 字段因全仓无 `deny_unknown_fields` 被 serde 静默忽略，不致命。

---

## 三、发现并修复的缺陷

### 🔴 严重 · 疯狂骰子文件整体丢失（已修复）
- **现象**：`crazydice.js` 在磁盘上不存在（`ls`/`find` 均找不到；早先 `node --check` 通过属 stale 状态），且 `index.html` 也未引用脚本标签。
- **后果**：部署后「🎲 疯狂骰子」完全无法加载——大厅里点了没反应，也不报错在控制台之外。
- **修复**：
  - 重新创建 `crazydice.js`：固定 `specific` 玩法、1 骰 6 面；`body` 渲染 6 面按钮 + 赔率 + 经济模型（70/15/15，链上 `burn_config`/`treasury_config` 取不到时回落静态文案）；`bind` 设 `ctx.getInput()=>({dice_input:{bet_type:'specific',specific_value:ctx._face}})`；`result` 复用骰宝 `engine_result` 解析；注册进 `GAME_REGISTRY`。
  - 在 `index.html:336` 补回 `<script src="crazydice.js"></script>`（位于 sanguo.js 之后、app.js 之前）。
  - 6 个 JS 文件 `node --check` 全部 OK。

### 🟡 中危 · DEFAULT_GAME_CONTRACT 自相矛盾（已修复）
- **现象**：shared.js 注释明确写「不写死，留空占位」，代码却硬编码旧项目地址 `paxi16kn52f54zpxsd2ydslu28latvll0gunpu6us6stdcs8p3hl6ucus5zznus`，与第5轮「合约未部署不要写死」指令冲突；指向的是旧/无关合约。
- **修复**：改为 `const DEFAULT_GAME_CONTRACT = ''`，部署后用 `?contract=` 或「我的」填写；URL > localStorage > 默认 的覆盖链不变。

---

## 四、遗留项（非本轮修复，因「不编译合约」）

1. **三国 round_id 时间窗口敏感**：合约用 `env.block.time.seconds()` 算 round_id 验签，前端用 `getBlockTime()` 复刻；若打包时区块时间与签名时不一致，签名校验失败。**建议（编译阶段做）**：给每个 `Sanguo*` 消息加 `round_id` 字段由前端下发（前端已带该字段、合约忽略中），签名与验证都用前端值，消除时间依赖。
2. **register_session 未链上校验 `session_addr == addr(pubkey)`**：仅存储并验证 pubkey，session_addr 作为 key 不强制由 pubkey 派生。属加固项，不阻断（攻击者仍需持有对应私钥才能签出有效签名，且 `session.user` 始终为注册钱包）。
3. **DApp 指南深链回退未实现**：指南要求 `window.paxihub` 缺失时 `paxi://hub/explorer?url=` 深链 + 1s 后跳商店；前端仅 toast + 跳文档。因应用本就运行在 PaxiHub 内，非阻断，可选补。

---

## 五、部署前置清单（管理端，需上链配置）

- **三国**：`SanguoSetConfig` / `SanguoSetParams` / `SanguoAddTemplates`（卡片模板、费用、AI 难度表）
- **疯狂骰子**：`AddGame{crazydice, dice 引擎(dice_count=1, sides=6, bet_types=['specific']), 限额}`
- **流程**：`cargo check` → `cargo wasm`（产物 `target/wasm32-unknown-unknown/release/paxi_game_hub.wasm`）→ `wasm store`（得 code_id）→ `wasm instantiate`（带 `--admin`，得合约地址）→ `AddGame` 配游戏 → 前端填地址。

---

## 六、验证记录
- 6 个 JS `node --check` 全 OK（shared/session/games/sanguo/crazydice/app）。
- `index.html` 脚本顺序：`paxi-cosmjs → shared → session → games → sanguo → crazydice → app`；`GAME_REGISTRY` 由 games.js(4) + sanguo.js + crazydice.js 共同填充。
- 会话签名 8 段格式、SHA-256 + secp256k1 low-S 与合约 `validate_and_consume_session` 逐字对齐。
- 确认合约全仓无 `deny_unknown_fields`，前端 Sanguo* payload 多余的 `round_id` 字段可被安全忽略。

---

## 第九轮补遗（专家复审：吴八哥，2026-09-16）

> 复审范围：`src/`（合约）+ `paxi-game-hub-v2/sanguo.js`（前端）。结论：**发现并修复 1 个致命阻断缺陷**，其余与合约逐条对齐。

### 🔴 致命 · Sanguo 执行消息帕斯卡命名导致 100% 写操作失败（已修复）

- **根因**：合约 `ExecuteMsg` 使用 `#[cw_serde]`。经核实 `cosmwasm-schema-derive-2.0.4/src/cw_serde.rs:29`，该宏对**枚举**展开为
  `#[serde(deny_unknown_fields, rename_all = "snake_case", crate = "…")]`。
  即所有执行变体按 snake_case 序列化：`SanguoDraw → "sanguo_draw"`、`SanguoAiBattle → "sanguo_ai_battle"`，依此类推；且 `deny_unknown_fields` 对未知变体**硬拒绝**。
- **现象**：前端 `sanguoExec` 用帕斯卡变体名作 payload key（`{"SanguoDraw":{…}}`），与合约期望的 `"sanguo_draw"` 不符 → 合约返回 `unknown variant SanguoDraw`（被 `deny_unknown_fields` 直接拒）。**20 个 Sanguo 执行流（抽卡/AI/领取/养成/提案/PVP/混战）全部失败**，仅查询（蛇形）可用。
- **为何前 8 轮漏掉**：第八轮报告第 32 行称「Sanguo*（第七轮已核）」「全仓无 deny_unknown_fields，多余字段被静默忽略」——两者均误。`cw_serde` 强制 `deny_unknown_fields`；且 `cargo check`/`node --check` 不触发 serde 运行期大小写反序列化，能"编译通过"却在实调用时崩。
- **修复**：`sanguoExec` 内将 `variant` 统一 `variant.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()` 转 snake_case 后再作 payload key；调用方（`SanguoDraw`/`SanguoAiBattle`/…）无需改动，20 个执行流一处覆盖。`node --check sanguo.js` 通过。

### 其余交叉面核对（全部通过，无问题）

1. **无感签名 8 段原文**前后端逐字符一致（`chain_id:contract:game_id:action:round_id:spend:nonce:pubkey`）；`chain_id` 取自节点 `node_info.network`（与 `env.block.chain_id` 同源）；合约地址用 `CONTRACTS.game`（即三国合约，`execContract` 也发往此处）。
2. **spend 双绑**：合约 `sanguo_auth` 把 `spend` 同时作 `bet_amount` 与 `amount_payout`；前端 `opts.spend` 逐动作对齐（ai→`params.ai_fee[diff-1]`，pvp/royale→对应 fee，其余 0），且以十进制字符串参与签名，与 `Uint128` Display 一致。
3. **action 字符串** 20 个前后端全部对齐；**查询响应字段**（`yes_votes`/`no_votes`、`reward_claimed`、`is_public`、`winner`、`status` 等）与**状态机字符串**（`waiting`/`full`/`finished`/`cancelled`）前后端一致。
4. 未修改任何 `.rs`；`cargo check` 仍 Finished（0 error）。按用户要求未编译 wasm。
