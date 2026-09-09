import { connectWallet } from './core/wallet.js';
import { ensureSession } from './session/session-client.js';
import { loadGame } from './games/lobby.js';
import { queryBalance } from './modules/balance.js';
import { CONFIG } from './config.js';
import { setWalletAddress } from './games/guess/handler.js';

let currentAddress = null;

document.getElementById('connectBtn').addEventListener('click', async () => {
    const addr = await connectWallet();
    if (addr) {
        currentAddress = addr;
        setWalletAddress(addr);  // 🆕 同步给 handler.js
        document.getElementById('addressDisplay').textContent = 
            addr.length > 16 ? addr.slice(0, 8) + '...' + addr.slice(-8) : addr;
        
        // 🆕 确保会话存在（传入钱包地址）
        try {
            await ensureSession(addr);
        } catch (e) {
            console.warn('会话初始化失败:', e);
        }
        
        await updateBalance();
        document.getElementById('connectBtn').textContent = '已连接';
        document.getElementById('connectBtn').disabled = true;
    }
});

document.querySelectorAll('[data-game]').forEach(btn => {
    btn.addEventListener('click', () => {
        const game = btn.dataset.game;
        loadGame(game);
    });
});

export async function updateBalance() {
    if (!currentAddress) return;
    try {
        const tkccBalance = await queryBalance(currentAddress, CONFIG.tkccAddress);
        const displayTkcc = tkccBalance ? (BigInt(tkccBalance) / BigInt(10 ** CONFIG.tkccDecimals)).toString() : '0';
        document.getElementById('balanceDisplay').textContent = `TKCC: ${displayTkcc}`;
    } catch (e) {
        console.error('更新余额失败:', e);
    }
}
