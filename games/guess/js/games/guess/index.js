import { CONFIG } from '../../config.js';
import { updateBalance } from '../../app.js';

export function render() {
    return `
        <div class="guess-game">
            <div class="guess-title">🎯 猜数字游戏</div>
            <p>猜一个 0-99 之间的数字，猜中赢 <strong>2 倍</strong>！</p>
            
            <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap; justify-content: center;">
                <div>
                    <label>下注代币:</label>
                    <span style="padding:10px 20px;background:rgba(0,0,0,0.3);border-radius:8px;color:#ffd700;">
                        🪙 TKCC (精度 6)
                    </span>
                </div>
            </div>

            <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap; justify-content: center;">
                <div>
                    <label>你的猜测:</label>
                    <input type="number" id="guessInput" class="guess-input" min="0" max="99" value="50">
                </div>
                <div>
                    <label>下注金额 (TKCC):</label>
                    <input type="number" id="betInput" class="bet-input" 
                           min="20000" max="100000" value="50000" step="1000">
                </div>
            </div>
            <div id="betHint" style="font-size:14px;color:rgba(255,255,255,0.6);">
                TKCC 范围: 20,000 ~ 100,000 TKCC
            </div>
            <button id="guessBtn" class="guess-btn">猜猜看！</button>
            <div id="guessResult"></div>
        </div>
    `;
}

export async function init() {
    const btn = document.getElementById('guessBtn');
    const resultDiv = document.getElementById('guessResult');
    const betInput = document.getElementById('betInput');

    btn.addEventListener('click', async () => {
        const number = parseInt(document.getElementById('guessInput').value);
        const bet = betInput.value;

        if (isNaN(number) || number < 0 || number > 99) {
            alert('请输入 0-99 之间的数字');
            return;
        }

        const betNum = parseInt(bet);
        if (isNaN(betNum) || betNum < 20000 || betNum > 100000) {
            alert('TKCC 下注范围: 20,000 ~ 100,000');
            return;
        }

        btn.disabled = true;
        btn.textContent = '交易中...';
        resultDiv.innerHTML = '';

        try {
            const { guessNumber } = await import('./handler.js');
            const result = await guessNumber(number, bet);

            if (result && result.tx_response) {
                const events = result.tx_response.events || [];
                const actionEvent = events.find(e => e.type === 'execute');
                const wonAttr = actionEvent?.attributes?.find(a => a.key === 'won');
                const targetAttr = actionEvent?.attributes?.find(a => a.key === 'target');
                const payoutAttr = actionEvent?.attributes?.find(a => a.key === 'payout');

                const won = wonAttr?.value === 'true';
                const target = targetAttr?.value;
                const payout = payoutAttr?.value;

                // 将最小单位转换为 TKCC 显示
                const payoutTkcc = payout ? (BigInt(payout) / BigInt(10 ** CONFIG.tkccDecimals)).toString() : '0';
                const betTkcc = (BigInt(bet) / BigInt(10 ** CONFIG.tkccDecimals)).toString();

                resultDiv.innerHTML = `
                    <div class="result ${won ? 'win' : 'lose'}">
                        ${won ? '🎉 恭喜中奖！' : '😢 很遗憾，没中'}<br>
                        目标数字: <strong>${target}</strong><br>
                        ${won ? `获得: ${payoutTkcc} TKCC` : `下注: ${betTkcc} TKCC`}
                    </div>
                `;
                // 🆕 下注成功后刷新余额
                await updateBalance();
            } else {
                resultDiv.innerHTML = '<div class="result lose">交易已提交，请查看结果</div>';
            }
        } catch (e) {
            console.error(e);
            resultDiv.innerHTML = `<div class="result lose">出错了: ${e.message || '请重试'}</div>`;
        } finally {
            btn.disabled = false;
            btn.textContent = '猜猜看！';
        }
    });
}
