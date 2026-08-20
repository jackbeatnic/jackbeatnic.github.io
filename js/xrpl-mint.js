/**
 * XRPL lazy mint — payment sheet. No private key in the browser.
 * Kasa on the VPS watches Destination Tag = catalog number.
 */
const XrplMint = (() => {
    let modal;
    let current = null;
    let info = null;

    function collection() {
        return info || {};
    }

    function isLive() {
        return collection().mint_live === true;
    }

    function issuer(nft) {
        return collection().issuer_wallet || nft?.contract_address || '';
    }

    function priceXrp(nft) {
        const n =
            nft?.current_price_xrp ??
            nft?.price_xrp ??
            collection().price_xrp_default ??
            0.25;
        const v = Number(n);
        return Number.isFinite(v) && v > 0 ? v : 0.25;
    }

    function tag(nft) {
        return String(nft?.token_id ?? '');
    }

    function supply(nft) {
        const n = Number(nft?.supply ?? collection().supply_ref ?? 3000);
        return Number.isFinite(n) && n > 0 ? n : 3000;
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

    function fill(nft) {
        current = nft;
        const live = isLive();
        const name = nft.name || `JBN #${nft.token_id} X`;
        const amt = String(priceXrp(nft));
        const addr = issuer(nft);
        const dt = tag(nft);
        const max = supply(nft);

        const banner = modal.querySelector('#xrpl-mint-banner');
        const lead = modal.querySelector('#xrpl-mint-lead');
        const nameEl = modal.querySelector('#xrpl-mint-name');
        const metaEl = modal.querySelector('#xrpl-mint-meta');
        const amountEl = modal.querySelector('#xrpl-mint-amount');
        const addrEl = modal.querySelector('#xrpl-mint-address');
        const tagEl = modal.querySelector('#xrpl-mint-tag');
        const fulfillEl = modal.querySelector('#xrpl-mint-fulfill');

        if (nameEl) nameEl.textContent = name;
        if (metaEl) {
            metaEl.textContent = `Up to ${max} copies of this image · destination tag = ${dt}`;
        }
        if (amountEl) amountEl.textContent = `${amt} XRP`;
        if (addrEl) addrEl.textContent = addr || '—';
        if (tagEl) tagEl.textContent = dt || '—';

        if (banner) {
            banner.hidden = false;
            banner.classList.toggle('shop-modal__banner--ok', live);
            banner.textContent = live
                ? 'The destination tag is required. Without it the studio cannot mint this image to you.'
                : 'Automatic mint is not switched on yet. Do not send XRP.';
        }
        if (lead) {
            lead.textContent = live
                ? '1) Send exactly this amount from your XRPL wallet.  2) Wait a minute.  3) Accept the 0 XRP offer — that delivers your NFT.'
                : 'When mint is live you will send XRP to the address below with this destination tag.';
        }
        if (fulfillEl) {
            fulfillEl.textContent = live
                ? 'The NFT is created after payment. It does not exist before.'
                : 'Mint on demand will create the NFT after payment.';
        }
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
    }

    async function ensureInfo() {
        if (info) return info;
        try {
            const res = await fetch('xrp_gallery.json');
            if (res.ok) {
                const data = await res.json();
                info = data.collection_info || {};
            } else {
                info = {};
            }
        } catch {
            info = {};
        }
        return info;
    }

    async function open(nft) {
        if (!nft || !modal) return;
        await ensureInfo();
        fill(nft);
        show();
    }

    function init() {
        modal = document.getElementById('xrpl-mint-modal');
        if (!modal) return;
        modal.querySelector('.shop-modal__close')?.addEventListener('click', hide);
        modal.querySelector('.shop-modal__backdrop')?.addEventListener('click', hide);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.hidden) hide();
        });
        modal.querySelector('#xrpl-copy-amount')?.addEventListener('click', () => {
            if (current) copy(modal.querySelector('#xrpl-copy-amount'), String(priceXrp(current)));
        });
        modal.querySelector('#xrpl-copy-address')?.addEventListener('click', () => {
            copy(modal.querySelector('#xrpl-copy-address'), issuer(current || {}));
        });
        modal.querySelector('#xrpl-copy-tag')?.addEventListener('click', () => {
            copy(modal.querySelector('#xrpl-copy-tag'), tag(current || {}));
        });
        ensureInfo();
    }

    return { init, open, hide };
})();
