// 本轮改动（B + D2 + I + R12）：「我的」页新增无感模式卡片 + 状态/到期提示；
//   hardReset 清空会话客户端缓存与内存私钥（I 修复）；
//   R12：①app.js/sanguo.js 的 Session.sign 调用补 await（C1 修复）②深链回退统一为官方 DApp 指南文档链接。
/**
 * Paxi Game Hub - 主入口
 * 路由 / 钱包 / 大厅 / 充提 / 游戏引导
 */

let currentTab = 'home';
let ctx = null;          // 当前游戏的上下文
let gameClaimBal = '0';  // 游戏页「领取奖励」卡片的合约内余额（下注用的是 TKCC）

// ============================================================
// 日志
// ============================================================
function log(msg, type = '') {
  const el = document.getElementById('log');
  if (!el) return;
  const line = document.createElement('div');
  line.className = type;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function showBusy(text) {
  hideBusy();
  const m = document.createElement('div');
  m.className = 'mask';
  m.id = 'busyMask';
  m.innerHTML = `<div class="spinner"></div><div>${text || hubT('processing')}</div>`;
  document.body.appendChild(m);
}
function hideBusy() {
  const m = document.getElementById('busyMask');
  if (m) m.remove();
}

const $ = (id) => document.getElementById(id);

// ============================================================
// 多语言（大厅级；三国子系统在自己的 sanguo.js 中响应 hub-lang-change）
// ============================================================
const HUB_I18N = {
  zh: {
    tab_home: '大厅', tab_wallet: '钱包', tab_me: '我的',
    btn_connect: '连接',
    title_home: '游戏大厅', title_wallet: '钱包', title_me: '我的',
    banner_title: '⚠️ 尚未配置游戏合约',
    banner_desc: '合约还没编译部署，所以地址没有写死。等合约 store + instantiate 拿到地址后，在「我的 → 合约地址」填一次即可，之后永久生效。也可以用带参数链接：',
    banner_tip: '💡 默认使用 TKCC 代币下注（需先「充值」TKCC 到合约）',
    banner_btn: '去填写合约地址',
    all_games: '全部游戏',
    choice_title: '🎮 选择游戏',
    w_bal_title: '💰 余额',
    sel_token: '选择代币',
    dep_title: '⬇️ 充值到合约',
    wd_title: '⬆️ 提款到钱包',
    sess_title: '🔑 会话密钥',
    add_token: '＋ 添加 PRC-20 代币',
    log_title: '📋 日志',
    acc_title: '👤 账户',
    contract_title: '📄 合约地址',
    limit_title: '🎮 游戏限额',
    reset_session: '清除本地会话密钥',
    dep_btn: '充值', wd_btn: '提现', save_btn: '保存并刷新',
    menu_deposit: '💰 充值', menu_withdraw: '💳 提现',
    menu_pump: '🚀 个性化发币', menu_burn: '🔥 燃烧代币', menu_reset: '🔄 重置数据',
    menu_economy: '📖 玩法及经济说明',
    // —— 玩法及经济说明弹窗 / 卡牌弹窗（静态 UI 文案）——
    menu_settings: '设置',
    eco_title: '📖 玩法及经济说明',
    codex_title: '📚 卡牌图鉴',
    detail_rarity: '稀有度', detail_faction: '阵营', detail_atk: '攻击',
    detail_def: '防御', detail_total: '共计', detail_star: '⭐ 星级',
    btn_star_up: '⭐ 升1星', btn_star_frag: '✨ 碎片升星', btn_level_up: '💠 升级',
    btn_decompose: '🔥 分解', btn_close: '关闭', modal_processing: '处理中...',
    // —— 通用 ——
    processing: '处理中…', loading: '加载中…', back_home: '← 大厅', back_wallet: '← 钱包',
    not_deployed: '合约未部署', pending_deploy: '🔒 待部署', disabled: '已停用',
    tag_external: '🎁 外部应用 · 新窗口打开',
    hint_connect: '连接钱包后即可开始游戏',
    hint_register: '首次游戏需注册会话密钥（一次性，之后下注不再弹钱包）',
    bal_onchain_paxi: '链上 PAXI', bal_incontract_paxi: '合约内 PAXI', bal_incontract_tkcc: '合约内 TKCC',
    // —— 钱包页 ——
    wallet_bal: '钱包余额', incontract_bal: '合约内余额', amt_label: '数量', all_btn: '全部',
    contract_addr_label: '合约地址',
    dep_desc_cw20: 'PRC-20 充值分两步：先<b>授权</b>给游戏合约，再充值。授权不足时会自动先发授权交易。',
    dep_desc_native: '充值后可在游戏中直接下注，无需每次签名。',
    sess_status: '状态', sess_unregistered: '未注册', sess_expired: '已过期', sess_ok: '正常',
    sess_addr: '会话地址', sess_daily_quota: '今日额度',
    sess_renew: '续期会话（+24h）', sess_register: '注册会话密钥',
    sess_desc: '会话有效期 24 小时。注册后下注由本地密钥签名，不再弹钱包。',
    // —— 我的页 ——
    acc_wallet_addr: '钱包地址', acc_sess_addr: '会话地址', acc_chain_id: '链 ID',
    acc_game_contract: '游戏合约', not_configured: '未配置',
    contract_game_label: '游戏合约地址',
    contract_tkcc_label: 'TKCC 合约（可选）',
    contract_desc: '填一次即写入本地，之后打开都不用再填。也可以直接用链接带参数打开：',
    clear_contracts_btn: '清除本地地址（回到默认值）',
    no_games_configured: '合约尚未配置任何游戏',
    load_fail: '读取失败：',
    per_day: '日', rounds_unit: '局',
    reset_session_desc: '仅在 nonce 卡死或想换密钥时使用。清除后需重新注册会话。',
    // —— 游戏页 ——
    result_title: '🎰 结果', result_placeholder: '下注后显示结果',
    bet_title: '💵 下注', bet_min: '最小', bet_max: '最大', bet_x2: '翻倍', bet_half: '减半',
    btn_play: '开始游戏', btn_submitting: '提交中…',
    limit_single: '单局限额', limit_daily: '每日上限',
    // —— 游戏页「领取奖励」（大厅游戏赢的币即时进合约内部余额，需在此提现回钱包）——
    claim_title: '🎁 领取奖励',
    claim_desc: '本游戏赢的币会先记在<b>合约内部余额</b>，不会自动到钱包。点下方按钮即可全部取回钱包（也可部分提现）。',
    claim_btn: '全部取回',
    claim_empty: '合约内暂无可领取的余额',
    claim_loading: '查询中…',
    claim_ok: '领取成功',
    // —— 提示 ——
    toast_open_in_paxihub: '请在 PaxiHub 钱包内打开',
    toast_connected: '钱包已连接',
    toast_connect_fail: '连接失败：',
    toast_set_contract_first: '请先在「我的」填写合约地址',
    toast_input_amount: '请输入下注金额',
    toast_invalid_amount: '数量无效', toast_input_amount_dep: '请输入数量',
    toast_added: '已添加', toast_removed: '已移除',
    tkcc_missing: '未配置 TKCC 合约，请先在「我的」填写',
    connect_wallet_first: '请先连接钱包',
    register_session_busy: '注册会话…',
    sess_registered_ok: '会话已注册', sess_register_ok2: '注册成功',
    wallet_insufficient: '钱包余额不足',
    game_insufficient: '合约内余额不足',
    load_game_busy: '加载游戏…',
    register_first_hint: '注册会话密钥后即可开始游戏（一次性操作，之后下注不再弹钱包）。',
    ready_log: (name, engine) => `${name} 已就绪，引擎 ${engine}`,
    load_fail_log: '加载失败：',
    fail_log: '失败：',
    chain_ok_log: '已上链，高度',
    you_win: '🎉 赢', you_lose: '😢 输',
    won_log: (v) => `🎉 赢了！派彩 ${v} TKCC`,
    lose_log: (v) => `输了 ${v} TKCC`,
    bet_log: (a, n) => `下注 ${a} TKCC（nonce=${n}）`,
    below_min_bet: (v) => `低于最小下注 ${v} TKCC`,
    above_max_bet: (v) => `超过最大下注 ${v} TKCC`,
    engine_mismatch: (want, got) => `引擎不匹配：本页期望 "${want}"，合约绑的是 "${got}"`,
    game_not_configured: (id) => `合约未配置游戏 "${id}" 的引擎`,
    limit_not_configured: (id) => `合约未配置游戏 "${id}" 的限额`,
    game_disabled: (id) => `游戏 "${id}" 已停用`,
  },
  en: {
    tab_home: 'Home', tab_wallet: 'Wallet', tab_me: 'Me',
    btn_connect: 'Connect',
    title_home: 'Game Hub', title_wallet: 'Wallet', title_me: 'My Account',
    banner_title: '⚠️ Game contract not configured',
    banner_desc: "The contract isn't compiled/deployed yet, so addresses aren't hardcoded. After store + instantiate, fill the address once in \"My → Contract\" and it persists. You can also open with a param link:",
    banner_tip: '💡 Bets use TKCC by default (deposit TKCC to the contract first)',
    banner_btn: 'Go set contract address',
    all_games: 'All Games',
    choice_title: '🎮 Choose a Game',
    w_bal_title: '💰 Balance',
    sel_token: 'Select Token',
    dep_title: '⬇️ Deposit to Contract',
    wd_title: '⬆️ Withdraw to Wallet',
    sess_title: '🔑 Session Key',
    add_token: '＋ Add PRC-20 Token',
    log_title: '📋 Log',
    acc_title: '👤 Account',
    contract_title: '📄 Contract Address',
    limit_title: '🎮 Game Limits',
    reset_session: 'Clear Local Session Key',
    dep_btn: 'Deposit', wd_btn: 'Withdraw', save_btn: 'Save & Reload',
    menu_deposit: '💰 Deposit', menu_withdraw: '💳 Withdraw',
    menu_pump: '🚀 Personal Token', menu_burn: '🔥 Burn Token', menu_reset: '🔄 Reset Data',
    menu_economy: '📖 Gameplay & economy',
    // —— economy / card modals (static UI text) ——
    menu_settings: 'Settings',
    eco_title: '📖 Gameplay & Economy',
    codex_title: '📚 Card Codex',
    detail_rarity: 'Rarity', detail_faction: 'Faction', detail_atk: 'ATK',
    detail_def: 'DEF', detail_total: 'Total', detail_star: '⭐ Star',
    btn_star_up: '⭐ +1 Star', btn_star_frag: '✨ Fragment Star', btn_level_up: '💠 Level Up',
    btn_decompose: '🔥 Decompose', btn_close: 'Close', modal_processing: 'Processing...',
    // —— common ——
    processing: 'Processing…', loading: 'Loading…', back_home: '← Hub', back_wallet: '← Wallet',
    not_deployed: 'Contract not deployed', pending_deploy: '🔒 Pending', disabled: 'Disabled',
    tag_external: '🎁 External app · opens in new tab',
    hint_connect: 'Connect your wallet to start playing',
    hint_register: 'First-time players need to register a session key (one-time; bets then skip wallet popups)',
    bal_onchain_paxi: 'On-chain PAXI', bal_incontract_paxi: 'In-contract PAXI', bal_incontract_tkcc: 'In-contract TKCC',
    // —— wallet page ——
    wallet_bal: 'Wallet Balance', incontract_bal: 'In-contract Balance', amt_label: 'Amount', all_btn: 'Max',
    contract_addr_label: 'Token Contract',
    dep_desc_cw20: 'PRC-20 deposits take two steps: <b>approve</b> the game contract first, then deposit. Approval is sent automatically when insufficient.',
    dep_desc_native: 'After depositing you can bet directly in games without wallet popups.',
    sess_status: 'Status', sess_unregistered: 'Not registered', sess_expired: 'Expired', sess_ok: 'Active',
    sess_addr: 'Session Address', sess_daily_quota: 'Today\'s Quota',
    sess_renew: 'Renew Session (+24h)', sess_register: 'Register Session Key',
    sess_desc: 'Sessions last 24 hours. After registering, bets are signed locally — no wallet popups.',
    // —— my account page ——
    acc_wallet_addr: 'Wallet Address', acc_sess_addr: 'Session Address', acc_chain_id: 'Chain ID',
    acc_game_contract: 'Game Contract', not_configured: 'Not set',
    contract_game_label: 'Game Contract Address',
    contract_tkcc_label: 'TKCC Contract (optional)',
    contract_desc: 'Fill once and it persists locally. You can also open with a param link:',
    clear_contracts_btn: 'Clear Local Addresses (back to defaults)',
    no_games_configured: 'No games configured in the contract yet',
    load_fail: 'Load failed: ',
    per_day: '/day', rounds_unit: ' rounds',
    reset_session_desc: 'Only use when the nonce is stuck or you want new keys. You must re-register the session afterwards.',
    // —— game page ——
    result_title: '🎰 Result', result_placeholder: 'Result shows after betting',
    bet_title: '💵 Bet', bet_min: 'Min', bet_max: 'Max', bet_x2: '×2', bet_half: '½',
    btn_play: 'Play', btn_submitting: 'Submitting…',
    limit_single: 'Bet Range', limit_daily: 'Daily Limit',
    claim_title: '🎁 Claim Reward',
    claim_desc: 'Winnings are credited to your <b>in-contract balance</b>, not your wallet. Tap below to withdraw everything back to your wallet.',
    claim_btn: 'Claim All',
    claim_empty: 'No in-contract balance to claim',
    claim_loading: 'Checking…',
    claim_ok: 'Claimed',
    // —— toasts ——
    toast_open_in_paxihub: 'Please open inside the PaxiHub wallet',
    toast_connected: 'Wallet connected',
    toast_connect_fail: 'Connection failed: ',
    toast_set_contract_first: 'Set the contract address in "My Account" first',
    toast_input_amount: 'Enter a bet amount',
    toast_invalid_amount: 'Invalid amount', toast_input_amount_dep: 'Enter an amount',
    toast_added: 'Added', toast_removed: 'Removed',
    tkcc_missing: 'TKCC contract not configured — set it in "My Account" first',
    connect_wallet_first: 'Please connect your wallet first',
    register_session_busy: 'Registering session…',
    sess_registered_ok: 'Session registered', sess_register_ok2: 'Registered',
    wallet_insufficient: 'Insufficient wallet balance',
    game_insufficient: 'Insufficient in-contract balance',
    load_game_busy: 'Loading game…',
    register_first_hint: 'Register a session key to start playing (one-time; bets then skip wallet popups).',
    ready_log: (name, engine) => `${name} ready, engine ${engine}`,
    load_fail_log: 'Load failed: ',
    fail_log: 'Failed: ',
    chain_ok_log: 'On chain, height',
    you_win: '🎉 Won', you_lose: '😢 Lost',
    won_log: (v) => `🎉 Won! Payout ${v} TKCC`,
    lose_log: (v) => `Lost ${v} TKCC`,
    bet_log: (a, n) => `Bet ${a} TKCC (nonce=${n})`,
    below_min_bet: (v) => `Below minimum bet ${v} TKCC`,
    above_max_bet: (v) => `Above maximum bet ${v} TKCC`,
    engine_mismatch: (want, got) => `Engine mismatch: page expects "${want}", contract bound "${got}"`,
    game_not_configured: (id) => `Engine for game "${id}" not configured in contract`,
    limit_not_configured: (id) => `Limit for game "${id}" not configured in contract`,
    game_disabled: (id) => `Game "${id}" is disabled`,
  },
};
function hubLang() {
  return (window.HUB_LANG === 'en') ? 'en' : 'zh';
}
function hubT(k) {
  const l = hubLang();
  return (HUB_I18N[l] && HUB_I18N[l][k] != null) ? HUB_I18N[l][k]
    : (HUB_I18N.zh[k] != null ? HUB_I18N.zh[k] : k);
}
function applyHubLang() {
  const l = (window.HUB_LANG === 'en') ? 'en' : 'zh';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (HUB_I18N[l] && HUB_I18N[l][k] != null) el.textContent = HUB_I18N[l][k];
  });
  // 需要翻译 title 属性的元素（如设置按钮）
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const k = el.getAttribute('data-i18n-title');
    if (HUB_I18N[l] && HUB_I18N[l][k] != null) el.title = HUB_I18N[l][k];
  });
  // 双语内容块（玩法说明、启动错误提示等）：按语言切换显示，仅目标语言加 .active
  document.querySelectorAll('.lang-zh, .lang-en').forEach((el) => {
    el.classList.toggle('active', el.classList.contains('lang-' + l));
  });
  // 设置菜单语言高亮
  const zh = $('langZhBtn'), en = $('langEnBtn');
  if (zh) zh.innerHTML = (l === 'zh' ? '<span class="check">✓</span>' : '') + '🇨🇳 中文';
  if (en) en.innerHTML = (l === 'en' ? '<span class="check">✓</span>' : '') + '🇺🇸 English';
}

