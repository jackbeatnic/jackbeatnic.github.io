/**
 * OpenSea deep links — Buy / Make offer (blueprint phase 3)
 * Offer: ?makeOffer=true on the asset page (OpenSea UI pattern)
 */
const OpenSeaLinks = (() => {
    function normalizeAssetUrl(url) {
        if (!url) return '';
        if (/xrp\.cafe/i.test(url) || /manifold\.xyz/i.test(url)) return url;
        return url.replace('/item/', '/assets/');
    }

    /** NFT page — Buy / listing button */
    function buyUrl(openseaUrl) {
        return normalizeAssetUrl(openseaUrl);
    }

    /** Opens the offer modal on OpenSea */
    function offerUrl(openseaUrl) {
        const base = normalizeAssetUrl(openseaUrl);
        if (!base) return '';
        const sep = base.includes('?') ? '&' : '?';
        return `${base}${sep}makeOffer=true`;
    }

    function chainFromUrl(url) {
        const m = url?.match(/opensea\.io\/(?:assets|item)\/([^/]+)\//);
        return m ? m[1] : null;
    }

    return { buyUrl, offerUrl, chainFromUrl };
})();