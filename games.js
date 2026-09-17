/**
 * 4 个游戏 —— 注册到 window.GAME_REGISTRY
 *
 * 每个游戏只需提供：
 *   meta    { id, name, icon, desc, engine }
 *   body(ctx)         下注区 HTML
 *   bind(ctx)         绑定事件，并设置 ctx.getInput() 返回引擎输入
 *   result(ctx, out)  结果渲染 HTML（可选）
 *
 * 通用流程（读配置 / 校验引擎 / 签名 / 广播 / 解析事件 / 刷新余额）全在 app.js 的 openGame
 */

// ============================================================
// 骰子赔率：DP 枚举点数和分布，与合约 play_dice 逐条对齐
// ============================================================
// 必须与合约 src/games/engines.rs::DICE_SPECIFIC_EDGE_BPS 保持一致，否则前端
// 算出的 RTP / 派彩与链上实际结算不符（玩家看到的赔率是错的）。
const DICE_EDGE_BPS = 1570n;

function diceSumDist(n, sides) {
  let cur = new Array(n * sides + 1).fill(0n);
  cur[0] = 1n;
  for (let i = 0; i < n; i++) {
    const next = new Array(n * sides + 1).fill(0n);
    for (let s = 0; s <= i * sides; s++) {
      if (cur[s] === 0n) continue;
      for (let v = 1; v <= sides; v++) next[s + v] += cur[s];
    }
    cur = next;
  }
  return cur;
}

/** 计算某 bet_type 的胜率与平局率（与合约 engines 逐条对齐） */
function diceWinPush(n, sides, type) {
  const counts = diceSumDist(n, sides);
  const total = BigInt(sides) ** BigInt(n); // 🟢 保持 BigInt：sides^n 可达 1e20，远超 2^53，转 Number 会丢精度
  const minSum = n, maxSum = n * sides, rangeSum = minSum + maxSum;
  const mid = Math.floor(rangeSum / 2);
  const hasTie = rangeSum % 2 === 0;
  const hasTriple = n >= 3;
  const tripleHit = (cmp) => {
    let c = 0;
    for (let d = 1; d <= sides; d++) if (cmp(n * d)) c++;
    return c;
  };

  let win = 0n, push = 0n;
  if (type === 'big' || type === 'small') {
    const isBig = type === 'big';
    const winCmp = isBig ? (s) => s > mid : (s) => (hasTie ? s < mid : s <= mid);
    for (let s = minSum; s <= maxSum; s++) if (winCmp(s)) win += counts[s];
    if (hasTriple) win -= BigInt(tripleHit(winCmp));
    if (hasTie) {
      push += counts[mid];
      if (hasTriple) push -= BigInt(tripleHit((t) => t === mid));
    }
  } else {
    const wantOdd = type === 'odd';
    for (let s = minSum; s <= maxSum; s++) if ((s % 2 === 1) === wantOdd) win += counts[s];
  }
  // 🟢 total 可能达 1e20（远超 2^53），必须用 BigInt 除法精确算比例后再转 Number（仅用于展示）
  const ratio = (num) => Number(num * 1000000000000n / total) / 1e12;
  return { winRate: ratio(win), pushRate: ratio(push) };
}

/** 按合约规则算 big/small/odd/even 的 RTP（含本金）；合约固定 profit_mult=74 → 派彩 1.74x */
function diceRtp(n, sides, type) {
  const { winRate, pushRate } = diceWinPush(n, sides, type);
  return winRate * 1.74 + pushRate;
}

/** 与合约 dice_specific_profit_mult 完全一致（百分制利润倍数） */
function diceSpecificMult(sides, n) {
  if (sides < 2 || n < 1) return 0;
  const s = BigInt(sides);
  const b = (s - 1n) ** BigInt(n);
  const hit = s ** BigInt(n) - b;
  if (hit <= 0n) return 0;
  return Number((b * 100n * (10000n - DICE_EDGE_BPS)) / (hit * 10000n));
}

