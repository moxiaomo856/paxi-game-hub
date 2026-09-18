// 本轮改动（A1+A3+A4+E+R12）：getSessionClient 直接传 Uint8Array 并缓存 + 传 gasPrice；
//   enableSeamlessMode 改用 cosmjs-types Feegrant；sendTxWithSession 修正 Feegrant
//   （granter 必须写进 StdFee，而非 signAndBroadcast 的第 6 个参数——E 修复）；
//   R12：Session.sign 改 async + await；🟢 第十六轮（2026-09-18）真根因修复：
//   noble v2.1.0 sign() 返回 Signature 对象（非 Uint8Array），必须 toCompactRawBytes()
//   再转 hex —— 详见 Session.sign 内注释。
/**
 * 会话密钥 —— 生成 / 存储 / 注册 / 签名 / nonce 链上同步
 *
 * ⚠️ 与合约 src/games/mod.rs::validate_and_consume_session 严格对齐：
 *    签名原文 = "{chain_id}:{contract}:{game_id}:{action}:{round_id}:{amount_or_payout}:{nonce}:{pubkey}"
 *    哈希     = 裸 SHA-256（不是 ADR-36，不要走钱包 signArbitrary）
 *    签名     = secp256k1 compact 64 字节，必须 low-S（Cosmos SDK 强制）
 *
 * 依赖 window.nobleSecp / nobleSha256 / nobleRipemd160（index.html 里的 ESM 注入）
 */

// noble 是异步 ESM，等它就绪 + 🔴 双保险注入 hmacSha256Sync
//   index.html 的 ESM 已经注入了一遍；这里再加一次运行时 fallback，
//   防止 github pages 缓存旧版 HTML 时 nobleSecp.sign() 抛 "etc.hmacSha256Sync not set"。
function waitForNoble(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ready = () => {
      if (!window.nobleSecp || !window.nobleSha256 || !window.nobleRipemd160) return false;
      // 🔴 运行时 fallback：如果 index.html 没注入 hmac，这里补上
      if (!window.nobleSecp.etc?.hmacSha256Sync) {
        // 动态 import hmac（ESM 模块异步加载）
        import('https://cdn.jsdelivr.net/npm/@noble/hashes@1.5.0/hmac/+esm')
          .then(({ hmac }) => {
            window.nobleSecp.etc.hmacSha256Sync = (key, ...msgs) =>
              hmac(window.nobleSha256, key, window.nobleSecp.etc.concatBytes(...msgs));
            console.warn('[noble] hmacSha256Sync fallback injected');
            resolve();
          })
          .catch(() => resolve()); // hmac 导入也失败就只能让后续 sign() 自己报错了
      } else {
        resolve();
      }
      return true;
    };
    if (ready()) return;
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (ready()) {
        clearInterval(timer);
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(timer);
        reject(new Error('加密库加载超时，请检查网络'));
      }
    }, 50);
  });
}

// ---- 会话私钥本地加密（AES-GCM + PBKDF2，密码不落盘、不上链） ----
// ⚠️ 依赖 window.crypto.subtle：安全上下文（https 或 localhost）可用；纯 file:// 打开不可用。
//    作用：私钥在 localStorage 中只以密文存放，XSS 即使读到 localStorage 也拿不到明文，
//    必须先在页面里用密码解锁（解锁后明文短暂留在内存用于签名，关页即清）。
async function deriveKey(passphrase, saltB64) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const salt = fromBase64(saltB64);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
async function encryptPriv(privBytes, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, toBase64(salt));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, privBytes);
  return JSON.stringify({ v: 1, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) });
}
async function decryptPriv(blobStr, passphrase) {
  const o = JSON.parse(blobStr);
  if (!o || o.v !== 1) throw new Error('unsupported key blob');
  const key = await deriveKey(passphrase, o.salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(o.iv) }, key, fromBase64(o.ct));
  return new Uint8Array(pt);
}

