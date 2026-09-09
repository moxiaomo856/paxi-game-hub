import { CONFIG } from '../config.js';

export async function getPaxiHub() {
    if (typeof window.paxihub !== 'undefined') {
        return window.paxihub.paxi;
    } else if (/Mobi/.test(navigator.userAgent)) {
        // 移动端 deep link
        const url = encodeURIComponent(window.location.href);
        window.location.href = `paxi://hub/explorer?url=${url}`;
        setTimeout(() => {
            window.location.href = 'https://paxinet.io/paxi_docs/paxihub#paxihub-application';
        }, 1000);
        return null;
    } else {
        alert('请安装 PaxiHub 浏览器扩展');
        return null;
    }
}
