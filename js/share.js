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

    function slugifyCollectionId(raw) {
        return String(raw || '')
            .trim()
            .toLowerCase()
            .replace(/['"]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'collection';
    }

    function collectionId(nft) {
        if (nft?.collection_id) return slugifyCollectionId(nft.collection_id);
        const medium = (nft?.medium || 'work').toString();
        const chain = (nft?.chain || 'x').toString();
        return slugifyCollectionId(`${medium}_${chain}`);
    }

    /**
     * Canonical share landing — namespaced by collection_id so NS/NJ/Sui
     * token_id 1,2,3… never collide (old flat nft/3.html was ambiguous).
     */
    function shareLandingUrl(nft) {
        if (!nft || nft.token_id == null) return siteUrl;
        const col = encodeURIComponent(collectionId(nft));
        const tid = encodeURIComponent(String(nft.token_id));
        return `${siteUrl}nft/${col}/${tid}.html`;
    }

    function workUrl(nft) {
        // Prefer namespaced landing (fresh OG) for gallery works.
        // Shop often has no nft/{col}/{id}.html yet — deep link.
        // Featured promo is a clone of a gallery token: same landing (crawlers
        // read OG there; the page JS still opens ?section=featured).
        const landing = shareLandingUrl(nft);
        const medium = nft?.medium || 'ai_art';
        const needsDeep = medium === 'shop' || !nft?.collection_id;

        if (
            !needsDeep &&
            nft?.share_url &&
            String(nft.share_url).includes(`/nft/${collectionId(nft)}/`)
        ) {
            return nft.share_url;
        }
        if (!needsDeep && landing && nft?.collection_id) return landing;

        if (
            nft?.share_url &&
            String(nft.share_url).includes('/nft/') &&
            !/\/nft\/\d+\.html$/.test(String(nft.share_url))
        ) {
            return nft.share_url;
        }

        const params = new URLSearchParams();
        params.set('work', String(nft.token_id));
        if (nft.collection_id) params.set('collection', String(nft.collection_id));
        if (medium === 'photography') {
            params.set('section', 'photography');
            const kind = nft.photo_kind || 'photo';
            if (kind !== 'photo') params.set('photo', kind);
            if (String(nft.chain || '').toLowerCase() === 'xrpl') {
                params.set('pchain', 'xrpl');
            }
        } else if (medium === 'xrpl_ai') {
            params.set('section', 'ai_art');
            params.set('ai', 'xrpl');
        } else if (medium === 'sui_ai') {
            params.set('section', 'ai_art');
            params.set('ai', 'sui');
        } else if (medium === 'ai_art') {
            params.set('section', 'ai_art');
            params.set('ai', 'evm');
            const series = nft.ai_series;
            const defSeries = 'nature_stories';
            if (series && series !== defSeries) params.set('series', series);
            const edition = String(nft.edition_label || nft.chain || '').toLowerCase();
            if (edition && ['avalanche', 'polygon', 'base'].includes(edition)) {
                params.set('edition', edition);
            }
        } else if (medium === 'manifold_auction') {
            params.set('section', 'atelier');
            params.set('market', 'auctions');
            const chain = nft.chain_key || nft.chain || 'base';
            if (chain !== 'base') params.set('chain', chain);
        } else if (medium === 'manifold_edition') {
            params.set('section', 'atelier');
            params.set('market', 'editions');
            const chain = nft.chain_key || nft.chain || 'base';
            if (chain !== 'base') params.set('chain', chain);
        } else if (medium === 'shop') {
            params.set('section', 'shop');
        } else if (medium === 'featured_promo') {
            params.set('section', 'featured');
        } else if (medium === 'objkt_auction') {
            params.set('section', 'photography');
        } else if (medium !== 'ai_art') {
            params.set('section', medium);
        }

        return `${siteUrl}?${params}`;
    }

    const COLLECTION_LABELS = {
        avalanche_nature_stories: 'Nature Stories',
        base_nature_stories_vol3: 'Nature Stories',
        polygon_nature_stories_vol2: 'Nature Stories',
        avalanche_flower_stories: 'Flower Stories',
        base_flower_stories_vol3: 'Flower Stories',
        polygon_flower_stories_vol2: 'Flower Stories',
        avalanche_nature_jam: 'Nature Jam',
        avalanche_nature_jam_vol2: 'Nature Jam vol. 2',
        base_jb_based_ai: 'JB Based AI',
        base_jb_based_ai_vol2: 'JB Based AI vol. 2',
        polygon_jb_ai_play: 'JB AI Play',
        base_jb_ai_play: 'JB AI Play',
        sui_nature_stories_tradeport: 'Nature Stories SE',
        sui_nature_stories_1of1_tradeport: 'Nature Stories SE 1/1',
        xrpl_jb_ai_nature: 'JB AI Nature',
        xrpl_jbn: 'JB AI Nature',
        objkt_jack_beatnic_open_editions: 'Open Editions',
        "objkt_jack's_nature": "Jack's Nature",
        objkt_jacks_nature: "Jack's Nature",
    };

    const CHAIN_LABELS = {
        avalanche: 'Avalanche',
        base: 'Base',
        polygon: 'Polygon',
        ethereum: 'Ethereum',
        sui: 'Sui',
        xrpl: 'XRPL',
        tezos: 'Tezos',
    };

    function artworkTitle(nft) {
        const n = String(nft?.name || '').trim();
        if (n && n !== 'Artwork' && n !== `#${nft?.token_id}`) return n;
        if (nft?.token_id != null && nft.token_id !== '') {
            const cid = String(nft.collection_id || '');
            const prefix = /flower/i.test(cid) ? 'FS' : 'NS';
            return `${prefix} #${nft.token_id}`;
        }
        return 'Artwork';
    }

    function collectionLabel(nft) {
        const fromNft = String(nft?.collection_name || '').trim();
        if (fromNft && !/^[a-z0-9_]+$/i.test(fromNft)) return fromNft;
        const cid = String(nft?.collection_id || '').trim();
        if (COLLECTION_LABELS[cid]) return COLLECTION_LABELS[cid];
        if (cid.includes('nature_stories')) return 'Nature Stories';
        if (cid.includes('flower_stories')) return 'Flower Stories';
        if (cid.includes('nature_jam')) return 'Nature Jam';
        if (cid.includes('based_ai')) return 'JB Based AI';
        if (cid.includes('ai_play')) return 'JB AI Play';
        if (fromNft) return fromNft.replace(/_/g, ' ');
        if (cid) return cid.replace(/_/g, ' ').replace(/-/g, ' ');
        return '';
    }

    function editionLabel(nft) {
        const ed = String(nft?.edition_label || '').trim();
        if (ed && !['all', 'evm'].includes(ed.toLowerCase())) {
            return ed.charAt(0).toUpperCase() + ed.slice(1);
        }
        const chain = String(nft?.chain || '').toLowerCase();
        return CHAIN_LABELS[chain] || '';
    }

    /** Caption for intents: artwork + collection (no URL). */
    function shareText(nft) {
        const title = artworkTitle(nft);
        const col = collectionLabel(nft);
        const ed = editionLabel(nft);
        const line2 = [col, ed].filter(Boolean).join(' · ');
        const lines = [title];
        if (line2 && !title.toLowerCase().includes(line2.toLowerCase())) {
            lines.push(line2);
        }
        lines.push('Jack Beatnic Gallery');
        return lines.join('\n');
    }

    /** Clipboard / WhatsApp / email: caption + live link. */
    function shareCopy(nft, url) {
        const caption = shareText(nft);
        const link = url || workUrl(nft);
        if (!link) return caption;
        if (caption.includes(link)) return caption;
        return `${caption}\n${link}`;
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
        const copyPayload = shareCopy(nft, url);
        const items = [
            { id: 'copy', label: 'Copy link', action: 'copy' },
        ];

        if (canNativeShare()) {
            items.push({ id: 'native', label: 'Share…', action: 'native' });
        }

        const cafeUrl =
            nft?.xrp_cafe_url ||
            nft?.marketplace_url ||
            (nft?.xrpl_nft_id ? `https://bidds.com/nft/${nft.xrpl_nft_id}` : '');
        if (nft?.medium === 'xrpl_ai' && cafeUrl) {
            items.push({
                id: 'xrp-cafe',
                label: 'Bidds',
                href: cafeUrl,
            });
        }

        const manifoldUrl = nft?.manifold_url || nft?.marketplace_url;
        if (nft?.medium === 'manifold_auction' && manifoldUrl) {
            items.push({
                id: 'manifold',
                label: 'Manifold',
                href: manifoldUrl,
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
                href: `https://wa.me/?text=${enc(copyPayload)}`,
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
            href: `mailto:?subject=${enc(artworkTitle(nft))}&body=${enc(copyPayload)}`,
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
        const ok = await copyToClipboard(
            shareCopy(activeNft, activeUrl) || activeUrl,
        );
        btn.textContent = ok ? 'Copied' : 'Copy failed';
        window.setTimeout(() => {
            btn.textContent = original;
        }, 1600);
    }

    function renderPopover(nft) {
        activeUrl = workUrl(nft);
        activeText = shareText(nft);

        const workEl = popover.querySelector('.share-popover__work');
        const col = collectionLabel(nft);
        workEl.textContent = col
            ? `${artworkTitle(nft)} · ${col}`
            : artworkTitle(nft);
        grid.innerHTML = channels(nft, activeUrl, activeText)
            .map((item) => {
                if (item.action) {
                    return `<button type="button" class="share-popover__btn" data-share-action="${item.action}">${item.label}</button>`;
                }
                return `<a class="share-popover__btn" href="${item.href}" target="_blank" rel="noopener noreferrer" data-share-channel="${item.id}">${item.label}</a>`;
            })
            .join('');
    }

    // Promo square for every chain. The shared URL stays the landing,
    // so OG (Telegram and others) is unchanged.
    function promoSquareUrl(nft) {
        const cid = collectionId(nft);
        const tid = nft?.token_id;
        if (!cid || tid == null) return '';
        const n = String(tid).padStart(4, '0');
        return `${siteUrl}jbg-present/promo/${encodeURIComponent(cid)}/${n}.jpg`;
    }

    async function nativeShare(nft, url, text) {
        if (!canNativeShare()) {
            openMenu(nft, anchor);
            return;
        }
        try {
            const payload = {
                title: artworkTitle(nft),
                text: shareText(nft),
                url,
            };
            const board = promoSquareUrl(nft);
            if (board && navigator.canShare) {
                try {
                    const res = await fetch(board);
                    if (res.ok) {
                        const blob = await res.blob();
                        const file = new File([blob], 'promo.jpg', {
                            type: blob.type || 'image/jpeg',
                        });
                        if (navigator.canShare({ files: [file] })) {
                            payload.files = [file];
                        }
                    }
                } catch {
                    /* board not public yet — link share still works */
                }
            }
            await navigator.share(payload);
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
                await navigator.share({
                    title: artworkTitle(nft),
                    text,
                    url,
                });
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