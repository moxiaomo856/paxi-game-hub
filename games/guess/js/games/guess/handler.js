import { ensureSession } from '../../session/session-client.js';
import { signTxWithSession } from '../../core/signer.js';
import { signAndBroadcastTx } from '../../core/wallet.js';
import { CONFIG } from '../../config.js';

let cachedAddress = null;

/**
 * 执行猜数字游戏（TKCC 下注）- 使用会话私钥签名（无感）
 * @param {number} number - 猜测的数字 (0-99)
 * @param {string} bet - 下注金额 (TKCC 数量)
 */
export async function guessNumber(number, bet) {
    const address = getWalletAddress();
    if (!address) {
        throw new Error('请先连接钱包');
    }

    // 1. 确保会话存在
    const session = await ensureSession(address);
    if (!session) {
        throw new Error('会话初始化失败');
    }

    // 2. 获取当前 nonce（从 localStorage）
    const nonceKey = `game_nonce_${address}`;
    let nonce = parseInt(localStorage.getItem(nonceKey) || '0');

    // 3. 构建游戏数据
    const gameData = {
        number: number,
        bet: String(bet),
        token: CONFIG.tkccAddress
    };

    // 4. 🔑 用会话私钥签名
    const signed = signTxWithSession(
        gameData,                    // msg
        session.privateKey,          // 会话私钥 (hex)
        nonce,                       // nonce
        'guess',                     // game_id
        'guess'                      // action
    );

    // 5. 构建完整的 PlayGame 消息
    const msg = {
        play_game: {
            game_id: 'guess',
            action: 'guess',
            data: JSON.stringify(gameData),
            session_addr: address,
            nonce: nonce,
            signature: signed.signature
        }
    };

    // 6. 广播交易（统一用 wallet.js 的 signAndBroadcastTx）
    const txBody = {
        contractAddress: CONFIG.contractAddress,
        message: msg,
        fee: {
            amount: [{ denom: CONFIG.denom, amount: '10000' }],
            gas: '400000'
        }
    };

    const result = await signAndBroadcastTx(txBody);
    
    // 7. nonce +1（无论成功与否，nonce 都应该递增）
    localStorage.setItem(nonceKey, String(nonce + 1));

    return result;
}

function getWalletAddress() {
    if (!cachedAddress) {
        const saved = localStorage.getItem('wallet_address');
        if (saved) {
            cachedAddress = saved;
        }
    }
    return cachedAddress;
}

// 导出设置方法，供 app.js 调用
export function setWalletAddress(address) {
    cachedAddress = address;
    localStorage.setItem('wallet_address', address);
}
