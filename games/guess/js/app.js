import { connectWallet } from './core/wallet.js';
import { ensureSession } from './session/session-client.js';
import { loadGame } from './games/lobby.js';
import { queryBalance } from './modules/balance.js';
import { CONFIG } from './config.js';
import { setWalletAddress } from './games/guess/handler.js';

let currentAddress = null;

// 🚀 页面加载完成后再绑定事件（确保 DOM 就绪）
document.addEventListener('DOMContentLoaded', () => {
    const connectBtn = document.getElementById('connectBtn');
    if (!connectBtn) {
        console.error('❌ 找不到 #connectBtn 元素');
        return;
    }

    connectBtn.addEventListener('click', async () => {
        connectBtn.disabled = true;
        connectBtn.textContent = '连接中...';

        const sender = await connectWallet();
        // sender = { address: "paxi1abc...", public_key: "04a1..." } 或 null
        if (sender && sender.address) {
            const addr = sender.address;  // 🔑 只取地址字符串！
            currentAddress = addr;
            setWalletAddress(addr);       // 同步给 handler.js
            document.getElementById('addressDisplay').textContent = 
                addr.length > 16 ? addr.slice(0, 8) + '...' + addr.slice(-8) : addr;
            
            // 确保会话存在
            try {
                await ensureSession(addr);
            } catch (e) {
                console.warn('会话初始化失败:', e);
            }
            
            await updateBalance();
            connectBtn.textContent = '已连接';
            connectBtn.disabled = true;
        } else {
            connectBtn.textContent = '连接钱包';
            connectBtn.disabled = false;
        }
    });

    document.querySelectorAll('[data-game]').forEach(btn => {
        btn.addEventListener('click', () => {
            const game = btn.dataset.game;
            loadGame(game);
        });
    });
});

export async function updateBalance() {
    if (!currentAddress) return;
    try {
        const tkccBalance = await queryBalance(currentAddress, CONFIG.tkccAddress);
        const num = tkccBalance ? Number(tkccBalance) : 0;
        const displayTkcc = (num / Math.pow(10, CONFIG.tkccDecimals)).toString();
        document.getElementById('balanceDisplay').textContent = `TKCC: ${displayTkcc}`;
    } catch (e) {
        console.error('更新余额失败:', e);
    }
}
