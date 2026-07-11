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
    const THUMB_HEIGHT = 330;
    const WEBP_QUALITY = 82;

    /** Po wdrożeniu Workera: https://img.twoja-domena.com */
    const CLOUDFLARE_WORKER_BASE = '';

    function isIpfsOrGateway(url) {
        if (!url || typeof url !== 'string') return false;
        return /ipfs\.io|gateway\.pinata|cloudflare-ipfs|dweb\.link|arweave/i.test(url);
    }

    function weservUrl(originalUrl, w, h) {
        const encoded = encodeURIComponent(originalUrl);
        return (
            `https://images.weserv.nl/?url=${encoded}` +
            `&w=${w}&h=${h}&fit=cover&output=webp&q=${WEBP_QUALITY}&n=-1`
        );
    }

    function cloudflareUrl(originalUrl, w, h) {
        const base = CLOUDFLARE_WORKER_BASE.replace(/\/$/, '');
        if (!base) return weservUrl(originalUrl, w, h);
        const params = new URLSearchParams({
            url: originalUrl,
            w: String(w),
            h: String(h),
        });
        return `${base}?${params.toString()}`;
    }

    /**
     * URL do atrybutu src — miniatura, nie oryginał.
     * W HTML nigdy nie wstawiaj nft.image_url bezpośrednio.
     */
    function displayUrl(originalUrl, mode = 'weserv', w = THUMB_WIDTH, h = THUMB_HEIGHT) {
        if (!originalUrl) return '';
        if (!isIpfsOrGateway(originalUrl)) return originalUrl;

        switch (mode) {
            case 'cloudflare':
                return cloudflareUrl(originalUrl, w, h);
            case 'direct':
                return originalUrl;
            case 'weserv':
            default:
                return weservUrl(originalUrl, w, h);
        }
    }

    return {
        displayUrl,
        THUMB_WIDTH,
        THUMB_HEIGHT,
        isIpfsOrGateway,
    };
})();