// ============================================================
// 卡牌：牌型判定复刻 + 蒙特卡洛概率
// ============================================================
const HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺', '皇家同花顺'];
const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_RED = [false, true, true, false];
const RANK_STR = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function handRank(cards) {
  const n = cards.length;
  if (n === 0) return 0;
  const rankCount = new Array(15).fill(0);
  const suitCount = new Array(4).fill(0);
  const ranks = [];
  for (const c of cards) { rankCount[c.rank]++; suitCount[c.suit]++; ranks.push(c.rank); }
  const uniq = [...new Set(ranks)].sort((a, b) => a - b);

  const isFlush = n >= 5 && suitCount.some((c) => c === n);
  let isStraight = false;
  if (n >= 5 && uniq.length === n) {
    if (uniq.length === 5 && String(uniq) === String([2, 3, 4, 5, 14])) isStraight = true;
    else isStraight = uniq.every((v, i) => i === 0 || v === uniq[i - 1] + 1);
  }
  const isRoyal = isStraight && isFlush && String(uniq) === String([10, 11, 12, 13, 14]);

  const pairs = rankCount.filter((c) => c === 2).length;
  const trips = rankCount.filter((c) => c === 3).length;
  const quads = rankCount.filter((c) => c === 4).length;

  if (isRoyal) return 9;
  if (isFlush && isStraight) return 8;
  if (quads > 0) return 7;
  if (trips > 0 && pairs > 0) return 6;
  if (isFlush) return 5;
  if (isStraight) return 4;
  if (trips > 0) return 3;
  if (pairs >= 2) return 2;
  if (pairs === 1) return 1;
  return 0;
}

function drawHand(deckCount, n) {
  const total = deckCount * 52;
  const used = new Set();
  const hand = [];
  while (hand.length < n) {
    const idx = Math.floor(Math.random() * total);
    if (used.has(idx)) continue;
    used.add(idx);
    hand.push({ rank: (idx % 13) + 2, suit: Math.floor(idx / 13) % 4 });
  }
  return hand;
}

function estimateHandProb(deckCount, n, iterations = 30000) {
  const counts = new Array(10).fill(0);
  for (let i = 0; i < iterations; i++) counts[handRank(drawHand(deckCount, n))]++;
  return counts.map((c) => c / iterations);
}

// ============================================================
// 通用小工具
// ============================================================
const BET_LABEL = { big: '大', small: '小', odd: '单', even: '双', specific: '指定点数' };

