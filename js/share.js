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
    // Promo board JPG (jbg-present/promo) fetched for the mobile share sheet.
    const boardCache = new Map();

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
        // Arena caches a link preview by the exact URL. This query forces a
        // fresh read so the card-image redirect is what gets stored.
        return `${siteUrl}nft/${col}/${tid}.html?v=20261004card`;
    }

    function withCardVersion(url) {
        const value = String(url || '');
        if (!/\/nft\/[^/?#]+\/\d+\.html(?:$|\?)/.test(value)) return value;
        if (value.includes('v=20261004card')) return value;
        return value + (value.includes('?') ? '&' : '?') + 'v=20261004card';
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
            return withCardVersion(nft.share_url);
        }
        if (!needsDeep && landing && nft?.collection_id) return landing;

        if (
            nft?.share_url &&
            String(nft.share_url).includes('/nft/') &&
            !/\/nft\/\d+\.html$/.test(String(nft.share_url))
        ) {
            return withCardVersion(nft.share_url);
        }

        const params = new URLSearchParams();
        params.set('work', String(nft.token_id));
        if (nft.collection_id) params.set('collection', String(nft.collection_id));
        if (medium === 'photography') {
            params.set('section', 'photography');
            const kind = nft.photo_kind || 'photo';
            if (kind !== 'photo') params.set('photo', kind);
            const photoChain = String(nft.chain || '').toLowerCase();
            if (photoChain === 'xrpl' || photoChain === 'avalanche') {
                params.set('pchain', photoChain);
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
        avalanche_jb_photography: 'JB Photography',
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

        // Same square JPG the phone share sheet attaches. On any screen this
        // puts it on the clipboard so a post can be built by hand.
        if (promoBoardRef(nft)) {
            items.push({ id: 'copy-graphic', label: 'Copy graphic', action: 'copy-graphic' });
        }

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

        const board = promoSquareUrl(nft);
        const pinMedia = board || nft?.image_url;
        if (pinMedia) {
            items.push({
                id: 'pinterest',
                label: 'Pinterest',
                href: `https://pinterest.com/pin/create/button/?url=${enc(url)}&media=${enc(pinMedia)}&description=${enc(text)}`,
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
        if (action === 'copy-graphic') {
            handleCopyGraphic(btn);
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

    /** Square promo JPG → PNG on the clipboard. The blob promise is handed
        to the clipboard immediately so the click still counts as the gesture. */
    async function copyGraphicFile(nft) {
        if (!promoBoardRef(nft) || !navigator.clipboard || typeof ClipboardItem === 'undefined') {
            return false;
        }
        const pngPromise = boardFile(nft).then(async (file) => {
            if (!file) throw new Error('no board');
            const bitmap = await createImageBitmap(file);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            bitmap.close?.();
            const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!png) throw new Error('no png');
            return png;
        });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
        return true;
    }

    async function handleCopyGraphic(btn) {
        const original = btn.textContent;
        let ok = false;
        try {
            ok = await copyGraphicFile(activeNft);
        } catch {
            ok = false;
        }
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
        boardFile(nft);
        grid.innerHTML = channels(nft, activeUrl, activeText)
            .map((item) => {
                if (item.action) {
                    return `<button type="button" class="share-popover__btn" data-share-action="${item.action}">${item.label}</button>`;
                }
                return `<a class="share-popover__btn" href="${item.href}" target="_blank" rel="noopener noreferrer" data-share-channel="${item.id}">${item.label}</a>`;
            })
            .join('');
    }

    // Promo boards live on the jbg-present Pages site (same origin as the
    // gallery): /jbg-present/promo/<collection_id>/<NNNN>.jpg, NNNN = ON-CHAIN
    // token id (NJ vol2 / AI Play gallery token_id is 10000+n / 700000000+n).
    const BOARD_COLLECTIONS = new Set([
        'avalanche_flower_stories',
        'avalanche_nature_jam',
        'avalanche_nature_jam_vol2',
        'avalanche_nature_stories',
        'base_flower_stories_vol3',
        'base_jb_based_ai',
        'base_jb_based_ai_vol2',
        'base_nature_stories_vol3',
        'polygon_flower_stories_vol2',
        'polygon_jb_ai_play',
        'polygon_nature_stories_vol2',
        'avalanche_jb_photography',
    ]);

    // Salvor photography listings use another collection id; the boards on
    // GitHub are avalanche_jb_photography/<on-chain token>.jpg.
    const PHOTO_BOARD = 'avalanche_jb_photography';
    const PHOTO_CONTRACT = '0xf3e01890467d204ff7cc0cdebb69f11e7f55f92c';

    function boardFolder(nft) {
        const cid = String(nft?.collection_id || '').trim().toLowerCase().replace(/-/g, '_');
        const contract = String(nft?.contract_address || '').trim().toLowerCase();
        if (
            cid === PHOTO_BOARD
            || cid.startsWith('salvor_photo_')
            || contract === PHOTO_CONTRACT
            || nft?.source === 'salvor'
        ) {
            return PHOTO_BOARD;
        }
        return cid;
    }

    function promoBoardRef(nft) {
        const cid = boardFolder(nft);
        if (!BOARD_COLLECTIONS.has(cid)) return null;
        const raw = nft?.onchain_token_id ?? nft?.token_id;
        const n = Number.parseInt(String(raw ?? ''), 10);
        if (!Number.isFinite(n) || n < 0) return null;
        const id = String(n).padStart(4, '0');
        return {
            url: `${siteUrl}jbg-present/promo/${cid}/${id}.jpg`,
            name: `jack-beatnic-${cid.replace(/_/g, '-')}-${id}.jpg`,
        };
    }

    function promoSquareUrl(nft) {
        return promoBoardRef(nft)?.url || '';
    }

    /** Phone / tablet — desktop keeps the menu (X intent with text + URL). */
    function isMobileDevice() {
        if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
            if (navigator.userAgentData.mobile) return true;
        }
        const ua = navigator.userAgent || '';
        if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
        // iPadOS reports "Macintosh" — tell it apart by touch.
        if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
        return false;
    }

    function canShareFiles() {
        if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
            return false;
        }
        try {
            const probe = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'probe.jpg', { type: 'image/jpeg' });
            return navigator.canShare({ files: [probe] });
        } catch {
            return false;
        }
    }

    function wantsFileShare(nft) {
        return isMobileDevice() && canShareFiles() && !!promoBoardRef(nft);
    }

    /** Promise<File|null> — cached per board, started early (pointerdown). */
    function boardFile(nft) {
        const ref = promoBoardRef(nft);
        if (!ref) return Promise.resolve(null);
        if (!boardCache.has(ref.url)) {
            const job = fetch(ref.url, { mode: 'cors', credentials: 'omit' })
                .then(async (res) => {
                    const type = res.headers.get('content-type') || '';
                    if (!res.ok || !type.startsWith('image/')) return null;
                    const blob = await res.blob();
                    if (!blob.size) return null;
                    return new File([blob], ref.name, { type: 'image/jpeg' });
                })
                .catch(() => null)
                .then((file) => {
                    if (!file) boardCache.delete(ref.url); // retry later
                    return file;
                });
            boardCache.set(ref.url, job);
        }
        return boardCache.get(ref.url);
    }

    function prefetchBoard(nft) {
        if (wantsFileShare(nft)) boardFile(nft);
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((resolve) => window.setTimeout(() => resolve(null), ms)),
        ]);
    }

    /**
     * Mobile: share the real promo-board JPG + text + landing URL, so the X /
     * Telegram apps post the image itself. Returns 'shared' | 'aborted' |
     * 'blocked' (lost user activation — retry from the menu) | 'none'.
     */
    async function shareBoardFile(nft, url, text) {
        if (!wantsFileShare(nft)) return 'none';
        const file = await withTimeout(boardFile(nft), 6000);
        if (!file) return 'none';
        // File only, same as dropping the JPEG from disk. A separate page URL
        // makes Arena build a link card and crop the square. The address stays
        // in the caption.
        const data = { files: [file], text: shareCopy(nft, url) };
        let ok = false;
        try {
            ok = navigator.canShare(data) || navigator.canShare({ files: [file] });
        } catch {
            ok = false;
        }
        if (!ok) return 'none';
        try {
            await navigator.share(data);
            return 'shared';
        } catch (err) {
            if (err?.name === 'AbortError') return 'aborted';
            if (err?.name === 'NotAllowedError') return 'blocked';
            return 'none';
        }
    }

    async function nativeShare(nft, url, text) {
        if (!canNativeShare()) {
            openMenu(nft, anchor);
            return;
        }
        const viaFile = await shareBoardFile(nft, url, shareText(nft));
        if (viaFile === 'shared' || viaFile === 'aborted') {
            close();
            return;
        }
        try {
            await navigator.share({ title: artworkTitle(nft), text: shareText(nft), url });
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

        // Phone/tablet with file sharing + a promo board → real JPG to the app.
        const viaFile = await shareBoardFile(nft, url, text);
        if (viaFile === 'shared' || viaFile === 'aborted') return;
        if (viaFile === 'blocked') {
            // Board was ready but the tap "expired" — the menu's Share… button
            // (a fresh tap) shares the cached JPG instantly.
            openMenu(nft, button);
            return;
        }

        // Mobile without a board / file support: link share sheet (as before).
        if (isMobileDevice() && canNativeShare()) {
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

        // Desktop (and fallback): menu with X intent (text + URL), Telegram, copy…
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
        // Start fetching the promo board before the click lands, so
        // navigator.share() still runs inside the user's tap.
        const warm = () => prefetchBoard(nft);
        button.addEventListener('pointerdown', warm, { passive: true });
        button.addEventListener('touchstart', warm, { passive: true });
        button.addEventListener('focus', warm);
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            open(nft, button);
        });
    }

    return { init, open, close, workUrl, bindButton, promoBoardUrl: promoSquareUrl };
})();