// 设置菜单开合
function toggleSettingsMenu() {
  const m = $('settingsMenu');
  if (m) m.classList.toggle('open');
}
// 点击空白处关闭菜单
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.settings-wrap');
  const menu = $('settingsMenu');
  if (wrap && menu && !wrap.contains(e.target)) menu.classList.remove('open');
});

// 中英文切换：写全局 + 持久化 + 广播 + 重渲染
function switchLang(lang) {
  window.HUB_LANG = (lang === 'en') ? 'en' : 'zh';
  try { localStorage.setItem('paxi_hub_lang', window.HUB_LANG); } catch (e) {}
  applyHubLang();
  window.dispatchEvent(new Event('hub-lang-change'));
  // 若三国已打开，由 sanguo.js 自身监听重渲染；否则重渲染当前 tab
  if (!document.getElementById('sgBody')) switchTab(currentTab);
}

// 个性化发币 / 燃烧代币（参照原三国设置外链）
function openPump() { window.open('https://moxiaomo856.github.io/paxi-pump/', '_blank'); }
function openBurn() { window.open('https://moxiaomo856.github.io/paxi-burn/', '_blank'); }

// 玩法及经济说明（设置菜单入口）：纯静态说明，不发起任何链上请求
function openEconomyInfo() {
  const m = $('economyModal');
  if (m) m.classList.add('active');
}
function closeEconomyInfo() {
  const m = $('economyModal');
  if (m) m.classList.remove('active');
}
// 点击浮层空白处关闭
document.addEventListener('click', (e) => {
  const m = $('economyModal');
  if (m && m.classList.contains('active') && e.target === m) m.classList.remove('active');
});

