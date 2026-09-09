export function getPaxiHub() {
    if (typeof window.paxihub !== 'undefined' && window.paxihub.paxi) {
        return window.paxihub.paxi;
    }
    return null;
}
