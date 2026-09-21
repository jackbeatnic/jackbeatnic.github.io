/**
 * SUI studio-signed lazy mint. No private key in the browser.
 * Live: PTB buy(art_id) on shared Vault. Kasa mints Copy S+1…2S.
 * Checkout is the in-page shop modal (same as XRPL) — never window.confirm/alert.
 */
const SuiMint = (() => {
    let modal;
    let current = null;
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

    function txUrl(digest) {
        return `https://suiscan.xyz/mainnet/tx/${encodeURIComponent(digest)}`;
    }

    function copy(btn, value) {
        if (!btn || value == null || value === '') return;
        const original = btn.textContent;
        navigator.clipboard
            .writeText(String(value))
            .then(() => {
                btn.textContent = 'Copied';
            })
            .catch(() => {
                btn.textContent = 'Copy failed';
            })
            .finally(() => {
                window.setTimeout(() => {
                    btn.textContent = original;
                }, 1600);
            });
    }

    function setStatus(text, kind) {
        const el = modal?.querySelector('#sui-mint-status');
        if (!el) return;
        el.replaceChildren();
        if (!text) {
            el.hidden = true;
            el.removeAttribute('data-kind');
            return;
        }
        el.hidden = false;
        el.dataset.kind = kind || '';
        el.appendChild(document.createTextNode(text));
    }

    function setStatusPaid(digest) {
        const el = modal?.querySelector('#sui-mint-status');
        if (!el) return;
        el.hidden = false;
        el.dataset.kind = 'ok';
        el.replaceChildren();
        el.appendChild(
            document.createTextNode(
                'Thank you. The studio is sending your piece — usually within a minute. ',
            ),
        );
        if (digest) {
            const a = document.createElement('a');
            a.href = txUrl(digest);
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = 'View transaction';
            el.appendChild(a);
        }
    }

    function setBusy(busy, label) {
        const btn = modal?.querySelector('#sui-mint-buy');
        if (!btn) return;
        btn.disabled = busy || btn.dataset.paid === '1';
        if (label) btn.textContent = label;
        else if (!busy && btn.dataset.paid !== '1') btn.textContent = 'Buy';
    }

    function fill(nft) {
        current = nft;
        const live = isLive();
        const name = nft?.name || 'NS';
        const sui = priceOf(nft);
        const amt = sui > 0 ? String(sui) : '—';

        const banner = modal.querySelector('#sui-mint-banner');
        const lead = modal.querySelector('#sui-mint-lead');
        const nameEl = modal.querySelector('#sui-mint-name');
        const metaEl = modal.querySelector('#sui-mint-meta');
        const amountEl = modal.querySelector('#sui-mint-amount');
        const fulfillEl = modal.querySelector('#sui-mint-fulfill');
        const buyBtn = modal.querySelector('#sui-mint-buy');

        if (nameEl) nameEl.textContent = name;
        if (metaEl) {
            metaEl.textContent = 'Signed copy from the Studio · Sui';
        }
        if (amountEl) amountEl.textContent = sui > 0 ? `${amt} SUI` : '—';

        if (banner) {
            banner.hidden = false;
            banner.classList.toggle('shop-modal__banner--ok', live);
            banner.textContent = live
                ? 'A signed piece, sent directly by the artist.'
                : 'Automatic mint is not switched on yet. Do not send SUI.';
        }
        if (lead) {
            lead.textContent = live
                ? '1) Check the amount.  2) Buy.  3) Confirm in your Sui wallet.'
                : 'When mint is live you will pay this amount from your Sui wallet.';
        }
        if (fulfillEl) {
            fulfillEl.textContent = live
                ? 'The NFT is created after payment. It does not exist before.'
                : 'Mint on demand will create the NFT after payment.';
        }
        if (buyBtn) {
            buyBtn.hidden = !live || !sui;
            buyBtn.disabled = false;
            buyBtn.dataset.paid = '';
            buyBtn.textContent = 'Buy';
        }
        setStatus('', '');
    }

    function show() {
        if (!modal) return;
        modal.hidden = false;
        document.body.classList.add('shop-open');
        modal.querySelector('.shop-modal__close')?.focus();
    }

    function hide() {
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove('shop-open');
        current = null;
        setBusy(false);
    }

    async function getWallet() {
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
        const wallet = await getWallet();
        const features = wallet.features || {};
        const connect =
            features['standard:connect']?.connect || wallet.connect?.bind(wallet);
        if (connect) await connect();
        const accs = wallet.accounts || [];
        const account =
            (Array.isArray(accs) && accs[0]) || wallet.account || null;
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

    async function handleBuy() {
        if (!current || !modal) return;
        if (!isLive()) {
            setStatus('The Studio mint is not open yet.', 'err');
            return;
        }
        setBusy(true, 'Confirm in wallet…');
        setStatus('Confirm in your Sui wallet. Do not change the amount.', 'pending');
        try {
            const digest = await buy(current);
            const buyBtn = modal.querySelector('#sui-mint-buy');
            if (buyBtn) buyBtn.dataset.paid = '1';
            setBusy(false, 'Paid');
            setStatusPaid(digest);
            const lead = modal.querySelector('#sui-mint-lead');
            if (lead) {
                lead.textContent =
                    'Paid. Wait a minute — the studio sends the NFT to the wallet you paid from.';
            }
        } catch (err) {
            const msg = String(err?.message || err || '');
            if (
                err?.code === 4001 ||
                /reject|cancel|denied/i.test(msg)
            ) {
                setStatus('Cancelled in the wallet.', 'err');
            } else {
                setStatus(msg || 'Wallet payment failed.', 'err');
            }
            setBusy(false, 'Buy');
        }
    }

    async function open(nft) {
        if (!nft || !modal) return;
        await load();
        fill(nft);
        show();
    }

    function init() {
        modal = document.getElementById('sui-mint-modal');
        if (!modal) return;
        modal.querySelector('.shop-modal__close')?.addEventListener('click', hide);
        modal.querySelector('.shop-modal__backdrop')?.addEventListener('click', hide);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.hidden) hide();
        });
        modal.querySelector('#sui-copy-amount')?.addEventListener('click', () => {
            if (current) copy(modal.querySelector('#sui-copy-amount'), String(priceOf(current)));
        });
        modal.querySelector('#sui-mint-buy')?.addEventListener('click', (e) => {
            e.preventDefault();
            handleBuy();
        });
        load();
    }

    return { init, load, isLive, open, hide, priceOf };
})();
