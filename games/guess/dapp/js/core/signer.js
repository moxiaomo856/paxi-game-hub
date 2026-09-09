import { CONFIG } from '../config.js';

/**
 * 使用 secp256k1 会话私钥对消息进行签名（Paxi 链兼容）
 * @param {Object} msg - 要发送的合约消息
 * @param {string} privateKeyHex - 会话私钥 (hex)
 * @param {string} nonce - 防重放随机数
 * @param {string} gameId - 游戏 ID
 * @param {string} action - 操作类型
 */
export function signTxWithSession(msg, privateKeyHex, nonce, gameId = 'guess', action = 'guess') {
    const Secp256k1 = getSecp256k1();
    if (!Secp256k1) {
        throw new Error('Secp256k1 不可用，请确认 paxi-cosmjs 已加载');
    }

    // 将 hex 私钥转为 Uint8Array
    const privBytes = hexToBytes(privateKeyHex);
    
    // 🔑 构建签名消息：合约要求格式为 "game_id:action:data:nonce"
    // 注意：data 必须与合约中解析的 JSON 字符串完全一致
    const dataStr = JSON.stringify(msg);
    const message = `${gameId}:${action}:${dataStr}:${nonce}`;
    const msgBytes = new TextEncoder().encode(message);
    
    // secp256k1 签名
    const signature = Secp256k1.sign(msgBytes, privBytes);
    
    return {
        msg,
        signature: bytesToHex(signature)
    };
}

// --- 工具函数 ---

function getSecp256k1() {
    if (window.cosmjs?.crypto?.Secp256k1) return window.cosmjs.crypto.Secp256k1;
    if (window.Secp256k1) return window.Secp256k1;
    return null;
}

function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
