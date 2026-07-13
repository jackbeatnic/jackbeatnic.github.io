/**
 * Per-work sharing — copy link + social intents (no third-party widgets).
 */
const GalleryShare = (() => {
    let siteUrl = 'https://jackbeatnic.github.io/';
    let popover = null;
    let grid = null;
    let anchor = null;
    let activeNft = null;
    let activeUrl = '';
    let activeText = '';
    let outsideHandler = null;

    function enc(value) {
        return encodeURIComponent(value || '');
    }

    function init(opts = {}) {
        const base = (opts.site_url || siteUrl).replace(/\/$/, '');
        siteUrl = `${base}/`;
        ensurePopover();
        document.addEventListener('keydown', onKeydown);
    }

    function workUrl(nft) {
        if (nft?.share_url) return nft.share_url;

        const params = new URLSearchParams();
        params.set('work', String(nft.token_id));
        const medium = nft.medium || 'ai_art';

        if (medium === 'photography') {
            params.set('section', 'photography');
            const kind = nft.photo_kind || 'photo';
            if (kind !== 'photo') params.set('photo', kind);
        } else if (medium === 'xrpl_ai') {
            params.set('section', 'xrpl');
        } else if (medium !== 'ai_art') {
            params.set('section', medium);
        }

        return `${siteUrl}?${params}`;
    }

    function shareText(nft) {
        return `${nft.name || 'Artwork'} — Jack Beatnic Gallery`;
    }

    function canNativeShare() {
        return typeof navigator.share === 'function';
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch {
                /* fall through */
            }
        }

        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        area.setSelectionRange(0, text.length);

        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        area.remove();
        return ok;
    }

    function channels(nft, url, text) {
        const items = [
            { id: 'copy', label: 'Copy link', action: 'copy' },
        ];

        if (canNativeShare()) {
            items.push({ id: 'native', label: 'Share…', action: 'native' });
        }

        items.push(
            {
                id: 'x',
                label: 'X',
                href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`,
            },
            {
                id: 'facebook',
                label: 'Facebook',
                href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
            },
            {
                id: 'linkedin',
                label: 'LinkedIn',
                href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
            },
            {
                id: 'whatsapp',
                label: 'WhatsApp',
                href: `https://wa.me/?text=${enc(`${text} ${url}`)}`,
            },
            {
                id: 'telegram',
                label: 'Telegram',
                href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
            },
            {
                id: 'reddit',
                label: 'Reddit',
                href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}`,
            }
        );

        if (nft?.image_url) {
            items.push({
                id: 'pinterest',
                label: 'Pinterest',
                href: `https://pinterest.com/pin/create/button/?url=${enc(url)}&media=${enc(nft.image_url)}&description=${enc(text)}`,
            });
        }

        items.push({
            id: 'email',
            label: 'Email',
            href: `mailto:?subject=${enc(text)}&body=${enc(`${text}\n\n${url}`)}`,
        });

        return items;
    }

    function ensurePopover() {
        if (popover) return;

        popover = document.createElement('div');
        popover.id = 'share-popover';
        popover.className = 'share-popover';
        popover.hidden = true;
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', 'Share artwork');
        popover.innerHTML = `
            <p class="share-popover__eyebrow">Share</p>
            <p class="share-popover__work"></p>
            <div class="share-popover__grid"></div>
        `;
        document.body.appendChild(popover);

        grid = popover.querySelector('.share-popover__grid');
        grid.addEventListener('click', onGridClick);
    }

    function onGridClick(e) {
        const btn = e.target.closest('[data-share-action]');
        if (!btn || !grid.contains(btn)) return;

        e.preventDefault();
        e.stopPropagation();

        const action = btn.dataset.shareAction;
        if (action === 'copy') {
            handleCopy(btn);
            return;
        }
        if (action === 'native') {
            nativeShare(activeNft, activeUrl, activeText);
        }
    }

    async function handleCopy(btn) {
        const original = btn.textContent;
        const ok = await copyToClipboard(activeUrl);
        btn.textContent = ok ? 'Copied' : 'Copy failed';
        window.setTimeout(() => {
            btn.textContent = original;
        }, 1600);
    }

    function renderPopover(nft) {
        activeUrl = workUrl(nft);
        activeText = shareText(nft);

        const workEl = popover.querySelector('.share-popover__work');
        workEl.textContent = nft.name || 'Artwork';
        grid.innerHTML = channels(nft, activeUrl, activeText)
            .map((item) => {
                if (item.action) {
                    return `<button type="button" class="share-popover__btn" data-share-action="${item.action}">${item.label}</button>`;
                }
                return `<a class="share-popover__btn" href="${item.href}" target="_blank" rel="noopener noreferrer" data-share-channel="${item.id}">${item.label}</a>`;
            })
            .join('');
    }

    async function nativeShare(nft, url, text) {
        if (!canNativeShare()) {
            openMenu(nft, anchor);
            return;
        }
        try {
            await navigator.share({
                title: shareText(nft),
                text,
                url,
            });
            close();
        } catch (err) {
            if (err?.name === 'AbortError') return;
            openMenu(nft, anchor);
        }
    }

    function positionPopover() {
        if (!anchor || !popover) return;

        const rect = anchor.getBoundingClientRect();
        const margin = 8;
        const width = popover.offsetWidth;
        const height = popover.offsetHeight;

        let left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
        let top = rect.bottom + margin;

        if (top + height > window.innerHeight - 12) {
            top = Math.max(12, rect.top - height - margin);
        }

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    }

    function bindOutsideClick() {
        unbindOutsideClick();
        outsideHandler = (e) => {
            if (!popover || popover.hidden) return;
            if (popover.contains(e.target) || e.target === anchor || anchor?.contains(e.target)) return;
            close();
        };
        window.setTimeout(() => {
            document.addEventListener('click', outsideHandler, true);
        }, 0);
    }

    function unbindOutsideClick() {
        if (!outsideHandler) return;
        document.removeEventListener('click', outsideHandler, true);
        outsideHandler = null;
    }

    function openMenu(nft, button) {
        if (!popover || !nft || !button) return;

        if (!popover.hidden && anchor === button) {
            close();
            return;
        }

        activeNft = nft;
        anchor = button;
        renderPopover(nft);
        popover.hidden = false;
        positionPopover();
        button.setAttribute('aria-expanded', 'true');
        bindOutsideClick();
    }

    async function open(nft, button) {
        if (!nft || !button) return;

        const url = workUrl(nft);
        const text = shareText(nft);

        if (canNativeShare()) {
            try {
                await navigator.share({ title: text, text, url });
                return;
            } catch (err) {
                if (err?.name === 'AbortError') return;
            }
        }

        openMenu(nft, button);
    }

    function close() {
        if (!popover) return;
        popover.hidden = true;
        anchor?.setAttribute('aria-expanded', 'false');
        unbindOutsideClick();
        anchor = null;
        activeNft = null;
        activeUrl = '';
        activeText = '';
    }

    function onKeydown(e) {
        if (e.key === 'Escape' && popover && !popover.hidden) close();
    }

    function bindButton(button, nft) {
        if (!button) return;
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', 'share-popover');
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            open(nft, button);
        });
    }

    return { init, open, close, workUrl, bindButton };
})();