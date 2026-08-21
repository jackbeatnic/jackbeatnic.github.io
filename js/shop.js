/**
 * Studio shop checkout — payment instructions only.
 * No private key. No Seaport. Demo rows must not receive funds.
 */
const ShopCheckout = (() => {
    let modal;
    let current = null;

    function qrUrl(value) {
        return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=8&data=${encodeURIComponent(value)}`;
    }

    function shortAddress(addr) {
        if (!addr || addr.length < 14) return addr || '';
        return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    }

    function amountText(item) {
        const cur = (item.currency || item.listing_currency || '').toUpperCase();
        const price = item.price ?? item.shop_price;
        if (price == null || price === '') return '—';
        return `${price} ${cur || ''}`.trim();
    }

    function copy(btn, value) {
        if (!btn || !value) return;
        const original = btn.textContent;
        navigator.clipboard
            .writeText(value)
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

    function fill(item) {
        current = item;
        const demo = Boolean(item.demo);
        const coming = item.shop_status === 'coming' || item.status === 'coming';
        const name = item.name || item.sku || 'Work';
        const amount = amountText(item);
        const addr = item.pay_address || '';
        const memo = item.memo || item.sku || '';
        const qty = item.qty_available ?? item.promo_quantity;
        const fulfill = item.fulfill || 'stock';

        const title = modal.querySelector('#shop-modal-title');
        const lead = modal.querySelector('#shop-modal-lead');
        const banner = modal.querySelector('#shop-modal-banner');
        const nameEl = modal.querySelector('#shop-modal-name');
        const metaEl = modal.querySelector('#shop-modal-meta');
        const amountEl = modal.querySelector('#shop-modal-amount');
        const addrEl = modal.querySelector('#shop-modal-address');
        const memoEl = modal.querySelector('#shop-modal-memo');
        const qr = modal.querySelector('#shop-modal-qr');
        const fulfillEl = modal.querySelector('#shop-modal-fulfill');

        if (title) title.textContent = demo ? 'Demo checkout' : 'Pay the studio';
        if (nameEl) nameEl.textContent = name;
        if (metaEl) {
            const bits = [
                item.collection_name || item.collection_id || '',
                item.chain || '',
                qty != null ? `${qty} available` : '',
            ].filter(Boolean);
            metaEl.textContent = bits.join(' · ');
        }
        if (amountEl) amountEl.textContent = amount;
        if (addrEl) addrEl.textContent = addr || '—';
        if (memoEl) memoEl.textContent = memo || '—';
        if (fulfillEl) {
            fulfillEl.textContent =
                fulfill === 'mint_on_demand'
                    ? 'Mint on demand — token is created after payment (not before).'
                    : 'From studio stock — an already minted token is transferred after payment.';
        }

        if (banner) {
            if (demo || coming) {
                banner.hidden = false;
                banner.textContent = coming
                    ? 'Coming soon. Do not send funds — mint-on-demand is not live.'
                    : 'Skeleton only. Do not send funds. Nothing will be minted or transferred.';
            } else {
                banner.hidden = false;
                banner.textContent =
                    'Send the exact amount in AVAX to this address. Put the memo in the payment note if your wallet allows it. Fulfillment is from studio stock — not an OpenSea checkout.';
            }
        }

        if (lead) {
            lead.textContent = demo
                ? 'This panel shows how a studio purchase will work. It is not an open sale.'
                : 'Send the amount below from a wallet you control. Use the memo so the order can be matched. This pool is not listed on OpenSea.';
        }

        if (qr) {
            if (addr && !demo && !coming) {
                qr.hidden = false;
                qr.src = qrUrl(addr);
                qr.alt = `QR for ${shortAddress(addr)}`;
            } else {
                qr.removeAttribute('src');
                qr.hidden = true;
                qr.alt = '';
            }
        }

        modal.dataset.demo = demo ? '1' : '0';
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

    function open(item) {
        if (!item || !modal) return;
        fill(item);
        show();
    }

    function init() {
        modal = document.getElementById('shop-modal');
        if (!modal) return;

        modal.querySelector('.shop-modal__close')?.addEventListener('click', hide);
        modal.querySelector('.shop-modal__backdrop')?.addEventListener('click', hide);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.hidden) hide();
        });

        modal.querySelector('#shop-copy-address')?.addEventListener('click', () => {
            copy(modal.querySelector('#shop-copy-address'), current?.pay_address || '');
        });
        modal.querySelector('#shop-copy-memo')?.addEventListener('click', () => {
            copy(modal.querySelector('#shop-copy-memo'), current?.memo || current?.sku || '');
        });
        modal.querySelector('#shop-copy-amount')?.addEventListener('click', () => {
            copy(modal.querySelector('#shop-copy-amount'), amountText(current || {}));
        });
    }

    return { init, open, hide };
})();
