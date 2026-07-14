/**
 * Filtry galerii — kategoria, palety kolorów, vibe, wyszukiwarka (dane z gallery.json)
 */
const GalleryFilters = (() => {
    const activeVibes = new Set();
    const activeColorFamilies = new Set();
    let searchQuery = '';
    let listedOnly = false;

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

    function setupVibes(nfts) {
        const container = document.getElementById('vibe-filters');
        if (!container) return;
        container.innerHTML = '';

        const tags = new Set();
        nfts.forEach((nft) => {
            (nft.ai?.vibe_tags || []).forEach((t) => tags.add(t));
        });

        [...tags].sort().forEach((tag) => {
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
        setupCategory(nfts);
        setupColors(nfts);
        setupVibes(nfts);
        if (rebind) bind();
    }

    function updateSources(nfts) {
        setupCategory(nfts);
        setupColors(nfts);
        setupVibes(nfts);
    }

    function reinit(nfts) {
        clearState();
        init(nfts);
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