// ============================================================
// 钱包
// ============================================================
async function connectWallet(silent) {
  if (typeof window.paxihub === 'undefined') {
    if (!silent) {
      showToast(hubT('toast_open_in_paxihub'), 'error');
      // DApp 指南要求的深链回退：移动端先尝试唤起 PaxiHub，1s 后跳商店/文档
      if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
        window.location.href = `paxi://hub/explorer?url=${encodeURIComponent(window.location.href)}`;
        setTimeout(() => {
          window.location.href = 'https://paxinet.io/paxi_docs/paxihub#paxihub-application';   // 官方 DApp 指南指定深链回退地址
        }, 1000);
      }
    }
    return false;
  }
  try {
    const sender = await window.paxihub.paxi.getAddress();
    state.wallet = sender;
    state.connected = true;
    await fetchChainId();
    updateHeader();
    await refreshBalances();
    if (!silent) showToast(hubT('toast_connected'), 'success');
    return true;
  } catch (e) {
    if (!silent) showToast(hubT('toast_connect_fail') + e.message, 'error');
    return false;
  }
}

function updateHeader() {
  const addrEl = $('hdrAddr');
  const balEl = $('hdrBal');
  const btn = $('btnConnect');
  if (state.connected && state.wallet) {
    addrEl.textContent = shortAddr(state.wallet.address, 4);
    addrEl.style.display = 'inline-block';
    balEl.style.display = 'inline-block';
    btn.style.display = 'none';
  } else {
    addrEl.style.display = 'none';
    balEl.style.display = 'none';
    btn.style.display = 'inline-flex';
  }
}

async function refreshBalances() {
  if (!state.connected) return;
  try {
    // 链上余额
    const b = await fetchAPI(`/cosmos/bank/v1beta1/balances/${state.wallet.address}`);
    const paxi = (b.balances || []).find((x) => x.denom === NETWORK.denom);
    state.chainBalance = fromRawUnits(paxi ? paxi.amount : '0');
    $('hdrBal').textContent = state.chainBalance + ' P';

    // 合约内余额
    const g = await queryContract({ balance: { address: state.wallet.address, token: null } });
    state.gameBalance = fromRawUnits(g.amount || '0');

    // 合约内 TKCC（查游戏合约带 token 参数，不是查代币合约的钱包余额）
    if (CONTRACTS.tkcc) {
      try {
        const t = await queryContract({
          balance: { address: state.wallet.address, token: CONTRACTS.tkcc },
        });
        state.tkccBalance = fromRawUnits(t.amount || '0');
      } catch (e) {
        state.tkccBalance = '0';
      }
    } else {
      state.tkccBalance = '0';
    }

    // 刷新页面上的显示
    if ($('bChain')) $('bChain').textContent = state.chainBalance;
    if ($('bGame')) $('bGame').textContent = state.gameBalance;
    if ($('bTkcc')) $('bTkcc').textContent = state.tkccBalance;
  } catch (e) {
    console.warn('refreshBalances', e);
  }
}

// ============================================================
// Tab 路由
// ============================================================
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  ctx = null;
  window.scrollTo(0, 0);

  const titles = { home: hubT('title_home'), wallet: hubT('title_wallet'), me: hubT('title_me') };
  $('pageTitle').textContent = titles[tab] || hubT('title_home');

  if (tab === 'home') renderHome();
  else if (tab === 'wallet') renderWallet();
  else renderMe();
}

// ============================================================
// 大厅展示名单与顺序（2026-09-24：放出猜数字两个变体 + 卡牌两个变体，共 7 个）
//   顺序：三国 → 骰宝 → 猜数字·经典 → 猜数字·精英 → 疯狂骰子 → 卡牌·按牌型 → 卡牌·对战
//   未列入的 id 一律不显示：轮盘 roulette / roulette_vip。
//   ⚠️ 注意：只有链上 list_games 已注册 game_id 的才能放出来，
//      否则 openGame 会在 game_engine_config_query / game_limit 处报「未配置」。
//      当前链上已注册 8 个：card_rank, card_vs_dealer, crazydice, dice,
//      guess, guess_elite, roulette, roulette_vip。
//   想增删游戏：改这个数组即可，顺序即大厅卡片顺序。
// ============================================================
const HUB_VISIBLE_GAMES = ['sanguo', 'choujiang', 'dice', 'guess', 'guess_elite', 'crazydice', 'card_rank', 'card_vs_dealer'];

// ============================================================
// 外部跳转类「游戏」：不走链上引擎，点击直接开外链（不依赖合约、不用会话密钥）
//   新增一个外部入口 = 往这里加一条 + 把 id 加进 HUB_VISIBLE_GAMES 即可。
//   字段：meta.id / meta.name{zh,en} / meta.icon / meta.desc{zh,en} / meta.type='link' / href
// ============================================================
const HUB_LINK_GAMES = {
  choujiang: {
    href: 'https://moxiaomo856.github.io/paxi-choujiang/',
    meta: {
      id: 'choujiang',
      type: 'link',
      icon: '🎁',
      name: { zh: '抽奖', en: 'Lucky Draw' },
      desc: { zh: '跳转抽奖 DApp', en: 'Open the lucky-draw DApp' },
    },
  },
};

function hubVisibleGames() {
  const list = Array.isArray(window.GAMES) ? window.GAMES : [];
  return HUB_VISIBLE_GAMES
    .map((id) => HUB_LINK_GAMES[id] || list.find((g) => g && g.meta && g.meta.id === id))
    .filter(Boolean);
}

/** 卡片点击：外部链接 → 新窗口打开；三国 → 打开三国；其余 → 链上游戏 */
function hubOpenEntry(g, gameId) {
  if (!g) return;
  if (g.meta && g.meta.type === 'link' && g.href) {
    window.open(g.href, '_blank', 'noopener');
    return;
  }
  if (g.meta && g.meta.type === 'sanguo') { openSanguo(); return; }
  openGame(gameId);
}

