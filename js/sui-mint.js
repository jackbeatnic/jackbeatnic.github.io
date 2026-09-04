/**
 * SUI studio-signed lazy mint. No private key in the browser.
 * Live: PTB buy(art_id) na Vault. SUI_LIVE / mint_live na kasie.
 */
const SuiMint = (() => {
    let cfg = { mint_live: false, package: '', vault: '', studio: '' };

    async function load() {
        try {
            const res = await fetch('data/shop_sui.json', { cache: 'no-cache' });
            if (res.ok) cfg = { ...cfg, ...(await res.json()) };
        } catch {
            /* keep */
        }
        return cfg;
    }

    function isLive() {
        return cfg.mint_live === true && Boolean(cfg.package && cfg.vault);
    }

    function open(nft) {
        const name = nft?.name || 'NS';
        const price = nft?.current_price_sui ?? nft?.price_sui ?? '';
        const id = nft?.token_id;
        if (!isLive()) {
            window.alert(
                `${name}: studio-signed mint is not live yet.\n` +
                    `TradePort still sells the unsigned run.\n` +
                    `Catalog #${id}` +
                    (price !== '' ? ` · ${price} SUI` : ''),
            );
            return;
        }
        window.alert(
            `${name}: connect Slush and send ${price} SUI (art_id=${id}).`,
        );
    }

    return { load, isLive, open };
})();

document.addEventListener('DOMContentLoaded', () => {
    SuiMint.load();
});
