import { signAndBroadcastTx } from '../core/wallet.js';
import { CONFIG } from '../config.js';

/**
 * 🆕 提现 TKCC 到钱包
 * @param {string} amount - TKCC 数量（前端输入）
 */
export async function withdrawTkcc(amount) {
    const rawAmount = BigInt(amount) * BigInt(10 ** CONFIG.tkccDecimals);
    
    const msg = {
        withdraw: { 
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
 * 提现 PAXI 到钱包
 */
export async function withdrawPaxi(amount) {
    const msg = {
        withdraw: { token: null, amount: String(amount) }
    };
    
    const txBody = {
        contractAddress: CONFIG.contractAddress,
        message: msg,
        fee: {
            amount: [{ denom: CONFIG.denom, amount: '5000' }],
            gas: '200000'
        }
    };
    
    return await signAndBroadcastTx(txBody);
}
