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

    function isIpfsOrGateway(url) {
        if (!url || typeof url !== 'string') return false;
        if (/^ipfs:\/\//i.test(url)) return true;
        return /ipfs\.io|gateway\.pinata|cloudflare-ipfs|dweb\.link|arweave/i.test(url);
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
    function resolveOriginalUrl(originalUrl) {
        if (!originalUrl || typeof originalUrl !== 'string') return '';
        const u = originalUrl.trim();
        if (/^ipfs:\/\//i.test(u)) {
            const cid = u.replace(/^ipfs:\/\//i, '').replace(/\/$/, '');
            return cid ? `https://ipfs.io/ipfs/${cid}` : '';
        }
        if (/^https?:\/\//i.test(u)) return u;
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

        switch (mode) {
            case 'cloudflare':
                return cloudflareUrl(resolved, w, h, fit);
            case 'weserv':
            default:
                return weservUrl(resolved, w, h, fit);
        }
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
        THUMB_WIDTH,
        THUMB_HEIGHT,
        VIEW_MAX_WIDTH,
        VIEW_MAX_HEIGHT,
        isIpfsOrGateway,
    };
})();