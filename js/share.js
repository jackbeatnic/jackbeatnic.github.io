/**
 * Per-work sharing — copy link + social intents (no third-party widgets).
 */
const GalleryShare = (() => {
    let siteUrl = 'https://jackbeatnic.github.io/';
    let popover = null;
    let anchor = null;
    let activeNft = null;

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
        } else if (medium !== 'ai_art') {
            params.set('section', medium);
        }

        return `${siteUrl}?${params}`;
    }

    function shareText(nft) {
        return `${nft.name || 'Artwork'} — Jack Beatnic Gallery`;
    }

    function channels(nft, url, text) {
        const items = [
            {
                id: 'copy',
                label: 'Copy link',
                action: 'copy',
            },
        ];

        if (typeof navigator.share === 'function') {
            items.push({
                id: 'native',
                label: 'Share…',
                action: 'native',
            });
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

        popover.addEventListener('click', (e) => e.stopPropagation());
    }

    function renderPopover(nft) {
        const url = workUrl(nft);
        const text = shareText(nft);
        const grid = popover.querySelector('.share-popover__grid');
        const workEl = popover.querySelector('.share-popover__work');

        workEl.textContent = nft.name || 'Artwork';
        grid.innerHTML = channels(nft, url, text)
            .map((item) => {
                if (item.action === 'copy') {
                    return `<button type="button" class="share-popover__btn" data-share-action="copy">Copy link</button>`;
                }
                if (item.action === 'native') {
                    return `<button type="button" class="share-popover__btn" data-share-action="native">Share…</button>`;
                }
                return `<a class="share-popover__btn" href="${item.href}" target="_blank" rel="noopener noreferrer" data-share-channel="${item.id}">${item.label}</a>`;
            })
            .join('');

        grid.querySelector('[data-share-action="copy"]')?.addEventListener('click', () => copyLink(url));
        grid.querySelector('[data-share-action="native"]')?.addEventListener('click', () => nativeShare(nft, url, text));
    }

    async function copyLink(url) {
        const btn = popover.querySelector('[data-share-action="copy"]');
        const original = btn?.textContent || 'Copy link';
        try {
            await navigator.clipboard.writeText(url);
            if (btn) btn.textContent = 'Copied';
        } catch {
            if (btn) btn.textContent = 'Copy failed';
        }
        window.setTimeout(() => {
            if (btn) btn.textContent = original;
        }, 1600);
    }

    async function nativeShare(nft, url, text) {
        if (typeof navigator.share !== 'function') return;
        try {
            await navigator.share({
                title: shareText(nft),
                text,
                url,
            });
            close();
        } catch (err) {
            if (err?.name !== 'AbortError') console.warn('Share failed', err);
        }
    }

    function positionPopover() {
        if (!anchor || !popover) return;

        popover.hidden = false;
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

    function open(nft, button) {
        if (!popover || !nft) return;

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

        const onOutside = (e) => {
            if (popover.contains(e.target) || e.target === button || button.contains(e.target)) return;
            close();
            document.removeEventListener('click', onOutside, true);
        };
        window.requestAnimationFrame(() => {
            document.addEventListener('click', onOutside, true);
        });
    }

    function close() {
        if (!popover) return;
        popover.hidden = true;
        anchor?.setAttribute('aria-expanded', 'false');
        anchor = null;
        activeNft = null;
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