import { signAndBroadcastTx } from '../core/wallet.js';
import { CONFIG } from '../config.js';

/**
 * 🆕 充值 TKCC 到游戏合约
 * 注意：需要先调用 TKCC 合约的 transfer，再调用游戏合约的 deposit
 * 这里简化：直接调用游戏合约的 deposit（要求用户已授权）
 */
export async function depositTkcc(amount) {
    // amount 是 TKCC 数量（前端输入），需要乘以 10^decimals 转为最小单位
    const rawAmount = BigInt(amount) * BigInt(10 ** CONFIG.tkccDecimals);
    
    const msg = {
        deposit: { 
            token: CONFIG.tkccAddress,
            amount: rawAmount.toString()
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
    
    return await signAndBroadcastTx(txBody);
}

/**
 * 充值 PAXI 到游戏合约
 */
export async function depositPaxi(amount) {
    const msg = {
        deposit: { token: null }
    };
    
    const txBody = {
        contractAddress: CONFIG.contractAddress,
        message: msg,
        funds: [{ denom: CONFIG.denom, amount: String(amount) }],
        fee: {
            amount: [{ denom: CONFIG.denom, amount: '5000' }],
            gas: '200000'
        }
    };
    
    return await signAndBroadcastTx(txBody);
}
