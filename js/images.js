/**
 * Warstwa obrazów — miniatury przez proxy, bez bezpośredniego IPFS w <img src>.
 *
 * Tryby (ustaw IMAGE_PROXY w gallery.js):
 *   'weserv'     — darmowy proxy + resize (MVP, bez konta Cloudflare)
 *   'cloudflare' — Twój Worker (cloudflare/image-proxy-worker.js)
 *   'direct'     — tylko dev / awaryjnie (pełny IPFS w źródle strony)
 */
const ImageProxy = (() => {
    const THUMB_WIDTH = 440;
    const THUMB_HEIGHT = 352;
    const VIEW_MAX_WIDTH = 1200;
    const VIEW_MAX_HEIGHT = 1600;
    const WEBP_QUALITY = 82;

    /** Po wdrożeniu Workera: https://img.twoja-domena.com */
    const CLOUDFLARE_WORKER_BASE = '';

    function extractCid(url) {
        if (!url || typeof url !== 'string') return '';
        const m = url.match(
            /(?:ipfs\/|ipfs:\/\/)(bafy[a-z0-9]+|Qm[1-9A-HJ-NP-Za-km-z]{44,})/i,
        );
        return m ? m[1] : '';
    }

    const IPFS_GATEWAYS = [
        'https://gateway.pinata.cloud/ipfs/',
        'https://w3s.link/ipfs/',
        'https://dweb.link/ipfs/',
        'https://nftstorage.link/ipfs/',
    ];

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

    function originalCandidates(originalUrl) {
        const resolved = resolveOriginalUrl(originalUrl);
        const cid = extractCid(originalUrl) || extractCid(resolved);
        const out = [];
        const add = (u) => {
            if (u && !out.includes(u)) out.push(u);
        };
        if (cid) {
            // Pinata public gateway 429s when the grid hammers it.
            // Keep it, but after other public gateways.
            add(`https://dweb.link/ipfs/${cid}`);
            add(`https://w3s.link/ipfs/${cid}`);
            add(`https://nftstorage.link/ipfs/${cid}`);
            add(`https://gateway.pinata.cloud/ipfs/${cid}`);
        }
        add(resolved);
        return out;
    }

    function proxiedCandidates(originalUrl, w, h, fit = 'inside') {
        const origs = originalCandidates(originalUrl);
        const out = [];
        const add = (u) => {
            if (u && !out.includes(u)) out.push(u);
        };
        const pinata = origs.filter((u) => /pinata/i.test(u));
        const others = origs.filter((u) => !/pinata/i.test(u));
        // Weserv 404s with "429" when Pinata rate-limits the proxy.
        // Try a non-Pinata origin first so thumbs can populate from cache.
        others.slice(0, 2).forEach((u) => add(weservUrl(u, w, h, fit)));
        pinata.slice(0, 1).forEach((u) => add(weservUrl(u, w, h, fit)));
        others.forEach(add);
        pinata.forEach(add);
        return out;
    }

    function displayCandidates(
        originalUrl,
        mode = 'weserv',
        w = THUMB_WIDTH,
        h = THUMB_HEIGHT,
        fit = 'inside',
    ) {
        if (mode === 'direct') return originalCandidates(originalUrl);
        return proxiedCandidates(originalUrl, w, h, fit);
    }

    function viewCandidates(originalUrl, mode = 'weserv') {
        return displayCandidates(
            originalUrl,
            mode,
            VIEW_MAX_WIDTH,
            VIEW_MAX_HEIGHT,
            'inside',
        );
    }

    const MAX_IN_FLIGHT = 6;
    let inFlight = 0;
    const waiters = [];

    function acquireSlot() {
        if (inFlight < MAX_IN_FLIGHT) {
            inFlight += 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => waiters.push(resolve));
    }

    function releaseSlot() {
        const next = waiters.shift();
        if (next) next();
        else inFlight = Math.max(0, inFlight - 1);
    }

    function bindFallback(img, candidates) {
        if (!img) return;
        const list = (candidates || []).filter(Boolean);
        if (!list.length) return;
        let i = 0;
        let held = false;

        const take = () => {
            if (held) return Promise.resolve();
            return acquireSlot().then(() => {
                held = true;
            });
        };
        const drop = () => {
            if (!held) return;
            held = false;
            releaseSlot();
        };

        const trySrc = () => {
            take().then(() => {
                img.src = list[i];
            });
        };

        img.addEventListener('load', drop);
        img.addEventListener('error', () => {
            i += 1;
            if (i < list.length) {
                window.setTimeout(trySrc, 90 * i);
            } else {
                drop();
            }
        });
        trySrc();
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
        if (mode === 'direct') return resolved;
        if (!shouldProxy(resolved)) return resolved;
        return displayCandidates(originalUrl, mode, w, h, fit)[0] || resolved;
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
        originalCandidates,
        resolveOriginalUrl,
        bindFallback,
        THUMB_WIDTH,
        THUMB_HEIGHT,
        VIEW_MAX_WIDTH,
        VIEW_MAX_HEIGHT,
        isIpfsOrGateway,
    };
})();