import { getPaxiHub } from './paxi-provider.js';

export async function connectWallet() {
    const paxi = await getPaxiHub();
    if (!paxi) return null;
    try {
        const address = await paxi.getAddress();
        return address;
    } catch (e) {
        console.error('连接钱包失败:', e);
        return null;
    }
}

export async function signMessage(message) {
    const paxi = await getPaxiHub();
    if (!paxi) return null;
    try {
        return await paxi.signMessage(message);
    } catch (e) {
        console.error('签名失败:', e);
        return null;
    }
}

export async function signAndBroadcastTx(txBody) {
    const paxi = await getPaxiHub();
    if (!paxi) return null;
    try {
        return await paxi.signAndBroadcast(txBody);
    } catch (e) {
        console.error('交易失败:', e);
        return null;
    }
}
