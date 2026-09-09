import { CONFIG } from '../config.js';

export async function broadcastTx(txBytes, mode = 'BROADCAST_MODE_SYNC') {
    const res = await fetch(`${CONFIG.lcd}/cosmos/tx/v1beta1/txs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_bytes: txBytes, mode })
    });
    const data = await res.json();
    return data;
}

export async function waitForTx(hash, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const res = await fetch(`${CONFIG.lcd}/cosmos/tx/v1beta1/txs/${hash}`);
        if (res.ok) {
            const data = await res.json();
            if (data.tx_response) return data.tx_response;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('交易超时');
}
