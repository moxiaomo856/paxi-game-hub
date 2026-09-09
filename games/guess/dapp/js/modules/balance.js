import { CONFIG } from '../config.js';

/**
 * 查询游戏合约中的余额（支持 PAXI 和 PRC-20）
 * @param {string} address - 钱包地址
 * @param {string|null} token - token 地址（null 表示 PAXI）
 */
export async function queryBalance(address, token = null) {
    const queryMsg = {
        balance: { address, token }
    };
    
    const queryString = btoa(JSON.stringify(queryMsg));
    const res = await fetch(
        `${CONFIG.lcd}/cosmwasm/wasm/v1/contract/${CONFIG.contractAddress}/smart/${queryString}`
    );
    
    if (!res.ok) {
        console.error('查询余额失败:', res.statusText);
        return null;
    }
    
    const data = await res.json();
    return data.amount || '0';
}

/**
 * 查询链上原生 PAXI 余额
 */
export async function queryNativeBalance(address) {
    const res = await fetch(
        `${CONFIG.lcd}/cosmos/bank/v1beta1/balances/${address}`
    );
    
    if (!res.ok) return '0';
    
    const data = await res.json();
    const balance = (data.balances || []).find(b => b.denom === CONFIG.denom);
    return balance ? balance.amount : '0';
}
