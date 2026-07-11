/**
 * Filtry galerii — kategoria, kolory, vibe, wyszukiwarka (dane z gallery.json)
 */
const GalleryFilters = (() => {
    const activeVibes = new Set();
    const activeColors = new Set();
    let searchQuery = '';

    function setupCategory(nfts) {
        const select = document.getElementById('category-filter');
        if (!select) return;

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

        const colors = new Map();
        nfts.forEach((nft) => {
            (nft.ai?.dominant_colors || []).forEach((hex) => {
                const key = hex.toUpperCase();
                colors.set(key, (colors.get(key) || 0) + 1);
            });
        });

        [...colors.entries()]
            .sort((a, b) => b[1] - a[1])
            .forEach(([hex]) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'color-filter';
                btn.dataset.color = hex;
                btn.title = hex;
                btn.setAttribute('aria-label', `Color ${hex}`);
                btn.style.setProperty('--swatch', hex);
                btn.addEventListener('click', () => toggleColor(hex, btn));
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

    function toggleColor(hex, btn) {
        if (activeColors.has(hex)) {
            activeColors.delete(hex);
            btn.classList.remove('is-active');
        } else {
            activeColors.add(hex);
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

            if (activeColors.size > 0) {
                const nftColors = (nft.ai?.dominant_colors || []).map((c) =>
                    c.toUpperCase()
                );
                const match = [...activeColors].some((c) => nftColors.includes(c));
                if (!match) return false;
            }

            if (activeVibes.size > 0) {
                const vibes = nft.ai?.vibe_tags || [];
                const match = [...activeVibes].every((t) => vibes.includes(t));
                if (!match) return false;
            }

            if (q) {
                const haystack = [
                    nft.name,
                    nft.ai?.description,
                    nft.ai?.category,
                    ...(nft.ai?.vibe_tags || []),
                    ...(nft.ai?.keywords || []),
                    ...(nft.ai?.dominant_colors || []),
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
        activeColors.clear();

        document.querySelectorAll('.color-filter.is-active, .vibe-filter.is-active').forEach((el) => {
            el.classList.remove('is-active');
        });

        dispatchChange();
    }

    function bind() {
        document.getElementById('category-filter')?.addEventListener('change', dispatchChange);
        document.getElementById('search-filter')?.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            dispatchChange();
        });
        document.getElementById('reset-filters')?.addEventListener('click', reset);
    }

    function init(nfts) {
        setupCategory(nfts);
        setupColors(nfts);
        setupVibes(nfts);
        bind();
    }

    return { init, apply, reset };
})();