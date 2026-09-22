// 本轮改动（R12）：sanguoExec 中 Session.sign 调用补 await（@noble/secp256k1@2.x 的 sign 为异步，不 await 会得到空串签名）。
/**
 * 🀄 三国卡牌前端子系统（新通用合约版）
 * --------------------------------------------------------------
 * 设计原则（按用户要求）：
 *   1. 所有卡牌地址（image_url）与玩法逻辑沿用原始三国源码，不改动。
 *   2. 底层合约调用改为新统一合约的 Sanguo* 消息 + 会话无感签名
 *      （复用 games/mod.rs::validate_and_consume_session）。
 *   3. 完整玩法已恢复：抽卡 / 我的卡 / AI 对战 / 养成 / 提案 / PVP / 混战
 *      七个页签，全部走无感签名（session key），仅会话注册时钱包弹一次。
 *      合约侧 msg.rs / exec.rs / query.rs / mod.rs / error.rs / state.rs
 *      已全部恢复并经 cargo check 通过（按用户要求不编译 wasm）。
 *
 * 签名原文（与合约一致）：
 *   "{chain_id}:{contract}:sanguo:{action}:{round_id}:{spend}:{nonce}:{pubkey}"
 *   裸 SHA-256 → secp256k1 compact 签名（64 bytes hex）。
 */

