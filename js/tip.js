/**
 * Tip the artist — modal overlay, EVM + BTC wallets
 */
const TipCreator = (() => {
    let evmWallet = '';
    let btcWallet = '';
    let modal;
    let openButtons = [];

    function qrUrl(value) {
        return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=10&data=${encodeURIComponent(value)}`;
    }

    function shortAddress(addr) {
        if (!addr || addr.length < 12) return addr || '';
        return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    }

    function bindCopy(btn, value, label) {
        if (!btn || !value) return;
        btn.addEventListener('click', async () => {
            const original = btn.textContent;
            try {
                await navigator.clipboard.writeText(value);
                btn.textContent = 'Copied';
            } catch {
                btn.textContent = 'Copy failed';
            }
            window.setTimeout(() => {
                btn.textContent = original;
            }, 1600);
        });
        btn.title = `Copy ${label}`;
    }

    function show() {
        if (!modal) return;
        modal.hidden = false;
        document.body.classList.add('tip-open');
        openButtons.forEach((btn) => btn.setAttribute('aria-expanded', 'true'));
        modal.querySelector('.tip-modal__close')?.focus();
    }

    function hide() {
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove('tip-open');
        openButtons.forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
    }

    function open() {
        show();
    }

    function registerOpener(btn) {
        if (!btn || openButtons.includes(btn)) return;
        openButtons.push(btn);
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.setAttribute('aria-controls', 'tip-modal');
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            modal?.hidden ? show() : hide();
        });
    }

    function init(config = {}) {
        evmWallet = config.evm_wallet || config.wallet || '';
        btcWallet = config.btc_wallet || '';
        modal = document.getElementById('tip-modal');
        if (!modal || !evmWallet) return;

        const evmQr = document.getElementById('tip-qr-evm');
        const btcQr = document.getElementById('tip-qr-btc');
        const evmAddr = document.getElementById('tip-address-evm');
        const btcAddr = document.getElementById('tip-address-btc');
        const btcBlock = document.getElementById('tip-btc-block');

        if (evmQr) {
            evmQr.src = qrUrl(evmWallet);
            evmQr.alt = 'QR code for EVM wallet';
        }
        if (evmAddr) {
            evmAddr.textContent = evmWallet;
            evmAddr.title = evmWallet;
        }

        if (btcWallet && btcBlock) {
            btcBlock.hidden = false;
            if (btcQr) {
                btcQr.src = qrUrl(btcWallet);
                btcQr.alt = 'QR code for Bitcoin wallet';
            }
            if (btcAddr) {
                btcAddr.textContent = btcWallet;
                btcAddr.title = btcWallet;
            }
        } else if (btcBlock) {
            btcBlock.hidden = true;
        }

        bindCopy(document.getElementById('tip-copy-evm'), evmWallet, 'EVM address');
        bindCopy(document.getElementById('tip-copy-btc'), btcWallet, 'BTC address');

        document.querySelectorAll('[data-tip-open]').forEach(registerOpener);

        modal.querySelector('.tip-modal__backdrop')?.addEventListener('click', hide);
        modal.querySelector('.tip-modal__close')?.addEventListener('click', hide);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && !modal.hidden) hide();
        });
    }

    return { init, open, hide, shortAddress };
})();