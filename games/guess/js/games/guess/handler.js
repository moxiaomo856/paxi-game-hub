import { ensureSession } from '../../session/session-client.js';
import { getSessionKey } from '../../session/key-manager.js';
import { signTxWithSession } from '../../core/signer.js';
import { broadcastTx, waitForTx } from '../../core/tx-broadcaster.js';
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

    // 2. 获取当前 nonce（从 localStorage 或链上查询）
    //    简化：用 localStorage 存储 nonce
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
            session_addr: address,                     // 钱包地址
            nonce: nonce,                              // 当前 nonce
            signature: signed.signature                // 会话签名
        }
    };

    // 6. 广播交易
    const txBody = {
        contractAddress: CONFIG.contractAddress,
        message: msg,
        fee: {
            amount: [{ denom: CONFIG.denom, amount: '10000' }],
            gas: '400000'
        }
    };

    // 使用 window.paxihub 广播（需要主钱包签名 Gas）
    const result = await signAndBroadcast(txBody);
    
    // 7. nonce +1（无论成功与否，nonce 都应该递增）
    localStorage.setItem(nonceKey, String(nonce + 1));

    return result;
}

/**
 * 使用主钱包签名并广播（用于 Gas 支付）
 */
async function signAndBroadcast(txBody) {
    const paxi = window.paxihub?.paxi;
    if (!paxi) {
        throw new Error('PaxiHub 未连接');
    }
    try {
        return await paxi.signAndBroadcast(txBody);
    } catch (e) {
        console.error('交易失败:', e);
        throw e;
    }
}

function getWalletAddress() {
    if (!cachedAddress) {
        // 从 localStorage 读取
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
