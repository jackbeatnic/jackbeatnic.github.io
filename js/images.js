/**
 * Warstwa obrazów — miniatury przez proxy, bez bezpośredniego IPFS w <img src>.
 *
 * Tryby (ustaw IMAGE_PROXY w gallery.js):
 *   'weserv'     — darmowy proxy + resize (MVP, bez konta Cloudflare)
 *   'cloudflare' — Twój Worker (cloudflare/image-proxy-worker.js)
 *   'direct'     — tylko dev / awaryjnie (pełny IPFS w źródle strony)
 */
const ImageProxy = (() => {
    const THUMB_WIDTH = 880;
    const THUMB_HEIGHT = 704;
    const VIEW_MAX_WIDTH = 1200;
    const VIEW_MAX_HEIGHT = 1200;
    const WEBP_QUALITY = 82;

    const PRESENT_BASE = 'https://jackbeatnic.github.io/jbg-present';
    // Only collections we actually built in jbg-present. Others stay on
    // the old sized-proxy path (XRPL jsDelivr, Tezos/Sui via weserv).
    const PRESENT_COLLECTIONS = new Set([
        'avalanche_nature_stories',
        'sui_nature_stories_tradeport',
        'sui_nature_stories_1of1_tradeport',
    ]);

    /** Po wdrożeniu Workera: https://img.twoja-domena.com */
    const CLOUDFLARE_WORKER_BASE = '';

    function extractCid(url) {
        if (!url || typeof url !== 'string') return '';
        const m = url.match(
            /(?:ipfs\/|ipfs:\/\/)(baf[a-z0-9]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44,})/i,
        );
        return m ? m[1] : '';
    }

    const IPFS_GATEWAYS = ['https://gateway.pinata.cloud/ipfs/'];

    function isIpfsOrGateway(url) {
        if (!url || typeof url !== 'string') return false;
        if (/^ipfs:\/\//i.test(url)) return true;
        return /ipfs\.io|gateway\.pinata|cloudflare-ipfs|dweb\.link|w3s\.link|nftstorage\.link|arweave/i.test(
            url,
        );
    }

    function siteOrigin() {
        // weserv needs a public absolute URL — use live origin or production fallback
        if (typeof window !== 'undefined' && window.location?.origin) {
            const o = window.location.origin;
            if (o && !o.startsWith('file:')) return o.replace(/\/$/, '');
        }
        return 'https://jackbeatnic.github.io';
    }

    function shouldProxy(url) {
        // Heavy / hotlink-protected / self-hosted full assets → always resize via proxy
        return (
            isIpfsOrGateway(url) ||
            /seadn\.io/i.test(url) ||
            /cdn\.xrp\.cafe|xrp\.cafe\//i.test(url) ||
            /\/assets\/xrpl\//i.test(url) ||
            /jackbeatnic\.github\.io\/assets\/xrpl\//i.test(url)
        );
    }

    function weservUrl(originalUrl, w, h, fit = 'inside') {
        const encoded = encodeURIComponent(originalUrl);
        let url = `https://images.weserv.nl/?url=${encoded}`;
        if (w) url += `&w=${w}`;
        if (h) url += `&h=${h}`;
        return `${url}&fit=${fit}&output=webp&q=${WEBP_QUALITY}&n=-1`;
    }

    function cloudflareUrl(originalUrl, w, h, fit = 'inside') {
        const base = CLOUDFLARE_WORKER_BASE.replace(/\/$/, '');
        if (!base) return weservUrl(originalUrl, w, h, fit);
        const params = new URLSearchParams({
            url: originalUrl,
            w: String(w),
            h: String(h),
            fit,
        });
        return `${base}?${params.toString()}`;
    }

    /**
     * URL do atrybutu src — miniatura, nie oryginał.
     * W HTML nigdy nie wstawiaj nft.image_url bezpośrednio.
     */
    /** ipfs.io often 403s; weserv then shows a blank thumb. Pinata still serves our CIDs. */
    function preferWorkingIpfsGateway(url) {
        if (!url) return url;
        const cid = extractCid(url);
        if (!cid) return url;
        // ipfs.io 403s in the browser; pinata is our first hop.
        if (/ipfs\.io|cloudflare-ipfs/i.test(url) || /^ipfs:\/\//i.test(url)) {
            return `${IPFS_GATEWAYS[0]}${cid}`;
        }
        return url;
    }

    function objktSizedUrl(nft, kind) {
        const kt = String(nft?.contract_address || '');
        const tid = nft?.tezos_token_id;
        if (!kt.startsWith('KT1') || tid == null || tid === '') return '';
        // Last-resort OBJKT cache only — too soft as a primary (esp. mobile).
        return `https://assets.objkt.media/file/assets-003/${kt}/${tid}/thumb400`;
    }

    function presentUrl(nft, kind) {
        const col = nft?.collection_id;
        const tid = nft?.token_id;
        if (!col || tid == null || tid === '') return '';
        if (!PRESENT_COLLECTIONS.has(String(col))) return '';
        const file = kind === 'view' ? `${tid}.view.webp` : `${tid}.thumb.webp`;
        return `${PRESENT_BASE}/${col}/${file}`;
    }

    function sizedProxyUrls(originalUrl, w, h, fit = 'inside') {
        const resolved = resolveOriginalUrl(originalUrl);
        if (!resolved) return [];
        if (!shouldProxy(resolved)) return [resolved];
        const primary = weservUrl(resolved, w, h, fit);
        const alt = primary.replace('https://images.weserv.nl/', 'https://wsrv.nl/');
        return primary === alt ? [primary] : [primary, alt];
    }

    function displayCandidates(
        originalUrl,
        mode = 'weserv',
        w = THUMB_WIDTH,
        h = THUMB_HEIGHT,
        fit = 'inside',
        nft = null,
        kind = 'thumb',
    ) {
        const out = [];
        const local = presentUrl(nft, kind);
        if (local) out.push(local);
        // Tezos Photo/Other: sharp weserv from the full CID first (the old look).
        // Tiny OBJKT thumbs only if the proxy fails.
        sizedProxyUrls(originalUrl, w, h, fit).forEach((u) => {
            if (u && !out.includes(u)) out.push(u);
        });
        const objkt = objktSizedUrl(nft, kind);
        if (objkt) out.push(objkt);
        return out;
    }

    function viewCandidates(originalUrl, mode = 'weserv', nft = null) {
        return displayCandidates(
            originalUrl,
            mode,
            VIEW_MAX_WIDTH,
            VIEW_MAX_HEIGHT,
            'inside',
            nft,
            'view',
        );
    }

    function bindFallback(img, candidates) {
        if (!img) return;
        const list = (candidates || []).filter(Boolean);
        if (!list.length) return;
        let i = 0;
        img.src = list[0];
        img.addEventListener('error', () => {
            i += 1;
            if (i < list.length) img.src = list[i];
        });
    }

    function resolveOriginalUrl(originalUrl) {
        if (!originalUrl || typeof originalUrl !== 'string') return '';
        const u = originalUrl.trim();
        if (/^ipfs:\/\//i.test(u)) {
            const cid = u.replace(/^ipfs:\/\//i, '').replace(/\/$/, '');
            return cid ? preferWorkingIpfsGateway(`ipfs://${cid}`) : '';
        }
        if (/^https?:\/\//i.test(u)) return preferWorkingIpfsGateway(u);
        // Relative site paths (e.g. assets/xrpl/123.webp) → absolute for weserv
        const path = u.replace(/^\.\//, '').replace(/^\//, '');
        return `${siteOrigin()}/${path}`;
    }

    function displayUrl(
        originalUrl,
        mode = 'weserv',
        w = THUMB_WIDTH,
        h = THUMB_HEIGHT,
        fit = 'inside',
    ) {
        const resolved = resolveOriginalUrl(originalUrl);
        if (!resolved) return '';
        if (!shouldProxy(resolved)) return resolved;
        return sizedProxyUrls(originalUrl, w, h, fit)[0] || '';
    }

    /**
     * URL do lightboxa (View) — zawsze przez proxy, fit=inside (pomniejsza, nie ścina).
     */
    function viewUrl(originalUrl, mode = 'weserv') {
        return displayUrl(
            originalUrl,
            mode,
            VIEW_MAX_WIDTH,
            VIEW_MAX_HEIGHT,
            'inside',
        );
    }

    return {
        displayUrl,
        viewUrl,
        displayCandidates,
        viewCandidates,
        sizedProxyUrls,
        resolveOriginalUrl,
        bindFallback,
        presentUrl,
        THUMB_WIDTH,
        THUMB_HEIGHT,
        VIEW_MAX_WIDTH,
        VIEW_MAX_HEIGHT,
        isIpfsOrGateway,
    };
})();