// ============================================================
// 大厅
// ============================================================
async function renderHome() {
  const main = $('main');  // 合约地址还没配 —— 仍然显示卡片（禁用），顶部加 banner 引导
  if (!hasGameContract()) {
    // 外部跳转类（如抽奖）不依赖合约 → 保持可点，其余置灰
    const disabledCards = hubVisibleGames().map((g) => {
      const isLink = g.meta && g.meta.type === 'link' && g.href;
      const nm = typeof g.meta.name === 'object' ? g.meta.name[hubLang()] : g.meta.name;
      const ds = typeof g.meta.desc === 'object' ? g.meta.desc[hubLang()] : g.meta.desc;
      return `
      <div class="game-card${isLink ? '' : ' disabled'}" data-game="${g.meta.id}"${isLink ? '' : ` title="${hubT('not_deployed')}"`}>
        <div class="game-icon">${g.meta.icon || '🎮'}</div>
        <div class="game-name">${nm}</div>
        <div class="game-desc">${ds}${isLink ? ` · ${hubT('tag_external')}` : ` · ${hubT('pending_deploy')}`}</div>
      </div>`;
    }).join('');
    main.innerHTML = `
      <div class="card" style="background:#2a1a0a;border-color:#8a6a2a;margin-bottom:12px">
        <div class="card-title" style="color:#fbbf24">${hubT('banner_title')}</div>
        <div class="desc" style="color:#d4b896">
          ${hubT('banner_desc')}
          <code>index.html?contract=paxi1…</code>
        </div>
        <div class="desc" style="margin-top:6px;color:#d4b896">${hubT('banner_tip')}</div>
        <button class="btn btn-primary" style="margin-top:10px" onclick="switchTab('me')">${hubT('banner_btn')}</button>
      </div>
      <div class="card-title">${hubT('all_games')}</div>
      <div class="game-grid">${disabledCards}</div>
    `;
    // 未配置合约时，只允许外部跳转卡片可点
    document.querySelectorAll('[data-game]').forEach((el) => {
      const id = el.dataset.game;
      const g = HUB_LINK_GAMES[id] || window.GAME_REGISTRY[id];
      if (g && g.meta && g.meta.type === 'link') el.onclick = () => hubOpenEntry(g, id);
    });
    return;
  }


  // 会话状态
  let sess = null;
  try {
    sess = await Session.syncFromChain();
  } catch (e) {}
  const needRegister = !state.sessAddr || !sess || !sess.registered || !sess.pubMatches || sess.expired;

  let sessHtml = '';
  if (!state.connected) {
    sessHtml = `<div class="hint">${hubT('hint_connect')}</div>`;
  } else if (needRegister) {
    sessHtml = `<div class="hint">${hubT('hint_register')}</div>`;
  }

  const cards = hubVisibleGames().map((g) => {
    const isLink = g.meta && g.meta.type === 'link' && g.href;   // 外部跳转：不看链上状态
    const entry = state.games.find((x) => x.game_id === g.meta.id);
    const off = !isLink && entry && entry.enabled === false;
    const isSanguo = g.meta.type === 'sanguo';
    const gname = typeof g.meta.name === 'object' ? g.meta.name[hubLang()] : g.meta.name;
    const gdesc = typeof g.meta.desc === 'object' ? g.meta.desc[hubLang()] : g.meta.desc;
    // 审计 #8：通用游戏用 TKCC 下注，限额单位改为 TKCC
    const tag = isLink ? hubT('tag_external')
      : off ? hubT('disabled')
      : isSanguo ? gdesc
      : (entry ? `${fromRawUnits(entry.min_bet)} ~ ${fromRawUnits(entry.max_bet)} TKCC` : '');
    return `
      <div class="game-card${off ? ' disabled' : ''}" data-game="${g.meta.id}">
        <div class="game-icon">${g.meta.icon}</div>
        <div class="game-name">${gname}</div>
        <div class="game-desc">${gdesc}</div>
        <div class="game-tag">${tag}</div>
      </div>`;
  }).join('');

  main.innerHTML = `
    <div class="balance-bar">
      <div class="bal-item"><div class="bal-val" id="bChain">${state.chainBalance}</div><div class="bal-lab">${hubT('bal_onchain_paxi')}</div></div>
      <div class="bal-item"><div class="bal-val" id="bGame">${state.gameBalance}</div><div class="bal-lab">${hubT('bal_incontract_paxi')}</div></div>
      <div class="bal-item"><div class="bal-val small" id="bTkcc">${state.tkccBalance}</div><div class="bal-lab">${hubT('bal_incontract_tkcc')}</div></div>
    </div>
    ${sessHtml}
    <div class="card">
      <div class="card-title">${hubT('choice_title')}</div>
      <div class="game-grid">${cards}</div>
    </div>`;

  document.querySelectorAll('[data-game]').forEach((el) => {
    const id = el.dataset.game;
    const g = HUB_LINK_GAMES[id] || window.GAME_REGISTRY[id];
    el.onclick = () => hubOpenEntry(g, id);
  });
}

// ============================================================
// 钱包页（充值 / 提款 / 会话）
// ============================================================
function renderWallet() {
  const main = $('main');
  const sess = state.sessInfo;
  const expired = sess && Number(sess.expires_at) < Math.floor(Date.now() / 1000);
  const sessOk = sess && !expired;

  const tokens = state.tokens.length ? state.tokens : [NATIVE_TOKEN];
  const t = findToken(tokens, state.selToken);

  // 🔴 Tab 按钮：PAXI / TKCC 硬绑 + 手动添加的代币
  const paxiTok = tokens.find((x) => x.type === 'native');
  const tkccTok = tokens.find((x) => x.symbol === 'TKCC');
  const otherToks = tokens.filter((x) => x !== paxiTok && x !== tkccTok);

  const tabBtn = (tok, label) => tok
    ? `<button class="btn ${tok.key === t.key ? 'btn-primary' : 'btn-ghost'}" onclick="switchToken('${tok.key}')" style="flex:1;margin-right:6px">${label}</button>`
    : '';
  const otherOpts = otherToks.length ? otherToks.map((x) =>
    `<option value="${x.key}"${x.key === t.key ? ' selected' : ''}>${esc(x.symbol)}</option>`).join('') : '';
  const otherSelect = otherToks.length
    ? `<select class="input" id="tokenSelOther" style="margin-top:6px" onchange="switchToken(this.value)">${otherOpts}</select>`
    : '';

  main.innerHTML = `
    <div class="card">
      <div class="card-title">${hubT('w_bal_title')}</div>
      <div class="field">
        <label class="label">${hubT('sel_token')}</label>
        <div style="display:flex">
          ${tabBtn(paxiTok, 'PAXI')}
          ${tabBtn(tkccTok, 'TKCC')}
        </div>
        ${otherSelect}
      </div>
      <div class="kv"><span class="k">${hubT('wallet_bal')}</span><span class="v" id="wBal">${state.walletBal} ${esc(t.symbol)}</span></div>
      <div class="kv"><span class="k">${hubT('incontract_bal')}</span><span class="v" id="gBal2">${state.gameBal} ${esc(t.symbol)}</span></div>
      ${t.type === 'cw20' ? `<div class="desc" style="margin-top:6px">${hubT('contract_addr_label')} <code>${t.contract}</code></div>` : ''}
      <button class="btn btn-ghost" id="btnAddToken" style="margin-top:10px">${hubT('add_token')}</button>
    </div>

    <div class="card">
      <div class="card-title">${hubT('dep_title')}</div>
      <div class="field">
        <label class="label">${hubT('amt_label')} (${esc(t.symbol)})</label>
        <input type="text" id="depAmt" inputmode="decimal" placeholder="0.0" />
        <div class="quick-row">
          <button class="quick" data-dep="1">1</button>
          <button class="quick" data-dep="5">5</button>
          <button class="quick" data-dep="10">10</button>
          <button class="quick" data-dep="50">50</button>
          <button class="quick" data-dep="max">${hubT('all_btn')}</button>
        </div>
      </div>
      <button class="btn btn-primary" id="btnDeposit">${hubT('dep_btn')}</button>
      <div class="desc" style="margin-top:8px">
        ${t.type === 'cw20' ? hubT('dep_desc_cw20') : hubT('dep_desc_native')}
      </div>
    </div>

    <div class="card">
      <div class="card-title">${hubT('wd_title')}</div>
      <div class="field">
        <label class="label">${hubT('amt_label')} (${esc(t.symbol)})</label>
        <input type="text" id="wdAmt" inputmode="decimal" placeholder="0.0" />
        <div class="quick-row">
          <button class="quick" data-wd="all">${hubT('all_btn')}</button>
        </div>
      </div>
      <button class="btn btn-ghost" id="btnWithdraw">${hubT('wd_btn')}</button>
    </div>

    <div class="card">
      <div class="card-title">${hubT('sess_title')}</div>
      <div class="kv"><span class="k">${hubT('sess_status')}</span><span class="v">${
        !sess ? hubT('sess_unregistered') : expired ? `<span class="warn-txt">${hubT('sess_expired')}</span>` : `<span class="ok-txt">${hubT('sess_ok')}</span>`
      }</span></div>
      <div class="kv"><span class="k">${hubT('sess_addr')}</span><span class="v">${shortAddr(state.sessAddr, 8) || '—'}</span></div>
      <div class="kv"><span class="k">nonce</span><span class="v">${state.sessNonce}</span></div>
      ${sessOk ? `<div class="kv"><span class="k">${hubT('sess_daily_quota')}</span><span class="v">${fromRawUnits(sess.daily_used)} / ${fromRawUnits(sess.daily_limit)}</span></div>` : ''}
      <button class="btn ${sessOk ? 'btn-ghost' : 'btn-primary'}" id="btnSess" style="margin-top:10px">
        ${sessOk ? hubT('sess_renew') : hubT('sess_register')}
      </button>
      <div class="desc" style="margin-top:8px">
        ${hubT('sess_desc')}
      </div>
    </div>

    <div class="card"><div class="card-title">${hubT('log_title')}</div><div class="log" id="log"></div></div>`;

  document.querySelectorAll('[data-dep]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.dep;
      $('depAmt').value = v === 'max' ? state.walletBal : v;
    };
  });
  document.querySelector('[data-wd="all"]').onclick = () => {
    $('wdAmt').value = state.gameBal;
  };
  $('btnAddToken').onclick = showAddToken;
  $('btnDeposit').onclick = doDeposit;
  $('btnWithdraw').onclick = doWithdraw;
  $('btnSess').onclick = doRegisterSession;

  // 拉余额（不阻塞渲染）
  refreshTokenBalances();
}

