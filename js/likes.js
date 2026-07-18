/**
 * Likes & Save for later — LocalStorage (blueprint Faza 4).
 * Globalne likes_count w gallery.json aktualizuje aktualizuj_pozycje_z_likes.py (cron).
 */
const GalleryLikes = (() => {
    const STORAGE_LIKES = 'jb_gallery_likes_v1';
    const STORAGE_SAVED = 'jb_gallery_saved_v1';

    let likes = new Set();
    let saved = new Set();
    let showSavedOnly = false;

    function loadSet(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return new Set();
            const arr = JSON.parse(raw);
            return new Set(Array.isArray(arr) ? arr : []);
        } catch {
            return new Set();
        }
    }

    function persistSet(key, set) {
        localStorage.setItem(key, JSON.stringify([...set]));
    }

    function nftKey(nft) {
        const chain = nft.chain || '';
        const contract = (nft.contract_address || '').toLowerCase();
        const token = String(nft.token_id ?? '');
        if (chain && contract) return `${chain}:${contract}:${token}`;
        return `${nft.collection_id || 'nft'}:${token}`;
    }

    function init() {
        likes = loadSet(STORAGE_LIKES);
        saved = loadSet(STORAGE_SAVED);
    }

    function dispatch() {
        document.dispatchEvent(new CustomEvent('gallery:likes'));
    }

    function toggleLike(key) {
        if (likes.has(key)) likes.delete(key);
        else likes.add(key);
        persistSet(STORAGE_LIKES, likes);
        // Full grid refresh only when a list filter depends on this state.
        // Card buttons update themselves via local sync — avoid layout jumps.
        if (showSavedOnly) dispatch();
        else {
            document.dispatchEvent(
                new CustomEvent('gallery:engage', { detail: { key, kind: 'like' } }),
            );
        }
    }

    function toggleSaved(key) {
        if (saved.has(key)) saved.delete(key);
        else saved.add(key);
        persistSet(STORAGE_SAVED, saved);
        if (showSavedOnly) dispatch();
        else {
            document.dispatchEvent(
                new CustomEvent('gallery:engage', { detail: { key, kind: 'saved' } }),
            );
        }
    }

    function isLiked(key) {
        return likes.has(key);
    }

    function isSaved(key) {
        return saved.has(key);
    }

    function setSavedOnly(on) {
        showSavedOnly = Boolean(on);
        dispatch();
    }

    function getSavedOnly() {
        return showSavedOnly;
    }

    function filterSaved(nfts) {
        if (!showSavedOnly) return nfts;
        return nfts.filter((nft) => saved.has(nftKey(nft)));
    }

    /** Kolejność z gallery.json (likes_count + display_rank z dziennego skryptu). */
    function sortForDisplay(nfts) {
        return [...nfts].sort((a, b) => {
            const rankA = a.display_rank ?? 999999;
            const rankB = b.display_rank ?? 999999;
            if (rankA !== rankB) return rankA - rankB;
            const likesA = a.likes_count ?? 0;
            const likesB = b.likes_count ?? 0;
            if (likesB !== likesA) return likesB - likesA;
            return Number(a.token_id) - Number(b.token_id);
        });
    }

    function exportSnapshot() {
        return {
            exported_at: new Date().toISOString(),
            local_likes: [...likes],
            local_saved: [...saved],
        };
    }

    init();

    return {
        nftKey,
        toggleLike,
        toggleSaved,
        isLiked,
        isSaved,
        setSavedOnly,
        getSavedOnly,
        filterSaved,
        sortForDisplay,
        exportSnapshot,
    };
})();