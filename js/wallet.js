/**
 * The Atelier — wallet connect & collector access (Blueprint Faza 5).
 * No personal data: address only, checked on-chain via viem.
 * Multi-wallet: atelier_wallets in gallery.json (photo / ai).
 */
const AtelierWallet = (() => {
    let wallets = {};
    let collectorAccess = {};
    let connected = null;
    let holderSnapshot = null;

    function init(collectionInfo = {}) {
        wallets = collectionInfo.atelier_wallets || collectionInfo.studio_market_wallets || {};
        collectorAccess = collectionInfo.collector_access || {};
    }

    function accessConfig() {
        return collectorAccess;
    }

    function listWallets() {
        return Object.entries(wallets).map(([id, cfg]) => ({ id, ...cfg }));
    }

    function tiers() {
        return collectorAccess.tiers || [];
    }

    function activeWalletId() {
        return connected?.walletId || null;
    }

    function address() {
        return connected?.address || null;
    }

    function isConnected() {
        return Boolean(connected?.address);
    }

    function connectEnabled() {
        return collectorAccess.enabled === true;
    }

    function connectLabel() {
        return collectorAccess.connect_label || 'Connect wallet';
    }

    /**
     * Phase 5: window.ethereum + viem — read NFT balance across creator contracts.
     * @returns {{ total: number, byWallet: Record<string, number>, tier: object|null }}
     */
    async function scanHoldings(addr) {
        if (!addr) return { total: 0, byWallet: {}, tier: null };
        // Phase 5: viem multicall balanceOf across atelier_wallets contracts
        throw new Error('Holder scan — Phase 5 (viem)');
    }

    async function connect() {
        if (!connectEnabled()) {
            throw new Error(collectorAccess.note || 'Wallet connect — coming soon');
        }
        // Phase 5: eth_requestAccounts + scanHoldings
        throw new Error('Wallet connect — Phase 5 (viem)');
    }

    function disconnect() {
        connected = null;
        holderSnapshot = null;
        document.dispatchEvent(new CustomEvent('atelier:wallet'));
    }

    function resolveTier(totalHeld) {
        const sorted = [...tiers()].sort(
            (a, b) => (b.min_nfts || 0) - (a.min_nfts || 0),
        );
        return sorted.find((tier) => totalHeld >= (tier.min_nfts || 0)) || null;
    }

    function holderState() {
        return holderSnapshot;
    }

    function hasCollectorAccess() {
        return Boolean(holderSnapshot?.tier);
    }

    return {
        init,
        accessConfig,
        listWallets,
        tiers,
        activeWalletId,
        address,
        isConnected,
        connectEnabled,
        connectLabel,
        scanHoldings,
        connect,
        disconnect,
        resolveTier,
        holderState,
        hasCollectorAccess,
    };
})();

/** @deprecated */
const StudioWallet = AtelierWallet;