/** 切换代币：更新选中项，重渲染卡片 */
function switchToken(key) {
  state.selToken = key;
  renderWallet();
}

/** 刷新当前选中代币的两种余额 */
async function refreshTokenBalances() {
  if (!state.connected || !hasGameContract()) return;
  const t = findToken(state.tokens.length ? state.tokens : [NATIVE_TOKEN], state.selToken);
  try {
    const [w, g] = await Promise.all([
      queryWalletBalance(t).catch(() => '0'),
      queryGameBalance(t).catch(() => '0'),
    ]);
    state.walletBal = w;
    state.gameBal = g;
    const wb = $('wBal'), gb = $('gBal2');
    if (wb) wb.textContent = `${w} ${esc(t.symbol)}`;
    if (gb) gb.textContent = `${g} ${esc(t.symbol)}`;
  } catch (e) {
    console.warn('刷新代币余额失败', e.message);
  }
}

/** 添加 PRC-20 代币 */
function showAddToken() {
  const main = $('main');
  const isEn = hubLang() === 'en';
  main.innerHTML = `
    <div class="back-bar" onclick="switchTab('wallet')">${hubT('back_wallet')}</div>
    <div class="card">
      <div class="card-title">${hubT('add_token')}</div>
      <div class="field">
        <label class="label">${hubT('contract_addr_label')}</label>
        <input type="text" class="input" id="inTokenAddr" placeholder="paxi1…" spellcheck="false" autocapitalize="off" autocorrect="off">
      </div>
      <button class="btn btn-primary" onclick="doAddToken()">${isEn ? 'Add' : '添加'}</button>
      <div class="desc" style="margin-top:10px">
        ${isEn
          ? 'Before adding, make sure the token is <b>whitelisted in the game contract</b> (admin calls <code>AddPrc20</code>), otherwise deposits will be rejected. Whitelisted tokens appear automatically; only add ones not listed.'
          : '添加前请确认该代币<b>已加入游戏合约白名单</b>（管理员调 <code>AddPrc20</code>），否则充值会被拒绝。合约白名单里的代币会自动出现，这里只需要添加没自动列出来的。'}
      </div>
      ${extraTokens().length ? `
        <div class="card-title" style="margin-top:16px">${isEn ? 'Manually Added' : '已手动添加'}</div>
        ${extraTokens().map((a) => `
          <div class="kv">
            <span class="k"><code>${shortAddr(a, 8)}</code></span>
            <span class="v"><button class="btn btn-ghost" style="padding:4px 10px;font-size:12px" onclick="doRemoveToken('${a}')">${isEn ? 'Remove' : '移除'}</button></span>
          </div>`).join('')}
      ` : ''}
    </div>`;
}

