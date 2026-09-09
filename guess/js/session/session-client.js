import { getSessionKey, generateSessionKey } from './key-manager.js';
import { signAndBroadcastTx } from '../core/wallet.js';
import { CONFIG } from '../config.js';

/**
 * 确保会话存在且有效
 * @param {string} walletAddress - 钱包地址（bech32，用作 session_addr）
 */
export async function ensureSession(walletAddress) {
    if (!walletAddress) {
        throw new Error('请先连接钱包');
    }

    let session = getSessionKey();
    if (!session) {
        session = await generateSessionKey();
        await registerSession(walletAddress, session.publicKey);
    }
    
    try {
        const info = await querySessionInfo(walletAddress);
        if (!info || !info.info || info.info.expires_at < Date.now() / 1000) {
            await registerSession(walletAddress, session.publicKey);
        }
    } catch (e) {
        console.warn('查询会话信息失败:', e);
    }
    return session;
}

/**
 * 注册会话到链上
 * @param {string} sessionAddr - 钱包地址（bech32）
 * @param {string} pubkeyHex - 会话公钥 (hex)
 */
async function registerSession(sessionAddr, pubkeyHex) {
    const msg = {
        register_session: {
            session_addr: sessionAddr,    // 🆕 钱包地址
            pubkey_hex: pubkeyHex,        // 🆕 公钥 hex
            daily_limit: '100000000000000000000'  // 极大值，等效无限制
        }
    };
    
    const txBody = {
        contractAddress: CONFIG.contractAddress,
        message: msg,
        fee: {
            amount: [{ denom: CONFIG.denom, amount: '5000' }],
            gas: '300000'
        }
    };
    
    const result = await signAndBroadcastTx(txBody);
    if (!result) {
        throw new Error('注册会话失败');
    }
    console.log('会话注册成功:', result);
}

async function querySessionInfo(sessionAddr) {
    const queryString = btoa(JSON.stringify({ 
        session_info: { pubkey: sessionAddr } 
    }));
    const res = await fetch(
        `${CONFIG.lcd}/cosmwasm/wasm/v1/contract/${CONFIG.contractAddress}/smart/${queryString}`
    );
    if (!res.ok) return null;
    return await res.json();
}
