/**
 * Tip the creator — QR portfela (blueprint, zero-PII)
 */
const TipCreator = (() => {
    function qrUrl(wallet) {
        const data = encodeURIComponent(wallet);
        return `https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=8&data=${data}`;
    }

    function shortAddress(addr) {
        if (!addr || addr.length < 12) return addr || '';
        return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    }

    function init(wallet) {
        if (!wallet) return;

        const openBtn = document.getElementById('tip-open');
        const panel = document.getElementById('tip-panel');
        const closeBtn = document.getElementById('tip-close');
        const copyBtn = document.getElementById('tip-copy');
        const addrEl = document.getElementById('tip-address');
        const qrEl = document.getElementById('tip-qr');

        if (!openBtn || !panel) return;

        addrEl.textContent = wallet;
        addrEl.title = wallet;
        qrEl.src = qrUrl(wallet);
        qrEl.alt = 'QR code for creator wallet';

        const show = () => {
            panel.hidden = false;
            openBtn.setAttribute('aria-expanded', 'true');
        };
        const hide = () => {
            panel.hidden = true;
            openBtn.setAttribute('aria-expanded', 'false');
        };

        openBtn.addEventListener('click', () => {
            panel.hidden ? show() : hide();
        });
        closeBtn?.addEventListener('click', hide);

        copyBtn?.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(wallet);
                copyBtn.textContent = 'Copied';
                setTimeout(() => {
                    copyBtn.textContent = 'Copy address';
                }, 1600);
            } catch {
                copyBtn.textContent = 'Copy failed';
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !panel.hidden) hide();
        });
    }

    return { init, shortAddress };
})();