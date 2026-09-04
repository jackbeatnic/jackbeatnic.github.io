/**
 * SUI studio-signed lazy mint. No private key in the browser.
 * Live: PTB buy(art_id) on shared Vault. Kasa mints Copy S+1…2S.
 */
const SuiMint = (() => {
    let cfg = { mint_live: false, package: '', vault: '', studio: '' };
    let prices = {};

    async function load() {
        try {
            const res = await fetch('data/shop_sui.json', { cache: 'no-cache' });
            if (res.ok) cfg = { ...cfg, ...(await res.json()) };
        } catch {
            /* keep */
        }
        try {
            const res = await fetch('data/sui_studio_prices.json', { cache: 'no-cache' });
            if (res.ok) prices = await res.json();
        } catch {
            /* keep */
        }
        return cfg;
    }

    function isLive() {
        return cfg.mint_live === true && Boolean(cfg.package && cfg.vault);
    }

    function priceOf(nft) {
        const id = String(nft?.token_id ?? '');
        const raw =
            nft?.current_price_sui ??
            nft?.price_sui ??
            prices[id] ??
            prices[Number(id)] ??
            '';
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function mistOf(sui) {
        return BigInt(Math.round(sui * 1_000_000_000));
    }

    async function getWallet() {
        const std = window.suiStandard || window.wallets;
        if (window.sui?.connect) return window.sui;
        try {
            const { getWallets } = await import(
                'https://esm.sh/@wallet-standard/app@1.1.0'
            );
            const list = getWallets()
                .get()
                .filter((w) =>
                    (w.chains || []).some((c) => String(c).includes('sui')),
                );
            if (list[0]) return list[0];
        } catch {
            /* no standard */
        }
        throw new Error('No Sui wallet. Open this page in Slush / Suiet.');
    }

    async function buy(nft) {
        const art = Number(nft?.token_id);
        const sui = priceOf(nft);
        if (!art || !sui) throw new Error('Missing art id or price');
        const { Transaction } = await import(
            'https://esm.sh/@mysten/sui@1.37.3/transactions'
        );
        const { SuiClient } = await import(
            'https://esm.sh/@mysten/sui@1.37.3/client'
        );
        const client = new SuiClient({
            url: 'https://rpc-mainnet.suiscan.xyz:443',
        });
        const wallet = await getWallet();
        const features = wallet.features || {};
        const connect =
            features['standard:connect']?.connect || wallet.connect?.bind(wallet);
        if (connect) await connect();
        const accs =
            wallet.accounts ||
            features['standard:events'] ||
            [];
        const account =
            (Array.isArray(accs) && accs[0]) ||
            wallet.account ||
            null;
        const sender =
            account?.address ||
            (await (wallet.getAccounts?.() || Promise.resolve([])))[0]?.address;
        if (!sender) throw new Error('Wallet connected but no address');
        const tx = new Transaction();
        const [pay] = tx.splitCoins(tx.gas, [mistOf(sui)]);
        tx.moveCall({
            target: `${cfg.package}::ns::buy`,
            arguments: [tx.object(cfg.vault), tx.pure.u64(art), pay],
        });
        tx.setSender(sender);
        const sign =
            features['sui:signAndExecuteTransaction']?.signAndExecuteTransaction ||
            wallet.signAndExecuteTransaction?.bind(wallet);
        if (!sign) throw new Error('Wallet cannot sign Sui transactions');
        const res = await sign({
            transaction: tx,
            chain: 'sui:mainnet',
            account,
        });
        return res?.digest || res?.effects?.transactionDigest || '';
    }

    async function open(nft) {
        const name = nft?.name || 'NS';
        const id = nft?.token_id;
        const sui = priceOf(nft);
        if (!isLive()) {
            window.alert(
                `${name}: studio-signed mint is not live yet.\nTradePort still sells the unsigned run.`,
            );
            return;
        }
        if (
            !window.confirm(
                `Mint signed ${name} (copy after TradePort cap) for ${sui} SUI?\nCatalog #${id}`,
            )
        ) {
            return;
        }
        try {
            const digest = await buy(nft);
            window.alert(
                digest
                    ? `Payment sent ${digest}\nThe studio mints your signed copy in about a minute.`
                    : 'Payment sent. Wait a minute for the signed NFT.',
            );
        } catch (err) {
            window.alert(err?.message || String(err));
        }
    }

    return { load, isLive, open, priceOf };
})();
