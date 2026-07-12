/**
 * Tip the artist — modal overlay, EVM + BTC + Solana wallets
 */
const TipCreator = (() => {
    let evmWallet = '';
    let btcWallet = '';
    let solWallet = '';
    let modal;
    let openButtons = [];

    function qrUrl(value) {
        return `https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=8&data=${encodeURIComponent(value)}`;
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

    function setupWallet(blockId, qrId, addrId, copyId, wallet, qrAlt, copyLabel) {
        const block = document.getElementById(blockId);
        const qr = document.getElementById(qrId);
        const addr = document.getElementById(addrId);
        const copyBtn = document.getElementById(copyId);

        if (!wallet || !block) {
            if (block) block.hidden = true;
            return;
        }

        block.hidden = false;
        if (qr) {
            qr.src = qrUrl(wallet);
            qr.alt = qrAlt;
        }
        if (addr) {
            addr.textContent = wallet;
            addr.title = wallet;
        }
        bindCopy(copyBtn, wallet, copyLabel);
    }

    function renderCopyPills(container, names) {
        if (!container || !Array.isArray(names) || names.length === 0) {
            if (container) container.hidden = true;
            return;
        }

        container.innerHTML = names
            .map((name) => {
                const safe = String(name).replace(/[<>"']/g, '');
                return `<button type="button" class="wallet-names__pill tip-copy-pill" data-copy="${safe}" title="Copy ${safe}">${safe}</button>`;
            })
            .join('');

        container.hidden = false;
        container.querySelectorAll('[data-copy]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const value = btn.getAttribute('data-copy') || '';
                const original = btn.textContent;
                try {
                    await navigator.clipboard.writeText(value);
                    btn.textContent = 'Copied';
                } catch {
                    btn.textContent = 'Copy failed';
                }
                window.setTimeout(() => {
                    btn.textContent = original;
                }, 1400);
            });
        });
    }

    function init(config = {}) {
        evmWallet = config.evm_wallet || config.wallet || '';
        btcWallet = config.btc_wallet || '';
        solWallet = config.solana_wallet || config.sol_wallet || '';
        modal = document.getElementById('tip-modal');
        if (!modal || !evmWallet) return;

        const evmQr = document.getElementById('tip-qr-evm');
        const evmAddr = document.getElementById('tip-address-evm');

        if (evmQr) {
            evmQr.src = qrUrl(evmWallet);
            evmQr.alt = 'QR code for EVM wallet';
        }
        if (evmAddr) {
            evmAddr.textContent = evmWallet;
            evmAddr.title = evmWallet;
        }

        setupWallet(
            'tip-btc-block',
            'tip-qr-btc',
            'tip-address-btc',
            'tip-copy-btc',
            btcWallet,
            'QR code for Bitcoin wallet',
            'BTC address',
        );
        setupWallet(
            'tip-sol-block',
            'tip-qr-sol',
            'tip-address-sol',
            'tip-copy-sol',
            solWallet,
            'QR code for Solana wallet',
            'Solana address',
        );

        bindCopy(document.getElementById('tip-copy-evm'), evmWallet, 'EVM address');

        const evmDomains = document.getElementById('tip-evm-domains');
        renderCopyPills(evmDomains, config.evm_domains);

        const tezLine = document.getElementById('tip-tez-line');
        const tezPills = document.getElementById('tip-tez-domains');
        if (Array.isArray(config.tezos_domains) && config.tezos_domains.length > 0 && tezLine && tezPills) {
            renderCopyPills(tezPills, config.tezos_domains);
            tezLine.hidden = false;
        } else if (tezLine) {
            tezLine.hidden = true;
        }

        document.querySelectorAll('[data-tip-open]').forEach(registerOpener);

        modal.querySelector('.tip-modal__backdrop')?.addEventListener('click', hide);
        modal.querySelector('.tip-modal__close')?.addEventListener('click', hide);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && !modal.hidden) hide();
        });
    }

    return { init, open, hide, shortAddress };
})();