function oddsTable(head, rows) {
  return `<div class="odds-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td class="${c.num ? 'num' : ''}">${c.v !== undefined ? c.v : c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ============================================================
// 游戏 1：猜数字
// ============================================================
const GuessGame = {
  meta: { id: 'guess', name: { zh: '猜数字', en: 'Guess Number' }, icon: '🎯', desc: { zh: '猜中数字赢倍率', en: 'Guess the number to win' }, engine: 'guess' },

  body(ctx) {
    const p = ctx.params;
    const n = Number(p.max) - Number(p.min) + 1;
    const mult = Number(p.multiplier) / 100;
    ctx._picked = null;
    return `
      <div class="card">
        <div class="card-title">🎯 选择数字</div>
        <div class="desc" style="margin-bottom:8px">
          范围 ${p.min} ~ ${p.max}（共 ${n} 个）　派彩 ${(1 + mult).toFixed(2)}x
          <br>理论 RTP ${((100 * (1 + mult)) / n).toFixed(1)}%
        </div>
        <div class="opt-grid" id="guessPad"></div>
      </div>`;
  },

  bind(ctx) {
    const p = ctx.params;
    const pad = document.getElementById('guessPad');
    const min = Number(p.min), max = Number(p.max);
    const n = max - min + 1;
    if (n > 60) {
      // 范围过大：改用数字输入框，避免渲染上千个按钮
      pad.innerHTML =
        `<input type="number" id="guessInput" class="guess-input" min="${min}" max="${max}" value="${min}" />`;
      ctx.getInput = () => {
        const v = Number(document.getElementById('guessInput').value);
        if (!(v >= min && v <= max)) throw new Error(`请输入 ${min} ~ ${max} 之间的数字`);
        ctx._picked = v;
        return { guess_input: { guess: v } };
      };
    } else {
      for (let i = min; i <= max; i++) {
        const b = document.createElement('button');
        b.className = 'opt';
        b.textContent = i;
        b.onclick = () => {
          ctx._picked = i;
          pad.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
        };
        pad.appendChild(b);
      }
      ctx.getInput = () => {
        if (ctx._picked === null) throw new Error('请先选择数字');
        return { guess_input: { guess: ctx._picked } };
      };
    }
  },

  // 合约返回：answer=3, guess=5
  result(ctx, out) {
    const m = /answer=(\d+)/.exec(out.engineResult || '');
    if (!m) return '';
    const ans = m[1];
    const hit = Number(ans) === Number(ctx._picked);
    return `<div class="big-result">${ans}</div>
      <div class="desc" style="width:100%;color:${hit ? 'var(--accent)' : 'var(--muted)'}">
        ${hit ? '🎯 猜中了！' : `你猜 ${ctx._picked}，未中`}
      </div>`;
  },
};

// ============================================================
// 游戏 2：幸运轮盘
// ============================================================
const RouletteGame = {
  meta: { id: 'roulette', name: { zh: '幸运轮盘', en: 'Lucky Roulette' }, icon: '🎡', desc: { zh: '押中槽位按倍率派彩', en: 'Bet a slot for payout' }, engine: 'roulette' },

  body(ctx) {
    const p = ctx.params;
    if (!p.payouts || p.payouts.length !== Number(p.slots)) {
      throw new Error('引擎参数非法：payouts 长度与 slots 不一致');
    }
    ctx._slot = null;
    const btns = [];
    for (let i = 0; i < Number(p.slots); i++) {
      const m = Number(p.payouts[i] ?? 0);
      btns.push(
        `<button class="opt${m === 0 ? ' dim' : ''}" data-slot="${i}">#${i}<small>${(m / 100).toFixed(2)}x</small></button>`,
      );
    }
    return `
      <div class="card">
        <div class="card-title">🎡 选择槽位</div>
        <div class="desc" style="margin-bottom:8px">共 ${p.slots} 个槽位，标注 0.00x 的为空槽（押中不赔）</div>
        <div class="opt-grid">${btns.join('')}</div>
        <div id="slotPicked" class="desc" style="margin-top:8px;color:var(--accent)"></div>
      </div>`;
  },

  bind(ctx) {
    const p = ctx.params;
    document.querySelectorAll('[data-slot]').forEach((b) => {
      b.onclick = () => {
        ctx._slot = Number(b.dataset.slot);
        document.querySelectorAll('[data-slot]').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        const m = Number(p.payouts[ctx._slot] ?? 0);
        document.getElementById('slotPicked').textContent =
          m === 0 ? `已选 #${ctx._slot}（空槽，押中不赔）` : `已选 #${ctx._slot} → 派彩 ${(1 + m / 100).toFixed(2)}x`;
      };
    });
    ctx.getInput = () => {
      if (ctx._slot === null) throw new Error('请先选择槽位');
      return { roulette_input: { bet_slot: ctx._slot } };
    };
  },

  // 合约返回：winning_slot=2, bet_slot=0
  result(ctx, out) {
    const m = /winning_slot=(\d+)/.exec(out.engineResult || '');
    if (!m) return '';
    const win = Number(m[1]);
    const hit = win === Number(ctx._slot);
    const mult = Number(ctx.params.payouts[win] ?? 0) / 100;
    return `<div class="big-result">#${win}</div>
      <div class="desc" style="width:100%;color:${hit ? 'var(--accent)' : 'var(--muted)'}">
        ${hit ? `🎡 押中！派彩 ${(1 + mult).toFixed(2)}x` : `你押 #${ctx._slot}，未中`}
      </div>`;
  },
};

// ============================================================
// 游戏 3：骰宝
// ============================================================
const DiceGame = {
  meta: { id: 'dice', name: { zh: '骰宝', en: 'Sic Bo' }, icon: '🎲', desc: { zh: '大小单双 / 猜点数', en: 'Big/Small/Odd/Even · Exact' }, engine: 'dice' },

  body(ctx) {
    const p = ctx.params;
    if (!p.bet_types || !p.bet_types.length) throw new Error('引擎参数非法：bet_types 为空');
    const n = Number(p.dice_count), sides = Number(p.sides);
    if (n < 1 || n > 10 || sides < 2 || sides > 100) throw new Error('引擎参数越界');

    ctx._dice = { n, sides, types: p.bet_types.map(String) };
    ctx._betType = null;
    ctx._value = null;

    // 赔率表
    const rows = ctx._dice.types.map((t) => {
      if (t === 'specific') {
        const m = diceSpecificMult(sides, n);
        const hit = 1 - Math.pow((sides - 1) / sides, n);
        const payout = 1 + m / 100;
        const rtp = hit * payout;
        return [
          BET_LABEL[t] || t,
          { v: `${payout.toFixed(2)}x`, num: 1 },
          { v: `${(hit * 100).toFixed(2)}%`, num: 1 },
          { v: `<span class="${rtp >= 1 ? 'warn-txt' : ''}">${(rtp * 100).toFixed(1)}%</span>`, num: 1 },
        ];
      }
      // big/small/odd/even → profit_mult=74，含本金派彩 1.74x（合约 engines.rs 固定值）
      const profMult = 74;
      const payoutX = 1 + profMult / 100;           // 1.74
      const { winRate, pushRate } = diceWinPush(n, sides, t);
      const rtpReal = winRate * payoutX + pushRate; // 含本金 RTP（平局退回本金）
      return [
        BET_LABEL[t] || t,
        { v: payoutX.toFixed(2) + 'x', num: 1 },
        { v: (winRate * 100).toFixed(2) + '%', num: 1 },
        { v: '<span class="' + (rtpReal >= 0.999 ? 'warn-txt' : '') + '">' + (rtpReal * 100).toFixed(1) + '%</span>', num: 1 },
      ];
    });

    const hasWarn = ctx._dice.types.some((t) =>
      t === 'specific'
        ? diceSpecificMult(sides, n) / 100 + 1 >= 1 / (1 - Math.pow((sides - 1) / sides, n))
        : diceRtp(n, sides, t) >= 0.999,
    );

    const typeBtns = ctx._dice.types
      .map((t) => `<button class="opt" data-bt="${t}">${BET_LABEL[t] || t}<small>${
        t === 'specific' ? '任选一颗' : '1.74x'
      }</small></button>`)
      .join('');

    let valBtns = '';
    for (let v = 1; v <= sides; v++) valBtns += `<button class="opt" data-val="${v}">${v}</button>`;

    return `
      <div class="card">
        <div class="card-title">🎲 选择玩法</div>
        <div class="desc" style="margin-bottom:8px">${n} 颗骰子 × ${sides} 面</div>
        <div class="opt-grid" id="diceTypes">${typeBtns}</div>
        <div id="diceVals" style="display:none;margin-top:10px">
          <div class="label">指定点数（任选一颗命中即中）</div>
          <div class="opt-grid">${valBtns}</div>
        </div>
        <div id="dicePicked" class="desc" style="margin-top:8px;color:var(--accent)"></div>
      </div>
      <div class="card">
        <div class="card-title">📊 赔率</div>
        ${oddsTable(['玩法', '派彩', '命中', 'RTP'], rows)}
        <div class="desc" style="margin-top:8px">
          ${n >= 3 ? `· 骰子数 ${n} ≥ 3，豹子（全同）通杀，大小单押全输<br>` : ''}
          ${hasWarn ? '<span class="warn-txt">· ⚠️ 标黄玩法 RTP ≥ 100%，庄家无收益</span>' : ''}
        </div>
      </div>`;
  },

  bind(ctx) {
    const { sides } = ctx._dice;
    document.querySelectorAll('[data-bt]').forEach((b) => {
      b.onclick = () => {
        ctx._betType = b.dataset.bt;
        ctx._value = null;
        document.querySelectorAll('[data-bt]').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        document.getElementById('diceVals').style.display = ctx._betType === 'specific' ? 'block' : 'none';
        document.querySelectorAll('[data-val]').forEach((x) => x.classList.remove('sel'));
        document.getElementById('dicePicked').textContent =
          ctx._betType === 'specific' ? '请再选一个点数' : '已选：' + (BET_LABEL[ctx._betType] || ctx._betType);
      };
    });
    document.querySelectorAll('[data-val]').forEach((b) => {
      b.onclick = () => {
        ctx._value = Number(b.dataset.val);
        document.querySelectorAll('[data-val]').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        const m = diceSpecificMult(sides, ctx._dice.n);
        document.getElementById('dicePicked').textContent =
          `指定 ${ctx._value} → 派彩 ${(1 + m / 100).toFixed(2)}x`;
      };
    });
    ctx.getInput = () => {
      if (!ctx._betType) throw new Error('请先选择玩法');
      if (ctx._betType === 'specific' && ctx._value === null) throw new Error('请选择指定的点数');
      return {
        dice_input: {
          bet_type: ctx._betType,
          specific_value: ctx._betType === 'specific' ? ctx._value : null,
        },
      };
    };
  },

  result(ctx, out) {
    const m = /dice=\[([^\]]*)\],\s*total=(\d+),\s*mid=(\d+)/.exec(out.engineResult || '');
    if (!m) return '';
    const dice = m[1].split(',').map((x) => x.trim()).filter(Boolean);
    return (
      dice.map((d) => `<div class="dice-face">${d}</div>`).join('') +
      `<div class="desc" style="width:100%">点数和 ${m[2]}（分界 ${m[3]}）</div>`
    );
  },
};

// ============================================================
// 游戏 4：卡牌对决
// ============================================================
const CardGame = {
  meta: { id: 'card', name: { zh: '卡牌对决', en: 'Card Duel' }, icon: '🃏', desc: { zh: '按牌型派彩 / 对战庄家', en: 'Pay by hand · vs dealer' }, engine: 'card' },

  body(ctx) {
    const p = ctx.params;
    const mults = (p.multiplier_by_hand || []).map(Number);
    if (mults.length !== 10) throw new Error(`引擎参数非法：multiplier_by_hand 需 10 档，实际 ${mults.length}`);
    const deck = Number(p.deck_count);
    const minC = Number(p.min_cards), maxC = Number(p.max_cards);
    if (deck <= 0) throw new Error('引擎参数非法：deck_count 必须大于 0');

    ctx._card = { deck, minC, maxC, mults };
    ctx._mode = 'rank_only';
    ctx._count = minC;

    const cap = Math.floor((deck * 52) / 2);
    let cntBtns = '';
    for (let c = minC; c <= maxC; c++) {
      cntBtns += `<button class="opt" data-cnt="${c}"${c > cap ? ' disabled title="超过牌堆容量"' : ''}>${c} 张</button>`;
    }

    return `
      <div class="card">
        <div class="card-title">🃏 模式</div>
        <div class="opt-grid cols-2">
          <button class="opt sel" data-mode="rank_only">按牌型派彩<small>固定倍率</small></button>
          <button class="opt" data-mode="vs_dealer">对战庄家<small>1.78x 净赚 0.78x</small></button>
        </div>
        <div class="label" style="margin-top:12px">发牌张数（${minC} ~ ${maxC}）</div>
        <div class="opt-grid" id="cardCnts">${cntBtns}</div>
      </div>
      <div class="card">
        <div class="card-title">📊 赔率</div>
        <div id="cardOdds"></div>
        <div id="cardNote" class="desc" style="margin-top:8px"></div>
      </div>`;
  },

  bind(ctx) {
    const { deck, maxC, mults } = ctx._card;

    function renderOdds() {
      const box = document.getElementById('cardOdds');
      const note = document.getElementById('cardNote');

      if (ctx._mode === 'vs_dealer') {
        box.innerHTML = oddsTable(['结果', '规则'], [
          ['胜', '牌型高于庄家 → 派彩 1.78x'],
          ['平', '牌型相同 → 退回本金'],
          ['负', '低于庄家 → 0'],
        ]);
        note.innerHTML =
          '<span class="warn-txt">⚠️ 双方牌型分布对称，合约 profit_mult=78，RTP ≈ 89~90%（视平局率而定）。</span>';
        return;
      }

      const prob = estimateHandProb(deck, ctx._count);
      let rtp = 0, covered = 0;
      const rows = [];
      for (let r = 0; r < 10; r++) {
        const m = mults[r];
        const payout = m > 0 ? 1 + m / 100 : 0;
        const contrib = prob[r] * payout;
        rtp += contrib;
        if (m > 0) covered += prob[r];
        rows.push([
          HAND_NAMES[r],
          { v: String(r), num: 1 },
          { v: m > 0 ? payout.toFixed(2) + 'x' : '不赔', num: 1 },
          { v: (prob[r] * 100).toFixed(2) + '%', num: 1 },
        ]);
      }
      rows.push([
        '<b>合计 RTP</b>', '', '',
        { v: `<b class="${rtp >= 1 ? 'warn-txt' : 'ok-txt'}">${(rtp * 100).toFixed(1)}%</b>`, num: 1 },
      ]);
      box.innerHTML = oddsTable(['牌型', '档位', '派彩', '概率'], rows);

      const notes = [
        `概率为本地 3 万次模拟估算，有派彩的局面占 ${(covered * 100).toFixed(1)}%。`,
      ];
      if (rtp >= 1) notes.push('<span class="warn-txt">⚠️ RTP ≥ 100%，玩家可长期套利</span>');
      if (maxC < 5) notes.push('max_cards < 5，同花/顺子类档位（4/5/6/8/9）永不出现');
      note.innerHTML = notes.join('<br>');
    }

    document.querySelectorAll('[data-mode]').forEach((b) => {
      b.onclick = () => {
        ctx._mode = b.dataset.mode;
        document.querySelectorAll('[data-mode]').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        renderOdds();
      };
    });
    document.querySelectorAll('[data-cnt]').forEach((b) => {
      b.onclick = () => {
        ctx._count = Number(b.dataset.cnt);
        document.querySelectorAll('[data-cnt]').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        renderOdds();
      };
    });
    const first = document.querySelector('[data-cnt]:not([disabled])');
    if (first) first.click(); // 选中首个可用档位（data-cnt 的 onclick 已触发一次 renderOdds）
    else renderOdds();        // 无可用档位时仍渲染一次，避免重复跑蒙特卡洛（修复双重渲染）

    ctx.getInput = () => ({
      card_input: { card_count: ctx._count, mode: ctx._mode },
    });
  },

  result(ctx, out) {
    const m = /player_cards=\[([^\]]*)\],\s*hand_rank=(\d+)/.exec(out.engineResult || '');
    if (!m) return '';
    const cards = m[1].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean);
    const r = Number(m[2]);
    return (
      cards
        .map((h) => {
          const rank = parseInt(h.slice(0, 2), 16);
          const suit = parseInt(h.slice(2, 4), 16);
          return `<div class="pcard${SUIT_RED[suit] ? ' red' : ''}">${RANK_STR[rank] || rank}<small>${SUITS[suit] || '?'}</small></div>`;
        })
        .join('') +
      `<div class="desc" style="width:100%">牌型：${HAND_NAMES[r] ?? '未知'}（档位 ${r}）</div>`
    );
  },
};

// ============================================================
// 注册表
// ============================================================
window.GAMES = [
  // ---- 猜数字 ----
  { ...GuessGame, meta: { ...GuessGame.meta, id: 'guess',       name: { zh: '猜数字·经典', en: 'Guess · Classic' }, icon: '🎯' } },
  { ...GuessGame, meta: { ...GuessGame.meta, id: 'guess_elite',   name: { zh: '猜数字·精英', en: 'Guess · Elite' }, icon: '🎯' } },

  // ---- 轮盘 ----
  { ...RouletteGame, meta: { ...RouletteGame.meta, id: 'roulette',      name: { zh: '轮盘·经典', en: 'Roulette · Classic' }, icon: '🎡' } },
  { ...RouletteGame, meta: { ...RouletteGame.meta, id: 'roulette_vip',  name: { zh: '轮盘·VIP', en: 'Roulette · VIP' }, icon: '🎡' } },

  // ---- 骰宝 ----
  { ...DiceGame, meta: { ...DiceGame.meta, id: 'dice',          name: { zh: '骰宝', en: 'Sic Bo' }, icon: '🎲' } },

  // ---- 卡牌 ----
  { ...CardGame, meta: { ...CardGame.meta, id: 'card_rank',     name: { zh: '卡牌·按牌型', en: 'Card · By Hand' }, icon: '🃏' } },
  { ...CardGame, meta: { ...CardGame.meta, id: 'card_vs_dealer',name: { zh: '卡牌·对战', en: 'Card · Vs Dealer' }, icon: '🃏' } },
];
window.GAME_REGISTRY = {};
for (const g of window.GAMES) window.GAME_REGISTRY[g.meta.id] = g;
