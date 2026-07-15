/**
 * Filtry galerii — kategoria, palety kolorów, vibe, wyszukiwarka (dane z gallery.json)
 */
const GalleryFilters = (() => {
    const activeVibes = new Set();
    const activeColorFamilies = new Set();
    let searchQuery = '';
    let listedOnly = false;
    let lastFilterNfts = [];

    /** Series/chain labels — not artistic mood filters */
    const META_VIBE_TAGS = new Set([
        'ai play',
        'ai art',
        'nature jam',
        'nature stories',
        'flower stories',
        'based ai',
        'polygon',
        'avalanche',
        'base',
        'sui',
        'xrpl',
        'xrp cafe',
        'tradeport',
        'launchpad',
        'experimental',
        'opensea',
        'photography',
        'photo',
    ]);

    function isListedNft(nft) {
        if (nft.medium === 'manifold_auction') {
            return nft.current_bid_eth != null || nft.reserve_eth != null;
        }
        if (nft.listing_status === 'For Sale') return true;
        if (nft.salvor_price_avax != null || nft.opensea_price_avax != null) return true;
        if (nft.opensea_price_eth != null) return true;
        if (nft.current_price_sui != null) return true;
        return Object.keys(nft).some(
            (key) =>
                key.startsWith('current_price_') &&
                nft[key] != null &&
                nft[key] !== '',
        );
    }

    function setupCategory(nfts) {
        const select = document.getElementById('category-filter');
        if (!select) return;

        select.innerHTML = '<option value="">All categories</option>';

        const categories = [
            ...new Set(nfts.map((n) => n.ai?.category).filter(Boolean)),
        ].sort();

        categories.forEach((category) => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent =
                category.charAt(0).toUpperCase() + category.slice(1);
            select.appendChild(option);
        });
    }

    function filtersContext() {
        return {
            section: GallerySections.getCurrentSection(),
            aiKind: GallerySections.getAiKind(),
            aiSeries: GallerySections.getAiSeries(),
        };
    }

    function nftsWithColorFamilies(nfts) {
        return (nfts || []).filter((nft) => GalleryColorGroups.familiesForNft(nft).length > 0);
    }

    function paletteSupported(nfts, ctx = filtersContext()) {
        if (ctx.section !== 'ai_art') return false;
        const list = nfts || [];
        if (!list.length) return false;
        const withColors = nftsWithColorFamilies(list);
        if (!withColors.length) return false;
        return (
            withColors.length === list.length ||
            withColors.length / list.length >= 0.5
        );
    }

    function countVibeTags(nfts) {
        const counts = new Map();
        (nfts || []).forEach((nft) => {
            const seen = new Set();
            (nft.ai?.vibe_tags || []).forEach((tag) => {
                const key = String(tag).toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    counts.set(key, (counts.get(key) || 0) + 1);
                }
            });
        });
        return counts;
    }

    function isMetaVibeTag(tag) {
        return META_VIBE_TAGS.has(String(tag).toLowerCase());
    }

    function discriminativeMoodTagKeys(nfts) {
        const list = nfts || [];
        const total = list.length;
        if (!total) return new Set();
        const counts = countVibeTags(list);
        return new Set(
            [...counts.entries()]
                .filter(([tag, count]) => !isMetaVibeTag(tag) && count > 0 && count < total)
                .map(([tag]) => tag),
        );
    }

    function moodSupported(nfts, ctx = filtersContext()) {
        if (ctx.section !== 'ai_art') return false;
        const list = nfts || [];
        if (!list.length) return false;
        const tagKeys = discriminativeMoodTagKeys(list);
        if (!tagKeys.size) return false;
        const withMood = list.filter((nft) =>
            (nft.ai?.vibe_tags || []).some((tag) => tagKeys.has(String(tag).toLowerCase())),
        );
        return (
            withMood.length === list.length ||
            withMood.length / list.length >= 0.5
        );
    }

    function collectMoodTags(nfts) {
        const tagKeys = discriminativeMoodTagKeys(nfts);
        if (!tagKeys.size) return [];
        const display = new Map();
        (nfts || []).forEach((nft) => {
            (nft.ai?.vibe_tags || []).forEach((tag) => {
                const key = String(tag).toLowerCase();
                if (tagKeys.has(key) && !display.has(key)) display.set(key, tag);
            });
        });
        return [...display.values()].sort((a, b) => a.localeCompare(b));
    }

    function setupColors(nfts) {
        const container = document.getElementById('color-filters');
        if (!container) return;
        container.innerHTML = '';

        const families = GalleryColorGroups.familiesPresent(nfts);
        families.forEach((family) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'color-filter color-filter--group';
            btn.dataset.colorFamily = family.id;
            btn.title = family.label;
            btn.setAttribute('aria-label', family.label);
            btn.style.setProperty('--swatch', family.swatch);
            btn.addEventListener('click', () => toggleColorFamily(family.id, btn));
            container.appendChild(btn);
        });
    }

    function shouldShowFiltersHint(nfts, ctx = filtersContext()) {
        if (ctx.section !== 'ai_art' || ctx.aiKind !== 'evm') return false;
        if (ctx.aiSeries !== 'all') return false;
        const list = nfts || [];
        const withColors = nftsWithColorFamilies(list);
        const moodTags = discriminativeMoodTagKeys(list);
        return withColors.length > 0 || moodTags.size > 0;
    }

    function syncSeriesScopedFilters(nfts = lastFilterNfts) {
        const ctx = filtersContext();
        const showPalette = paletteSupported(nfts, ctx);
        const showMood = moodSupported(nfts, ctx);
        const paletteRow = document.getElementById('color-filters')?.closest('.filters-row');
        const moodRow = document.getElementById('vibe-filters')?.closest('.filters-row');
        if (paletteRow) paletteRow.hidden = !showPalette;
        if (moodRow) moodRow.hidden = !showMood;

        const panel = document.getElementById('explore');
        let note = document.getElementById('filters-series-note');
        if (!note && panel) {
            note = document.createElement('p');
            note.id = 'filters-series-note';
            note.className = 'filters-panel__hint';
            const head = panel.querySelector('.filters-panel__head');
            head?.insertAdjacentElement('afterend', note);
        }
        if (note) {
            const showHint = shouldShowFiltersHint(nfts, ctx);
            note.hidden = !showHint;
            note.textContent =
                'Palette and mood filters work per series (e.g. Nature Stories) or on XRPL. Pick a series above, or switch to XRPL.';
        }
    }

    function clearUnsupportedFilters(nfts, ctx = filtersContext()) {
        const showPalette = paletteSupported(nfts, ctx);
        const showMood = moodSupported(nfts, ctx);
        if (!showPalette) {
            activeColorFamilies.clear();
            document.querySelectorAll('.color-filter.is-active').forEach((el) => {
                el.classList.remove('is-active');
            });
        }
        if (!showMood) {
            activeVibes.clear();
            document.querySelectorAll('.vibe-filter.is-active').forEach((el) => {
                el.classList.remove('is-active');
            });
        }
    }

    function clearColorMoodFilters({ dispatch = true } = {}) {
        activeVibes.clear();
        activeColorFamilies.clear();
        document.querySelectorAll('.color-filter.is-active, .vibe-filter.is-active').forEach((el) => {
            el.classList.remove('is-active');
        });
        if (dispatch) dispatchChange();
    }

    function setupVibes(nfts) {
        const container = document.getElementById('vibe-filters');
        if (!container) return;
        container.innerHTML = '';

        collectMoodTags(nfts).forEach((tag) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'filter-tag vibe-filter';
            btn.textContent = tag;
            btn.dataset.tag = tag;
            btn.addEventListener('click', () => toggleVibe(tag, btn));
            container.appendChild(btn);
        });
    }

    function toggleColorFamily(familyId, btn) {
        if (activeColorFamilies.has(familyId)) {
            activeColorFamilies.delete(familyId);
            btn.classList.remove('is-active');
        } else {
            activeColorFamilies.add(familyId);
            btn.classList.add('is-active');
        }
        dispatchChange();
    }

    function toggleVibe(tag, btn) {
        if (activeVibes.has(tag)) {
            activeVibes.delete(tag);
            btn.classList.remove('is-active');
        } else {
            activeVibes.add(tag);
            btn.classList.add('is-active');
        }
        dispatchChange();
    }

    function dispatchChange() {
        document.dispatchEvent(new CustomEvent('gallery:filter'));
    }

    function apply(nfts) {
        const category = document.getElementById('category-filter')?.value || '';
        const q = searchQuery.trim().toLowerCase();

        return nfts.filter((nft) => {
            if (category && nft.ai?.category !== category) return false;

            if (activeColorFamilies.size > 0) {
                if (!GalleryColorGroups.nftMatchesFamilies(nft, activeColorFamilies)) {
                    return false;
                }
            }

            if (activeVibes.size > 0) {
                const vibes = nft.ai?.vibe_tags || [];
                const match = [...activeVibes].every((t) => vibes.includes(t));
                if (!match) return false;
            }

            if (listedOnly && !isListedNft(nft)) return false;

            if (q) {
                const haystack = [
                    nft.name,
                    nft.ai?.description,
                    nft.ai?.category,
                    ...(nft.ai?.vibe_tags || []),
                    ...(nft.ai?.keywords || []),
                    ...(nft.ai?.dominant_colors || []),
                    ...GalleryColorGroups.searchTokensForNft(nft),
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                if (!haystack.includes(q)) return false;
            }

            return true;
        });
    }

    function reset() {
        const select = document.getElementById('category-filter');
        if (select) select.value = '';
        searchQuery = '';
        const search = document.getElementById('search-filter');
        if (search) search.value = '';

        activeVibes.clear();
        activeColorFamilies.clear();
        GalleryLikes.setSavedOnly(false);

        document.querySelectorAll('.color-filter.is-active, .vibe-filter.is-active').forEach((el) => {
            el.classList.remove('is-active');
        });
        const savedBtn = document.getElementById('filter-saved');
        if (savedBtn) savedBtn.classList.remove('is-active');
        listedOnly = false;
        const listedBtn = document.getElementById('filter-listed');
        if (listedBtn) listedBtn.classList.remove('is-active');

        dispatchChange();
    }

    function bind() {
        document.getElementById('category-filter')?.addEventListener('change', dispatchChange);
        document.getElementById('search-filter')?.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            dispatchChange();
        });
        document.getElementById('reset-filters')?.addEventListener('click', reset);
        document.getElementById('filter-listed')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            listedOnly = !listedOnly;
            btn.classList.toggle('is-active', listedOnly);
            dispatchChange();
        });
        document.getElementById('filter-saved')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const on = !GalleryLikes.getSavedOnly();
            GalleryLikes.setSavedOnly(on);
            btn.classList.toggle('is-active', on);
        });
    }

    function clearState() {
        const select = document.getElementById('category-filter');
        if (select) select.value = '';
        searchQuery = '';
        const search = document.getElementById('search-filter');
        if (search) search.value = '';
        activeVibes.clear();
        activeColorFamilies.clear();
        GalleryLikes.setSavedOnly(false);
        document.querySelectorAll('.color-filter.is-active, .vibe-filter.is-active').forEach((el) => {
            el.classList.remove('is-active');
        });
        const savedBtn = document.getElementById('filter-saved');
        if (savedBtn) savedBtn.classList.remove('is-active');
        listedOnly = false;
        const listedBtn = document.getElementById('filter-listed');
        if (listedBtn) listedBtn.classList.remove('is-active');
    }

    function init(nfts, { rebind = false } = {}) {
        lastFilterNfts = nfts;
        clearUnsupportedFilters(nfts);
        setupCategory(nfts);
        setupColors(nfts);
        setupVibes(nfts);
        syncSeriesScopedFilters(nfts);
        if (rebind) bind();
    }

    function updateSources(nfts) {
        lastFilterNfts = nfts;
        clearUnsupportedFilters(nfts);
        setupCategory(nfts);
        setupColors(nfts);
        setupVibes(nfts);
        syncSeriesScopedFilters(nfts);
    }

    function reinit(nfts) {
        clearState();
        init(nfts);
        syncSeriesScopedFilters();
    }

    let bound = false;
    function bindOnce() {
        if (bound) return;
        bound = true;
        bind();
    }

    function getListedOnly() {
        return listedOnly;
    }

    return {
        init,
        reinit,
        updateSources,
        apply,
        reset,
        bindOnce,
        getListedOnly,
        isListedNft,
    };
})();