(function () {
  'use strict';

  // ============================================================
  // 卡牌数据（与原始三国源码逐字一致，不改动地址 / 属性）
  // ============================================================
  const CARD_TEMPLATES = [
    { name: '曹操', title: '魏武挥鞭', rarity: 'legend', attack: 105, defense: 95, identity: '魏·武帝' },
    { name: '诸葛亮', title: '卧龙出山', rarity: 'legend', attack: 110, defense: 90, identity: '蜀·丞相' },
    { name: '关羽', title: '武圣降世', rarity: 'legend', attack: 115, defense: 85, identity: '蜀·五虎将' },
    { name: '赵云', title: '常山龙胆', rarity: 'legend', attack: 100, defense: 100, identity: '蜀·五虎将' },
    { name: '吕布', title: '飞将无双', rarity: 'legend', attack: 120, defense: 80, identity: '汉·温侯' },
    { name: '司马懿', title: '冢虎沉谋', rarity: 'legend', attack: 95, defense: 110, identity: '魏·太傅' },
    { name: '张飞', title: '当阳怒吼', rarity: 'epic', attack: 95, defense: 75, identity: '蜀·五虎将' },
    { name: '马超', title: '锦马超', rarity: 'epic', attack: 90, defense: 80, identity: '蜀·五虎将' },
    { name: '黄忠', title: '百步穿杨', rarity: 'epic', attack: 85, defense: 85, identity: '蜀·五虎将' },
    { name: '姜维', title: '麒麟之志', rarity: 'epic', attack: 88, defense: 82, identity: '蜀·大将军' },
    { name: '周瑜', title: '赤壁东风', rarity: 'epic', attack: 80, defense: 90, identity: '吴·大都督' },
    { name: '陆逊', title: '火烧连营', rarity: 'epic', attack: 82, defense: 88, identity: '吴·大都督' },
    { name: '夏侯惇', title: '拔矢啖睛', rarity: 'epic', attack: 92, defense: 78, identity: '魏·大将军' },
    { name: '张辽', title: '威震逍遥', rarity: 'epic', attack: 88, defense: 82, identity: '魏·五子良将' },
    { name: '魏延', title: '汉中镇守', rarity: 'rare', attack: 75, defense: 70, identity: '蜀·镇北将军' },
    { name: '庞统', title: '凤雏落凤', rarity: 'rare', attack: 70, defense: 75, identity: '蜀·军师中郎将' },
    { name: '法正', title: '睚眦必报', rarity: 'rare', attack: 68, defense: 72, identity: '蜀·尚书令' },
    { name: '甘宁', title: '锦帆贼', rarity: 'rare', attack: 80, defense: 60, identity: '吴·折冲将军' },
    { name: '太史慈', title: '北海救孔', rarity: 'rare', attack: 72, defense: 68, identity: '吴·建昌都尉' },
    { name: '孙策', title: '小霸王', rarity: 'rare', attack: 78, defense: 62, identity: '吴·讨逆将军' },
    { name: '吕蒙', title: '吴下阿蒙', rarity: 'rare', attack: 65, defense: 75, identity: '吴·大都督' },
    { name: '邓艾', title: '阴平奇兵', rarity: 'rare', attack: 70, defense: 70, identity: '魏·征西将军' },
    { name: '廖化', title: '蜀中先锋', rarity: 'common', attack: 50, defense: 45, identity: '蜀·车骑将军' },
    { name: '简雍', title: '雍容辩士', rarity: 'common', attack: 40, defense: 50, identity: '蜀·昭德将军' },
    { name: '孙乾', title: '雍容辩士', rarity: 'common', attack: 38, defense: 48, identity: '蜀·秉忠将军' },
    { name: '糜竺', title: '富商军师', rarity: 'common', attack: 42, defense: 42, identity: '蜀·安汉将军' },
    { name: '诸葛瑾', title: '敦厚长者', rarity: 'common', attack: 45, defense: 55, identity: '吴·大将军' },
    { name: '鲁肃', title: '单刀赴会', rarity: 'common', attack: 48, defense: 52, identity: '吴·横江将军' },
    { name: '程昱', title: '兖州谋主', rarity: 'common', attack: 44, defense: 46, identity: '魏·卫尉' },
    { name: '贾诩', title: '毒士乱武', rarity: 'common', attack: 46, defense: 44, identity: '魏·太尉' },
  ];

  // 卡牌图片地址（与原始源码一致，不改动）
  const IMAGE_URLS = [
    'https://i.ibb.co/0pXyCqvs/image.png',
    'https://i.ibb.co/vvKKdPCq/image.png',
    'https://i.ibb.co/6743V8cB/image.png',
    'https://i.ibb.co/z98s8dS/image.png',
    'https://i.ibb.co/S7Qjr3Hk/image.png',
    'https://i.ibb.co/S7RB8T90/image.png',
    'https://i.ibb.co/xSX7Bv0q/image.png',
    'https://i.ibb.co/jkFY9h1Z/image.png',
    'https://i.ibb.co/70bYyjF/image.png',
    'https://i.ibb.co/k2HxGQ25/image.png',
    'https://i.ibb.co/99p7TBpH/image.png',
    'https://i.ibb.co/BKc8bJgc/image.png',
    'https://i.ibb.co/Pz35X0Hc/image.png',
    'https://i.ibb.co/4wwW0yRv/image.png',
    'https://i.ibb.co/99DDBg1y/image.png',
    'https://i.ibb.co/mrpP4bYk/image.png',
    'https://i.ibb.co/jpMd1Bw/image.png',
    'https://i.ibb.co/JVxVCnV/image.png',
    'https://i.ibb.co/dhWs803/image.png',
    'https://i.ibb.co/VWm6yT7W/image.png',
    'https://i.ibb.co/WpvPY4y9/image.png',
    'https://i.ibb.co/KxZZb9RF/image.png',
    'https://i.ibb.co/W4wfdFWg/image.png',
    'https://i.ibb.co/vCLxJLyP/image.png',
    'https://i.ibb.co/PGMxkthb/image.png',
    'https://i.ibb.co/Z6sBmsxK/image.png',
    'https://i.ibb.co/yF6JZxTC/image.png',
    'https://i.ibb.co/tPPt4J3c/image.png',
    'https://i.ibb.co/fmGRNrc/image.png',
    'https://i.ibb.co/pvjK82Yb/image.png',
  ];

  // ============================================================
  // 多语言（沿用原始三国词库；同时响应大厅全局语言切换）
  // ============================================================
  const i18n = {
    zh: {
      'sg_title': '🀄 三国·卡牌',
      'sg_subtitle': '消耗 PAXI + TKCC 抽取武将卡牌，永久归你所有。',
      'tab_draw': '🎴 抽卡',
      'tab_mycards': '🃏 我的卡',
      'draw_single': '🗡️ 单抽',
      'draw_pack3': '🎴 三连抽',
      'draw_single_title': '🗡️ 单抽（1 张）',
      'draw_pack3_title': '🎴 三连抽（3 张）',
      'cost_label': '消耗',
      'bal_title': '💰 余额',
      'bal_tkcc': '合约内 TKCC',
      'loading': '加载中…',
      'my_cards': '我的卡牌',
      'my_cards_desc': '所有已拥有的武将卡牌，永久保存。',
      'empty_cards': '点击「抽卡」获取卡牌',
      'power_label': '战力',
      'insufficient': '余额不足，请先充值 TKCC',
      'connect_first': '请先连接钱包',
      'params_err': '无法读取三国合约参数，请检查合约地址与网络连接后重试',
      'draw_doing': '抽卡中…',
      'draw_ok': '成功！新卡已入账',
      'draw_ok_short': '抽卡成功！',
      'draw_fail': '抽卡失败：',
      'register_session': '注册会话…',
      'back_home': '← 游戏大厅',
      'contract_missing': '请先在「我的」填写合约地址',
      // ---- 第七轮恢复：完整玩法页签 ----
      'tab_ai': 'AI 对战',
      'tab_cultivate': '养成',
      'tab_proposal': '提案',
      'tab_pvp': 'PVP',
      'tab_royale': '混战',
      'tab_ledger': '📊 收入对账',
      'ai_title': 'AI 对战',
      'ai_desc': '选择难度挑战 AI，胜则赢取 TKCC 奖励',
      'ai_diff': '难度',
      'ai_fee': '挑战费',
      'ai_reward': '胜率奖励',
      'ai_pending_hint': '你已赢 {n} 场，奖励需点击下方按钮领取后才会到钱包。',
      'ai_stats': '今日已战',
      'cult_title': '养成',
      'cult_desc': '升星 / 分解 / 升级 / 合成 / 出战顺序',
      'frag_title': '碎片',
      'rarity_common': '普通',
      'rarity_rare': '稀有',
      'rarity_epic': '史诗',
      'rarity_legend': '传说',
      'order_title': '出战顺序',
      'set_order_btn': '设置顺序',
      'starup_btn': '升星',
      'decompose_btn': '分解',
      'upgrade_btn': '升级',
      'decompose_confirm': '确定要分解这张卡牌吗？\n分解后卡牌消失、获得对应碎片，不可恢复！',
      'select_rarity': '选择稀有度',
      'craft_btn': '合成',
      'craft_desc': '消耗对应稀有度碎片，随机获得一张该稀有度卡牌。',
      'craft_common': '🟤 合成普通（{cost} 碎片）',
      'craft_rare': '🔵 合成稀有（{cost} 碎片）',
      'craft_epic': '🟣 合成史诗（{cost} 碎片）',
      'craft_legend': '🟡 合成传说（{cost} 碎片）',
      'craft_insufficient': '碎片不足：需要 {need}，当前 {have}',
      'select_card_first': '请先选择卡牌',
      'prop_title': '卡牌提案',
      'prop_desc': '提交新武将卡，社区投票通过后上链',
      'prop_propose': '提交新卡提案',
      'prop_name': '卡牌名',
      'prop_attack': '攻击',
      'prop_defense': '防御',
      'prop_weight': '权重',
      'prop_submit': '提交提案',
      'prop_list': '提案列表',
      'prop_votes': '票数',
      'prop_approved': '已通过',
      'prop_rejected': '已否决',
      'prop_open': '投票中',
      'prop_vote_yes': '赞成',
      'prop_vote_no': '反对',
      'prop_execute': '执行',
      'prop_cancel': '撤销',
      'pvp_title': 'PVP 1v1',
      'pvp_desc': '与好友 1v1 对战',
      'pvp_create': '创建对战',
      'pvp_opponent': '对手地址',
      'pvp_public': '公开匹配',
      'pvp_list': '对战列表',
      'pvp_accept': '接受',
      'pvp_cancel': '取消',
      'pvp_claim': '领取',
      'royale_title': '混战',
      'royale_desc': '4-6 人混战，最后存活者通吃',
      'royale_create': '创建混战',
      'royale_size': '人数',
      'royale_join': '加入',
      'royale_settle': '结算',
      'royale_claim': '领取',
      'royale_list': '混战列表',
      'pending_reward': '待领取奖励',
      'claim_btn': '领取',
      'doing': '处理中…',
      'ok_short': '成功',
      'fail_prefix': '操作失败：',
      'need_connect': '请先连接钱包并选择卡牌',
      // ---- 第七轮恢复：补充文案 ----
      'ai_today': '今日已战',
      'ai_limit': '每日上限',
      'win_rate': '胜率',
      'order_max': '出战顺序最多 8 张',
      'selected_label': '已选',
      'prop_id': '卡牌 ID',
      'prop_status': '状态',
      'prop_yes': '赞成票',
      'prop_no': '反对票',
      'prop_deadline': '截止',
      'deposit_label': '提案押金',
      'none_label': '暂无',
      'match_id_label': '对局',
      'status_label': '状态',
      'opponent_label': '对手',
      'winner_label': '胜者',
      'reward_label': '奖励',
      'pick_title': '选择卡牌',
      'create_ok': '已创建',
      'accept_ok': '已接受',
      'join_ok': '已加入',
      'settle_ok': '已结算',
      'execute_ok': '已执行',
      'cancel_ok': '已撤销',
      'propose_ok': '提案已提交',
      'vote_ok': '投票成功',
      'claim_ok': '已领取',
      // ---- 到账/消耗金额提示（前端自解析交易事件，绕开钱包把 burn 当到账显示的问题） ----
      'claim_in': '✅ 已到账 {amt} TKCC',
      'claim_in_burn': '✅ 已到账 {amt} TKCC（合约另销毁 {burned} TKCC）',
      'spent_tip': '✅ {what} · 本次消耗 {amt} TKCC（合约内余额扣除）',
      'need_three': '请先选择 3 张卡牌',

      // ---- 老合约资产迁移 ----
      'migrate_title': '老合约资产迁移',
      'migrate_desc': '把老三国合约里的卡牌（保留稀有度/攻防/星级/等级）和碎片一次性迁移到新合约。每个钱包只能迁移一次。',
      'migrate_btn': '一键迁移',
      'migrate_doing': '迁移中…',
      'migrate_ok': '迁移完成',
      'migrate_done': '该钱包已迁移过，无需重复操作',
      'migrate_opening': '管理员尚未开放迁移入口',
      'migrate_none': '老合约里没有可迁移的卡牌或碎片',
      // ---- 迁移上限说明（gas 容量约束）----
      'migrate_limit_note': '⚠️ 单次最多迁移 30 张卡（gas 容量上限）。老合约卡牌超过 30 张的，请先在老合约里把多余的卡分解掉，再回来迁移。每个钱包只有一次迁移机会，但迁移失败不会消耗这次机会。',
      'migrate_over_limit': '老合约有 {n} 张卡，超过单次上限 {max} 张。请先在老合约分解掉 {over} 张后再迁移（分解后本提示会自动刷新）。',
      'migrate_gas_hint': '本次按 {n} 张卡设置 gas 上限 {gas}（手续费按声明上限全额扣，未用完不退还）。',
      'migrate_no_preview': '（未能读取老合约卡数，已按 {max} 张卡的上限准备 gas）',
      'migrate_blocked': '老合约卡数超限，请先分解后再迁移',
      'migrate_old_summary': '老合约：{n} 张卡 · 碎片(普/稀/史/传) {fg}',
      'migrate_ok_detail': '✅ {msg}：{minted} 张卡，{frags} 碎片{skipped}',
      'migrate_ok_skip': '（跳过 {n}）',

      // ---- 统计卡 / 图鉴 ----
      'sg_stat_wins': '胜场', 'sg_stat_cards': '总卡牌', 'sg_stat_battles': '总对战', 'sg_stat_frag': '碎片',
      'codex_open': '📚 卡牌图鉴（{n} 将）',
      'codex_progress': '收集进度：{own} / {total}（点击卡牌查看详情）',
      'codex_not_owned': '未拥有',

      // ---- 卡牌详情 ----
      'detail_title_wrap': '「{t}」',
      'detail_stats': '{identity}{title}　攻击 {atk} · 防御 {def} · 战力 {pow}',

      // ---- AI 出战选择 ----
      'ai_my_cards': '我的卡牌',
      'ai_pick_title': '🃏 选择出战卡牌',
      'ai_pick_desc': '最多选 3 张，顺序即出牌顺序（第 1 张先出）。不选则沿用你已有的出战顺序。',
      'ai_need_three_btn': '需至少 3 张卡牌',
      'ai_need_three_hint': '❌ AI 对战需要至少 3 张卡牌，请先去「抽卡」获得卡牌后再来挑战。',
      'ai_need_three_msg': 'AI 对战需要至少 3 张卡牌，请先去「抽卡」获得卡牌后再来挑战。',
      'order_saved': '出牌顺序：{names}',

      // ---- 对战竞技场 ----
      'battle_result_title': '⚔️ 对战结果',
      'battle_win': '🏆 胜利！', 'battle_lose': '💀 失败', 'battle_draw': '🤝 平局',
      'battle_you': '你', 'battle_opp': '对手',
      'battle_deployed': '（出战）',
      'battle_reward': '奖励：{amt} TKCC',
      'battle_rounds': '三局 {n} 胜',
      'battle_challenger': '挑战方', 'battle_defender': '应战方',
      'battle_ai_general': 'AI 战将', 'battle_ai_diff': 'AI 难度 {n}',

      // ---- 抽卡余额不足 ----
      'draw_mode_single': '单抽', 'draw_mode_pack3': '三连抽',
      'draw_paxi_lack': '合约内 PAXI 不足：{mode}需要 {need} PAXI，当前只有 {have} PAXI，请先充值至少 {lack} PAXI',

      // ---- 升星 / 升级 / 分解 ----
      'err_card_notfound': '找不到该卡牌，请刷新「我的卡」后重试',
      'err_max_star': '⭐ 该卡已满星（5★），无法继续升星',
      'err_bal_query': '查询合约内余额失败，请稍后重试',
      'err_tkcc_star': '合约内 TKCC 不足：{from}★→{to}★ 需要 {need} TKCC，当前 {have} TKCC，请先在「钱包」充值',
      'confirm_star_up': '升星 {from}★ → {to}★\n\n费用：{fee} TKCC（从合约内余额扣）\n其中销毁 {half} + 资金池 {half}\n\n确定 = 升星，取消 = 中止',
      'err_frag_star': '碎片不足：碎片升星需要 {need} 个{rarity}碎片，当前 {have} 个（碎片升星不花 TKCC）',
      'confirm_star_frag': '碎片升星 {from}★ → {to}★\n\n消耗 {need} 个{rarity}碎片（不花 TKCC、不销毁）\n当前拥有 {have} 个\n\n确定 = 升星，取消 = 中止',
      'err_max_level': '💠 该卡已满级（Lv10），无法继续升级',
      'err_frag_level': '碎片不足：升级 Lv{from}→Lv{to} 需要 {need} 个{rarity}碎片，当前 {have} 个',
      'err_sig_format': '会话签名异常（签名为空）——通常是浏览器缓存了旧版脚本，请强制刷新页面（或清除缓存）后重试',
      'confirm_level_up': '升级 Lv{from} → Lv{to}\n\n消耗 {need} 个{rarity}碎片\n收益：攻击 +3 · 防御 +2（战力 +5）\n当前拥有 {have} 个\n\n确定 = 升级，取消 = 中止',
      'confirm_decompose': '⚠️ 分解后该卡将永久消失！\n\n「{name}」{star}★ Lv{lv}\n仅返还 {back} 个{rarity}碎片\n（不退还已投入的星级/等级/费用，养成后分解=白烧钱）\n\n确定 = 分解，取消 = 保留',

      // ---- 管理员对账页 ----
      'ledger_loading': '查询中…',
      'ledger_scanning': '⏳ 正在逐笔解析链上抽卡事件…',
      'ledger_rpc_limited': '⚠️ 逐笔统计需访问链节点(RPC)，当前环境受限（如在手机钱包内打开）。请在桌面浏览器打开本页以查看逐笔收到。',
      'ledger_scan_ok': '✅ 已逐笔解析全部抽卡交易（链上为准）。',
      'ledger_scan_fail': '⚠️ 逐笔解析不可用，下列“收到”列为 — 。',
      'ledger_th_addr': '抽水地址', 'ledger_th_count': '笔数', 'ledger_th_paxi': '收到 PAXI', 'ledger_th_tkcc': '收到 TKCC',
      'ledger_total': '合计',
      'ledger_total_burn': '游戏合约累计销毁 TKCC',
      'ledger_burn_desc': '销毁为真实 burn（token 永久消失），不进任何钱包；与每笔抽卡 TKCC 的 40% 一致。',
      'ledger_wallet_note': '说明：钱包/Ping.pub 对 PRC-20 的 wasm 转账事件解析有误（常把 10 PAXI 错标成 10 TKCC、漏显 12 万 TKCC）。本页直接读链上事件，数字与链一致。',
      'ledger_done': '✅ 完成，共 {n} 个抽水地址',
      'ledger_admin_only': '⛔ 此页面仅管理员可见。',
      'ledger_title': '📊 收入对账（管理员）',
      'ledger_desc': '逐笔解析 {n} 个抽水地址的抽卡 wasm 事件，显示真实收到的 PAXI + TKCC（链上为准，不受钱包显示影响）。含游戏合约累计销毁。',
      'ledger_refresh': '🔄 刷新对账',
      'ledger_hint_click': '点击「刷新对账」开始加载…',
    },
    en: {
      'sg_title': '🀄 Three Kingdoms · Cards',
      'sg_subtitle': 'Spend PAXI + TKCC to draw general cards — yours forever.',
      'tab_draw': '🎴 Draw',
      'tab_mycards': '🃏 My Cards',
      'draw_single': '🗡️ Single',
      'draw_pack3': '🎴 Triple',
      'draw_single_title': '🗡️ Single Draw (1 card)',
      'draw_pack3_title': '🎴 Triple Draw (3 cards)',
      'cost_label': 'Cost',
      'bal_title': '💰 Balance',
      'bal_tkcc': 'In-contract TKCC',
      'loading': 'Loading…',
      'my_cards': 'My Cards',
      'my_cards_desc': 'All your general cards, stored permanently.',
      'empty_cards': 'Tap "Draw" to get cards',
      'power_label': 'Power',
      'insufficient': 'Insufficient balance, deposit TKCC first',
      'connect_first': 'Please connect your wallet first',
      'params_err': 'Failed to read Sanguo contract params. Check the contract address and network, then retry.',
      'draw_doing': 'Drawing…',
      'draw_ok': 'Success! New cards added',
      'draw_ok_short': 'Draw succeeded!',
      'draw_fail': 'Draw failed: ',
      'register_session': 'Registering session…',
      'back_home': '← Game Hub',
      'contract_missing': 'Set the contract address in "My Account" first',
      // ---- 第七轮恢复：完整玩法页签 ----
      'tab_ai': 'AI Battle',
      'tab_cultivate': 'Cultivate',
      'tab_proposal': 'Proposal',
      'tab_pvp': 'PVP',
      'tab_royale': 'Royale',
      'tab_ledger': '📊 Ledger',
      'ai_title': 'AI Battle',
      'ai_desc': 'Pick a difficulty and battle the AI; win TKCC rewards',
      'ai_diff': 'Difficulty',
      'ai_fee': 'Entry fee',
      'ai_reward': 'Win reward',
      'ai_pending_hint': 'You won {n} battles — tap below to claim to your wallet.',
      'ai_stats': 'Battles today',
      'cult_title': 'Cultivate',
      'cult_desc': 'Star up / Decompose / Upgrade / Craft / Battle order',
      'frag_title': 'Fragments',
      'rarity_common': 'Common',
      'rarity_rare': 'Rare',
      'rarity_epic': 'Epic',
      'rarity_legend': 'Legend',
      'order_title': 'Battle order',
      'set_order_btn': 'Set order',
      'starup_btn': 'Star up',
      'decompose_btn': 'Decompose',
      'upgrade_btn': 'Upgrade',
      'decompose_confirm': 'Decompose this card?\nThe card will be converted into fragments. This cannot be undone!',
      'select_rarity': 'Select Rarity',
      'craft_btn': 'Craft',
      'craft_desc': 'Spend fragments of a rarity to get a random card of that rarity.',
      'craft_common': '🟤 Craft Common ({cost} frags)',
      'craft_rare': '🔵 Craft Rare ({cost} frags)',
      'craft_epic': '🟣 Craft Epic ({cost} frags)',
      'craft_legend': '🟡 Craft Legend ({cost} frags)',
      'craft_insufficient': 'Not enough fragments: need {need}, you have {have}',
      'select_card_first': 'Select a card first',
      'prop_title': 'Card Proposals',
      'prop_desc': 'Submit a new general card; on-chain after community vote',
      'prop_propose': 'Propose new card',
      'prop_name': 'Card name',
      'prop_attack': 'Attack',
      'prop_defense': 'Defense',
      'prop_weight': 'Weight',
      'prop_submit': 'Submit proposal',
      'prop_list': 'Proposal list',
      'prop_votes': 'Votes',
      'prop_approved': 'Approved',
      'prop_rejected': 'Rejected',
      'prop_open': 'Voting',
      'prop_vote_yes': 'Yes',
      'prop_vote_no': 'No',
      'prop_execute': 'Execute',
      'prop_cancel': 'Cancel',
      'pvp_title': 'PVP 1v1',
      'pvp_desc': '1v1 battle with a friend',
      'pvp_create': 'Create match',
      'pvp_opponent': 'Opponent address',
      'pvp_public': 'Public match',
      'pvp_list': 'Match list',
      'pvp_accept': 'Accept',
      'pvp_cancel': 'Cancel',
      'pvp_claim': 'Claim',
      'royale_title': 'Royale',
      'royale_desc': '4-6 player brawl; last survivor takes all',
      'royale_create': 'Create royale',
      'royale_size': 'Size',
      'royale_join': 'Join',
      'royale_settle': 'Settle',
      'royale_claim': 'Claim',
      'royale_list': 'Royale list',
      'pending_reward': 'Pending rewards',
      'claim_btn': 'Claim',
      'doing': 'Processing…',
      'ok_short': 'Success',
      'fail_prefix': 'Failed: ',
      'need_connect': 'Connect wallet and select a card first',
      // ---- 第七轮恢复：补充文案 ----
      'ai_today': 'Battles today',
      'ai_limit': 'Daily limit',
      'win_rate': 'Win rate',
      'order_max': 'Up to 8 cards in battle order',
      'selected_label': 'Selected',
      'prop_id': 'Card ID',
      'prop_status': 'Status',
      'prop_yes': 'Yes votes',
      'prop_no': 'No votes',
      'prop_deadline': 'Deadline',
      'deposit_label': 'Deposit',
      'none_label': 'None',
      'match_id_label': 'Match',
      'status_label': 'Status',
      'opponent_label': 'Opponent',
      'winner_label': 'Winner',
      'reward_label': 'Reward',
      'pick_title': 'Select cards',
      'create_ok': 'Created',
      'accept_ok': 'Accepted',
      'join_ok': 'Joined',
      'settle_ok': 'Settled',
      'execute_ok': 'Executed',
      'cancel_ok': 'Cancelled',
      'propose_ok': 'Proposal submitted',
      'vote_ok': 'Voted',
      'claim_ok': 'Claimed',
      // ---- Payout / spend amount tips (parsed from the tx itself) ----
      'claim_in': '✅ Received {amt} TKCC',
      'claim_in_burn': '✅ Received {amt} TKCC (contract burned {burned} TKCC)',
      'spent_tip': '✅ {what} · spent {amt} TKCC (from in-contract balance)',
      'need_three': 'Select 3 cards first',

      // ---- Old contract migration ----
      'migrate_title': 'Old contract migration',
      'migrate_desc': 'Move your cards (rarity/ATK/DEF/star/level preserved) and fragments from the old Three-Kingdoms contract in one shot. Once per wallet.',
      'migrate_btn': 'Migrate now',
      'migrate_doing': 'Migrating…',
      'migrate_ok': 'Migration complete',
      'migrate_done': 'This wallet has already migrated',
      'migrate_opening': 'Migration not opened yet',
      'migrate_none': 'No cards or fragments to migrate',
      // ---- Migration cap (gas budget) ----
      'migrate_limit_note': '⚠️ Max 30 cards per migration (gas budget cap). If you hold more than 30 cards on the old contract, decompose the extra ones there first, then come back. One migration per wallet — a failed migration does not use up that chance.',
      'migrate_over_limit': 'You have {n} cards on the old contract, over the {max}-card limit. Please decompose {over} of them first (this hint refreshes automatically afterwards).',
      'migrate_gas_hint': 'Gas limit set to {gas} for {n} cards (the declared fee is charged in full; unused gas is NOT refunded).',
      'migrate_no_preview': '(Could not read old-contract card count; gas prepared for the {max}-card cap.)',
      'migrate_blocked': 'Card count over the limit — decompose first, then migrate',
      'migrate_old_summary': 'Old contract: {n} cards · fragments (C/R/E/L) {fg}',
      'migrate_ok_detail': '✅ {msg}: {minted} cards, {frags} fragments{skipped}',
      'migrate_ok_skip': ' (skipped {n})',

      // ---- stat cards / codex ----
      'sg_stat_wins': 'Wins', 'sg_stat_cards': 'Cards', 'sg_stat_battles': 'Battles', 'sg_stat_frag': 'Fragments',
      'codex_open': '📚 Card Codex ({n} generals)',
      'codex_progress': 'Collecting: {own} / {total} (tap a card for details)',
      'codex_not_owned': 'Not owned',

      // ---- card detail ----
      'detail_title_wrap': '"{t}"',
      'detail_stats': '{identity}{title}  ATK {atk} · DEF {def} · Power {pow}',

      // ---- AI lineup picker ----
      'ai_my_cards': 'My Cards',
      'ai_pick_title': '🃏 Pick battle cards',
      'ai_pick_desc': 'Pick up to 3 cards; the order is the play order (first card goes first). Leave empty to keep your current lineup.',
      'ai_need_three_btn': 'Need at least 3 cards',
      'ai_need_three_hint': '❌ AI battle needs at least 3 cards. Draw cards first, then come back.',
      'ai_need_three_msg': 'AI battle needs at least 3 cards. Draw cards first, then come back.',
      'order_saved': 'Play order: {names}',

      // ---- battle arena ----
      'battle_result_title': '⚔️ Battle Result',
      'battle_win': '🏆 Victory!', 'battle_lose': '💀 Defeat', 'battle_draw': '🤝 Draw',
      'battle_you': 'You', 'battle_opp': 'Opponent',
      'battle_deployed': ' (deployed)',
      'battle_reward': 'Reward: {amt} TKCC',
      'battle_rounds': '{n} round wins',
      'battle_challenger': 'Challenger', 'battle_defender': 'Defender',
      'battle_ai_general': 'AI General', 'battle_ai_diff': 'AI Lv.{n}',

      // ---- draw: insufficient PAXI ----
      'draw_mode_single': 'Single draw', 'draw_mode_pack3': 'Triple draw',
      'draw_paxi_lack': 'Insufficient in-contract PAXI: {mode} needs {need} PAXI, you have {have} PAXI. Deposit at least {lack} PAXI first.',

      // ---- star-up / level-up / decompose ----
      'err_card_notfound': 'Card not found. Refresh "My Cards" and retry.',
      'err_max_star': '⭐ This card is already at max stars (5★).',
      'err_bal_query': 'Failed to read in-contract balance. Please try again later.',
      'err_tkcc_star': 'Insufficient in-contract TKCC: {from}★→{to}★ needs {need} TKCC, you have {have} TKCC. Deposit in "Wallet" first.',
      'confirm_star_up': 'Star-up {from}★ → {to}★\n\nCost: {fee} TKCC (deducted from in-contract balance)\nof which burn {half} + bankroll {half}\n\nOK = star up, Cancel = abort',
      'err_frag_star': 'Not enough fragments: fragment star-up needs {need} {rarity} fragments, you have {have} (no TKCC required).',
      'confirm_star_frag': 'Fragment star-up {from}★ → {to}★\n\nConsumes {need} {rarity} fragments (no TKCC, no burn)\nYou have {have}\n\nOK = star up, Cancel = abort',
      'err_max_level': '💠 This card is already at max level (Lv10).',
      'err_frag_level': 'Not enough fragments: level-up Lv{from}→Lv{to} needs {need} {rarity} fragments, you have {have}.',
      'err_sig_format': 'Session signature error (signature is empty) — usually the browser cached an old script. Hard-refresh the page (or clear cache) and retry.',
      'confirm_level_up': 'Level-up Lv{from} → Lv{to}\n\nConsumes {need} {rarity} fragments\nGain: ATK +3 · DEF +2 (Power +5)\nYou have {have}\n\nOK = level up, Cancel = abort',
      'confirm_decompose': '⚠️ Decomposing permanently destroys this card!\n\n"{name}" {star}★ Lv{lv}\nOnly {back} {rarity} fragments are returned\n(stars/levels/fees already invested are not refunded — decomposing an upgraded card wastes them)\n\nOK = decompose, Cancel = keep',

      // ---- admin ledger page ----
      'ledger_loading': 'Loading…',
      'ledger_scanning': '⏳ Parsing on-chain draw events one by one…',
      'ledger_rpc_limited': '⚠️ Per-tx stats need RPC access, which is restricted here (e.g. inside a mobile wallet). Open this page in a desktop browser to see per-tx receipts.',
      'ledger_scan_ok': '✅ All draw transactions parsed per-tx (on-chain is authoritative).',
      'ledger_scan_fail': '⚠️ Per-tx parsing unavailable; the "received" columns show — .',
      'ledger_th_addr': 'Fee address', 'ledger_th_count': 'Txs', 'ledger_th_paxi': 'PAXI received', 'ledger_th_tkcc': 'TKCC received',
      'ledger_total': 'Total',
      'ledger_total_burn': 'Total TKCC burned by game contract',
      'ledger_burn_desc': 'Burn is a real burn (tokens permanently destroyed), reaching no wallet; matches the 40% TKCC portion of each draw.',
      'ledger_wallet_note': 'Note: wallets/Ping.pub mis-parse PRC-20 wasm transfer events (often labeling 10 PAXI as 10 TKCC, or hiding the 120,000 TKCC). This page reads on-chain events directly, so the numbers match the chain.',
      'ledger_done': '✅ Done, {n} fee addresses',
      'ledger_admin_only': '⛔ This page is admin-only.',
      'ledger_title': '📊 Revenue reconciliation (admin)',
      'ledger_desc': 'Parses draw wasm events per-tx across {n} fee addresses, showing the real PAXI + TKCC received (on-chain is authoritative, unaffected by wallet display). Includes cumulative burn of the game contract.',
      'ledger_refresh': '🔄 Refresh',
      'ledger_hint_click': 'Tap "Refresh" to start loading…',
    },
  };
  function t(k) {
    const l = (window.HUB_LANG === 'en') ? 'en' : 'zh';
    return (i18n[l] && i18n[l][k] != null) ? i18n[l][k] : (i18n.zh[k] != null ? i18n.zh[k] : k);
  }
  /** 带占位的文案：tf('migrate_over_limit', { n: 40, max: 30, over: 10 }) */
  function tf(k, vars) {
    return String(t(k)).replace(/\{(\w+)\}/g, (_, key) => (vars && vars[key] != null ? vars[key] : `{${key}}`));
  }

  // ============================================================
  // 工具
  // ============================================================
  function getCardImage(name) {
    const idx = CARD_TEMPLATES.findIndex((c) => c.name === name);
    return idx >= 0 ? IMAGE_URLS[idx] : '';
  }
  const RARITY_LABEL = {
    legend: { zh: '传说', en: 'Legend' },
    epic: { zh: '史诗', en: 'Epic' },
    rare: { zh: '稀有', en: 'Rare' },
    common: { zh: '普通', en: 'Common' },
  };
  function rarityLabel(r) {
    const l = (window.HUB_LANG === 'en') ? 'en' : 'zh';
    return esc((RARITY_LABEL[r] && RARITY_LABEL[r][l]) || r || '');
  }
  function power(c) { return (Number(c.attack || 0) + Number(c.defense || 0)); }

  // 对战里展示玩家地址：只保留前 15 个字符，其余用省略号代替（避免长地址撑破排版）
  function sgShortAddr(a) {
    const s = String(a || '');
    if (s.length <= 15) return s;
    return s.slice(0, 15) + '…';
  }

  // ============================================================
  // 🟢 交易金额自解析（**纯展示层，不改任何业务逻辑**）
  //    TKCC 是 PRC-20(cw20) 代币，链上精度 6。领奖类交易在合约内部会发两条子事件：
  //      transfer（把奖励打给玩家）  +  burn（按 5% 抽水销毁）
  //    第三方钱包常只取"最后一条 PRC-20 事件"→ 把 burn 当作到账额显示
  //    （实测：真实到账 168,000 TKCC 被钱包显示成 36,000 TKCC）。
  //    这里由前端直接读本次交易的 transfer 事件，把**真实到账额**提示给玩家，
  //    玩家无需再回钱包对账。
  // ============================================================
  function sgTkccEvents(tx) {
    const out = { inbound: 0n, burn: 0n };
    if (!tx) return out;
    let self = '';
    try { self = (state.wallet && state.wallet.address) || ''; } catch (_) { self = ''; }
    const evs = [...(tx.events || [])];
    for (const log of tx.logs || []) evs.push(...(log.events || []));
    for (const ev of evs) {
      if (!ev || ev.type !== 'wasm') continue;
      const m = {};
      for (const a of ev.attributes || []) m[a.key] = a.value;   // 本节点 attributes 为明文，勿盲目 base64 解码
      if (m.action === 'transfer' && m.amount && m.to === self) {
        try { out.inbound += BigInt(m.amount); } catch (_) { /* 忽略异常值 */ }
      } else if (m.action === 'burn' && m.amount) {
        try { out.burn += BigInt(m.amount); } catch (_) { /* 忽略异常值 */ }
      }
    }
    return out;
  }

  /** 领奖成功提示：优先显示本次真实到账额；解析不到则回退原文案（如合约改为内部记账时） */
  function sgClaimToast(tx, fallbackKey) {
    const m = sgTkccEvents(tx);
    if (m.inbound > 0n) {
      const key = (m.burn > 0n) ? 'claim_in_burn' : 'claim_in';
      showToast(tf(key, {
        amt: fromRawUnits(String(m.inbound), 6),
        burned: fromRawUnits(String(m.burn), 6),
      }), 'success');
      return;
    }
    showToast(t(fallbackKey), 'success');
  }

  /** 消耗类操作（建房/加入/挑战）成功提示：写明本次扣了多少 TKCC（从合约内余额扣，钱包里看不到） */
  function sgSpentTip(whatKey, rawFee) {
    showToast(tf('spent_tip', {
      what: t(whatKey),
      amt: fromRawUnits(String(rawFee || 0), 6),
    }), 'success');
  }
  const RARITY_ORDER = { legend: 0, epic: 1, rare: 2, common: 3 };
  void RARITY_ORDER; // 保留备用（排序用）
  function rarityColor(r) {
    return { legend: '#fbbf24', epic: '#a78bfa', rare: '#60a5fa', common: '#cbd5e1' }[r] || '#cbd5e1';
  }

  async function requireSanguo() {
    if (!state.connected) {
      const ok = await connectWallet(false);
      if (!ok) throw new Error(t('connect_first'));
    }
    const r = await Session.ensure();
    if (!r.ok) {
      showBusy(t('register_session'));
      try { await Session.register(); } finally { hideBusy(); }
    }
  }

  // ===================== 三国专用签名 + 执行 =====================
  /**
   * 生成 round_id。
   *
   * ⚠️ 格式为 {action}_{blockTime}_{nonce}_{rand}，其中 action 冗余嵌入仅供调试用，
   *    合约只做字符串比较，不解析 round_id 内部结构。
   *    blockTime 取自链上最新区块时间（getBlockTime，内部缓存 5 秒），仅用于增强唯一性。
   *
   *  ℹ️ 更正旧注释：合约验签时直接使用消息里下发的 round_id 原值
   *    （games/mod.rs::validate_and_consume_session 签名原文第 6 段），
   *    并不自行用 env.block.time 计算，因此不存在「区块时间漂移导致验签失败」的问题。
   *    防重放由 nonce 递增保证，round_id 只需保证同 action 下不重复。
   */
  async function sanguoRoundId(action) {
    const T = await getBlockTime();
    return `${action}_${T}_${state.sessNonce}_${Math.floor(Math.random() * 1e6)}`;
  }

  /**
   * 统一签名并执行一个 Sanguo* 消息。
   *
   * ⚠️ opts.action 必须与合约 sanguo_auth 里的 action 完全一致，否则验签会失败。
   *    取值集合（与合约 sanguo_auth 一一对应）：
   *      draw_pack | draw_pack3 | ai_battle | claim_reward | set_battle_order |
   *      star_up | decompose | upgrade | craft | propose | vote | execute_proposal |
   *      cancel_proposal | create_pvp | accept_pvp | cancel_pvp | claim_pvp |
   *      create_royale | join_royale | settle_royale | claim_royale
   *
   *    opts.spend 必须与合约 sanguo_auth 收到的 spend 完全一致（参与签名原文）：
   *      ai_battle → params.ai_fee[diff-1]，create/accept_pvp → params.pvp_fee，
   *      create/join_royale → params.royale_entry_fee，其余为 0。
   *
   * @param variant  PascalCase 执行消息名，如 'SanguoDraw'
   * @param fields   业务字段（不含 round_id/session_addr/nonce/signature）
   * @param opts     { action, spend=0, funds=[] }
   */
  async function sanguoExec(variant, fields, opts) {
    const action = opts.action;
    const spend = opts.spend || 0;

    // 🟢 修复（低危 2）：显式同步链上 nonce，把「调用方必须先调 requireSanguo()」
    //    这一隐式契约显式化 —— 将来新增入口若漏调 requireSanguo，这里仍能兜住。
    //    同步失败不阻断，沿用本地缓存 nonce（与修复前行为一致）。
    try { await Session.syncFromChain(); } catch (e) { /* 沿用本地 nonce */ }

    // 🟢 修复（2026-09-18）：签名守卫 + nonce 漂移自动重试。
    //    此前发生过：手机钱包内置浏览器缓存旧版 session.js → Session.sign 返回空串 →
    //    带 signature:"" 的必败消息仍被推给钱包弹窗 → 用户确认后合约才拒绝。
    //    现在签名不为 128 位 hex 就地报错并提示强刷；nonce 类错误自动重同步重试一次。
    for (let attempt = 1; attempt <= 2; attempt++) {
      const roundId = await sanguoRoundId(action);
      const message = Session.buildMessage({
        gameId: 'sanguo',
        action,
        roundId,
        amountPayout: spend,
        nonce: state.sessNonce,
      });
      const sig = await Session.sign(message);
      if (!sig || !/^[0-9a-f]{128}$/.test(sig)) {
        throw new Error(t('err_sig_format'));
      }
      // ⚠️ 合约 ExecuteMsg 用 #[cw_serde] → 枚举变体按 snake_case 序列化
      //    (SanguoDraw → "sanguo_draw")。此前误用帕斯卡命名会被合约拒绝为 unknown variant。
      //    统一在此处把 PascalCase 变体名转成 snake_case，调用方无需改动。
      const msgKey = variant.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      const payload = {
        [msgKey]: {
          ...fields,
          round_id: roundId,
          session_addr: state.sessAddr,
          nonce: state.sessNonce,
          signature: sig,
        },
      };
      try {
        const hash = await execContract(payload, opts.funds || [], '', opts);
        const tx = await waitForTx(hash);
        Session.bumpNonce();
        // tx 一并返回：调用方可以直接用 parseTxEvents 读本次交易的 attributes，
        // 不必再 poll 一次同一条交易。
        return { hash, roundId, tx };
      } catch (e) {
        // nonce 漂移（换设备/上笔失败/多标签页）→ 重同步链上 nonce 后整体重建
        // round_id + 签名再试一次；其他错误原样抛出。
        if (attempt < 2 && /nonce/i.test(String(e && e.message))) {
          try { await Session.syncFromChain(); } catch (_) { /* 保持本地 nonce */ }
          continue;
        }
        throw e;
      }
    }
    throw new Error('unreachable');
  }

  // ============================================================
  // 老三国卡牌合约（只读，不修改）
  //  地址：paxi1lqjxm6zdvz9sf0lx3280gjj598lqenxeraesfv5334gpnsarc7eqku0zwu
  //  code_id 28 / label 三国卡牌-首发30张 / 未被 migrate（仍存活）
  //
  // 它的 QueryMsg **不带 sanguo_ 前缀**，与新合约不同（跨合约查询由合约侧发起，
  // 这里只是给前端做「迁移前预览」用；迁移本身是合约去查老合约）。
  // 已知可用变体：config / player_cards / get_fragments / rarity_count / …
  // ============================================================
  const OLD_SANGUO_CONTRACT = 'paxi1lqjxm6zdvz9sf0lx3280gjj598lqenxeraesfv5334gpnsarc7eqku0zwu';

  // ===================== 状态 =====================
  let userCards = [];        // CardInfo[]
  let sanguoTab = 'draw';
  let sgJustDrew = false;   // 抽卡成功后置位：下一帧「我的卡牌」网格里的卡走翻牌入场
  let paramsCache = null;
  let tapCountCache = 0;     // 从 sanguo_config 读取的抽水地址数量；查询失败保持 0，doDraw 会拒绝（审计 P2-1）
  let sanguoPicked = [];     // 养成-出战顺序 / PVP / 混战 选中的 card_id 列表
  let sgPendingAction = null; // 'accept_pvp' | 'join_royale'（通用卡牌选择面板）
  let sgPendingId = null;     // 对应的 match_id / royale_id
  // 碎片合成消耗（普通/稀有/史诗/传说）——必须与合约一致：src/sanguo/state.rs::CRAFT_COST = [30,60,150,400]
  const CRAFT_COST = { common: 30, rare: 60, epic: 150, legend: 400 };
  let sgFrags = { common: 0, rare: 0, epic: 0, legend: 0 };  // 合成区用的四档碎片余额

  // 收入对账页仅对管理员钱包可见（管理员 = 部署者钱包）
  const SG_ADMIN = 'paxi1rdarmm997hqwfdgl9wvnpffe28zmex3kfyg7xd';
  function isSgAdmin() {
    return !!(state.wallet && state.wallet.address && state.wallet.address === SG_ADMIN);
  }

  // 七页签（完整玩法），全部走无感签名；标签用 t() 动态取，跟随大厅语言切换
  const SANGUO_TABS = [
    { id: 'draw',      key: 'tab_draw' },
    { id: 'mycards',   key: 'tab_mycards' },
    { id: 'ai',        key: 'tab_ai' },
    { id: 'cultivate', key: 'tab_cultivate' },
    { id: 'proposal',  key: 'tab_proposal' },
    { id: 'pvp',       key: 'tab_pvp' },
    { id: 'royale',    key: 'tab_royale' },
    { id: 'ledger',    key: 'tab_ledger', admin: true },
  ];

  async function loadParams() {
    try {
      const r = await queryContract({ sanguo_params: {} });
      paramsCache = r;
    } catch (e) { paramsCache = null; }
    try {
      const c = await queryContract({ sanguo_config: {} });
      // 🟢 修复（中危 3）：查询成功即覆盖，包括长度 0。
      //    旧写法带 `.length` 真值判断，管理员把 tap_addresses 清空（改为 []）后
      //    tapCountCache 仍保留旧值，前端继续发越界 tap_index → 合约 SanguoInvalidTap，
      //    表现为「明明改了链上配置，抽卡反而报错」。
      tapCountCache = (c && Array.isArray(c.tap_addresses)) ? c.tap_addresses.length : 0;
    } catch (e) {
      tapCountCache = 0;
    }
    return paramsCache;
  }

  // 审计 #15：查询失败时直接抛错，不再用硬编码默认值发交易
  function requireParams() {
    if (!paramsCache) throw new Error(t('params_err'));
    return paramsCache;
  }
  function paxiFeeRaw(pack3) {
    const p = requireParams();
    const v = pack3 ? p.pack3_paxi_fee : p.single_paxi_fee;
    if (v == null) throw new Error(t('params_err'));
    return BigInt(v);
  }
  function prcTotalRaw(pack3) {
    const p = requireParams();
    const v = pack3 ? p.pack3_prc_total : p.single_prc_total;
    if (v == null) throw new Error(t('params_err'));
    return BigInt(v);
  }

  async function loadSanguoCards() {
    if (!state.wallet) return;
    try {
      const r = await queryContract({ sanguo_player_cards: { address: state.wallet.address } });
      userCards = r.cards || [];
    } catch (e) { userCards = []; }
  }

  // ============================================================
  // 入口：从大厅卡片进入
  // ============================================================
  window.openSanguo = function () {
    if (!hasGameContract()) {
      showToast(t('contract_missing'), 'error');
      switchTab('me');
      return;
    }
    renderSanguo();
  };

  function renderSanguo() {
    const main = $('main');
    $('pageTitle').textContent = t('sg_title');
    // 注：包裹在 .sg-page 内 —— 老版金色主题只作用于三国页内部，大厅保持中性、其他游戏不动
    main.innerHTML = `
      <div class="sg-page">
        <div class="back-bar" onclick="switchTab('home')">${t('back_home')}</div>
        <div class="sg-stats">
          <div class="sg-stat"><span class="ic">🏆</span><span class="num" id="sgWin">—</span><span class="lb">${t('sg_stat_wins')}</span></div>
          <div class="sg-stat"><span class="ic">🃏</span><span class="num" id="sgStatCards">0</span><span class="lb">${t('sg_stat_cards')}</span></div>
          <div class="sg-stat"><span class="ic">⚔️</span><span class="num" id="sgBattle">—</span><span class="lb">${t('sg_stat_battles')}</span></div>
          <div class="sg-stat"><span class="ic">🧩</span><span class="num" id="sgFrag" style="color:#ffd700">0</span><span class="lb">${t('sg_stat_frag')}</span></div>
        </div>
        <div class="card">
          <div class="card-title">${t('sg_title')}</div>
          <div class="desc">${t('sg_subtitle')}</div>
        </div>
        <div class="card">
          <button class="btn btn-gold" onclick="openCodex()" style="width:100%">${tf('codex_open', { n: CARD_TEMPLATES.length })}</button>
        </div>
        <div id="sgTabs">
          ${SANGUO_TABS.filter((tb) => !tb.admin || isSgAdmin()).map((tb) => tabBtn(tb.id, t(tb.key))).join('')}
        </div>
        <div id="sgBody"></div>
        <div class="battle-arena" id="battleArena"></div>
      </div>`;
    document.querySelectorAll('#sgTabs .sg-tab').forEach((b) => {
      b.onclick = () => { sanguoTab = b.dataset.tab; updateSgTabs(); renderSanguoTab(); };
    });
    updateSgTabs();
    renderSanguoTab();
    sgSyncWallet();
  }

  function tabBtn(id, label) {
    return `<button class="sg-tab btn btn-ghost btn-sm" data-tab="${id}" style="white-space:nowrap">${label}</button>`;
  }
  function updateSgTabs() {
    document.querySelectorAll('#sgTabs .sg-tab').forEach((b) => {
      b.classList.toggle('btn-primary', b.dataset.tab === sanguoTab);
      b.classList.toggle('btn-ghost', b.dataset.tab !== sanguoTab);
    });
  }

  async function renderSanguoTab() {
    const body = $('sgBody');
    if (!body) return;
    const fns = {
      draw: renderDraw,
      mycards: renderMyCards,
      ai: renderAiBattle,
      cultivate: renderCultivate,
      proposal: renderProposal,
      pvp: renderPvp,
      royale: renderRoyale,
      ledger: renderLedger,
    };
    // 收入对账页仅管理员可见：非管理员误入时回退到抽卡页
    if (sanguoTab === 'ledger' && !isSgAdmin()) { sanguoTab = 'draw'; }
    (fns[sanguoTab] || renderDraw)(body);
  }

  // ============================================================
  // 收入对账（仅管理员可见）：逐笔解析 11 个抽水地址的抽卡 wasm 事件，
  // 显示每个地址真实收到的 PAXI + TKCC（链上为准，不受钱包/Ping.pub 的 PRC-20 解析错误影响）。
  // 注：RPC(tx_search) 在手机钱包内置浏览器可能受限（CORS/端口），失败则降级显示「—」
  //     并提示用桌面浏览器查看；当前余额走 LCD 始终可用。
  // ============================================================
  async function rpcSearchAll(query) {
    const base = NETWORK.rpc + '/tx_search';
    const out = [];
    for (let page = 1; page <= 30; page++) {
      const url = `${base}?query=${encodeURIComponent('"' + query + '"')}&order_by="desc"&page=${page}&per_page=50`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('RPC ' + r.status);
      const d = await r.json();
      const txs = (d && d.result && d.result.txs) || [];
      out.push(...txs);
      const total = Number((d && d.result && d.result.total_count) || 0);
      if (!txs.length || out.length >= total) break;
    }
    return out;
  }

  // 解析一笔抽卡交易事件：仅统计「游戏合约发出」的 TKCC 转账/销毁与 PAXI 原生转账
  function parseDrawTx(evs, gameAddr, tkccAddr) {
    let paxi = 0n, tkcc = 0n, burn = 0n, isDraw = false;
    const byType = {};
    for (const e of evs || []) { (byType[e.type] = byType[e.type] || []).push(e); }
    for (const e of (byType.wasm || [])) {
      const kv = {}; for (const a of e.attributes) kv[a.key] = a.value;
      if (kv.action === 'draw_pack' || kv.action === 'draw_pack3') isDraw = true;
    }
    if (!isDraw) return null;
    for (const e of (byType.wasm || [])) {
      const kv = {}; for (const a of e.attributes) kv[a.key] = a.value;
      if (kv._contract_address === tkccAddr && kv.from === gameAddr) {
        if (kv.action === 'transfer') { try { tkcc += BigInt(kv.amount || '0'); } catch (_) {} }
        if (kv.action === 'burn') { try { burn += BigInt(kv.amount || '0'); } catch (_) {} }
      }
    }
    for (const e of (byType.transfer || [])) {
      const kv = {}; for (const a of e.attributes) kv[a.key] = a.value;
      if (kv.sender === gameAddr && kv.amount && kv.amount.endsWith('upaxi')) {
        try { paxi += BigInt(kv.amount.replace('upaxi', '')); } catch (_) {}
      }
    }
    return { paxi, tkcc, burn };
  }

  async function loadLedger() {
    const body = $('sgLedgerBody');
    const hint = $('sgLedgerHint');
    if (hint) hint.textContent = t('ledger_loading');
    if (body) body.innerHTML = `<div class="hint">${t('ledger_scanning')}</div>`;

    const gameAddr = CONTRACTS.game;
    const tkccAddr = CONTRACTS.tkcc;
    let taps = [];
    try {
      const c = await queryContract({ sanguo_config: {} });
      taps = (c && Array.isArray(c.tap_addresses)) ? c.tap_addresses : [];
    } catch (e) { taps = []; }

    const agg = taps.map((addr) => ({ addr, paxi: 0n, tkcc: 0n, count: 0 }));
    let burnTotal = 0n, scanOk = false;
    try {
      for (let i = 0; i < taps.length; i++) {
        const txs = await rpcSearchAll(`wasm.to='${taps[i]}'`);
        for (const tx of txs) {
          const evs = (tx.tx_result && tx.tx_result.events) || tx.events || [];
          const r = parseDrawTx(evs, gameAddr, tkccAddr);
          if (r) { agg[i].paxi += r.paxi; agg[i].tkcc += r.tkcc; agg[i].count += 1; burnTotal += r.burn; }
        }
      }
      scanOk = true;
    } catch (e) {
      if (hint) hint.textContent = t('ledger_rpc_limited');
    }

    if (!body) return;
    let rows = '', sumP = 0n, sumT = 0n;
    for (const a of agg) { sumP += a.paxi; sumT += a.tkcc;
      rows += `<tr>
        <td style="font-size:10px;word-break:break-all;max-width:140px">${a.addr}</td>
        <td style="text-align:center">${a.count}</td>
        <td>${scanOk ? fromRawUnits(a.paxi.toString()) : '—'}</td>
        <td>${scanOk ? fromRawUnits(a.tkcc.toString()) : '—'}</td>
      </tr>`;
    }
    body.innerHTML = `
      <div class="card">
        <div class="desc">${scanOk ? t('ledger_scan_ok') : t('ledger_scan_fail')}</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">
          <thead><tr style="text-align:left;color:#ffd700">
            <th>${t('ledger_th_addr')}</th><th style="text-align:center">${t('ledger_th_count')}</th><th>${t('ledger_th_paxi')}</th><th>${t('ledger_th_tkcc')}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          ${scanOk ? `<tfoot><tr style="font-weight:bold;border-top:1px solid #b8860b">
            <td>${t('ledger_total')}</td><td></td>
            <td>${fromRawUnits(sumP.toString())}</td>
            <td>${fromRawUnits(sumT.toString())}</td>
          </tr></tfoot>` : ''}
        </table>
      </div>
      ${scanOk ? `<div class="card"><div class="kv"><span class="k">${t('ledger_total_burn')}</span><span class="v" style="color:#ff8c69">${fromRawUnits(burnTotal.toString())}</span></div>
        <div class="desc">${t('ledger_burn_desc')}</div></div>` : ''}
      <div class="hint" style="margin-top:8px">${t('ledger_wallet_note')}</div>`;
    if (hint && scanOk) hint.textContent = tf('ledger_done', { n: taps.length });
  }

  async function renderLedger(body) {
    if (!isSgAdmin()) {
      body.innerHTML = `<div class="hint err">${t('ledger_admin_only')}</div>`;
      return;
    }
    body.innerHTML = `
      <div class="card">
        <div class="card-title">${t('ledger_title')}</div>
        <div class="desc">${tf('ledger_desc', { n: 11 })}</div>
      </div>
      <div class="card">
        <button class="btn btn-primary" id="sgLedgerRefresh">${t('ledger_refresh')}</button>
        <span id="sgLedgerHint" class="hint"></span>
      </div>
      <div id="sgLedgerBody">${t('ledger_hint_click')}</div>`;
    const btn = $('sgLedgerRefresh');
    if (btn) btn.onclick = () => loadLedger();
    loadLedger();
  }

  // ============================================================
  // 抽卡
  // ============================================================
  async function renderDraw(body) {
    body.innerHTML = `
      <div class="card">
        <div class="card-title">🎴 ${t('sg_title')}</div>
        <div class="desc">${t('sg_subtitle')}</div>
      </div>
      <div class="card">
        <div class="card-title">${t('bal_title')}</div>
        <div class="kv"><span class="k">${t('bal_tkcc')}</span><span class="v" id="sgTkcc">${t('loading')}</span></div>
      </div>
      <div class="card">
        <div class="card-title">${t('draw_single_title')}</div>
        <div class="desc" id="sgDesc1">${t('loading')}</div>
        <button class="btn btn-primary" id="sgDraw1" style="margin-top:10px">${t('draw_single')}</button>
      </div>
      <div class="card">
        <div class="card-title">${t('draw_pack3_title')}</div>
        <div class="desc" id="sgDesc3">${t('loading')}</div>
        <button class="btn btn-gold" id="sgDraw3" style="margin-top:10px">${t('draw_pack3')}</button>
      </div>
      <div id="sgDrawLog"></div>`;

    await loadParams();
    if (state.connected || state.wallet) {
      try {
        const b = await queryContract({ balance: { address: state.wallet.address, token: CONTRACTS.tkcc } });
        $('sgTkcc').textContent = fromRawUnits(b.amount || '0');
      } catch (e) { $('sgTkcc').textContent = '0'; }
    } else {
      $('sgTkcc').textContent = '—';
    }
    const d1 = $('sgDesc1'), d3 = $('sgDesc3');
    try {
      if (d1) d1.textContent = `${t('cost_label')} ${fromRawUnits(paxiFeeRaw(false))} PAXI + ${fromRawUnits(prcTotalRaw(false))} TKCC`;
      if (d3) d3.textContent = `${t('cost_label')} ${fromRawUnits(paxiFeeRaw(true))} PAXI + ${fromRawUnits(prcTotalRaw(true))} TKCC`;
    } catch (e) {
      // 审计 #15：参数读不到就明确报错，不用硬编码默认值误导玩家
      if (d1) d1.textContent = e.message;
      if (d3) d3.textContent = e.message;
    }

    $('sgDraw1').onclick = () => doDraw(false);
    $('sgDraw3').onclick = () => doDraw(true);
  }

  async function doDraw(pack3) {
    try {
      await requireSanguo();
    } catch (e) { showToast(e.message, 'error'); return; }

    // 审计 P2-1：tap 数量未就绪（sanguo_config 未配置 / 查询失败）→ 拒绝，不用假数据发交易
    if (tapCountCache <= 0) {
      showToast(t('params_err'), 'error');
      return;
    }

    // 审计 #15：费用必须来自合约 sanguo_params，读取失败直接报错
    let tkccNeed, paxiRaw;
    try {
      tkccNeed = prcTotalRaw(pack3);
      paxiRaw = paxiFeeRaw(pack3);
    } catch (e) { showToast(e.message, 'error'); return; }

    try {
      const b = await queryContract({ balance: { address: state.wallet.address, token: CONTRACTS.tkcc } });
      if (BigInt(b.amount || '0') < tkccNeed) {
        showToast(t('insufficient'), 'error');
        return;
      }
    } catch (e) { showToast(t('insufficient'), 'error'); return; }

    // 🟢 预检「合约内 PAXI 存款」：
    //    draw_pack 的 PAXI 费用是从合约内部账本扣的（不是钱包余额），
    //    不查这一项的话，三连抽（30 PAXI）在只有 10 PAXI 存款时照样会把交易发出去，
    //    被合约拒绝后报错还容易被误读成「gas 费不足」。
    //    这里本地拦下来，直接告诉用户差多少、要充多少。
    try {
      const pb = await queryContract({ balance: { address: state.wallet.address, token: null } });
      const havePaxi = BigInt(pb.amount || '0');
      if (havePaxi < paxiRaw) {
        const need = (Number(paxiRaw) / 1e6).toFixed(2);
        const have = (Number(havePaxi) / 1e6).toFixed(2);
        const lack = ((Number(paxiRaw) - Number(havePaxi)) / 1e6).toFixed(2);
        showToast(
          tf('draw_paxi_lack', { mode: t(pack3 ? 'draw_mode_pack3' : 'draw_mode_single'), need, have, lack }),
          'error',
        );
        const log = $('sgDrawLog');
        if (log) {
          log.innerHTML = `<div class="hint err">❌ ${tf('draw_paxi_lack', { mode: t(pack3 ? 'draw_mode_pack3' : 'draw_mode_single'), need, have, lack })}</div>`;
        }
        return;
      }
    } catch (e) {
      // 查不到时不阻断（避免误伤），只留痕
      console.warn('[doDraw] 合约内 PAXI 余额预检失败，跳过:', e && e.message);
    }

    showBusy(t('draw_doing'));
    try {
      // 审计 #14：tap_index 上界以合约 sanguo_config 的 tap_addresses 数量为准
      const tapIndex = Math.floor(Math.random() * tapCountCache);
      const action = pack3 ? 'draw_pack3' : 'draw_pack';
      await sanguoExec('SanguoDraw', { tap_index: tapIndex, pack3 }, {
        action,
        spend: 0,
        // 🟢 审计修复（致命）：draw_pack 的 PAXI 费用走内部 BALANCES[(player, empty_addr)] 扣，
        //    不再通过 info.funds 接收。传 funds 会被永久锁死在合约银行，用户被扣两次。
      });
      await loadSanguoCards();
      await refreshBalances();
      const tk = $('sgTkcc'); if (tk) tk.textContent = state.tkccBalance;
      $('sgDrawLog').innerHTML = `<div class="hint ok draw-burst">✅ ${pack3 ? t('draw_pack3') : t('draw_single')} ${t('draw_ok')}<span class="gold-burst"></span></div>`;
      showToast(t('draw_ok_short'), 'success');
      sgJustDrew = true;   // 让「我的卡牌」里的卡走翻牌入场（即便现在在抽卡页，切过去也会翻一次）
      if (sanguoTab === 'mycards') renderSanguoTab();
    } catch (e) {
      $('sgDrawLog').innerHTML = `<div class="hint err">❌ ${esc(e.message || e)}</div>`;
      showToast(t('draw_fail') + (e.message || e), 'error');
    } finally { hideBusy(); }
  }

  // ============================================================
  // 我的卡
  // ============================================================
  async function renderMyCards(body) {
    body.innerHTML = `
      <div class="card" id="sgMigrateCard" style="display:none">
        <div class="card-title">📦 ${t('migrate_title')}</div>
        <div class="desc">${t('migrate_desc')}</div>
        <div class="hint" style="margin-top:6px;color:#e8b04b">${t('migrate_limit_note')}</div>
        <div id="sgMigrateLog"></div>
        <button class="btn btn-primary" id="sgMigrateBtn" style="margin-top:8px">${t('migrate_btn')}</button>
      </div>
      <div class="card" id="sgPendingCard" style="display:none">
        <div class="card-title">🎁 ${t('pending_reward')}（<span id="sgPendingTotal">0</span> TKCC）</div>
        <div id="sgPendingList"></div>
        <button class="btn btn-gold" id="sgClaimAll" style="margin-top:8px">${t('claim_btn')}</button>
      </div>
      <div class="card">
        <div class="card-title">🃏 ${t('my_cards')}（<span id="sgCardCount">0</span>）</div>
        <div class="desc">${t('my_cards_desc')}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px" id="sgCardGrid"></div>`;
    if (state.wallet) await loadSanguoCards();
    const grid = $('sgCardGrid');
    $('sgCardCount').textContent = userCards.length;
    if (!userCards.length) {
      grid.innerHTML = `<div class="hint" style="grid-column:1/-1">${t('empty_cards')}</div>`;
    } else {
      grid.innerHTML = userCards.map((c) => cardHtml(c)).join('');
      sgJustDrew = false;   // 翻牌类已写进 HTML，立刻清位，避免下次无关重渲染再翻
    }
    // 老合约资产迁移入口（仅当管理员已放行该老合约时展示）
    renderSanguoMigrationEntry();

    // 待领取奖励（AI 对战胜利后进入待领取队列）
    if (state.wallet) {
      try {
        const pend = await queryContract({ sanguo_pending: { address: state.wallet.address } });
        const ids = (pend && pend.battle_ids) || [];
        const total = (pend && pend.total_rewards) ? pend.total_rewards : '0';
        if (ids.length) {
          $('sgPendingCard').style.display = '';
          $('sgPendingTotal').textContent = fromRawUnits(total);
          $('sgPendingList').innerHTML = ids.map((id) =>
            `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #1c2740">
              <span style="font-size:12px;color:#9fb3d1">${id}</span>
              <button class="btn btn-sm btn-gold" data-bid="${id}">${t('claim_btn')}</button>
            </div>`).join('');
          $('sgPendingList').querySelectorAll('button[data-bid]').forEach((b) => {
            b.onclick = () => doClaimReward(b.dataset.bid);
          });
          $('sgClaimAll').onclick = () => doClaimAll(ids);
        }
      } catch (e) { /* 忽略，不影响卡片展示 */ }
    }
  }

  // ============================================================
  // 老合约资产迁移
  // ============================================================
  // 本会话是否已迁移成功（合约侧每钱包只允许一次，这里只是省掉一次必然失败的 tx）
  let migrationDone = false;
  // 预览阶段读到的老合约卡数（null = 未知）；用于算 gas 上限，真正发交易前还会再核一次
  let oldMigrateCardCount = null;

  // ============================================================
  // 迁移容量 / gas 预算（链上实测校准，2026-09-20）
  //   实测：迁 3 张 = 454,173 gas；迁 3 张（另一钱包）= 454,186 gas
  //   拟合：gas(N) ≈ 364,000 + 30,000 × N   （N=3 代入得 454k，与实测吻合）
  //   固定开销 ≈ 36 万（白名单读 + secp256k1 验签 + 2 次跨合约 query 实例化老合约 VM）
  //   每张卡 ≈ 3 万（2 读：MIGRATED_CARDS / CARD_ID_COUNTER；3 写：COUNTER / CARDS / MIGRATED_CARDS）
  // → 600k 只能迁约 8 张；30 张约需 126~156 万；故单次上限定 30 张 + gas 按卡数自适应。
  // ============================================================
  const MIGRATE_MAX_CARDS = 30;          // 单次迁移卡数上限（超了先去老合约分解）
  const MIGRATE_GAS_BASE = 400_000;      // 固定开销（实测 36 万，取 40 万留余量）
  const MIGRATE_GAS_PER_CARD = 60_000;   // 每张卡（实测约 3 万，取 6 万 = 2 倍冗余）
  const MIGRATE_GAS_MIN = 600_000;       // 与其余玩法一致的下限
  const MIGRATE_GAS_MAX = 3_000_000;     // 30 张 → 400k + 60k×30 = 220 万，封顶 300 万
  // 卡数未知（预览查询失败）时按满额 30 张准备 → 220 万，不会爆
  const MIGRATE_GAS_UNKNOWN = MIGRATE_GAS_BASE + MIGRATE_GAS_PER_CARD * MIGRATE_MAX_CARDS;

  /** 按老合约卡数算本次迁移的 gas 上限（clamp 在 [MIN, MAX]） */
  function migrationGasLimit(cardCount) {
    // ⚠️ 必须先判 null/undefined：Number(null) === 0，会误判成"0 张卡"只给 60 万
    if (cardCount == null) return Math.min(MIGRATE_GAS_MAX, MIGRATE_GAS_UNKNOWN);
    const n = Number(cardCount);
    if (!Number.isFinite(n) || n < 0) return Math.min(MIGRATE_GAS_MAX, MIGRATE_GAS_UNKNOWN);
    return Math.min(MIGRATE_GAS_MAX, Math.max(MIGRATE_GAS_MIN, MIGRATE_GAS_BASE + MIGRATE_GAS_PER_CARD * n));
  }

  /** 读老合约当前钱包的卡数；失败返回 null（不阻断，按满额准备 gas） */
  async function fetchOldCardCount() {
    if (!state.wallet) return null;
    try {
      const cards = await queryAnyContract(OLD_SANGUO_CONTRACT, { player_cards: { address: state.wallet.address } });
      return (cards && cards.cards) ? cards.cards.length : 0;
    } catch (e) {
      return null;
    }
  }

  /**
   * 渲染「一键迁移」入口。
   *
   * 展示条件（三者都满足才显示）：
   *   1. 已连接钱包；
   *   2. 本会话还没迁移过；
   *   3. 新合约的迁移白名单里包含 OLD_SANGUO_CONTRACT。
   *
   * 同时直连老合约做一次只读预览（卡牌数 + 碎片数），让玩家在点按钮前
   * 就知道能搬过来什么。预览失败不影响入口展示（老合约可能暂时不可达）。
   */
  async function renderSanguoMigrationEntry() {
    const card = $('sgMigrateCard');
    if (!card) return;
    if (!state.wallet || migrationDone) return;

    try {
      const wl = await queryContract({ sanguo_migration_whitelist: {} });
      const list = (wl && wl.contracts) || [];
      if (!list.includes(OLD_SANGUO_CONTRACT)) return;   // 管理员未放行 → 不展示
    } catch (e) {
      return; // 查询失败（网络/合约未部署该查询）→ 宁可不展示，也不要误导
    }

    card.style.display = '';

    const log = $('sgMigrateLog');
    const btn = $('sgMigrateBtn');
    btn.onclick = doMigrateFromOld;

    try {
      const [cards, frags] = await Promise.all([
        queryAnyContract(OLD_SANGUO_CONTRACT, { player_cards: { address: state.wallet.address } }),
        queryAnyContract(OLD_SANGUO_CONTRACT, { get_fragments: { address: state.wallet.address } }),
      ]);
      const n = (cards && cards.cards) ? cards.cards.length : 0;
      const fg = (frags && (frags.common || frags.rare || frags.epic || frags.legend))
        ? `${frags.common || 0}/${frags.rare || 0}/${frags.epic || 0}/${frags.legend || 0}`
        : '0/0/0/0';
      oldMigrateCardCount = n;
      log.innerHTML = `<div class="hint" style="margin-top:6px">${tf('migrate_old_summary', { n: esc(n), fg: esc(fg) })}</div>`;
      if (n === 0 && fg === '0/0/0/0') {
        btn.disabled = true;
        log.innerHTML += `<div class="hint" style="margin-top:4px">${t('migrate_none')}</div>`;
      } else if (n > MIGRATE_MAX_CARDS) {
        // 🟢 超出单次 gas 容量：直接拦下，避免玩家点了必然 out of gas 的交易（手续费白扣）
        btn.disabled = true;
        btn.textContent = t('migrate_blocked');
        log.innerHTML += `<div class="hint err" style="margin-top:4px">⚠️ ${esc(tf('migrate_over_limit', { n, max: MIGRATE_MAX_CARDS, over: n - MIGRATE_MAX_CARDS }))}</div>`;
      } else {
        log.innerHTML += `<div class="hint" style="margin-top:4px">${esc(tf('migrate_gas_hint', { n, gas: migrationGasLimit(n).toLocaleString('en-US') }))}</div>`;
      }
    } catch (e) {
      // 预览失败：不阻断按钮，但提示已按满额准备 gas
      log.innerHTML += `<div class="hint" style="margin-top:4px">${esc(tf('migrate_no_preview', { max: MIGRATE_MAX_CARDS }))}</div>`;
    }
  }

  /**
   * 一键迁移：把老合约里的卡（保留稀有度/攻防/星级/等级）与 4 档碎片搬过来。
   *
   * ⚠️ action 必须是 'migrate'（合约 sanguo_auth 的 action 参数），spend 必须是 0，
   *    两者都参与签名原文，写错会验签失败。
   * ⚠️ 每钱包只能成功一次，重复调用会被合约以 SanguoAlreadyMigrated 拒绝。
   */
  async function doMigrateFromOld() {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    const log = $('sgMigrateLog');
    showBusy(t('migrate_doing'));
    try {
      // 🟢 发交易前再核一次老合约卡数（预览到点击之间玩家可能又分解/抽了卡）
      const n = await fetchOldCardCount();
      oldMigrateCardCount = n;

      // 🟢 超限保护：超过 30 张直接拦下，不发出注定 out of gas 的交易
      //    （Cosmos 里 out of gas 照样扣手续费，拦下能帮玩家省这笔钱）
      if (n != null && n > MIGRATE_MAX_CARDS) {
        const tip = tf('migrate_over_limit', { n, max: MIGRATE_MAX_CARDS, over: n - MIGRATE_MAX_CARDS });
        if (log) log.innerHTML = `<div class="hint err" style="margin-top:6px">⚠️ ${esc(tip)}</div>`;
        const bb = $('sgMigrateBtn'); if (bb) { bb.disabled = true; bb.textContent = t('migrate_blocked'); }
        showToast(tip, 'error');
        return;
      }

      // 🟢 gas 随卡数线性增长（实测 ≈ 36 万固定 + 3 万/张），默认 600k 上限会被撑爆。
      //    这里按实际卡数自适应（30 张 → 220 万；查不到卡数按 30 张满额 220 万准备）。
      //    未用完的 gas 会原路退还，抬高上限不会让玩家多掏钱。
      const gasLimit = migrationGasLimit(n);
      const { tx } = await sanguoExec(
        'SanguoMigrateFromOld',
        { old_contract: OLD_SANGUO_CONTRACT },
        { action: 'migrate', spend: 0, gasLimit },
      );
      const a = parseTxEvents(tx, ['cards_minted', 'cards_skipped', 'fragments_migrated']);
      const minted = (a.cards_minted && a.cards_minted[0]) || '0';
      const skipped = (a.cards_skipped && a.cards_skipped[0]) || '0';
      const frags = (a.fragments_migrated && a.fragments_migrated[0]) || '0';
      migrationDone = true;
      if (log) log.innerHTML = `<div class="hint ok" style="margin-top:6px">${tf('migrate_ok_detail', { msg: t('migrate_ok'), minted, frags, skipped: Number(skipped) ? tf('migrate_ok_skip', { n: skipped }) : '' })}</div>`;
      const b = $('sgMigrateBtn'); if (b) b.disabled = true;
      await loadSanguoCards();
      await refreshBalances();
      showToast(t('migrate_ok'), 'success');
      renderSanguoTab();
    } catch (e) {
      const msg = String(e.message || e);
      if (/already migrated/i.test(msg)) {
        migrationDone = true;
        if (log) log.innerHTML = `<div class="hint" style="margin-top:6px">ℹ️ ${t('migrate_done')}</div>`;
        const b = $('sgMigrateBtn'); if (b) b.disabled = true;
        showToast(t('migrate_done'), 'error');
      } else {
        if (log) log.innerHTML = `<div class="hint err" style="margin-top:6px">❌ ${esc(msg)}</div>`;
        showToast(t('fail_prefix') + msg, 'error');
      }
    } finally { hideBusy(); }
  }

  async function doClaimReward(battleId) {
    try {
      await requireSanguo();
    } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      const res = await sanguoExec('SanguoClaimReward', { battle_id: battleId }, { action: 'claim_reward', spend: 0 });
      sgClaimToast(res.tx, 'ok_short');
      renderSanguoTab();
    } catch (e) {
      showToast(t('fail_prefix') + (e.message || e), 'error');
    } finally { hideBusy(); }
  }

  async function doClaimAll(ids) {
    try {
      await requireSanguo();
    } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      let inSum = 0n, burnSum = 0n;
      for (const id of ids) {
        const r = await sanguoExec('SanguoClaimReward', { battle_id: id }, { action: 'claim_reward', spend: 0 });
        const m = sgTkccEvents(r.tx);
        inSum += m.inbound; burnSum += m.burn;
      }
      if (inSum > 0n) {
        showToast(tf((burnSum > 0n) ? 'claim_in_burn' : 'claim_in', {
          amt: fromRawUnits(String(inSum), 6),
          burned: fromRawUnits(String(burnSum), 6),
        }), 'success');
      } else { showToast(t('ok_short'), 'success'); }
      renderSanguoTab();
    } catch (e) {
      showToast(t('fail_prefix') + (e.message || e), 'error');
    } finally { hideBusy(); }
  }

  function cardHtml(c) {
    const img = getCardImage(c.name);
    const col = rarityColor(c.rarity);
    const cls = rarityClass(c.rarity);
    const cid = esc(c.card_id);
    const lvTxt = (c.star > 1 || c.level > 0) ? `<div class="sg-card-lv">★${c.star || 1}${c.level ? ' Lv' + c.level : ''}</div>` : '';
    // 🟢「我的卡牌」只展示卡牌参数，不放养成按钮（升级/升星/分解统一到「养成」页）。
    return `<div class="sg-card ${cls}${sgJustDrew ? ' new-card' : ''}" onclick="openCardDetailFromId('${cid}')">
      ${lvTxt}
      <div class="sg-card-img"><img src="${img}" onerror="this.style.display='none'"></div>
      <div class="sg-card-foot">
        <div class="nm">${esc(c.name)}</div>
        <div class="rr">${rarityLabel(c.rarity)} · ${t('power_label')} ${power(c)}</div>
      </div>
    </div>`;
  }

  // ============================================================
  // 卡牌选择面板（养成-出战顺序 / PVP / 混战 共用）
  // ============================================================
  function sanguoRenderPicker(containerId, max) {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    if (!userCards.length) {
      grid.innerHTML = `<div class="hint">${t('empty_cards')}</div>`;
      return;
    }
    grid.innerHTML = userCards.map((c) => {
      const idx = sanguoPicked.indexOf(c.card_id);
      const sel = idx >= 0;
      const col = rarityColor(c.rarity);
      const badge = sel ? `<div class="sg-pick-ord">${idx + 1}</div>` : '';
      return `<div class="sg-pick" data-cid="${c.card_id}" style="position:relative;border:2px solid ${sel ? col : '#2a3756'};border-radius:8px;padding:4px;cursor:pointer;background:${sel ? 'rgba(255,255,255,.06)' : '#0d1322'};text-align:center">
        ${badge}
        <div style="font-size:11px;font-weight:700;color:#fff">${esc(c.name)}</div>
        <div style="font-size:9px;color:${col}">${rarityLabel(c.rarity)} · ${power(c)}</div>
      </div>`;
    }).join('');
    grid.querySelectorAll('.sg-pick').forEach((el) => {
      el.onclick = () => {
        const cid = el.dataset.cid;
        const idx = sanguoPicked.indexOf(cid);
        if (idx >= 0) sanguoPicked.splice(idx, 1);
        else {
          if (sanguoPicked.length >= max) { showToast(t('need_three'), 'error'); return; }
          sanguoPicked.push(cid);
        }
        sanguoRenderPicker(containerId, max);
      };
    });
  }

  // ============================================================
  // AI 对战
  // ============================================================
  async function renderAiBattle(body) {
    await loadParams();
    // 🟢 修复：必须加载卡牌才能判断是否满足合约 ai_battle 要求的 ≥3 张门槛，
    //    否则无卡也能发起交易（并弹钱包），与合约 SanguoNeed3Cards 报错对不齐。
    if (state.wallet) await loadSanguoCards();
    const cardCount = userCards.length;
    const enoughCards = cardCount >= 3;
    body.innerHTML = `
      <div class="card" id="sgAiPendingCard" style="display:none">
        <div class="card-title">🎁 ${t('pending_reward')}（<span id="sgAiPendingTotal">0</span> TKCC）</div>
        <div class="hint" id="sgAiPendingHint"></div>
        <button class="btn btn-gold" id="sgAiClaimAll" style="margin-top:8px;width:100%">${t('claim_btn')}</button>
      </div>
      <div class="card">
        <div class="card-title">⚔️ ${t('ai_title')}</div>
        <div class="desc">${t('ai_desc')}</div>
      </div>
      <div class="card">
        <div class="kv"><span class="k">${t('ai_today')}</span><span class="v" id="sgAiToday">—</span></div>
        <div class="kv"><span class="k">${t('ai_limit')}</span><span class="v" id="sgAiLimit">—</span></div>
        <div class="kv"><span class="k">${t('win_rate')}</span><span class="v" id="sgAiRate">—</span></div>
        <div class="kv"><span class="k">${t('ai_my_cards')}</span><span class="v" id="sgAiCards">${cardCount} / 3</span></div>
      </div>
      <div class="card">
        <div class="card-title">${t('ai_pick_title')}</div>
        <div class="desc">${t('ai_pick_desc')}</div>
        <div id="sgAiPick" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;margin-top:8px"></div>
      </div>
      <div class="card">
        <div class="card-title">${t('ai_diff')}</div>
        <select id="sgAiDiff" class="input">
          ${[1,2,3,4,5].map((d) => {
            const idx = d - 1;
            const fee = paramsCache ? fromRawUnits(paramsCache.ai_fee[idx]) : '?';
            const reward = paramsCache ? fromRawUnits(paramsCache.ai_reward[idx]) : '?';
            return `<option value="${d}">${t('ai_diff')} ${d} · ${t('ai_fee')} ${fee} · ${t('ai_reward')} ${reward}</option>`;
          }).join('')}
        </select>
        <button class="btn btn-primary" id="sgAiGo" style="margin-top:10px;width:100%" ${enoughCards ? '' : 'disabled'}>${enoughCards ? t('ai_title') : t('ai_need_three_btn')}</button>
        ${enoughCards ? '' : `<div class="hint err" style="margin-top:8px">${t('ai_need_three_hint')}</div>`}
      </div>
      <div id="sgAiLog"></div>`;
    if (state.wallet) {
      try {
        const s = await queryContract({ sanguo_ai_stats: { address: state.wallet.address } });
      if (s) {
        sgAiStats = s;
        $('sgAiToday').textContent = (s.today_count != null ? s.today_count : '0') + ' / ' + (s.daily_limit != null ? s.daily_limit : '0');
        $('sgAiLimit').textContent = s.daily_limit != null ? s.daily_limit : '—';
        $('sgAiRate').textContent = s.win_rate != null ? s.win_rate : '—';
        sgSyncWallet();
      }
      } catch (e) { /* 忽略 */ }
    }
    // 🟢 AI 也能像 PVP 那样选派：进入页面时用链上出战顺序预填选卡面板（最多 3 张）
    if (state.wallet && userCards.length) {
      try {
        const bo = await queryContract({ sanguo_battle_order: { player: state.wallet.address } });
        if (bo && bo.order && bo.order.length) {
          const ids = bo.order.filter((id) => userCards.some((c) => c.card_id === id)).slice(0, 3);
          if (ids.length) sanguoPicked = ids;
        }
      } catch (e) {}
      sanguoRenderPicker('sgAiPick', 3);
    }
    $('sgAiGo').onclick = () => doAiBattle();

    // 🟢 待领取横幅：赢局奖励先进合约 pending（sanguo_pending），必须点「领取」才真正转账。
    //    原领取入口只在「我的卡」页，玩家在 AI 对战页看不到 → 这里补一个一键领取入口。
    if (state.wallet) {
      try {
        const pend = await queryContract({ sanguo_pending: { address: state.wallet.address } });
        const ids = (pend && pend.battle_ids) || [];
        if (ids.length) {
          $('sgAiPendingCard').style.display = '';
          $('sgAiPendingTotal').textContent = fromRawUnits((pend && pend.total_rewards) || '0');
          $('sgAiPendingHint').textContent = tf('ai_pending_hint', { n: ids.length });
          $('sgAiClaimAll').onclick = () => doClaimAll(ids);
        }
      } catch (e) { /* 查询失败不阻断对战页 */ }
    }
  }

  async function doAiBattle() {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    try { await loadParams(); } catch (e) { showToast(t('params_err'), 'error'); return; }
    // 🟢 门槛校验：合约 ai_battle 要求 ≥3 张卡，避免无卡也能发交易并弹钱包
    if (!userCards || userCards.length < 3) {
      try { await loadSanguoCards(); } catch (e) {}
      if (!userCards || userCards.length < 3) {
        const msg = t('ai_need_three_msg');
        const logEl = $('sgAiLog');
        if (logEl) logEl.innerHTML = `<div class="hint err">❌ ${esc(msg)}</div>`;
        showToast(msg, 'error');
        return;
      }
    }
    const p = requireParams();
    const diff = Number(($('sgAiDiff') || {}).value || 1);
    const diffIdx = diff - 1;
    const fee = p.ai_fee[diffIdx];
    // 🟢 AI 也能像 PVP 那样选派：开战前把当前选中的卡设为出战顺序（合约 ai_battle 读取此顺序）
    if (sanguoPicked.length >= 3) {
      try { await ensureBattleOrder(); } catch (e) { /* 设置失败不阻断，合约会用已有顺序或高战力兜底 */ }
    }
    showBusy(t('doing'));
    try {
      const res = await sanguoExec('SanguoAiBattle', { difficulty: diff }, { action: 'ai_battle', spend: fee });
      sgSpentTip('ok_short', fee);
      // 🟢 前端新增：对战竞技场（双方出牌 + 胜负 + 奖励）
      try { await showAiBattleFromTx(res.tx, diff); } catch (_) { /* 展示失败不影响主流程 */ }
      renderSanguoTab();
    } catch (e) {
      $('sgAiLog').innerHTML = `<div class="hint err">❌ ${esc(e.message || e)}</div>`;
      showToast(t('fail_prefix') + (e.message || e), 'error');
    } finally { hideBusy(); }
  }

  // 🟢 AI/PVP 共用：确保链上出战顺序 = 当前选中的 sanguoPicked（前 3 张），
  //    与链上不一致才发交易，避免无谓的 set_battle_order。
  async function ensureBattleOrder() {
    const want = sanguoPicked.slice(0, 3);
    if (want.length < 3) return;
    let cur = [];
    try {
      const bo = await queryContract({ sanguo_battle_order: { player: state.wallet.address } });
      cur = (bo && bo.order) || [];
    } catch (e) {}
    const same = cur.length === want.length && cur.every((id, i) => id === want[i]);
    if (!same) {
      await sanguoExec('SanguoSetBattleOrder', { order: want }, { action: 'set_battle_order', spend: 0 });
    }
  }

  // ============================================================
  // 养成（碎片 / 出战顺序 / 升星 / 分解 / 升级 / 合成）
  // ============================================================
  async function renderCultivate(body) {
    await loadParams();
    if (state.wallet) await loadSanguoCards();
    sanguoPicked = [];
    body.innerHTML = `
      <div class="card">
        <div class="card-title">🌱 ${t('cult_title')}</div>
        <div class="desc">${t('cult_desc')}</div>
      </div>
      <div class="card">
        <div class="card-title">${t('frag_title')}</div>
        <div class="kv"><span class="k">${t('rarity_common')}</span><span class="v" id="sgFragC">0</span></div>
        <div class="kv"><span class="k">${t('rarity_rare')}</span><span class="v" id="sgFragR">0</span></div>
        <div class="kv"><span class="k">${t('rarity_epic')}</span><span class="v" id="sgFragE">0</span></div>
        <div class="kv"><span class="k">${t('rarity_legend')}</span><span class="v" id="sgFragL">0</span></div>
      </div>
      <div class="card">
        <div class="card-title">${t('order_title')} <span style="font-size:12px;color:#9fb3d1">(${t('order_max')})</span></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0" id="sgOrderPick"></div>
        <button class="btn btn-primary" id="sgSetOrder">${t('set_order_btn')}</button>
      </div>
      <div class="card" id="sgCraftCard">
        <div class="card-title">✨ ${t('craft_btn')}</div>
        <div class="desc">${t('craft_desc')}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin:8px 0 10px;font-size:12px">
          <span style="color:#b9a58f">🟤 ${t('rarity_common')} <b id="craftFragCommon">0</b></span>
          <span style="color:#4a9eff">🔵 ${t('rarity_rare')} <b id="craftFragRare">0</b></span>
          <span style="color:#b14aff">🟣 ${t('rarity_epic')} <b id="craftFragEpic">0</b></span>
          <span style="color:#ffd700">🟡 ${t('rarity_legend')} <b id="craftFragLegend">0</b></span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn-secondary" data-craft="common">${tf('craft_common', { cost: CRAFT_COST.common })}</button>
          <button class="btn btn-primary" data-craft="rare">${tf('craft_rare', { cost: CRAFT_COST.rare })}</button>
          <button class="btn btn-gold" data-craft="epic">${tf('craft_epic', { cost: CRAFT_COST.epic })}</button>
          <button class="btn btn-gold" data-craft="legend" style="background:linear-gradient(135deg,#ffd700,#ff8c00);color:#3a2400">${tf('craft_legend', { cost: CRAFT_COST.legend })}</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🃏 ${t('my_cards')}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px" id="sgCultGrid"></div>
      </div>`;
    if (state.wallet) {
      try {
        const f = await queryContract({ sanguo_fragments: { address: state.wallet.address } });
        if (f) {
          $('sgFragC').textContent = f.common; $('sgFragR').textContent = f.rare;
          $('sgFragE').textContent = f.epic; $('sgFragL').textContent = f.legend;
          const sum = (Number(f.common) || 0) + (Number(f.rare) || 0) + (Number(f.epic) || 0) + (Number(f.legend) || 0);
          sgFragCache = sum; sgSyncWallet();
          // 合成区（老版样式）里的四档碎片余额同步刷新
          sgFrags = {
            common: Number(f.common) || 0, rare: Number(f.rare) || 0,
            epic: Number(f.epic) || 0, legend: Number(f.legend) || 0,
          };
          const setF = (id, v) => { const el = $(id); if (el) el.textContent = v; };
          setF('craftFragCommon', sgFrags.common); setF('craftFragRare', sgFrags.rare);
          setF('craftFragEpic', sgFrags.epic); setF('craftFragLegend', sgFrags.legend);
        }
      } catch (e) {}
    }
    // 🟢 多钱包 + 出战顺序：预填链上已存的出战顺序（按当前钱包），顺序即出牌顺序：第 1 个先出
    if (state.wallet) {
      try {
        const bo = await queryContract({ sanguo_battle_order: { player: state.wallet.address } });
        if (bo && bo.order && bo.order.length) {
          const ids = bo.order.filter((id) => userCards.some((c) => c.card_id === id));
          if (ids.length) sanguoPicked = ids;
        }
      } catch (e) {}
    }
    sanguoRenderPicker('sgOrderPick', 8);
    $('sgSetOrder').onclick = () => doSetBattleOrder();
    // 🟢 老版样式：四档稀有度各自一个合成按钮，直接点对应稀有度即可（不再下拉选择）
    document.querySelectorAll('#sgCraftCard button[data-craft]').forEach((b) => {
      b.onclick = () => doCraft(b.dataset.craft);
    });
    const grid = $('sgCultGrid');
    if (!userCards.length) {
      grid.innerHTML = `<div class="hint" style="grid-column:1/-1">${t('empty_cards')}</div>`;
    } else {
      grid.innerHTML = userCards.map((c) => {
        const col = rarityColor(c.rarity);
        const img = getCardImage(c.name);
        // 🟢 养成页：卡牌图（小尺寸）+ 下方「升星 / 升星·F / 升级 / 分解」按钮。
        //    渲染结构变化，按钮动作仍走原 doStarUp / doUpgrade / doDecompose，逻辑零改动。
        return `<div class="sg-cult-card" style="border-color:${col}">
          <div class="sg-cult-img"><img src="${img}" onerror="this.style.display='none'"></div>
          <div class="sg-cult-info">
            <div class="nm">${esc(c.name)}</div>
            <div class="rr" style="color:${col}">${rarityLabel(c.rarity)} ★${c.star||1} Lv${c.level||0} · ${power(c)}</div>
          </div>
          <div class="sg-cult-acts">
            <button class="btn btn-sm btn-ghost" data-act="star_tk" data-cid="${c.card_id}">${t('starup_btn')}</button>
            <button class="btn btn-sm btn-ghost" data-act="star_frag" data-cid="${c.card_id}">${t('starup_btn')}·F</button>
            <button class="btn btn-sm btn-ghost" data-act="upgrade" data-cid="${c.card_id}">${t('upgrade_btn')}</button>
            <button class="btn btn-sm btn-ghost" data-act="decompose" data-cid="${c.card_id}">${t('decompose_btn')}</button>
          </div>
        </div>`;
      }).join('');
      grid.querySelectorAll('button[data-act]').forEach((b) => {
        b.onclick = () => {
          const act = b.dataset.act, cid = b.dataset.cid;
          if (act === 'star_tk') doStarUp(cid, false);
          else if (act === 'star_frag') doStarUp(cid, true);
          else if (act === 'upgrade') doUpgrade(cid);
          else if (act === 'decompose') doDecompose(cid);
        };
      });
    }
  }

  async function doSetBattleOrder() {
    if (!sanguoPicked.length) { showToast(t('select_card_first'), 'error'); return; }
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoSetBattleOrder', { order: sanguoPicked.slice() }, { action: 'set_battle_order', spend: 0 });
      const names = sanguoPicked.map((id) => { const c = userCards.find((x) => x.card_id === id); return c ? c.name : id; });
      showToast(`${t('ok_short')} · ${tf('order_saved', { names: names.join(' → ') })}`, 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  // 🟢 养成预检（2026-09-20）：与老版 paxi-card-game 对齐。
  //    此前升星/升级/分解无任何前端预检：5★ 满星卡照样发交易、余额不够照样发交易，
  //    全部被合约拒绝 → 白烧 gas（链上实测：两笔 sanguo_star_up 报
  //    "Card already at maximum star"，每笔白扣手续费）。
  //    数值必须与合约一致：
  //    · src/sanguo/state.rs::upgrade_fees = [50000,150000,400000,1000000]（TKCC，50% 销毁）
  //    · 升星碎片路径 = STAR_UP_FRAGMENT_COST[稀有度] → [50,100,200,500]（按稀有度，与星级无关，与升级碎片同表）
  //    · 升级每级碎片 = 同表 50/100/200/500（按稀有度）
  //    · 分解返还 = 5/10/20/50（按稀有度）
  const STAR_UP_FEES = [50000, 150000, 400000, 1000000]; // 升星 TKCC 费用（整 TKCC，×1e6=raw），与合约 upgrade_fees/1e6 一致
  const UPGRADE_FRAG_PER_LEVEL = { common: 50, rare: 100, epic: 200, legend: 500 }; // 升级每级碎片（按稀有度）
  const DECOMPOSE_FRAG_BACK = { common: 5, rare: 10, epic: 20, legend: 50 };       // 分解返还碎片（按稀有度）
  // 升星「碎片路径」消耗：合约 STAR_UP_FRAGMENT_COST[稀有度] = [50,100,200,500]，与升级同表、按稀有度、与星级无关
  const STAR_UP_FRAG_COST = { common: 50, rare: 100, epic: 200, legend: 500 };

  // 查合约内 TKCC 余额（raw）。查询失败返回 null（调用方决定是否放行）。
  async function sgInContractTkcc() {
    try {
      const b = await queryContract({ balance: { address: state.wallet.address, token: CONTRACTS.tkcc } });
      return BigInt(b.amount || '0');
    } catch (e) { return null; }
  }
  // 查某稀有度碎片（以链上为准，顺带刷新缓存；失败退回缓存值）
  async function sgFragOf(rarity) {
    try {
      const f = await queryContract({ sanguo_fragments: { address: state.wallet.address } });
      if (f && f[rarity] != null) { sgFrags[rarity] = Number(f[rarity]) || 0; return sgFrags[rarity]; }
    } catch (e) {}
    return sgFrags[rarity] || 0;
  }

  async function doStarUp(cardId, useFragments) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    const card = userCards.find((c) => c.card_id === cardId);
    if (!card) { showToast(t('err_card_notfound'), 'error'); return; }
    const star = card.star || 1;
    if (star >= 5) { showToast(t('err_max_star'), 'error'); return; }
    const fee = STAR_UP_FEES[star - 1];
    if (!useFragments) {
      const bal = await sgInContractTkcc();
      if (bal === null) { showToast(t('err_bal_query'), 'error'); return; }
      if (bal < BigInt(fee) * 1000000n) {
        showToast(tf('err_tkcc_star', { from: star, to: star + 1, need: fee.toLocaleString(), have: Math.floor(Number(bal) / 1e6).toLocaleString() }), 'error');
        return;
      }
      const half = fee / 2;
      if (!confirm(tf('confirm_star_up', { from: star, to: star + 1, fee: fee.toLocaleString(), half: half.toLocaleString() }))) return;
    } else {
      const fragNeed = STAR_UP_FRAG_COST[card.rarity] || 50; // 合约按稀有度固定 50/100/200/500，与星级无关
      const have = await sgFragOf(card.rarity);
      if (have < fragNeed) {
        showToast(tf('err_frag_star', { need: fragNeed, rarity: rarityLabel(card.rarity), have }), 'error');
        return;
      }
      if (!confirm(tf('confirm_star_frag', { from: star, to: star + 1, need: fragNeed, rarity: rarityLabel(card.rarity), have }))) return;
    }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoStarUp', { card_id: cardId, use_fragments: useFragments }, { action: 'star_up', spend: 0 });
      showToast(t('ok_short'), 'success');
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally {
      hideBusy();
      // 🟢 无论成功/失败都从链上重拉一次卡牌与碎片再渲染：
      //    避免「链上已成功、但本地缓存没刷新」让玩家以为没升星/没升级；
      //    即便本次超时误报失败，只要链上真成功了，这里也会显示真实状态。
      try { await loadSanguoCards(); } catch (_) {}
      renderSanguoTab();
    }
  }
  async function doUpgrade(cardId) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    const card = userCards.find((c) => c.card_id === cardId);
    if (!card) { showToast(t('err_card_notfound'), 'error'); return; }
    const lv = card.level || 0;
    if (lv >= 10) { showToast(t('err_max_level'), 'error'); return; }
    const perLv = UPGRADE_FRAG_PER_LEVEL[card.rarity] || 50;
    const have = await sgFragOf(card.rarity);
    if (have < perLv) {
      showToast(tf('err_frag_level', { from: lv, to: lv + 1, need: perLv, rarity: rarityLabel(card.rarity), have }), 'error');
      return;
    }
    if (!confirm(tf('confirm_level_up', { from: lv, to: lv + 1, need: perLv, rarity: rarityLabel(card.rarity), have }))) return;
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoUpgrade', { card_id: cardId }, { action: 'upgrade', spend: 0 });
      showToast(t('ok_short'), 'success');
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally {
      hideBusy();
      // 🟢 无论成功/失败都从链上重拉一次卡牌与碎片再渲染：
      //    避免「链上已成功、但本地缓存没刷新」让玩家以为没升星/没升级；
      //    即便本次超时误报失败，只要链上真成功了，这里也会显示真实状态。
      try { await loadSanguoCards(); } catch (_) {}
      renderSanguoTab();
    }
  }
  async function doDecompose(cardId) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    const card = userCards.find((c) => c.card_id === cardId);
    if (!card) { showToast(t('err_card_notfound'), 'error'); return; }
    const back = DECOMPOSE_FRAG_BACK[card.rarity] || 5;
    // 分解是销毁性操作：老版同款确认框，写清「不退还已投入」避免养成后白烧
    if (!confirm(tf('confirm_decompose', { name: card.name, star: card.star || 1, lv: card.level || 0, back, rarity: rarityLabel(card.rarity) }))) return;
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoDecompose', { card_id: cardId }, { action: 'decompose', spend: 0 });
      showToast(t('ok_short'), 'success');
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally {
      hideBusy();
      // 🟢 无论成功/失败都从链上重拉一次卡牌与碎片再渲染：
      //    避免「链上已成功、但本地缓存没刷新」让玩家以为没升星/没升级；
      //    即便本次超时误报失败，只要链上真成功了，这里也会显示真实状态。
      try { await loadSanguoCards(); } catch (_) {}
      renderSanguoTab();
    }
  }
  async function doCraft(rarity) {
    rarity = rarity || 'common';
    // 前端先校验碎片（与合约 CRAFT_COST 一致），不够就直接拦下，不浪费一次签名
    const cost = CRAFT_COST[rarity] || 0;
    const have = (sgFrags && sgFrags[rarity]) || 0;
    if (have < cost) {
      showToast(tf('craft_insufficient', { need: cost, have }), 'error');
      return;
    }
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoCraft', { rarity }, { action: 'craft', spend: 0 });
      showToast(t('ok_short'), 'success');
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally {
      hideBusy();
      // 🟢 无论成功/失败都从链上重拉一次卡牌与碎片再渲染：
      //    避免「链上已成功、但本地缓存没刷新」让玩家以为没升星/没升级；
      //    即便本次超时误报失败，只要链上真成功了，这里也会显示真实状态。
      try { await loadSanguoCards(); } catch (_) {}
      renderSanguoTab();
    }
  }

  // ============================================================
  // 提案系统
  // ============================================================
  async function renderProposal(body) {
    await loadParams();
    body.innerHTML = `
      <div class="card">
        <div class="card-title">📜 ${t('prop_title')}</div>
        <div class="desc">${t('prop_desc')}</div>
        <div class="kv"><span class="k">${t('deposit_label')}</span><span class="v">${paramsCache ? fromRawUnits(paramsCache.proposal_deposit) + ' TKCC' : '—'}</span></div>
      </div>
      <div class="card">
        <div class="card-title">${t('prop_propose')}</div>
        <input id="sgPropName" class="input" placeholder="${t('prop_name')}">
        <div style="display:flex;gap:6px;margin-top:6px">
          <select id="sgPropRarity" class="input">
            <option value="common">${t('rarity_common')}</option>
            <option value="rare">${t('rarity_rare')}</option>
            <option value="epic">${t('rarity_epic')}</option>
            <option value="legend">${t('rarity_legend')}</option>
          </select>
          <input id="sgPropAtk" class="input" type="number" placeholder="${t('prop_attack')}" style="width:80px">
          <input id="sgPropDef" class="input" type="number" placeholder="${t('prop_defense')}" style="width:80px">
          <input id="sgPropW" class="input" type="number" placeholder="${t('prop_weight')}" style="width:70px">
        </div>
        <button class="btn btn-primary" id="sgPropSubmit" style="margin-top:8px;width:100%">${t('prop_submit')}</button>
      </div>
      <div class="card">
        <div class="card-title">${t('prop_list')}</div>
        <div id="sgPropList"></div>
      </div>`;
    $('sgPropSubmit').onclick = () => doPropose();
    const list = $('sgPropList');
    try {
      const r = await queryContract({ sanguo_proposals: { start_after: null, limit: 50 } });
      const props = (r && r.proposals) || [];
      if (!props.length) { list.innerHTML = `<div class="hint">${t('none_label')}</div>`; }
      else {
        list.innerHTML = props.map((p) => {
          const st = p.executed ? (p.approved ? t('prop_approved') : t('prop_rejected')) : t('prop_open');
          const isProposer = state.wallet && p.proposer === state.wallet.address;
          const buttons = [];
          if (!p.executed) {
            buttons.push(`<button class="btn btn-sm btn-ghost" data-v="yes" data-pid="${p.id}">${t('prop_vote_yes')}</button>`);
            buttons.push(`<button class="btn btn-sm btn-ghost" data-v="no" data-pid="${p.id}">${t('prop_vote_no')}</button>`);
            buttons.push(`<button class="btn btn-sm btn-primary" data-exec="${p.id}">${t('prop_execute')}</button>`);
            if (isProposer) buttons.push(`<button class="btn btn-sm btn-ghost" data-cancel="${p.id}">${t('prop_cancel')}</button>`);
          }
          return `<div style="border-bottom:1px solid #1c2740;padding:6px 0">
            <div style="font-size:12px;font-weight:700;color:#fff">#${p.id} ${esc(p.template.name)} <span style="color:${rarityColor(p.template.rarity)}">${rarityLabel(p.template.rarity)}</span></div>
            <div style="font-size:11px;color:#9fb3d1">${t('prop_status')}: ${st} · ${t('prop_yes')}: ${p.yes_votes} · ${t('prop_no')}: ${p.no_votes}</div>
            <div style="display:flex;gap:4px;margin-top:4px">${buttons.join('')}</div>
          </div>`;
        }).join('');
        list.querySelectorAll('button[data-v]').forEach((b) => { b.onclick = () => doVote(b.dataset.pid, b.dataset.v === 'yes'); });
        list.querySelectorAll('button[data-exec]').forEach((b) => { b.onclick = () => doExecuteProposal(b.dataset.exec); });
        list.querySelectorAll('button[data-cancel]').forEach((b) => { b.onclick = () => doCancelProposal(b.dataset.cancel); });
      }
    } catch (e) { list.innerHTML = `<div class="hint err">${esc(e.message || e)}</div>`; }
  }

  async function doPropose() {
    const name = ($('sgPropName') || {}).value ? $('sgPropName').value.trim() : '';
    const rarity = ($('sgPropRarity') || {}).value || 'common';
    const attack = Number(($('sgPropAtk') || {}).value || 0);
    const defense = Number(($('sgPropDef') || {}).value || 0);
    const weight = Number(($('sgPropW') || {}).value || 1);
    if (!name) { showToast(t('prop_name'), 'error'); return; }
    const id = 'prop_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e4).toString(36);
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    try { await loadParams(); } catch (e) { showToast(t('params_err'), 'error'); return; }
    showBusy(t('doing'));
    try {
      const template = { id, name, rarity, attack, defense, weight };
      await sanguoExec('SanguoProposeCard', { template }, { action: 'propose', spend: 0 });
      showToast(t('propose_ok'), 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doVote(proposalId, approve) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoVoteCard', { proposal_id: Number(proposalId), approve }, { action: 'vote', spend: 0 });
      showToast(t('vote_ok'), 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doExecuteProposal(proposalId) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoExecuteProposal', { proposal_id: Number(proposalId) }, { action: 'execute_proposal', spend: 0 });
      showToast(t('execute_ok'), 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doCancelProposal(proposalId) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoCancelProposal', { proposal_id: Number(proposalId) }, { action: 'cancel_proposal', spend: 0 });
      showToast(t('cancel_ok'), 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }

  // ============================================================
  // PVP 1v1
  // ============================================================
  async function renderPvp(body) {
    await loadParams();
    if (state.wallet) await loadSanguoCards();
    sanguoPicked = [];
    body.innerHTML = `
      <div class="card">
        <div class="card-title">🆚 ${t('pvp_title')}</div>
        <div class="desc">${t('pvp_desc')}</div>
      </div>
      <div class="card">
        <div class="card-title">${t('pvp_create')}</div>
        <input id="sgPvpOpp" class="input" placeholder="${t('pvp_opponent')}">
        <label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px;color:#9fb3d1">
          <input type="checkbox" id="sgPvpPublic"> ${t('pvp_public')}
        </label>
        <div style="font-size:12px;color:#9fb3d1;margin-top:8px">${t('pick_title')}（${t('need_three')}）</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:6px 0" id="sgPvpPick"></div>
        <button class="btn btn-primary" id="sgPvpCreate" style="width:100%">${t('pvp_create')}</button>
      </div>
      <div class="card" id="sgActCard" style="display:none">
        <div class="card-title">${t('pick_title')}（${t('need_three')}）</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:6px 0" id="sgActPick"></div>
        <button class="btn btn-primary" id="sgActGo" style="width:100%">${t('ok_short')}</button>
      </div>
      <div class="card">
        <div class="card-title">${t('pvp_list')}</div>
        <div id="sgPvpList"></div>
      </div>`;
    sanguoRenderPicker('sgPvpPick', 3);
    $('sgPvpCreate').onclick = () => doCreatePvp();
    const list = $('sgPvpList');
    try {
      const r = await queryContract({ sanguo_pvp_list: { player: null, status: null, limit: 50 } });
      const ms = (r && r.matches) || [];
      if (!ms.length) list.innerHTML = `<div class="hint">${t('none_label')}</div>`;
      else {
        list.innerHTML = ms.map((m) => {
          const isChallenger = state.wallet && m.challenger === state.wallet.address;
          const isOpponent = state.wallet && m.opponent === state.wallet.address;
          const winner = m.winner || '';
          const isWinner = state.wallet && winner === state.wallet.address;
          const buttons = [];
          if (m.status === 'waiting') {
            if (isOpponent || (m.is_public && !isChallenger)) buttons.push(`<button class="btn btn-sm btn-primary" data-accept="${m.match_id}">${t('pvp_accept')}</button>`);
            if (isChallenger) buttons.push(`<button class="btn btn-sm btn-ghost" data-cancel="${m.match_id}">${t('pvp_cancel')}</button>`);
          }
          if (m.status === 'finished' && isWinner && !m.reward_claimed) buttons.push(`<button class="btn btn-sm btn-gold" data-claim="${m.match_id}">${t('pvp_claim')}</button>`);
          return `<div style="border-bottom:1px solid #1c2740;padding:6px 0">
            <div style="font-size:12px;font-weight:700;color:#fff">${t('match_id_label')}: ${esc(m.match_id)}</div>
            <div style="font-size:11px;color:#9fb3d1">${t('status_label')}: ${m.status} · ${t('opponent_label')}: ${m.opponent ? esc(sgShortAddr(m.opponent)) : (m.is_public ? t('pvp_public') : '—')}</div>
            <div style="display:flex;gap:4px;margin-top:4px">${buttons.join('')}</div>
          </div>`;
        }).join('');
        list.querySelectorAll('button[data-accept]').forEach((b) => { b.onclick = () => doAcceptPvp(b.dataset.accept); });
        list.querySelectorAll('button[data-cancel]').forEach((b) => { b.onclick = () => doCancelPvp(b.dataset.cancel); });
        list.querySelectorAll('button[data-claim]').forEach((b) => { b.onclick = () => doClaimPvp(b.dataset.claim); });
      }
    } catch (e) { list.innerHTML = `<div class="hint err">${esc(e.message || e)}</div>`; }
  }

  async function doCreatePvp() {
    if (sanguoPicked.length !== 3) { showToast(t('need_three'), 'error'); return; }
    const opponent = ($('sgPvpOpp') || {}).value ? $('sgPvpOpp').value.trim() : '';
    const isPublic = ($('sgPvpPublic') || {}).checked;
    if (!isPublic && !opponent) { showToast(t('pvp_opponent'), 'error'); return; }
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    try { await loadParams(); } catch (e) { showToast(t('params_err'), 'error'); return; }
    const p = requireParams();
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoCreatePvp', { opponent: isPublic ? '' : opponent, card_ids: sanguoPicked.slice(), public: isPublic }, { action: 'create_pvp', spend: p.pvp_fee });
      sgSpentTip('create_ok', p.pvp_fee);
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doAcceptPvp(matchId) {
    sgPendingAction = 'accept_pvp'; sgPendingId = matchId; sanguoPicked = [];
    const card = document.getElementById('sgActCard');
    if (card) { card.style.display = ''; sanguoRenderPicker('sgActPick', 3); }
    const go = document.getElementById('sgActGo');
    if (go) go.onclick = () => doPendingConfirm();
  }
  async function doPendingConfirm() {
    if (sanguoPicked.length !== 3) { showToast(t('need_three'), 'error'); return; }
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    try { await loadParams(); } catch (e) { showToast(t('params_err'), 'error'); return; }
    const p = requireParams();
    showBusy(t('doing'));
    try {
      if (sgPendingAction === 'accept_pvp') {
        await sanguoExec('SanguoAcceptPvp', { match_id: sgPendingId, card_ids: sanguoPicked.slice() }, { action: 'accept_pvp', spend: p.pvp_fee });
        sgSpentTip('accept_ok', p.pvp_fee);
        // 🟢 前端新增：对战竞技场（双方出牌 + 胜负）
        try { await showPvpBattle(sgPendingId); } catch (_) { /* 展示失败不影响主流程 */ }
      } else if (sgPendingAction === 'join_royale') {
        await sanguoExec('SanguoJoinRoyale', { royale_id: sgPendingId, card_ids: sanguoPicked.slice() }, { action: 'join_royale', spend: p.royale_entry_fee });
        sgSpentTip('join_ok', p.royale_entry_fee);
      }
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doCancelPvp(matchId) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoCancelPvp', { match_id: matchId }, { action: 'cancel_pvp', spend: 0 });
      showToast(t('cancel_ok'), 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doClaimPvp(matchId) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      const res = await sanguoExec('SanguoClaimPvpReward', { match_id: matchId }, { action: 'claim_pvp', spend: 0 });
      sgClaimToast(res.tx, 'claim_ok');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }

  // ============================================================
  // 混战（4-6 人）
  // ============================================================
  async function renderRoyale(body) {
    await loadParams();
    if (state.wallet) await loadSanguoCards();
    sanguoPicked = [];
    body.innerHTML = `
      <div class="card">
        <div class="card-title">🔥 ${t('royale_title')}</div>
        <div class="desc">${t('royale_desc')}</div>
      </div>
      <div class="card">
        <div class="card-title">${t('royale_create')}</div>
        <select id="sgRoyaleSize" class="input">
          <option value="4">4</option><option value="5">5</option><option value="6">6</option>
        </select>
        <div style="font-size:12px;color:#9fb3d1;margin-top:8px">${t('pick_title')}（${t('need_three')}）</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:6px 0" id="sgRoyalePick"></div>
        <button class="btn btn-primary" id="sgRoyaleCreate" style="width:100%">${t('royale_create')}</button>
      </div>
      <div class="card" id="sgActCard" style="display:none">
        <div class="card-title">${t('pick_title')}（${t('need_three')}）</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:6px 0" id="sgActPick"></div>
        <button class="btn btn-primary" id="sgActGo" style="width:100%">${t('ok_short')}</button>
      </div>
      <div class="card">
        <div class="card-title">${t('royale_list')}</div>
        <div id="sgRoyaleList"></div>
      </div>`;
    sanguoRenderPicker('sgRoyalePick', 3);
    $('sgRoyaleCreate').onclick = () => doCreateRoyale();
    const list = $('sgRoyaleList');
    try {
      const r = await queryContract({ sanguo_royale_list: { status: null, limit: 50 } });
      const rs = (r && r.royales) || [];
      if (!rs.length) list.innerHTML = `<div class="hint">${t('none_label')}</div>`;
      else {
        list.innerHTML = rs.map((m) => {
          const isPlayer = state.wallet && m.players.includes(state.wallet.address);
          const winner = m.winner || '';
          const isWinner = state.wallet && winner === state.wallet.address;
          const buttons = [];
          if (m.status === 'waiting' && !isPlayer) buttons.push(`<button class="btn btn-sm btn-primary" data-join="${m.royale_id}">${t('royale_join')}</button>`);
          if (m.status === 'full') buttons.push(`<button class="btn btn-sm btn-primary" data-settle="${m.royale_id}">${t('royale_settle')}</button>`);
          if (m.status === 'finished' && isWinner && !m.reward_claimed) buttons.push(`<button class="btn btn-sm btn-gold" data-claim="${m.royale_id}">${t('royale_claim')}</button>`);
          return `<div style="border-bottom:1px solid #1c2740;padding:6px 0">
            <div style="font-size:12px;font-weight:700;color:#fff">${t('match_id_label')}: ${esc(m.royale_id)}</div>
            <div style="font-size:11px;color:#9fb3d1">${t('status_label')}: ${m.status} · ${t('royale_size')}: ${m.size} · ${m.players.length}/${m.size}</div>
            <div style="display:flex;gap:4px;margin-top:4px">${buttons.join('')}</div>
          </div>`;
        }).join('');
        list.querySelectorAll('button[data-join]').forEach((b) => { b.onclick = () => doJoinRoyale(b.dataset.join); });
        list.querySelectorAll('button[data-settle]').forEach((b) => { b.onclick = () => doSettleRoyale(b.dataset.settle); });
        list.querySelectorAll('button[data-claim]').forEach((b) => { b.onclick = () => doClaimRoyale(b.dataset.claim); });
      }
    } catch (e) { list.innerHTML = `<div class="hint err">${esc(e.message || e)}</div>`; }
  }

  async function doCreateRoyale() {
    if (sanguoPicked.length !== 3) { showToast(t('need_three'), 'error'); return; }
    const size = Number(($('sgRoyaleSize') || {}).value || 4);
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    try { await loadParams(); } catch (e) { showToast(t('params_err'), 'error'); return; }
    const p = requireParams();
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoCreateRoyale', { size, card_ids: sanguoPicked.slice() }, { action: 'create_royale', spend: p.royale_entry_fee });
      sgSpentTip('create_ok', p.royale_entry_fee);
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doJoinRoyale(royaleId) {
    sgPendingAction = 'join_royale'; sgPendingId = royaleId; sanguoPicked = [];
    const card = document.getElementById('sgActCard');
    if (card) { card.style.display = ''; sanguoRenderPicker('sgActPick', 3); }
    const go = document.getElementById('sgActGo');
    if (go) go.onclick = () => doPendingConfirm();
  }
  async function doSettleRoyale(royaleId) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoSettleRoyale', { royale_id: royaleId }, { action: 'settle_royale', spend: 0 });
      showToast(t('settle_ok'), 'success');
      // 🟢 前端新增：混战竞技场（多方出牌 + 胜者）
      try { await showRoyaleBattle(royaleId); } catch (_) { /* 展示失败不影响主流程 */ }
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doClaimRoyale(royaleId) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      const res = await sanguoExec('SanguoClaimRoyaleReward', { royale_id: royaleId }, { action: 'claim_royale', spend: 0 });
      sgClaimToast(res.tx, 'claim_ok');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }

  // ============================================================
  // 新增前端展示：图鉴 / 卡牌详情 / 对战竞技场 / 头部统计联动
  // ⚠️ 仅改渲染层；以下函数不发起任何合约写操作，
  //    所有 sanguoExec / queryContract 调用均复用既有逻辑或只读查询。
  // ============================================================
  let sgAiStats = null;     // 来自 sanguo_ai_stats {total,wins,...}
  let sgFragCache = null;   // 碎片总数（来自 sanguo_fragments）
  let currentDetailCard = null; // 当前卡牌详情弹窗对应的卡

  // 稀有度 → CSS 类（对应 index.html 的 .rarity-*）
  function rarityClass(r) {
    return { legend: 'rarity-legend', epic: 'rarity-epic', rare: 'rarity-rare', common: 'rarity-common' }[r] || '';
  }

  // ---- 卡牌详情弹窗 ----
  // 根据 card_id 打开「我的卡」详情（可升星 / 升级 / 分解）
  function openCardDetailFromId(cardId) {
    const card = userCards.find((c) => c.card_id === cardId);
    if (!card) return;
    openCardDetail(card, true);
  }
  window.openCardDetailFromId = openCardDetailFromId;

  // 根据武将名打开图鉴卡详情（只读，不可养成）
  function openCodexCard(name) {
    const tpl = CARD_TEMPLATES.find((t) => t.name === name);
    if (!tpl) return;
    openCardDetail({
      card_id: tpl.name, name: tpl.name, rarity: tpl.rarity,
      attack: tpl.attack, defense: tpl.defense, star: 1, level: 0,
      title: tpl.title, identity: tpl.identity,
    }, false);
  }
  window.openCodexCard = openCodexCard;

  function openCardDetail(card, owned) {
    currentDetailCard = card;
    const img = getCardImage(card.name);
    const col = rarityColor(card.rarity);
    const dImg = $('detailImg'); if (dImg) { dImg.src = img || ''; dImg.style.display = img ? '' : 'none'; }
    const dName = $('detailName'); if (dName) { dName.textContent = card.name || '—'; dName.style.color = col; }
    const dSub = $('detailSub'); if (dSub) dSub.textContent = card.identity || card.title || '';
    const dRar = $('detailRarity'); if (dRar) { dRar.textContent = rarityLabel(card.rarity); dRar.style.color = col; }
    const dId = $('detailIdentity'); if (dId) dId.textContent = card.identity || card.title || '—';
    const dAtk = $('detailAtk'); if (dAtk) dAtk.textContent = (card.attack != null) ? card.attack : '—';
    const dDef = $('detailDef'); if (dDef) dDef.textContent = (card.defense != null) ? card.defense : '—';
    const dPow = $('detailPower'); if (dPow) dPow.textContent = power(card);
    const dStar = $('detailStar'); if (dStar) dStar.textContent = '★' + (card.star || 1) + (card.level ? ' Lv' + card.level : '');
    const dDesc = $('detailDesc');
    if (dDesc) dDesc.textContent = tf('detail_stats', {
      identity: card.identity || '',
      title: card.title ? tf('detail_title_wrap', { t: card.title }) : '',
      atk: card.attack != null ? card.attack : '?',
      def: card.defense != null ? card.defense : '?',
      pow: power(card),
    });
    // 🟢「我的卡牌」弹窗只展示参数：养成按钮统一放到「养成」页，这里始终隐藏。
    const actions = document.querySelector('#cardDetailModal .star-actions');
    if (actions) actions.style.display = 'none';
    const modal = $('cardDetailModal');
    if (modal) modal.classList.add('active');
  }
  window.openCardDetail = openCardDetail;

  function closeCardDetail() {
    const modal = $('cardDetailModal');
    if (modal) modal.classList.remove('active');
    currentDetailCard = null;
  }
  window.closeCardDetail = closeCardDetail;

  // 详情弹窗内的养成按钮：复用既有 do* 逻辑（已含无感签名 + 重渲染）
  async function _refreshDetail(cardId) {
    if (state.wallet) { try { await loadSanguoCards(); } catch (e) {} }
    const card = userCards.find((c) => c.card_id === cardId);
    if (card) openCardDetail(card, true);
    else closeCardDetail(); // 已分解（卡不存在）
  }
  async function detailStarUp() {
    if (!currentDetailCard) return;
    const cid = currentDetailCard.card_id;
    await doStarUp(cid, false); await _refreshDetail(cid);
  }
  window.detailStarUp = detailStarUp;
  async function detailStarUpFrag() {
    if (!currentDetailCard) return;
    const cid = currentDetailCard.card_id;
    await doStarUp(cid, true); await _refreshDetail(cid);
  }
  window.detailStarUpFrag = detailStarUpFrag;
  async function detailUpgrade() {
    if (!currentDetailCard) return;
    const cid = currentDetailCard.card_id;
    await doUpgrade(cid); await _refreshDetail(cid);
  }
  window.detailUpgrade = detailUpgrade;
  async function detailDecompose() {
    if (!currentDetailCard) return;
    const cid = currentDetailCard.card_id;
    await doDecompose(cid); closeCardDetail();
  }
  window.detailDecompose = detailDecompose;

  // ---- 老版风格：我的卡牌网格内联按钮（不经弹窗直接养成）----
  // 分解是销毁性操作（卡没了换碎片），网格里按钮小、易误触，加一次确认。
  window.sgQuickUpgrade = (cid) => doUpgrade(cid);
  window.sgQuickStarUp = (cid) => doStarUp(cid, false);
  window.sgQuickDecompose = (cid) => {
    if (!confirm(t('decompose_confirm'))) return;
    doDecompose(cid);
  };

  // ---- 卡牌图鉴 ----
  async function openCodex() {
    const ownedNames = new Set(userCards.map((c) => c.name));
    const total = CARD_TEMPLATES.length;
    const ownedCount = CARD_TEMPLATES.filter((tpl) => ownedNames.has(tpl.name)).length;
    const prog = $('codexProgress');
    if (prog) prog.textContent = tf('codex_progress', { own: ownedCount, total });
    const grid = $('codexContent');
    if (grid) {
      grid.innerHTML = CARD_TEMPLATES.map((tpl) => {
        const img = getCardImage(tpl.name);
        const cls = rarityClass(tpl.rarity);
        const have = ownedNames.has(tpl.name);
        return `<div class="codex-card ${cls}" onclick="openCodexCard('${esc(tpl.name)}')">
          ${have ? '' : `<div class="sg-card-lv" style="background:rgba(0,0,0,.65);color:#888">${t('codex_not_owned')}</div>`}
          <div class="cc-img"><img src="${img}" onerror="this.style.display='none'"></div>
          <div class="cc-foot"><div class="nm">${esc(tpl.name)}</div><div class="rr">${rarityLabel(tpl.rarity)} · ${t('power_label')} ${power(tpl)}</div></div>
        </div>`;
      }).join('');
    }
    const modal = $('codexModal');
    if (modal) modal.classList.add('active');
  }
  window.openCodex = openCodex;

  function closeCodex() {
    const modal = $('codexModal');
    if (modal) modal.classList.remove('active');
  }
  window.closeCodex = closeCodex;

  // ---- 对战竞技场 ----
  // 解析 "[210, 180, 195]" 形式的战力数组
  function parsePowers(str) {
    if (!str) return [];
    return String(str).replace(/[\[\]]/g, '').split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  }
  // 用战力还原最接近的模板（用于展示 AI 出牌，纯前端展示用）
  function bestMatchTemplate(p) {
    let best = null, bd = Infinity;
    for (const tpl of CARD_TEMPLATES) {
      const d = Math.abs((tpl.attack + tpl.defense) - p);
      if (d < bd) { bd = d; best = tpl; }
    }
    return best;
  }
  // 批量按 card_id 取卡（任意玩家均可，复用 sanguo_card 只读查询）
  async function cardsFromIds(ids) {
    const list = await Promise.all((ids || []).map(async (id) => {
      try {
        const c = await queryContract({ sanguo_card: { card_id: id } });
        return c ? { name: c.name, rarity: c.rarity, power: power(c) } : { name: id, rarity: 'common', power: 0 };
      } catch (e) { return { name: id, rarity: 'common', power: 0 }; }
    }));
    return list;
  }
  // 迷你卡（竞技场用）
  function miniCardHtml(c) {
    const img = c.img || getCardImage(c.name) || '';
    const col = rarityColor(c.rarity);
    const tag = c.ai ? '<div style="position:absolute;top:0;left:0;background:#8b2f1a;color:#fff;font-size:8px;padding:0 3px;border-bottom-right-radius:4px">AI</div>'
                     : (c.win ? '<div style="position:absolute;top:0;right:0;background:#b8860b;color:#0d0a0c;font-size:8px;padding:0 3px;border-bottom-left-radius:4px">👑</div>' : '');
    return `<div class="mini-card" style="position:relative;border-color:${col}">
      ${tag}
      <img src="${img}" onerror="this.style.display='none'">
      <div class="mc-nm">${esc(c.name || '?')}</div>
      ${c.power != null ? `<div style="font-size:8px;text-align:center;color:${col};padding-bottom:1px">⚔ ${c.power}</div>` : ''}
    </div>`;
  }
  // 通用竞技场渲染：opts.sides 或 opts.you/opts.opp；result ∈ win|lose|draw
  function showBattle(opts) {
    const arena = $('battleArena');
    if (!arena) return;
    let sidesHtml;
    if (opts.sides && opts.sides.length) {
      sidesHtml = opts.sides.map((s) => `
        <div class="side-label">${esc(s.label || '—')}${t('battle_deployed')}</div>
        <div class="side-cards">${(s.cards || []).map(miniCardHtml).join('') || '<span class="hint">—</span>'}</div>`).join('');
    } else {
      const you = (opts.you || []).map((c) => (Object.assign({}, c, { win: opts.result === 'win' })));
      const opp = (opts.opp || []).map((c) => (Object.assign({}, c, { win: opts.result === 'lose' })));
      sidesHtml = `
        <div class="side-label">${esc(opts.youLabel || t('battle_you'))}${t('battle_deployed')}</div>
        <div class="side-cards">${you.map(miniCardHtml).join('') || '<span class="hint">—</span>'}</div>
        <div class="side-label">${esc(opts.oppLabel || t('battle_opp'))}${t('battle_deployed')}</div>
        <div class="side-cards">${opp.map(miniCardHtml).join('') || '<span class="hint">—</span>'}</div>`;
    }
    const resultClass = opts.result === 'win' ? 'win' : opts.result === 'lose' ? 'lose' : 'draw';
    const resultText = opts.result === 'win' ? t('battle_win') : opts.result === 'lose' ? t('battle_lose') : t('battle_draw');
    const rewardHtml = (opts.reward != null && Number(opts.reward) > 0) ? `<div class="side-label">${tf('battle_reward', { amt: opts.reward })}</div>` : '';
    const rwHtml = (opts.roundWins !== null && opts.roundWins !== undefined && opts.roundWins !== '') ? `<div class="side-label">${tf('battle_rounds', { n: opts.roundWins })}</div>` : '';
    arena.innerHTML = `
      <div class="vs-banner">${t('battle_result_title')}</div>
      ${sidesHtml}
      ${rwHtml}${rewardHtml}
      <div class="final-result ${resultClass}">${resultText}</div>`;
    arena.classList.add('show');
    try { arena.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  }
  window.showBattle = showBattle;

  // AI 对战：从交易事件还原双方出牌 + 胜负 + 奖励
  async function showAiBattleFromTx(tx, diff) {
    const ev = parseTxEvents(tx, ['result', 'player_powers', 'ai_powers', 'round_wins', 'reward']);
    const result = (ev.result && ev.result[0]) || 'lose';
    const playerPowers = parsePowers(ev.player_powers && ev.player_powers[0]);
    const aiPowers = parsePowers(ev.ai_powers && ev.ai_powers[0]);
    const roundWins = (ev.round_wins && ev.round_wins[0]) || '';
    const rewardRaw = (ev.reward && ev.reward[0]) || '0';
    // 🟢 修复：链上 reward 是 raw（TKCC 精度 6），必须除以 1e6 再展示
    const reward = fromRawUnits(rewardRaw, 6);
    // 我方出牌：优先链上出战顺序，回退前 3 张
    let orderIds = [];
    try { const bo = await queryContract({ sanguo_battle_order: { player: state.wallet.address } }); orderIds = (bo && bo.order) || []; } catch (e) {}
    let you = orderIds.map((id) => userCards.find((c) => c.card_id === id)).filter(Boolean);
    if (you.length < 3) you = userCards.slice(0, 3);
    you = you.slice(0, 3).map((c) => ({ name: c.name, rarity: c.rarity, power: power(c) }));
    // 对手（AI）：用战力还原最接近模板作展示（带 AI 标记）
    const opp = aiPowers.map((p) => {
      const tpl = bestMatchTemplate(p);
      return { name: tpl ? tpl.name : t('battle_ai_general'), rarity: tpl ? tpl.rarity : 'common', power: p, ai: true };
    });
    showBattle({ you, opp, result, youLabel: t('battle_you'), oppLabel: tf('battle_ai_diff', { n: diff }), roundWins, reward });
  }
  window.showAiBattleFromTx = showAiBattleFromTx;

  // PVP：双方真实出牌（按 card_id 取卡）+ 胜负
  async function showPvpBattle(matchId) {
    const m = await queryContract({ sanguo_pvp: { match_id: matchId } });
    if (!m) return;
    const ch = await cardsFromIds(m.challenger_order || []);
    const op = await cardsFromIds(m.opponent_order || []);
    const winner = m.winner || '';
    let result = 'draw';
    if (winner) {
      if (state.wallet && winner === state.wallet.address) result = 'win';
      else if (state.wallet && (m.challenger === state.wallet.address || m.opponent === state.wallet.address)) result = 'lose';
    }
    showBattle({ you: ch, opp: op, youLabel: t('battle_challenger'), oppLabel: t('battle_defender'), result });
  }
  window.showPvpBattle = showPvpBattle;

  // 混战：多方真实出牌 + 胜者
  async function showRoyaleBattle(royaleId) {
    const r = await queryContract({ sanguo_royale: { royale_id: royaleId } });
    if (!r) return;
    const players = r.players || [];
    const orders = r.player_orders || [];
    const winner = r.winner || '';
    let result = 'draw';
    if (winner) {
      if (state.wallet && winner === state.wallet.address) result = 'win';
      else if (state.wallet && players.includes(state.wallet.address)) result = 'lose';
    }
    const sides = [];
    for (let i = 0; i < players.length; i++) {
      const cards = await cardsFromIds(orders[i] || []);
      const isMe = state.wallet && players[i] === state.wallet.address;
      const isWin = winner && players[i] === winner;
      const short = sgShortAddr(players[i]);
      sides.push({ label: (isMe ? t('battle_you') : short) + (isWin ? ' 👑' : ''), cards });
    }
    showBattle({ sides, result });
  }
  window.showRoyaleBattle = showRoyaleBattle;

  // ---- 头部统计联动（供 index.html 包装 refreshBalances 调用）----
  function sgSyncWallet() {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    if (userCards) set('sgStatCards', userCards.length);
    if (sgAiStats) {
      set('sgWin', sgAiStats.wins != null ? sgAiStats.wins : '—');
      set('sgBattle', sgAiStats.total != null ? sgAiStats.total : '—');
    }
    if (sgFragCache != null) set('sgFrag', sgFragCache);
  }
  window.__sgSyncWallet = sgSyncWallet;

  // ============================================================
  // 注册到大厅（关键：否则大厅不显示三国卡片）
  // ============================================================
  const SanguoGame = {
    meta: {
      id: 'sanguo',
      name: { zh: '三国卡牌', en: 'Three Kingdoms' },
      icon: '🀄',
      desc: { zh: '抽卡·收藏武将卡牌', en: 'Draw & collect generals' },
      type: 'sanguo',
    },
  };
  if (!window.GAMES) window.GAMES = [];
  if (!window.GAME_REGISTRY) window.GAME_REGISTRY = {};
  window.GAMES.push(SanguoGame);
  window.GAME_REGISTRY['sanguo'] = SanguoGame;

  // 大厅切换语言时，若三国已打开则整页重渲染（含标题与页签文案）
  const _sgRerender = () => { if (document.getElementById('sgBody')) renderSanguo(); };
  window.__sgRerender = _sgRerender;
  window.addEventListener('hub-lang-change', _sgRerender);

})();