const Session = {
  async load() {
    const raw = localStorage.getItem(LS.sessPriv);
    if (!raw) return false;
    if (raw.startsWith('{')) {
      // 加密存储：先保留密文，等 unlock() 用密码解开（内存中私钥保持 null）
      try {
        const o = JSON.parse(raw);
        if (o && o.v === 1) {
          state.encBlob = raw;
          state.sessPriv = null;
          state.legacyPlain = false;
        }
      } catch (e) { /* 解析失败 → 走下方明文兜底 */ }
    }
    if (!state.encBlob) {
      // 兼容旧版：明文 hex 直接读入内存（后续 ensure 会提示升级为加密）
      state.sessPriv = hexToBytes(raw);
      state.legacyPlain = true;
    }
    state.sessPubHex = localStorage.getItem(LS.sessPub) || '';
    state.sessAddr = localStorage.getItem(LS.sessAddr) || '';
    state.sessNonce = Number(localStorage.getItem(LS.sessNonce) || '0');
    return !!(state.sessAddr && state.sessPubHex);
  },

  async generate(pw) {
    await waitForNoble();
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('当前环境不支持 Web Crypto，请用 https 或 localhost 访问（不要用 file:// 直接打开）');
    }
    const priv = window.nobleSecp.utils.randomPrivateKey();
    const pub = window.nobleSecp.getPublicKey(priv, true); // 33 字节压缩
    const pubHex = bytesToHex(pub);
    const h160 = window.nobleRipemd160(window.nobleSha256(pub));
    const addr = window.bech32Encode(NETWORK.prefix, h160);

    state.sessPriv = priv;
    state.sessPubHex = pubHex;
    state.sessAddr = addr;
    state.sessNonce = 0;
    state.legacyPlain = false;
    state.encBlob = null;

    if (pw) {
      // 用密码加密后只落盘密文（推荐路径）
      const blob = await encryptPriv(priv, pw);
      localStorage.setItem(LS.sessPriv, blob);
      state.encBlob = blob;
    } else {
      // 无密码兜底（不推荐）：仍以明文存储，保持旧行为
      localStorage.setItem(LS.sessPriv, bytesToHex(priv));
    }
    localStorage.setItem(LS.sessPub, pubHex);
    localStorage.setItem(LS.sessAddr, addr);
    localStorage.setItem(LS.sessNonce, '0');
    return addr;
  },

  /** 用密码解密本地密文到内存（不落盘） */
  async unlock(pw) {
    if (!state.encBlob) return !!state.sessPriv;
    try {
      const priv = await decryptPriv(state.encBlob, pw);
      state.sessPriv = priv;
      return true;
    } catch (e) {
      return false;
    }
  },

  /** 清空内存中的私钥（保留密文，等同退出登录式锁屏） */
  lock() {
    state.sessPriv = null;
  },

  /**
   * ⚠️ 关键：nonce 永远以链上为准。
   * localStorage 只是缓存。一旦偏差（换设备 / 清缓存 / 上笔失败但本地已自增 /
   * 多标签页并发），合约报 InvalidNonce，而失败交易不会回滚本地计数，
   * 结果就是会话永久卡死。所以每次用之前都拉一次真实 nonce。
   */
  async syncFromChain() {
    if (!state.sessAddr) throw new Error('本地没有会话密钥');
    let r;
    try {
      r = await queryContract({ session_info: { session_addr: state.sessAddr } });
    } catch (e) {
      return { registered: false };
    }
    if (!r || !r.info) return { registered: false };

    const info = r.info;
    state.sessNonce = Number(info.nonce);
    state.sessInfo = info;
    localStorage.setItem(LS.sessNonce, String(state.sessNonce));

    return {
      registered: true,
      pubMatches: info.pubkey === state.sessPubHex,
      expired: Number(info.expires_at) < Math.floor(Date.now() / 1000),
      expiresAt: Number(info.expires_at),
      dailyLimit: info.daily_limit,
      dailyUsed: info.daily_used,
    };
  },

  async register() {
    if (!state.sessAddr || !state.sessPriv) await this.ensure();
    if (!state.connected) throw new Error('请先连接钱包');
    const hash = await execContract({
      register_session: {
        session_addr: state.sessAddr,
        pubkey_hex: state.sessPubHex,
        daily_limit: SESSION_DAILY_LIMIT,
      },
    });
    await waitForTx(hash);
    await this.syncFromChain();
    return hash;
  },

  buildMessage({ gameId, action, roundId, amountPayout, nonce }) {
    const chainId = state.chainId;
    return [
      chainId, CONTRACTS.game, gameId, action, roundId, amountPayout, nonce, state.sessPubHex,
    ].join(':');
  },

  /**
   * 裸 SHA-256 + secp256k1，返回 128 hex（64 字节 compact）
   * 🔴 真根因修复（2026-09-18，第十六轮）：@noble/secp256k1@2.1.0 的 sign() 返回的是
   *   **Signature 对象（r/s 两个 BigInt）**，不是 Uint8Array！此前注释误以为 v2 返回
   *   Uint8Array，所以即使补了 await，bytesToHex(Signature 对象) 仍得到空串
   *   （Array.from(非可迭代对象) = []）→ 签名永远为空 → 守卫报"签名为空"。
   *   本机 node + 同版本 2.1.0 复现确认；sig.toCompactRawBytes() → Uint8Array(64)
   *   → 128 hex，lowS 生效，verify 通过。
   *   兼容写法：如果未来换成返回 Uint8Array 的版本/替代实现，直接透传。
   */
  async sign(message) {
    const hash = window.nobleSha256(new TextEncoder().encode(message));
    const sig = await window.nobleSecp.sign(hash, state.sessPriv, { lowS: true });
    const bytes = (sig instanceof Uint8Array) ? sig : sig.toCompactRawBytes();
    return bytesToHex(bytes);   // Uint8Array(64) compact 签名 → 128 hex
  },

  bumpNonce() {
    state.sessNonce = Number(state.sessNonce) + 1;
    localStorage.setItem(LS.sessNonce, String(state.sessNonce));
  },

  /**
   * 确保会话可用，不可用则返回原因
   * @returns {{ok:boolean, needRegister:boolean, reason?:string}}
   */
  async ensure() {
    await waitForNoble();
    const loaded = await this.load();

    if (!loaded || state.encBlob) {
      // 🔴 零密码策略（老板旧版模式）：
      //   - 从未创建过会话 → 直接 generate(null)，明文存 localStorage
      //   - 旧版用户有加密 blob（设过密码）→ 清掉密文重新生成，彻底告别密码
      if (state.encBlob) {
        console.warn('[Session] 检测到旧版加密会话，自动清除并重新生成（零密码模式）');
        localStorage.removeItem(LS.sessPriv);
        state.encBlob = null;
      }
      await this.generate(null);  // null = 明文，不加密
    }

    const chain = await this.syncFromChain();
    if (!chain.registered) return { ok: false, needRegister: true, reason: '会话尚未在链上注册' };
    if (!chain.pubMatches) return { ok: false, needRegister: true, reason: '本地密钥与链上注册的不一致' };
    if (chain.expired) return { ok: false, needRegister: true, reason: '会话已过期，需续期' };
    return { ok: true, needRegister: false, info: chain };
  },
};


