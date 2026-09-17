/**
 * 疯狂骰子（🎲）—— 1 骰 6 面 · 押面即赢
 *
 * 走通用游戏引擎通道：openGame 查询 game_engine_config_query('crazydice') + game_limit，
 * 复用 app.js 的 doPlay 签名/广播流程。合约需已配置 crazydice 为 dice 引擎：
 *   dice_count = 1, sides = 6, bet_types = ['specific']
 *
 * 与 games.js 的 DiceGame 完全同构，只是固定只暴露「指定点数」一种玩法，
 * 并把经济模型（90% 奖池 / 5% 销毁 / 5% 运营）展示出来。
 *
 * 依赖（均由 games.js 在同作用域定义，且本文件在其后加载）：
 *   diceSpecificMult(sides, n) —— 计算 specific 玩法的利润倍率（百分数）
 */
const CrazyDiceGame = {
  meta: {
    id: 'crazydice',
    name: { zh: '疯狂骰子', en: 'Crazy Dice' },
    icon: '🎲',
    desc: { zh: '1 骰 6 面 · 押面即赢', en: '1 die × 6 faces · pick to win' },
    engine: 'dice',
  },

  body(ctx) {
    const p = ctx.params;
    const n = Number(p.dice_count), sides = Number(p.sides);
    if (n < 1 || n > 10 || sides < 2 || sides > 100) throw new Error('引擎参数越界');

    // 疯狂骰子固定只玩 specific（押中指定点数）
    const types = (p.bet_types || []).map(String);
    if (!types.includes('specific')) throw new Error('合约未启用 specific 玩法');
    ctx._dice = { n, sides, types: ['specific'] };
    ctx._face = null;

    const m = diceSpecificMult(sides, n);   // 百分数利润倍率
    const payout = 1 + m / 100;             // 含本金派彩倍数
    const hit = 1 - Math.pow((sides - 1) / sides, n); // 命中概率

    let faceBtns = '';
    for (let v = 1; v <= sides; v++) {
      faceBtns += `<button class="opt" data-face="${v}">${v}</button>`;
    }

    return `
      <div class="card">
        <div class="card-title">🎲 押一面</div>
        <div class="desc" style="margin-bottom:8px">${n} 颗骰子 × ${sides} 面 · 摇出你选的点数即赢</div>
        <div class="opt-grid" id="cdFaces">${faceBtns}</div>
        <div id="cdPick" class="desc" style="margin-top:8px;color:var(--accent)">请选择要押的点数</div>
      </div>
      <div class="card">
        <div class="card-title">📊 赔率</div>
        <div class="kv"><span class="k">押中派彩</span><span class="v">${payout.toFixed(2)}x</span></div>
        <div class="kv"><span class="k">命中概率</span><span class="v">${(hit * 100).toFixed(1)}%</span></div>
      </div>
      <div class="card">
        <div class="card-title">💰 经济模型</div>
        <div class="desc" id="cdEcon">90% 进奖池 · 5% 销毁 · 5% 运营（加载中…）</div>
      </div>`;
  },

  bind(ctx) {
    const { sides } = ctx._dice;

    document.querySelectorAll('#cdFaces [data-face]').forEach((b) => {
      b.onclick = () => {
        ctx._face = Number(b.dataset.face);
        document.querySelectorAll('#cdFaces [data-face]').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        document.getElementById('cdPick').textContent = `已押点数 ${ctx._face}`;
      };
    });

    ctx.getInput = () => {
      if (ctx._face === null) throw new Error('请先选择要押的点数');
      return {
        dice_input: {
          bet_type: 'specific',
          specific_value: ctx._face,
        },
      };
    };

    // 经济模型：优先取链上 burn_config / treasury_config，取不到回落静态文案
    loadCrazyEconomy();
  },

  result(ctx, out) {
    const m = /dice=\[([^\]]*)\],\s*total=(\d+),\s*mid=(\d+)/.exec(out.engineResult || '');
    if (!m) return '';
    const dice = m[1].split(',').map((x) => x.trim()).filter(Boolean);
    const total = Number(m[2]);
    const picked = ctx._face;
    const hit = picked !== null && dice.map(Number).includes(picked);
    return (
      dice.map((d) => `<div class="dice-face">${d}</div>`).join('') +
      `<div class="desc" style="width:100%;color:${hit ? 'var(--accent)' : 'var(--muted)'}">` +
      `摇出 ${dice.join(',')}　你押 ${picked === null ? '—' : picked} → ${hit ? '🎉 中了！' : '未中'}</div>`
    );
  },
};

/** 拉取链上经济参数，失败则显示静态 70/15/15。
 *
 *  🟢 修复（中危 2）：原先只读全局 burn_config / treasury_config，
 *     但管理员可通过 SetGameConfig 为本游戏设 burn_rate_override /
 *     treasury_share_override 覆盖，导致 UI 显示值与链上实际结算值不一致。
 *     现改为：优先读本游戏 GameConfig 覆盖值，无覆盖再回落到全局。
 *
 *  单位说明：合约侧单位为 bps（万分之一，硬顶 10000），故 /100 得百分比。
 *  安全性：contract.rs::QueryMsg::GameConfig 用 unwrap_or_default()，
 *     未配置时返回默认（burn_enabled=true、两个 override 均为 null），可安全调用。
 */
async function loadCrazyEconomy() {
  const el = document.getElementById('cdEcon');
  if (!el) return;
  try {
    const [gameCfg, burn, treasury] = await Promise.all([
      queryContract({ game_config: { game_id: 'crazydice' } }).catch(() => null),
      queryContract({ burn_config: {} }).catch(() => null),
      queryContract({ treasury_config: {} }).catch(() => null),
    ]);
    const burnBps = (gameCfg && gameCfg.burn_rate_override != null)
      ? Number(gameCfg.burn_rate_override)
      : (burn && burn.burn_rate != null ? Number(burn.burn_rate) : 500);
    const treasBps = (gameCfg && gameCfg.treasury_share_override != null)
      ? Number(gameCfg.treasury_share_override)
      : (treasury && treasury.treasury_share != null ? Number(treasury.treasury_share) : 500);
    // burn_enabled=false 表示该游戏不参与销毁
    const burnEnabled = !gameCfg || gameCfg.burn_enabled !== false;
    const burnPct = burnEnabled ? burnBps / 100 : 0;
    const treasuryPct = treasBps / 100;
    const poolPct = Math.max(0, 100 - burnPct - treasuryPct);
    el.textContent = `${poolPct}% 进奖池 · ${burnPct}% 销毁 · ${treasuryPct}% 运营`;
  } catch (e) {
    el.textContent = '90% 进奖池 · 5% 销毁 · 5% 运营';
  }
}

// 注册到游戏注册表（games.js 已先加载并建立 window.GAMES / GAME_REGISTRY）
window.GAMES.push(CrazyDiceGame);
window.GAME_REGISTRY[CrazyDiceGame.meta.id] = CrazyDiceGame;
