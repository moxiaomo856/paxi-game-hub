// 猜数字游戏 —— 纯前端演示版
// 接入链上只需替换 play() 函数里的逻辑

let balance = 100;
let target = Math.floor(Math.random() * 100);
let guessCount = 0;
let history = [];

const $ = id => document.getElementById(id);

function updateStats() {
    $('balance').textContent = balance;
    $('guesses').textContent = guessCount;
}

function play() {
    const bet = parseInt($('betAmount').value);
    const guess = parseInt($('guessNum').value);
    const resultDiv = $('result');
    const playBtn = $('playBtn');

    // 输入校验
    if (isNaN(bet) || bet <= 0) { alert('请输入有效的下注金额'); return; }
    if (bet > balance) { alert('余额不足'); return; }
    if (isNaN(guess) || guess < 0 || guess > 99) { alert('请输入 0-99 的数字'); return; }

    // 扣费
    balance -= bet;
    guessCount++;
    playBtn.disabled = true;

    // 判定
    const won = guess === target;
    const payout = won ? bet * 2 : 0;
    if (won) balance += payout;

    // 显示结果
    resultDiv.className = `result ${won ? 'win' : 'lose'}`;
    resultDiv.innerHTML = won 
        ? `🎉 中奖！猜的 <b>${guess}</b> 就是目标！<br>赢得 <b>${payout}</b> PAXI`
        : `😢 没中。目标是 <b>${target}</b>。<br>${guess < target ? '太小了 ↑' : '太大了 ↓'}`;
    resultDiv.classList.remove('hidden');

    // 历史
    history.unshift({ guess, target, won, bet, payout });
    renderHistory();

    // 赢了就重置目标数字
    if (won) {
        target = Math.floor(Math.random() * 100);
    }

    // 余额归零
    if (balance <= 0) {
        balance = 0;
        $('resetBtn').classList.remove('hidden');
        playBtn.textContent = '余额不足';
    } else {
        setTimeout(() => {
            playBtn.disabled = false;
        }, 1500);
    }

    updateStats();
}

function renderHistory() {
    const container = $('history');
    container.innerHTML = history.slice(0, 10).map(h => `
        <div class="history-item ${h.won ? 'win' : 'lose'}">
            <span>猜 ${h.guess} → 目标 ${h.target}</span>
            <span>${h.won ? `+${h.payout}` : `-${h.bet}`}</span>
        </div>
    `).join('');
}

function resetGame() {
    balance = 100;
    target = Math.floor(Math.random() * 100);
    guessCount = 0;
    history = [];
    $('result').classList.add('hidden');
    $('history').innerHTML = '';
    $('resetBtn').classList.add('hidden');
    $('playBtn').textContent = '猜！';
    updateStats();
}

$('playBtn').addEventListener('click', play);
$('resetBtn').addEventListener('click', resetGame);

updateStats();