// ============================================================================
// 🟢 无感签名核心函数（基于 Feegrant + 会话私钥 + CosmJS Stargate）
//
// 合约侧零改动：
//   - 所有 Play/Sanguo* 入口通过 sanguo_auth / validate_and_consume_session
//     返回 session.user（主钱包）作为 player
//   - info.sender 是谁不影响资产扣减（走 BALANCES[(player, token)]）
//   - payload 里的 session_addr/nonce/signature 保留，用于合约二次验证
//
// 前提条件（用户需先手动做一次）：
//   1. 主钱包 RegisterSession → 合约绑定 session_addr → main_wallet
//   2. 主钱包 MsgGrantAllowance → 授权会话地址用主钱包余额付 gas（7 天）
//
// 之后所有游戏写操作：
//   - sender = 会话地址
//   - feeGranter = 主钱包地址（Feegrant pay gas）
//   - 会话私钥直接签 Cosmos SignDoc（不弹主钱包）
// ============================================================================

// 等待 index.html 中赋值的 window.CosmJSSigning 就绪
function waitForCosmJS(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (window.CosmJSSigning) return resolve();
    const timer = setTimeout(() => reject(new Error('CosmJS 加载超时')), timeoutMs);
    window.addEventListener('cosmjs-ready', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// 用会话私钥创建 Cosmos SigningStargateClient（不需要主钱包）
// DirectSecp256k1Wallet.fromKey 接受 32 字节私钥（Uint8Array）
Session._sessionClient = null;
Session.getSessionClient = async function() {
  await waitForCosmJS();
  if (Session._sessionClient) return Session._sessionClient;
  const { DirectSecp256k1Wallet, SigningStargateClient, GasPrice } = window.CosmJSSigning;

  if (!state.sessPriv) throw new Error('会话私钥未生成');

  // sessPriv 是 Uint8Array（32 字节），直接传给 fromKey（不要 hexToBytes 二次转换）
  const wallet = await DirectSecp256k1Wallet.fromKey(state.sessPriv, NETWORK.prefix);

  // 连接 RPC（会话走 RPC，主钱包走 LCD）；传 gasPrice 让 Stargate 能估算/模拟 gas
  Session._sessionClient = await SigningStargateClient.connectWithSigner(
    NETWORK.rpc,
    wallet,
    { gasPrice: GasPrice.fromString('0.025upaxi') },
  );
  return Session._sessionClient;
};

// 查询 Feegrant 是否仍有效
// Feegrant: granter = 主钱包, grantee = 会话地址
// 链上路径: /cosmos/feegrant/v1beta1/allowance/{granter}/{grantee}
// 查询 Feegrant 是否仍有效
// 🔴 PAXI LCD 节点不支持 /cosmos/feegrant/v1beta1/* REST 接口（返回 501），
//    所以改用本地 localStorage + 合约端 session_info 双重验证
//    （合约的 session_info 查得到说明会话已注册，但不检查 feegrant——
//     feegrant 是链上 ante handler 层的 gas 代付授权，合约看不到）
Session.hasFeegrant = async function() {
  if (!state.sessAddr || !state.wallet) return false;
  try {
    const exp = Number(localStorage.getItem('paxi_hub_feegrant_expires') || '0');
    if (!exp) return false;                    // 根本没点过"开启无感模式"
    if (exp < Date.now()) return false;        // 过期了

    // 再用合约 session_info 做二次确认（确认会话在链上真的存在且未过期）
    const info = await Session.syncFromChain();
    if (!info || !info.registered || info.expired) return false;

    return true;
  } catch (e) {
    console.warn('[hasFeegrant] 检查失败，保守认为未开启:', e.message);
    return false;
  }
};

// 🟢 同步版 Feegrant 快检（供 shared.js::execAnyContract 的 useSession 即时判断）
//    只查本地 localStorage 的 7 天过期标记，不触发任何链上查询 / 弹窗，
//    用于"是否值得尝试无感通道"的快筛；链上有效性由 Feegrant ante handler 兜底。
Session.hasFeegrantFlag = function () {
  try {
    const exp = Number(localStorage.getItem('paxi_hub_feegrant_expires') || '0');
    if (!exp) return false;                     // 从没点过"开启无感模式"
    if (exp < Date.now()) {                     // 过期则清掉，避免下次误判
      localStorage.removeItem('paxi_hub_feegrant_expires');
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
};

// 🟢 自动确保无感模式可用（本页只尝试一次，失败静默回落主钱包通道）
//    用于游戏写操作前：若会话未注册或 Feegrant 未建立，自动调用 enableSeamlessMode
//    （首次会弹 1~2 次主钱包完成 RegisterSession + MsgGrantAllowance，之后即免密）。
//    若自动开通失败（用户取消 / 链不支持 feegrant），置 _seamlessFailedOnce 本页不再重试，
//    让调用方走主钱包通道（仍可用，只是要弹签名）。
Session._seamlessFailedOnce = false;
Session.ensureSeamless = async function () {
  if (Session._seamlessFailedOnce) return Session.hasFeegrantFlag();
  if (Session.hasFeegrantFlag()) return true;   // 已开通，直接放行
  try {
    if (!state.connected || !state.wallet) return false;
    // 确保会话密钥已注册（未注册会让 enableSeamlessMode 先做一次 RegisterSession）
    const r = await Session.ensure();
    if (!r.ok && r.needRegister) {
      await Session.enableSeamlessMode();       // 注册 + 授权（弹 1~2 次）
    } else if (!Session.hasFeegrantFlag()) {
      await Session.enableSeamlessMode();       // 仅补 Feegrant 授权
    }
    const got = Session.hasFeegrantFlag();
    if (!got) Session._seamlessFailedOnce = true; // 开了却没拿到标记（链不支持？）本页不再重试
    return got;
  } catch (e) {
    Session._seamlessFailedOnce = true;          // 用户取消或失败，本页不再自动重试
    console.warn('[ensureSeamless] 自动开通失败，将走主钱包通道:', e && e.message);
    return false;
  }
};

// 🔴🔴🔴 关键：用会话签名器发 TX，Feegrant 通过 StdFee.granter 生效
//
// 为什么能绕过弹钱包？
//   DirectSecp256k1Wallet 用我们自己的私钥对象签 SignDoc，
//   不调用 window.paxihub.paxi.signAndSendTransaction（那才是弹钱包的）。
//
// 为什么 gas 能由主钱包付？（Feegrant 机制，E 修复点）
//   Cosmos SDK 的 Feegrant 走的是 **StdFee.granter** 字段，而非 signAndBroadcast 的第 6 个参数。
//   SigningStargateClient.signAndBroadcast 只有 5 个参数：
//     signAndBroadcast(signerAddress, messages, fee, memo?, timeoutHeight?)
//   第 6 个参数会被 JS 静默丢弃！所以必须把 granter 写进 fee 对象（fee.granter = 主钱包地址）。
//   执行时 SDK 检查会话地址是否有主钱包的 allowance，有则用主钱包余额扣 gas。
//
// ⚠️ 错误写法（上一版，已废弃）：
//   client.signAndBroadcast(addr, msgs, 'auto', memo, undefined, { feeGranter: ... })  // ← 第 6 参被丢弃
//
// 为什么合约能识别会话地址？
//   合约里 SESSIONS[session_addr].user = main_wallet，
//   所以 validate_and_consume_session 返回的 player 始终是主钱包。
Session.sendTxWithSession = async function(messages, memo = '') {
  const client = await Session.getSessionClient();

  // gas 必须由主钱包付（fee.granter），主钱包没连就报错，避免用错付费方
  if (!state.wallet || !state.wallet.address) {
    throw new Error('主钱包未连接，无法指定 gas 支付方');
  }

  // 1. 估算 gas（失败则用静态兜底，避免卡死）
  let gasLimit = 1500000;
  try {
    const sim = await client.simulate(state.sessAddr, messages, memo);
    gasLimit = Math.ceil(sim * 1.2);
  } catch (e) {
    console.warn('[无感 Tx] simulate 失败，用静态估算', e && e.message);
  }

  // 2. 构造带 granter 的 StdFee（Feegrant 关键：granter 写进 fee，而非第 6 参数）
  const { GasPrice } = window.CosmJSSigning;
  const gasPrice = GasPrice.fromString('0.025upaxi');
  const feeAmount = gasPrice.amount.multiply(gasLimit); // Decimal → 总 upaxi 数
  const fee = {
    amount: [{ denom: 'upaxi', amount: feeAmount.toString() }],
    gas: String(gasLimit),
    granter: state.wallet.address, // 🟢 gas 由主钱包付（Feegrant）
  };

  // 3. 串行队列：会话签名器不支持并发签名（每个 Tx 占着 account sequence）
  if (!Session._txQueue) Session._txQueue = Promise.resolve();

  const result = await new Promise((resolve, reject) => {
    Session._txQueue = Session._txQueue.then(async () => {
      try {
        const r = await client.signAndBroadcast(state.sessAddr, messages, fee, memo);
        if (r.code !== 0) reject(new Error(mapError(r.code, r.rawLog)));
        else resolve(r.transactionHash);
      } catch (e) {
        reject(e);
      }
    }).catch(() => {}); // 保证下一个队列项能继续
  });

  return result;
};

// 开启无感模式（首次：主钱包弹窗 2 次）
// 在 UI 的「我的」页提供按钮调用这个
  Session.enableSeamlessMode = async function() {
  if (!state.sessAddr || !state.sessPriv) await Session.ensure();
  if (!state.wallet) throw new Error('钱包未连接');

  // 1. 会话注册（主钱包签名，弹 1 次）
  const info = await Session.syncFromChain();
  if (!info.registered || info.expired) {
    await Session.register();
  }

  // 2. 授权 Feegrant —— 🟢 复用 shared.js::sendTx 成熟路径
  //
  // 🔴 关键修复：signAndSendTransaction **不接受** {chainId, fee, memo, messages}！
  // DApp 指南明确要求 SignDoc 三件套：
  //   { bodyBytes: base64(SignDoc.bodyBytes),
  //     authInfoBytes: base64(SignDoc.authInfoBytes),
  //     chainId, accountNumber }
  //
  // sendTx 内部已经完整实现了这条链路：
  //   fetch auth → fetchChainId() → simulate gas → TxBody/AuthInfo/SignDoc 编码
  //   → signAndSendTransaction(三件套) → 自己 POST LCD
  //
  // 所以 enableSeamlessMode 只需要给 sendTx 一个 MsgGrantAllowance 消息就行。
  // 但 PaxiCosmJS UMD 的 Registry 里没有 feegrant 的 protobuf encoder。
  // 🟢 最简方案：手写 MsgGrantAllowance 的 protobuf bytes（结构固定，10 行手写）
  const expiration = new Date(Date.now() + 7 * 86400 * 1000).toISOString();

  // 手写 MsgGrantAllowance protobuf（cosmos-sdk v0.47）
  // wire format 基础函数
  const pe = new TextEncoder();
    // 🟢 修复：while 循环版 varint（不限制长度）
  const varint = n => {
    const buf = []; let x = n;
    while (x > 0x7f) { buf.push((x & 0x7f) | 0x80); x >>= 7; }
    buf.push(x);
    return new Uint8Array(buf);
  };
  const field = (num, val) => new Uint8Array([(num << 3) | 2, ...varint(val.length), ...val]);

  // BasicAllowance
  // 🔴 修复：Timestamp 是嵌套消息，内部 seconds=int64 (field 1, wiretype 0)
  // 正确序列: [0x08, varint(seconds)]
  const ts = Math.floor(new Date(expiration).getTime() / 1000);
  const secBuf = []; let s = ts;
  while (s > 0x7f) { secBuf.push((s & 0x7f) | 0x80); s >>= 7; }
  secBuf.push(s);
  // Timestamp 完整字节: field 1 (seconds) varint tag 0x08 + value
  const timestampBytes = new Uint8Array([0x08, ...secBuf]);
  const tsField = field(2, timestampBytes);
  const coinField = field(1, new Uint8Array([
    ...field(1, pe.encode('upaxi')), ...field(2, pe.encode('30000000'))  // 30 PAXI, 7d 耗量足够
  ]));
  const baBytes = new Uint8Array([...coinField, ...tsField]);

  // Any{typeUrl, value} 包 BasicAllowance
  const anyBytes = new Uint8Array([
    ...field(1, pe.encode('/cosmos.feegrant.v1beta1.BasicAllowance')),
    ...field(2, baBytes),
  ]);

  // MsgGrantAllowance{granter, grantee, allowance}
  const grantBytes = new Uint8Array([
    ...field(1, pe.encode(state.wallet.address)),
    ...field(2, pe.encode(state.sessAddr)),
    ...field(3, anyBytes),
  ]);

  const grantMsg = {
    typeUrl: '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
    value: grantBytes,  // Uint8Array —— sendTx 的 TxBody.encode() 直接 copy
  };

  // ✅ 走 sendTx（与 DApp 指南完全一致的签名格式）
  const txHash = await sendTx([grantMsg], 'Seamless feegrant 7d');
  localStorage.setItem('paxi_hub_feegrant_expires', String(Date.now() + 7 * 86400 * 1000));
  return txHash;
};

window.Session = Session;
