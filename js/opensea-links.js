/**
 * OpenSea deep links — Buy / Make offer (blueprint Faza 3)
 * Offer: ?makeOffer=true na stronie assetu (wzorzec OpenSea UI)
 */
const OpenSeaLinks = (() => {
    function normalizeAssetUrl(url) {
        if (!url) return '';
        if (/xrp\.cafe/i.test(url)) return url;
        return url.replace('/item/', '/assets/');
    }

    /** Strona NFT — przycisk Buy / listing */
    function buyUrl(openseaUrl) {
        return normalizeAssetUrl(openseaUrl);
    }

    /** Otwiera modal oferty na OpenSea */
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