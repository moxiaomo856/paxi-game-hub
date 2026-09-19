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
      'ai_title': 'AI 对战',
      'ai_desc': '选择难度挑战 AI，胜则赢取 TKCC 奖励',
      'ai_diff': '难度',
      'ai_fee': '挑战费',
      'ai_reward': '胜率奖励',
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
      'select_rarity': '选择稀有度',
      'craft_btn': '合成',
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
      'ai_title': 'AI Battle',
      'ai_desc': 'Pick a difficulty and battle the AI; win TKCC rewards',
      'ai_diff': 'Difficulty',
      'ai_fee': 'Entry fee',
      'ai_reward': 'Win reward',
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
      'select_rarity': 'Select Rarity',
      'craft_btn': 'Craft',
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
    },
  };
  function t(k) {
    const l = (window.HUB_LANG === 'en') ? 'en' : 'zh';
    return (i18n[l] && i18n[l][k] != null) ? i18n[l][k] : (i18n.zh[k] != null ? i18n.zh[k] : k);
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
        throw new Error('会话签名异常（签名为空）——通常是浏览器缓存了旧版脚本，请强制刷新页面（或清除缓存）后重试');
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
        const hash = await execContract(payload, opts.funds || []);
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

  // 七页签（完整玩法），全部走无感签名；标签用 t() 动态取，跟随大厅语言切换
  const SANGUO_TABS = [
    { id: 'draw',      key: 'tab_draw' },
    { id: 'mycards',   key: 'tab_mycards' },
    { id: 'ai',        key: 'tab_ai' },
    { id: 'cultivate', key: 'tab_cultivate' },
    { id: 'proposal',  key: 'tab_proposal' },
    { id: 'pvp',       key: 'tab_pvp' },
    { id: 'royale',    key: 'tab_royale' },
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
          <div class="sg-stat"><span class="ic">🏆</span><span class="num" id="sgWin">—</span><span class="lb">胜场</span></div>
          <div class="sg-stat"><span class="ic">🃏</span><span class="num" id="sgStatCards">0</span><span class="lb">总卡牌</span></div>
          <div class="sg-stat"><span class="ic">⚔️</span><span class="num" id="sgBattle">—</span><span class="lb">总对战</span></div>
          <div class="sg-stat"><span class="ic">🧩</span><span class="num" id="sgFrag" style="color:#ffd700">0</span><span class="lb">碎片</span></div>
        </div>
        <div class="card">
          <div class="card-title">${t('sg_title')}</div>
          <div class="desc">${t('sg_subtitle')}</div>
        </div>
        <div class="card">
          <button class="btn btn-gold" onclick="openCodex()" style="width:100%">📚 卡牌图鉴（${CARD_TEMPLATES.length} 将）</button>
        </div>
        <div id="sgTabs">
          ${SANGUO_TABS.map((tb) => tabBtn(tb.id, t(tb.key))).join('')}
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
    };
    (fns[sanguoTab] || renderDraw)(body);
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
          `合约内 PAXI 不足：${pack3 ? '三连抽' : '单抽'}需要 ${need} PAXI，当前只有 ${have} PAXI，请先充值至少 ${lack} PAXI`,
          'error',
        );
        const log = $('sgDrawLog');
        if (log) {
          log.innerHTML = `<div class="hint err">❌ 合约内 PAXI 不足：需要 ${need} PAXI，当前 ${have} PAXI，请先充值 ${lack} PAXI</div>`;
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
      log.innerHTML = `<div class="hint" style="margin-top:6px">老合约：${esc(n)} 张卡 · 碎片(普/稀/史/传) ${esc(fg)}</div>`;
      if (n === 0 && fg === '0/0/0/0') {
        btn.disabled = true;
        log.innerHTML += `<div class="hint" style="margin-top:4px">${t('migrate_none')}</div>`;
      }
    } catch (e) { /* 预览失败不阻断迁移按钮 */ }
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
      const { tx } = await sanguoExec(
        'SanguoMigrateFromOld',
        { old_contract: OLD_SANGUO_CONTRACT },
        { action: 'migrate', spend: 0 },
      );
      const a = parseTxEvents(tx, ['cards_minted', 'cards_skipped', 'fragments_migrated']);
      const minted = (a.cards_minted && a.cards_minted[0]) || '0';
      const skipped = (a.cards_skipped && a.cards_skipped[0]) || '0';
      const frags = (a.fragments_migrated && a.fragments_migrated[0]) || '0';
      migrationDone = true;
      if (log) log.innerHTML = `<div class="hint ok" style="margin-top:6px">✅ ${t('migrate_ok')}：${minted} 张卡，${frags} 碎片${Number(skipped) ? `（跳过 ${skipped}）` : ''}</div>`;
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
      await sanguoExec('SanguoClaimReward', { battle_id: battleId }, { action: 'claim_reward', spend: 0 });
      showToast(t('ok_short'), 'success');
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
      for (const id of ids) {
        await sanguoExec('SanguoClaimReward', { battle_id: id }, { action: 'claim_reward', spend: 0 });
      }
      showToast(t('ok_short'), 'success');
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
      <div class="card">
        <div class="card-title">⚔️ ${t('ai_title')}</div>
        <div class="desc">${t('ai_desc')}</div>
      </div>
      <div class="card">
        <div class="kv"><span class="k">${t('ai_today')}</span><span class="v" id="sgAiToday">—</span></div>
        <div class="kv"><span class="k">${t('ai_limit')}</span><span class="v" id="sgAiLimit">—</span></div>
        <div class="kv"><span class="k">${t('win_rate')}</span><span class="v" id="sgAiRate">—</span></div>
        <div class="kv"><span class="k">我的卡牌</span><span class="v" id="sgAiCards">${cardCount} / 3</span></div>
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
        <button class="btn btn-primary" id="sgAiGo" style="margin-top:10px;width:100%" ${enoughCards ? '' : 'disabled'}>${enoughCards ? t('ai_title') : '需至少 3 张卡牌'}</button>
        ${enoughCards ? '' : '<div class="hint err" style="margin-top:8px">❌ AI 对战需要至少 3 张卡牌，请先去「抽卡」获得卡牌后再来挑战。</div>'}
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
    $('sgAiGo').onclick = () => doAiBattle();
  }

  async function doAiBattle() {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    try { await loadParams(); } catch (e) { showToast(t('params_err'), 'error'); return; }
    // 🟢 门槛校验：合约 ai_battle 要求 ≥3 张卡，避免无卡也能发交易并弹钱包
    if (!userCards || userCards.length < 3) {
      try { await loadSanguoCards(); } catch (e) {}
      if (!userCards || userCards.length < 3) {
        const msg = 'AI 对战需要至少 3 张卡牌，请先去「抽卡」获得卡牌后再来挑战。';
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
    showBusy(t('doing'));
    try {
      const res = await sanguoExec('SanguoAiBattle', { difficulty: diff }, { action: 'ai_battle', spend: fee });
      showToast(t('ok_short'), 'success');
      // 🟢 前端新增：对战竞技场（双方出牌 + 胜负 + 奖励）
      try { await showAiBattleFromTx(res.tx, diff); } catch (_) { /* 展示失败不影响主流程 */ }
      renderSanguoTab();
    } catch (e) {
      $('sgAiLog').innerHTML = `<div class="hint err">❌ ${esc(e.message || e)}</div>`;
      showToast(t('fail_prefix') + (e.message || e), 'error');
    } finally { hideBusy(); }
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
      <div class="card">
        <div class="card-title">${t('select_rarity')} → ${t('craft_btn')}</div>
        <select id="sgCraftRarity" class="input">
          <option value="common">${t('rarity_common')}</option>
          <option value="rare">${t('rarity_rare')}</option>
          <option value="epic">${t('rarity_epic')}</option>
          <option value="legend">${t('rarity_legend')}</option>
        </select>
        <button class="btn btn-gold" id="sgCraft" style="margin-top:8px;width:100%">${t('craft_btn')}</button>
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
    $('sgCraft').onclick = () => doCraft();
    const grid = $('sgCultGrid');
    if (!userCards.length) {
      grid.innerHTML = `<div class="hint" style="grid-column:1/-1">${t('empty_cards')}</div>`;
    } else {
      grid.innerHTML = userCards.map((c) => {
        const col = rarityColor(c.rarity);
        return `<div style="border:2px solid ${col};border-radius:10px;overflow:hidden;background:#0d1322;padding:4px">
          <div style="font-size:11px;font-weight:700;color:#fff">${esc(c.name)}</div>
          <div style="font-size:9px;color:${col}">${rarityLabel(c.rarity)} ★${c.star||1} Lv${c.level||0} · ${power(c)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:4px">
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
      showToast(`${t('ok_short')} · 出牌顺序：${names.join(' → ')}`, 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doStarUp(cardId, useFragments) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoStarUp', { card_id: cardId, use_fragments: useFragments }, { action: 'star_up', spend: 0 });
      showToast(t('ok_short'), 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doUpgrade(cardId) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoUpgrade', { card_id: cardId }, { action: 'upgrade', spend: 0 });
      showToast(t('ok_short'), 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doDecompose(cardId) {
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoDecompose', { card_id: cardId }, { action: 'decompose', spend: 0 });
      showToast(t('ok_short'), 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
  }
  async function doCraft() {
    const rarity = ($('sgCraftRarity') || {}).value || 'common';
    try { await requireSanguo(); } catch (e) { showToast(e.message, 'error'); return; }
    showBusy(t('doing'));
    try {
      await sanguoExec('SanguoCraft', { rarity }, { action: 'craft', spend: 0 });
      showToast(t('ok_short'), 'success');
      renderSanguoTab();
    } catch (e) { showToast(t('fail_prefix') + (e.message || e), 'error'); }
    finally { hideBusy(); }
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
            <div style="font-size:11px;color:#9fb3d1">${t('status_label')}: ${m.status} · ${t('opponent_label')}: ${m.opponent ? esc(m.opponent) : (m.is_public ? t('pvp_public') : '—')}</div>
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
      showToast(t('create_ok'), 'success');
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
        showToast(t('accept_ok'), 'success');
        // 🟢 前端新增：对战竞技场（双方出牌 + 胜负）
        try { await showPvpBattle(sgPendingId); } catch (_) { /* 展示失败不影响主流程 */ }
      } else if (sgPendingAction === 'join_royale') {
        await sanguoExec('SanguoJoinRoyale', { royale_id: sgPendingId, card_ids: sanguoPicked.slice() }, { action: 'join_royale', spend: p.royale_entry_fee });
        showToast(t('join_ok'), 'success');
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
      await sanguoExec('SanguoClaimPvpReward', { match_id: matchId }, { action: 'claim_pvp', spend: 0 });
      showToast(t('claim_ok'), 'success');
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
      showToast(t('create_ok'), 'success');
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
      await sanguoExec('SanguoClaimRoyaleReward', { royale_id: royaleId }, { action: 'claim_royale', spend: 0 });
      showToast(t('claim_ok'), 'success');
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
    if (dDesc) dDesc.textContent = `${card.identity || ''}${card.title ? '「' + card.title + '」' : ''}　攻击 ${card.attack != null ? card.attack : '?'} · 防御 ${card.defense != null ? card.defense : '?'} · 战力 ${power(card)}`;
    const actions = document.querySelector('#cardDetailModal .star-actions');
    if (actions) actions.style.display = owned ? '' : 'none';
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

  // ---- 卡牌图鉴 ----
  async function openCodex() {
    const ownedNames = new Set(userCards.map((c) => c.name));
    const total = CARD_TEMPLATES.length;
    const ownedCount = CARD_TEMPLATES.filter((tpl) => ownedNames.has(tpl.name)).length;
    const prog = $('codexProgress');
    if (prog) prog.textContent = `收集进度：${ownedCount} / ${total}（点击卡牌查看详情）`;
    const grid = $('codexContent');
    if (grid) {
      grid.innerHTML = CARD_TEMPLATES.map((tpl) => {
        const img = getCardImage(tpl.name);
        const cls = rarityClass(tpl.rarity);
        const have = ownedNames.has(tpl.name);
        return `<div class="codex-card ${cls}" onclick="openCodexCard('${esc(tpl.name)}')">
          ${have ? '' : '<div class="sg-card-lv" style="background:rgba(0,0,0,.65);color:#888">未拥有</div>'}
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
        <div class="side-label">${esc(s.label || '—')}（出战）</div>
        <div class="side-cards">${(s.cards || []).map(miniCardHtml).join('') || '<span class="hint">—</span>'}</div>`).join('');
    } else {
      const you = (opts.you || []).map((c) => (Object.assign({}, c, { win: opts.result === 'win' })));
      const opp = (opts.opp || []).map((c) => (Object.assign({}, c, { win: opts.result === 'lose' })));
      sidesHtml = `
        <div class="side-label">${esc(opts.youLabel || '你')}（出战）</div>
        <div class="side-cards">${you.map(miniCardHtml).join('') || '<span class="hint">—</span>'}</div>
        <div class="side-label">${esc(opts.oppLabel || '对手')}（出战）</div>
        <div class="side-cards">${opp.map(miniCardHtml).join('') || '<span class="hint">—</span>'}</div>`;
    }
    const resultClass = opts.result === 'win' ? 'win' : opts.result === 'lose' ? 'lose' : 'draw';
    const resultText = opts.result === 'win' ? '🏆 胜利！' : opts.result === 'lose' ? '💀 失败' : '🤝 平局';
    const rewardHtml = (opts.reward != null && Number(opts.reward) > 0) ? `<div class="side-label">奖励：${opts.reward} TKCC</div>` : '';
    const rwHtml = (opts.roundWins !== null && opts.roundWins !== undefined && opts.roundWins !== '') ? `<div class="side-label">三局 ${opts.roundWins} 胜</div>` : '';
    arena.innerHTML = `
      <div class="vs-banner">⚔️ 对战结果</div>
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
      return { name: tpl ? tpl.name : 'AI 战将', rarity: tpl ? tpl.rarity : 'common', power: p, ai: true };
    });
    showBattle({ you, opp, result, youLabel: '你', oppLabel: 'AI 难度 ' + diff, roundWins, reward });
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
    showBattle({ you: ch, opp: op, youLabel: '挑战方', oppLabel: '应战方', result });
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
      const short = players[i].slice(0, 6) + '…' + players[i].slice(-4);
      sides.push({ label: (isMe ? '你' : short) + (isWin ? ' 👑' : ''), cards });
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
