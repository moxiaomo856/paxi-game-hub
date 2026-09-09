const SESSION_KEY = 'game_session_privkey';
const SESSION_PUBKEY = 'game_session_pubkey';
const SESSION_KEYGENED = 'game_session_keygened';

/**
 * 生成 secp256k1 密钥对（与 Cosmos SDK / Paxi 链兼容）
 */
export async function generateSessionKey() {
    const Secp256k1 = getSecp256k1();
    if (!Secp256k1) {
        throw new Error('Secp256k1 不可用，请确认 paxi-cosmjs 已加载');
    }

    const keypair = Secp256k1.makeKeypair();

    const privHex = toHex(keypair.privkey);
    const pubHex = toHex(keypair.pubkey);

    localStorage.setItem(SESSION_KEY, privHex);
    localStorage.setItem(SESSION_PUBKEY, pubHex);
    localStorage.setItem(SESSION_KEYGENED, '1');

    return { privateKey: privHex, publicKey: pubHex };
}

export function getSessionKey() {
    const priv = localStorage.getItem(SESSION_KEY);
    const pub = localStorage.getItem(SESSION_PUBKEY);
    const kegen = localStorage.getItem(SESSION_KEYGENED);
    if (priv && pub && kegen === '1') {
        return { privateKey: priv, publicKey: pub };
    }
    return null;
}

export function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_PUBKEY);
    localStorage.removeItem(SESSION_KEYGENED);
}

// --- 工具函数 ---

function getSecp256k1() {
    // paxi-cosmjs UMD 包可能挂在不同路径
    if (window.cosmjs?.crypto?.Secp256k1) return window.cosmjs.crypto.Secp256k1;
    if (window.paxi?.crypto?.Secp256k1) return window.paxi.crypto.Secp256k1;
    if (window.paxihub?.crypto?.Secp256k1) return window.paxihub.crypto.Secp256k1;
    if (window.Secp256k1) return window.Secp256k1;
    return null;
}

function toHex(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return Array.from(arr)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
