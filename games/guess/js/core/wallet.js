import { getPaxiHub } from './paxi-provider.js';
import { CONFIG } from '../config.js';

/**
 * 连接钱包，返回 { address, publicKeyHex }
 * 失败时返回 null 并显示提示
 */
export async function connectWallet() {
    const paxi = getPaxiHub();
    if (!paxi) {
        if (/Mobi/.test(navigator.userAgent)) {
            const url = encodeURIComponent(window.location.href);
            window.location.href = `paxi://hub/explorer?url=${url}`;
            setTimeout(() => {
                window.location.href = 'https://paxinet.io/paxi_docs/paxihub#paxihub-application';
            }, 1000);
        } else {
            alert('⚠️ 请安装 PaxiHub 浏览器扩展，或在 PaxiHub App 内打开本页面');
        }
        return null;
    }
    try {
        const sender = await paxi.getAddress();
        if (!sender || !sender.address) {
            throw new Error('未获取到地址');
        }
        // sender.public_key 是 Uint8Array (base64)，转成 hex 存
        const pubBytes = new Uint8Array(sender.public_key);
        const pubKeyHex = Array.from(pubBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        return { address: sender.address, publicKeyHex };
    } catch (e) {
        console.error('连接钱包失败:', e);
        alert('❌ 连接钱包失败：' + (e.message || e));
        return null;
    }
}

export async function signMessage(message) {
    const paxi = getPaxiHub();
    if (!paxi) {
        alert('请先连接钱包');
        return null;
    }
    try {
        return await paxi.signMessage(message);
    } catch (e) {
        console.error('签名失败:', e);
        alert('❌ 签名失败：' + (e.message || e));
        return null;
    }
}

/**
 * 签名并广播合约执行消息（官方流程）
 * @param {Object} txBody - { contractAddress, message, fee }
 */
export async function signAndBroadcastTx(txBody) {
    const paxi = getPaxiHub();
    if (!paxi) {
        alert('请先连接钱包');
        return null;
    }
    try {
        // 先查链 ID 和账户信息
        const sender = await paxi.getAddress();
        const chainId = await fetchChainId();
        const { accountNumber, sequence } = await fetchAccountInfo(sender.address);
        
        // 构建 MsgExecuteContract
        const execMsg = buildWasmExecuteMsg(sender.address, txBody.contractAddress, txBody.message);
        
        // 用 PaxiCosmJS 构建完整交易
        const txObj = await buildSignDoc(chainId, accountNumber, sequence, [execMsg], txBody.fee);
        
        // 调 PaxiHub 签名
        const result = await paxi.signAndSendTransaction(txObj);
        
        if (!result || !result.success) {
            throw new Error('签名失败: ' + (result?.error || 'unknown'));
        }
        
        // 组装 TxRaw 并广播
        return await broadcastSignedTx(txObj, result.success);
    } catch (e) {
        console.error('交易失败:', e);
        alert('❌ 交易失败：' + (e.message || e));
        return null;
    }
}

// ============ 底层工具 ============

async function fetchChainId() {
    try {
        const res = await fetch(`${CONFIG.rpc}/status`);
        const data = await res.json();
        return data.result.node_info.network;
    } catch {
        return CONFIG.chainId;  // fallback
    }
}

async function fetchAccountInfo(address) {
    const res = await fetch(`${CONFIG.lcd}/cosmos/auth/v1beta1/accounts/${address}`);
    const { account } = await res.json();
    const ba = account.base_account || account;
    return {
        accountNumber: Number(ba.account_number),
        sequence: Number(ba.sequence)
    };
}

function buildWasmExecuteMsg(senderAddr, contractAddr, msgObj) {
    const P = window.PaxiCosmJS;
    const msg = P.MsgExecuteContract.fromPartial({
        sender: senderAddr,
        contract: contractAddr,
        msg: new TextEncoder().encode(JSON.stringify(msgObj))
    });
    return P.Any.fromPartial({
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: P.MsgExecuteContract.encode(msg).finish()
    });
}

async function buildSignDoc(chainId, accountNumber, sequence, anyMsgs, fee) {
    const P = window.PaxiCosmJS;
    
    // TxBody
    const txBody = P.TxBody.fromPartial({
        messages: anyMsgs,
        memo: ""
    });
    
    // Fee
    const feeObj = {
        amount: [{
            denom: CONFIG.denom,
            amount: fee.amount?.[0]?.amount || '30000'
        }],
        gasLimit: String(fee.gas || '400000')
    };
    
    // PubKey
    const sender = await getPaxiHub().getAddress();
    const pubBytes = new Uint8Array(sender.public_key);
    const pubkeyAny = {
        typeUrl: "/cosmos.crypto.secp256k1.PubKey",
        value: P.PubKey.encode({ key: pubBytes }).finish()
    };
    
    // AuthInfo
    const authInfo = P.AuthInfo.fromPartial({
        signerInfos: [{
            publicKey: pubkeyAny,
            modeInfo: { single: { mode: 1 } },
            sequence: BigInt(sequence)
        }],
        fee: feeObj
    });
    
    // SignDoc
    const signDoc = P.SignDoc.fromPartial({
        bodyBytes: P.TxBody.encode(txBody).finish(),
        authInfoBytes: P.AuthInfo.encode(authInfo).finish(),
        chainId,
        accountNumber: BigInt(accountNumber)
    });
    
    return {
        bodyBytes: btoa(String.fromCharCode(...signDoc.bodyBytes)),
        authInfoBytes: btoa(String.fromCharCode(...signDoc.authInfoBytes)),
        chainId,
        accountNumber: signDoc.accountNumber.toString(),
        // 保存完整的 signDoc 用于组装 TxRaw
        _bodyBytesRaw: signDoc.bodyBytes,
        _authInfoBytesRaw: signDoc.authInfoBytes,
        _txBodyRaw: txBody,
        _authInfoRaw: authInfo
    };
}

async function broadcastSignedTx(txObj, signatureBase64) {
    const P = window.PaxiCosmJS;
    const sigBytes = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
    
    const txRaw = P.TxRaw.fromPartial({
        bodyBytes: txObj._bodyBytesRaw,
        authInfoBytes: txObj._authInfoBytesRaw,
        signatures: [sigBytes]
    });
    
    const txBytes = P.TxRaw.encode(txRaw).finish();
    const base64Tx = btoa(String.fromCharCode(...txBytes));
    
    const res = await fetch(`${CONFIG.lcd}/cosmos/tx/v1beta1/txs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tx_bytes: base64Tx, mode: "BROADCAST_MODE_SYNC" })
    });
    
    const data = await res.json();
    return data;
}