async function doAddToken() {
  const addr = ($('inTokenAddr')?.value || '').trim();
  try {
    addExtraToken(addr);
    showToast(hubT('toast_added'));
    await loadTokens();
    state.selToken = 'cw20:' + addr;
    switchTab('wallet');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function doRemoveToken(addr) {
  removeExtraToken(addr);
  showToast(hubT('toast_removed'));
  loadTokens().then(() => showAddToken());
}

/** 启动时拉一次代币列表 */
async function loadTokens() {
  try {
    state.tokens = await loadTokenList();
  } catch (e) {
    state.tokens = [NATIVE_TOKEN];
  }
  // 🔴 默认选 TKCC（游戏主用 TKCC），找不到才回退 PAXI
  const tk = state.tokens.find((t) => t.symbol === 'TKCC');
  state.selToken = tk ? tk.key : NATIVE_TOKEN.key;
  return state.tokens;
}

async function doDeposit() {
  const t = findToken(state.tokens.length ? state.tokens : [NATIVE_TOKEN], state.selToken);
  const amt = ($('depAmt')?.value || '').trim();
  if (!amt || Number(amt) <= 0) return showToast(hubT('toast_input_amount_dep'), 'error');

  const raw = toRawUnits(amt, t.decimals);
  if (BigInt(raw) <= 0n) return showToast(hubT('toast_invalid_amount'), 'error');

  // 链上余额够不够
  const walletRaw = toRawUnits(state.walletBal, t.decimals);
  if (BigInt(raw) > BigInt(walletRaw)) {
    return showToast(`${hubT('wallet_insufficient')}（${state.walletBal} ${esc(t.symbol)}）`, 'error');
  }

  showBusy(hubT('dep_btn') + '…');
  try {
    let hash;
    if (t.type === 'native') {
      // 原生 PAXI：附带 funds 一步到位
      hash = await execContract(
        { deposit: { token: null, amount: raw } },
        [{ denom: NETWORK.denom, amount: raw }],
      );
      await waitForTx(hash);
    } else {
      // PRC-20：合约用 transfer_from 主动拉取，必须先有 allowance
      const allowance = await queryPrc20Allowance(t.contract, state.wallet.address, CONTRACTS.game);
      if (BigInt(allowance) < BigInt(raw)) {
        log('授权额度不足，先发授权交易…', 'info');
        const h1 = await approvePrc20(t.contract, raw);
        await waitForTx(h1);
        log('授权完成，开始充值…', 'ok');
      }
      hash = await execContract({ deposit: { token: t.contract, amount: raw } });
      await waitForTx(hash);
    }
    log(`充值成功 ${amt} ${esc(t.symbol)}`, 'ok');
    showToast('充值成功', 'success');
    $('depAmt').value = '';
    await refreshBalances();
    await refreshTokenBalances();
  } catch (e) {
    const msg = e.message || String(e);
    log('充值失败：' + msg, 'err');
    showToast(msg, 'error');
  } finally {
    hideBusy();
  }
}

async function doWithdraw() {
  const t = findToken(state.tokens.length ? state.tokens : [NATIVE_TOKEN], state.selToken);
  const amt = ($('wdAmt')?.value || '').trim();
  if (!amt || Number(amt) <= 0) return showToast(hubT('toast_input_amount_dep'), 'error');

  const raw = toRawUnits(amt, t.decimals);
  if (BigInt(raw) <= 0n) return showToast(hubT('toast_invalid_amount'), 'error');

  const gameRaw = toRawUnits(state.gameBal, t.decimals);
  if (BigInt(raw) > BigInt(gameRaw)) {
    return showToast(`${hubT('game_insufficient')}（${state.gameBal} ${esc(t.symbol)}）`, 'error');
  }

  showBusy(hubT('wd_btn') + '…');
  try {
    const hash = await execContract({
      withdraw: { token: t.type === 'native' ? null : t.contract, amount: raw },
    });
    await waitForTx(hash);
    log(`提款成功 ${amt} ${esc(t.symbol)}`, 'ok');
    showToast('提款成功', 'success');
    $('wdAmt').value = '';
    await refreshBalances();
    await refreshTokenBalances();
  } catch (e) {
    const msg = e.message || String(e);
    log('提款失败：' + msg, 'err');
    showToast(msg, 'error');
  } finally {
    hideBusy();
  }
}

async function doRegisterSession() {
  showBusy(hubT('register_session_busy'));
  try {
    if (!state.connected) throw new Error(hubT('connect_wallet_first'));
    await Session.register();
    showToast(hubT('sess_registered_ok'), 'success');
    log('会话注册成功，nonce=' + state.sessNonce, 'ok');
    renderWallet();
  } catch (e) {
    log('注册失败：' + e.message, 'err');
    showToast(e.message, 'error');
  } finally {
    hideBusy();
  }
}

// ============================================================
// 我的
// ============================================================
function renderMe() {
  const main = $('main');
  const sess = state.sessInfo;
  main.innerHTML = `
    <div class="card">
      <div class="card-title">${hubT('acc_title')}</div>
      <div class="kv"><span class="k">${hubT('acc_wallet_addr')}</span><span class="v">${shortAddr(state.wallet?.address, 8) || '—'}</span></div>
      <div class="kv"><span class="k">${hubT('acc_sess_addr')}</span><span class="v">${shortAddr(state.sessAddr, 8) || '—'}</span></div>
      <div class="kv"><span class="k">${hubT('acc_chain_id')}</span><span class="v">${state.chainId || '—'}</span></div>
      <div class="desc" style="margin-top:6px;opacity:.6">build ${window.HUB_BUILD || '未知（旧版缓存）'}</div>
    </div>

    <div class="card">
      <div class="card-title">🔓 无感模式</div>
      <div class="kv"><span class="k">状态</span><span class="v" id="seamlessStatus">检测中…</span></div>
      <div class="kv"><span class="k">gas 代付授权</span><span class="v" id="seamlessFeegrant">检测中…</span></div>
      <div class="kv"><span class="k">会话余额</span><span class="v" id="seamlessBal">检测中…</span></div>
      <div class="kv"><span class="k">到期时间</span><span class="v" id="seamlessExpiry">—</span></div>
      <button class="btn btn-primary" id="btnSeamless" style="margin-top:10px">开启无感模式（免密）</button>
      <button class="btn btn-ghost" id="btnSelfCheck" style="margin-top:8px">🔍 无感自检（出问题先点这个）</button>
      <div id="selfCheckBox" style="display:none;margin-top:10px"></div>
      <div class="desc" style="margin-top:8px">
        开启后游戏操作（抽卡 / 对战 / 迁移）不再弹钱包，gas 由主钱包代付 7 天；
        若代付授权不可用，会话账户会用自带的 PAXI 余额付费，同样免密。
        充值 / 提现 / 管理员操作不受影响。
      </div>
    </div>

    <div class="card">
      <div class="card-title">${hubT('contract_title')}</div>
      <div class="kv"><span class="k">${hubT('acc_game_contract')}</span><span class="v">${
        CONTRACTS.game ? shortAddr(CONTRACTS.game, 8) : `<span style="color:#c0392b">${hubT('not_configured')}</span>`
      }</span></div>
      <div class="kv"><span class="k">${hubT('contract_tkcc_label')}</span><span class="v" style="color:#6ee7b7">${CONTRACTS.tkcc ? shortAddr(CONTRACTS.tkcc, 8) : '—'}</span></div>

      <div class="field">
        <label class="label">${hubT('contract_game_label')}</label>
        <input type="text" class="input" id="inContract" placeholder="${hubLang() === 'en' ? 'paxi1… (address returned after instantiate)' : 'paxi1…（instantiate 后拿到的地址）'}" value="${CONTRACTS.game || ''}" spellcheck="false" autocapitalize="off" autocorrect="off">
      </div>
      <button class="btn btn-primary" onclick="saveContracts()">${hubT('save_btn')}</button>
      <div class="desc" style="margin-top:8px">
        ${hubT('contract_desc')}
        <code>index.html?contract=paxi1…</code>
      </div>
      <button class="btn btn-ghost" style="margin-top:8px" onclick="clearContracts()">${hubT('clear_contracts_btn')}</button>
    </div>

    <div class="card">
      <div class="card-title">${hubT('limit_title')}</div>
      <div id="limitList"><div class="desc">${hubT('loading')}</div></div>
    </div>

    <div class="card">
      <button class="btn btn-ghost" onclick="hardReset()">${hubT('reset_session')}</button>
      <div class="desc" style="margin-top:8px">
        ${hubT('reset_session_desc')}
      </div>
    </div>`;

  loadLimitList();
  renderSeamlessCard();
}

async function renderSeamlessCard() {
  const btn = $('btnSeamless');
  if (!btn) return;

  // 🟢 第十八轮：状态一律以链上为准（会话注册 + Feegrant 授权 + 会话余额）
  const v = await Session.verifySeamless(true).catch((e) => ({ ok: false, mode: 'none', reason: (e && e.message) || '检查失败' }));
  const info = await Session.syncFromChain().catch(() => null);
  const fg = await Session.getFeegrant(true).catch(() => null);
  const nowSec = Math.floor(Date.now() / 1000);
  const hoursLeft = (info && info.expiresAt) ? Math.max(0, (info.expiresAt - nowSec) / 3600) : 0;
  const sessionOk = !!(info && info.registered && !info.expired && info.pubMatches);

  // 会话状态
  if (!sessionOk) {
    $('seamlessStatus').innerHTML = '<span class="warn-txt">未开启 / 已过期</span>';
    $('seamlessExpiry').textContent = '—';
  } else if (hoursLeft < 2) {
    $('seamlessStatus').innerHTML = '<span class="warn-txt">即将到期</span>';
    $('seamlessExpiry').textContent = `${hoursLeft.toFixed(1)} 小时后`;
  } else {
    $('seamlessStatus').innerHTML = v.ok
      ? '<span class="ok-txt">正常（免密可用）</span>'
      : '<span class="warn-txt">会话有效，但无法付 gas</span>';
    $('seamlessExpiry').textContent = `${hoursLeft.toFixed(1)} 小时后`;
  }

  // gas 代付授权（链上真实查询）
  if (fg && fg.ok) {
    $('seamlessFeegrant').innerHTML = `<span class="ok-txt">有效</span>（额度 ${Session.fmtPaxi(fg.spendLimit)} PAXI，主钱包代付）`;
  } else if (fg && fg.unknown) {
    $('seamlessFeegrant').innerHTML = `<span class="warn-txt">查询失败</span>`;
  } else {
    $('seamlessFeegrant').innerHTML = '<span class="warn-txt">未授权 / 已过期</span>';
  }

  // 会话账户余额（Feegrant 不可用时的兜底付费方）
  let bal = '0';
  try { bal = await Session.getSessionBalance(); } catch (e) {}
  const plan = await computeSeamlessFee().catch(() => null);
  $('seamlessBal').textContent = plan
    ? `${Session.fmtPaxi(bal)} PAXI（每笔约 ${Session.fmtPaxi(plan.amount)}）`
    : `${Session.fmtPaxi(bal)} PAXI`;

  btn.textContent = sessionOk ? '续期 / 重新授权无感模式' : '开启无感模式（免密）';

  btn.onclick = async () => {
    showBusy('授权中…（只需在钱包确认 1 次）');
    try {
      await Session.enableSeamlessMode();
      showToast('无感模式已开启，之后游戏操作不再弹钱包', 'success');
      await renderSeamlessCard();
    } catch (e) {
      showToast((e && e.message) || '开通失败', 'error');
    } finally { hideBusy(); }
  };

  const sc = $('btnSelfCheck');
  if (sc) sc.onclick = async () => {
    const box = $('selfCheckBox');
    box.style.display = 'block';
    box.innerHTML = '<div class="desc">检测中…</div>';
    try {
      const r = await Session.selfCheck();
      const icon = { ok: '✅', warn: '⚠️', fail: '❌' };
      box.innerHTML = `<div class="desc" style="margin-bottom:6px">build ${r.build}</div>`
        + r.items.map((it) => `<div class="kv" style="align-items:flex-start">
             <span class="k" style="flex:0 0 42%">${icon[it.ok]} ${it.name}</span>
             <span class="v" style="word-break:break-all;text-align:right">${it.detail || '—'}</span>
           </div>`).join('');
      console.log('[无感自检]', r);
    } catch (e) {
      box.innerHTML = `<div class="desc" style="color:#c0392b">自检失败：${(e && e.message) || e}</div>`;
    }
  };
}

async function loadLimitList() {
  const box = $('limitList');
  if (!box) return;
  const isEn = hubLang() === 'en';
  try {
    const r = await queryContract({ list_games: {} });
    const rows = (r.games || []).map((g) => `
      <div class="kv">
        <span class="k">${g.game_id} ${g.enabled ? '' : `（${hubT('disabled')}）`}</span>
        <span class="v">${fromRawUnits(g.min_bet)}~${fromRawUnits(g.max_bet)} TKCC · ${
          isEn
            ? `${fromRawUnits(g.max_daily_bet)}/day · ${g.max_daily_rounds} rounds`
            : `日${fromRawUnits(g.max_daily_bet)}·${g.max_daily_rounds}局`
        }</span>
      </div>`).join('');
    box.innerHTML = rows || `<div class="desc">${hubT('no_games_configured')}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="desc">${hubT('load_fail')}${e.message}</div>`;
  }
}

function saveContracts() {
  try {
    const game = ($('inContract')?.value || '').trim();
    setContract('contract', game);      // 留空 = 删除该项
    showToast(CONTRACTS.game ? '已保存，正在刷新' : '已清除地址');
    setTimeout(() => window.location.reload(), 600);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function clearContracts() {
  try {
    localStorage.removeItem('paxi_hub_contract_contract');
  } catch (e) {}
  showToast('已清除，回到代码默认值');
  setTimeout(() => window.location.reload(), 600);
}

function hardReset() {
  Object.values(LS).forEach((k) => localStorage.removeItem(k));
  // 🟢 第十八轮：连 gas 代付标记一起清掉，否则重开后仍会误判无感已开通
  try { localStorage.removeItem('paxi_hub_feegrant_expires'); } catch (e) {}
  if (window.Session) {
    // 清掉所有内存缓存（链上查询缓存、失败标记、待重授权标记）+ 内存私钥
    window.Session._fgCache = { at: 0, granter: '', data: null };
    window.Session._seamlessFailedOnce = false;
    window.Session._forceRegrant = false;
    window.Session._lastSeamlessError = null;
    if (typeof window.Session.lock === 'function') window.Session.lock();
  }
  showToast('已清除，请重新注册会话');
  setTimeout(() => window.location.reload(), 800);
}

// ============================================================
// 游戏页
// ============================================================
async function openGame(gameId) {
  const g = window.GAME_REGISTRY[gameId];
  if (!g) return;

  if (!hasGameContract()) {
    showToast(hubT('toast_set_contract_first'), 'error');
    switchTab('me');
    return;
  }

  if (!state.connected) {
    const ok = await connectWallet(false);
    if (!ok) return;
  }

  showBusy(hubT('load_game_busy'));
  try {
    await connectWallet(true);

    // 1. 会话
    const r = await Session.ensure();
    if (!r.ok) {
      hideBusy();
      $('main').innerHTML = `
        <div class="back-bar" onclick="switchTab('home')">${hubT('back_home')}</div>
        <div class="hint">${r.reason}</div>
        <div class="card">
          <div class="desc">${hubT('register_first_hint')}</div>
          <button class="btn btn-primary" style="margin-top:12px" onclick="quickRegister()">${hubT('sess_register')}</button>
        </div>`;
      return;
    }

    // 2. 引擎配置 + 限额
    const cfg = await queryContract({ game_engine_config_query: { game_id: gameId } });
    const lim = await queryContract({ game_limit: { game_id: gameId } });
    if (!cfg.config) throw new Error(hubT('game_not_configured')(gameId));
    if (!lim.limit) throw new Error(hubT('limit_not_configured')(gameId));
    if (!lim.limit.enabled) throw new Error(hubT('game_disabled')(gameId));

    const engineKey = Object.keys(cfg.config.params || {})[0];
    if (engineKey !== g.meta.engine) {
      throw new Error(hubT('engine_mismatch')(g.meta.engine, engineKey));
    }

    ctx = {
      id: gameId,
      game: g,
      params: cfg.config.params[engineKey],
      limit: lim.limit,
    };

    // 3. 渲染
    const body = g.body(ctx);
    const gname = typeof g.meta.name === 'object' ? g.meta.name[hubLang()] : g.meta.name;
    $('pageTitle').textContent = gname;
    $('main').innerHTML = `
      <div class="back-bar" onclick="switchTab('home')">${hubT('back_home')}</div>

      <div class="balance-bar">
        <div class="bal-item"><div class="bal-val" id="gBal">${state.gameBalance}</div><div class="bal-lab">${hubT('bal_incontract_paxi')}</div></div>
        <div class="bal-item"><div class="bal-val small">${fromRawUnits(lim.limit.min_bet)}~${fromRawUnits(lim.limit.max_bet)}</div><div class="bal-lab">${hubT('limit_single')}</div></div>
        <div class="bal-item"><div class="bal-val small">${fromRawUnits(lim.limit.max_daily_bet)} / ${lim.limit.max_daily_rounds}${hubLang() === 'en' ? ' rounds' : '局'}</div><div class="bal-lab">${hubT('limit_daily')}</div></div>
      </div>

      <div class="card" id="gameClaimCard" style="display:none">
        <div class="card-title">${hubT('claim_title')}</div>
        <div class="kv"><span class="k">${hubT('incontract_bal')}</span><span class="v" id="gcBal">${hubT('claim_loading')}</span></div>
        <div class="desc" style="margin-top:6px">${hubT('claim_desc')}</div>
        <button class="btn btn-gold" id="btnGameClaim" style="margin-top:8px;width:100%">${hubT('claim_btn')}</button>
      </div>

      <div class="card">
        <div class="card-title">${hubT('result_title')}</div>
        <div class="result-stage" id="stage"><span class="placeholder-txt">${hubT('result_placeholder')}</span></div>
      </div>

      ${body}

      <div class="card">
        <div class="card-title">${hubT('bet_title')}</div>
        <div class="field">
          <input type="text" id="betAmt" inputmode="decimal" value="${fromRawUnits(lim.limit.min_bet)}" />
          <div class="quick-row">
            <button class="quick" data-bet="${fromRawUnits(lim.limit.min_bet)}">${hubT('bet_min')}</button>
            <button class="quick" data-bet="${fromRawUnits(lim.limit.max_bet)}">${hubT('bet_max')}</button>
            <button class="quick" data-bet="x2">${hubT('bet_x2')}</button>
            <button class="quick" data-bet="half">${hubT('bet_half')}</button>
          </div>
        </div>
        <button class="btn btn-gold" id="btnPlay">${hubT('btn_play')}</button>
      </div>

      <div class="card"><div class="card-title">${hubT('log_title')}</div><div class="log" id="log"></div></div>`;

    g.bind(ctx);
    document.querySelectorAll('[data-bet]').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.bet;
        const cur = Number($('betAmt').value) || 0;
        if (v === 'x2') $('betAmt').value = String(cur * 2);
        else if (v === 'half') $('betAmt').value = String(cur / 2);
        else $('betAmt').value = v;
      };
    });
    $('btnPlay').onclick = doPlay;
    const gcBtn = $('btnGameClaim');
    if (gcBtn) gcBtn.onclick = claimGameReward;
    refreshGameClaim();   // 异步拉合约内余额，有余额才显示「领取奖励」卡片
    log(hubT('ready_log')(gname, engineKey), 'ok');
  } catch (e) {
    log(hubT('load_fail_log') + e.message, 'err');
    $('main').innerHTML = `
      <div class="back-bar" onclick="switchTab('home')">${hubT('back_home')}</div>
      <div class="hint err">${esc(e.message)}</div>`;
  } finally {
    hideBusy();
  }
}

async function quickRegister() {
  showBusy(hubT('register_session_busy'));
  try {
    await Session.register();
    showToast(hubT('sess_register_ok2'), 'success');
    openGame(ctx ? ctx.id : (hubVisibleGames()[0] || window.GAMES[0]).meta.id); // 默认进第一个可见游戏（三国）
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    hideBusy();
  }
}

async function doPlay() {
  if (!ctx) return;
  const btn = $('btnPlay');
  let amt;
  try {
    amt = $('betAmt').value.trim();
    if (!amt || Number(amt) <= 0) throw new Error(hubT('toast_input_amount'));
    // 审计 #11：UI 全部按 TKCC 展示，未配置 TKCC 合约时直接拒绝，不再静默回退 PAXI
    if (!CONTRACTS.tkcc) throw new Error(hubT('tkcc_missing'));
    const input = ctx.getInput();
    const betU = toRawUnits(amt);

    if (BigInt(betU) < BigInt(ctx.limit.min_bet)) {
      throw new Error(hubT('below_min_bet')(fromRawUnits(ctx.limit.min_bet)));
    }
    if (BigInt(betU) > BigInt(ctx.limit.max_bet)) {
      throw new Error(hubT('above_max_bet')(fromRawUnits(ctx.limit.max_bet)));
    }

    btn.disabled = true;
    btn.textContent = hubT('btn_submitting');
    $('stage').innerHTML = '<div class="spinner"></div>';

    const roundId = `${ctx.id}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

    // nonce 永远取链上最新，避免本地漂移导致会话卡死
    await Session.syncFromChain();

    const msg = Session.buildMessage({
      gameId: ctx.id,
      action: 'play',
      roundId,
      amountPayout: betU,
      nonce: state.sessNonce,
    });
    const sig = await Session.sign(msg);
    // 🟢 与 sanguoExec 对齐：空签名守卫（noble 2.1.0 返回 Signature 对象，必须 toCompactRawBytes，
    //   否则签名为空 → 带 signature:\"\" 的必败交易被推给钱包）。拦截就地报错，绝不静默发坏交易。
    if (!sig || !/^[0-9a-f]{128}$/.test(sig)) {
      throw new Error('会话签名异常（签名为空）——通常是浏览器缓存了旧版脚本，请强制刷新页面（或清除缓存）后重试');
    }
    log(hubT('bet_log')(amt, state.sessNonce), 'info');

    const hash = await execContract({
      play: {
        game_id: ctx.id,
        round_id: roundId,
        token: CONTRACTS.tkcc,
        bet: betU,
        guess_input: null,
        roulette_input: null,
        dice_input: null,
        card_input: null,
        score_input: null,
        session_addr: state.sessAddr,
        nonce: state.sessNonce,
        signature: sig,
        ...input,
      },
    });

    const tx = await waitForTx(hash);
    Session.bumpNonce();   // 只有确认上链后才自增
    log(`${hubT('chain_ok_log')} ${tx.height}`, 'ok');

    const ev = parseTxEvents(tx, ['won', 'payout', 'profit_paid', 'result', 'engine_result', 'bet']);
    const first = (k) => (ev[k] && ev[k].length ? ev[k][ev[k].length - 1] : undefined);
    const out = {
      won: first('won') === 'true',
      payout: first('payout'),
      engineResult: first('engine_result'),
      raw: ev,
    };

    const html = ctx.game.result ? ctx.game.result(ctx, out) : '';
    $('stage').innerHTML = html || `<div class="big-result">${out.won ? hubT('you_win') : hubT('you_lose')}</div>`;

    log(
      out.won
        ? hubT('won_log')(fromRawUnits(out.payout || '0'))
        : hubT('lose_log')(amt),
      out.won ? 'ok' : 'err',
    );
    if (out.engineResult) log(`${hubLang() === 'en' ? 'Result' : '结果'}: ${out.engineResult}`, 'info');

    await refreshBalances();
    const gb = $('gBal');
    if (gb) gb.textContent = state.gameBalance;
  } catch (e) {
    log(hubT('fail_log') + e.message, 'err');
    showToast(e.message, 'error');
    $('stage').innerHTML = `<span class="placeholder-txt">${hubT('result_placeholder')}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = hubT('btn_play');
    refreshGameClaim();   // 赢局派彩即时进合约内部余额，刷新可领取额
  }
}

// ============================================================
// 游戏页「领取奖励」（大厅通用游戏：猜数字 / 骰宝 / 疯狂骰子）
// ------------------------------------------------------------
// 合约行为：这些游戏没有 pending/claim 机制，赢局的 payout 会**即时**加进合约内部
// BALANCES（从 HOUSE_BANKROLL 扣 profit），所以要拿回钱包必须发 Withdraw。
// 这里补一个「领取奖励」卡片 = 一键 Withdraw 全部合约内余额，避免玩家赢完找不到入口。
// ============================================================

/** 下注用的代币 = 配置的 TKCC；没配 TKCC 时退回钱包页当前选中代币 */
function gameClaimToken() {
  const list = state.tokens && state.tokens.length ? state.tokens : [NATIVE_TOKEN];
  if (CONTRACTS.tkcc) {
    const t = list.find((x) => x.type === 'cw20' && x.contract === CONTRACTS.tkcc);
    if (t) return t;
    return { key: 'cw20:' + CONTRACTS.tkcc, type: 'cw20', contract: CONTRACTS.tkcc, symbol: 'TKCC', decimals: 6, name: 'TKCC' };
  }
  return findToken(list, state.selToken);
}

/** 拉取合约内余额并刷新「领取奖励」卡片（无余额则整卡隐藏） */
async function refreshGameClaim() {
  const card = $('gameClaimCard');
  if (!card || !state.connected || !hasGameContract()) return;
  const t = gameClaimToken();
  const balEl = $('gcBal');
  const btn = $('btnGameClaim');
  if (balEl) balEl.textContent = hubT('claim_loading');
  try {
    const bal = await queryGameBalance(t);
    gameClaimBal = bal;
    if (balEl) balEl.textContent = `${bal} ${esc(t.symbol)}`;
    const zero = !bal || Number(bal) <= 0;
    if (btn) {
      btn.disabled = zero;
      btn.textContent = zero ? hubT('claim_empty') : hubT('claim_btn');
    }
    card.style.display = '';   // 常驻显示：余额为 0 时按钮置灰提示，避免玩家找不到入口
  } catch (e) {
    console.warn('查询合约内余额失败', e && e.message);
    if (balEl) balEl.textContent = '—';
    card.style.display = '';
  }
}

/** 一键把合约内余额全部提现回钱包（等价于「领取奖励」） */
async function claimGameReward() {
  if (!state.connected) return showToast(hubT('connect_wallet_first'), 'error');
  const t = gameClaimToken();
  const btn = $('btnGameClaim');
  let amt = gameClaimBal;
  try {
    amt = await queryGameBalance(t);   // 以链上最新为准，别用缓存值
  } catch (e) {
    return showToast(hubT('claim_loading') + '：' + (e.message || e), 'error');
  }
  gameClaimBal = amt;
  if (!amt || Number(amt) <= 0) return showToast(hubT('claim_empty'), 'error');

  const raw = toRawUnits(amt, t.decimals);
  if (BigInt(raw) <= 0n) return showToast(hubT('claim_empty'), 'error');

  if (btn) { btn.disabled = true; btn.textContent = hubT('processing'); }
  showBusy(hubT('claim_btn') + '…');
  try {
    const hash = await execContract({
      withdraw: { token: t.type === 'native' ? null : t.contract, amount: raw },
    });
    await waitForTx(hash);
    log(`${hubT('claim_ok')} ${amt} ${esc(t.symbol)}`, 'ok');
    showToast(hubT('claim_ok'), 'success');
    await refreshBalances();
  } catch (e) {
    const msg = e.message || String(e);
    log('领取失败：' + msg, 'err');
    showToast(msg, 'error');
  } finally {
    hideBusy();
    await refreshGameClaim();
    if (btn) btn.disabled = false;
  }
}

// ============================================================
// 启动
// ============================================================
async function boot() {
  // 恢复上次选择的语言
  try {
    const s = localStorage.getItem('paxi_hub_lang');
    if (s === 'en' || s === 'zh') window.HUB_LANG = s;
  } catch (e) {}
  applyHubLang();

  updateHeader();
  renderHome();

  // 自动连接（PaxiHub 内置浏览器里静默完成，不弹窗）
  await connectWallet(true);

  // 恢复本地会话密钥
  try {
    await Session.load();
  } catch (e) {}

  if (!hasGameContract()) {
    if (currentTab === 'home') renderHome();   // 内部会显示配置引导
    return;
  }

  // 拉代币列表（原生 PAXI + 合约白名单 PRC-20 + 手动添加的）
  try {
    await loadTokens();
  } catch (e) {
    console.warn('代币列表加载失败', e);
  }

  // 拉游戏列表（大厅卡片显示限额）
  try {
    const r = await queryContract({ list_games: {} });
    state.games = r.games || [];
  } catch (e) {
    console.warn('list_games 失败', e);
  }

  // 会话状态
  try {
    await Session.syncFromChain();
  } catch (e) {}

  if (currentTab === 'home') renderHome();

  // 🟢 会话到期前提示（剩余 < 2 小时提醒续期）
  (function checkSeamlessExpiry() {
    try {
      const info = state.sessInfo;
      if (!info || !info.expires_at) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const hoursLeft = (Number(info.expires_at) - nowSec) / 3600;
      if (hoursLeft > 0 && hoursLeft < 2) {
        showToast('无感会话将在 2 小时内到期，请到「我的」续期', 'error');
      }
    } catch (e) {}
  })();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
