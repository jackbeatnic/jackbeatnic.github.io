/**
 * Sekcje galerii: AI Art, Photography, The Atelier + Tip.
 */
const GallerySections = (() => {
    let site = {};
    let currentSection = 'ai_art';
    let currentAiKind = 'evm';
    let currentAiSeries = 'nature_stories';
    let currentPhotoKind = 'photo';
    let collectionToSeries = {};
    let currentMarketKind = 'auctions';
    let currentMarketChain = 'base';

    function config() {
        return site.sections || {};
    }

    function atelierCfg() {
        return config().atelier || config().studio_market || {};
    }

    function aiSeriesCatalog() {
        return site.ai_series_catalog || config().ai_art?.series_catalog || {};
    }

    function defaultAiSeries() {
        return (
            config().ai_art?.default_series ||
            aiSeriesCatalog().default ||
            'nature_stories'
        );
    }

    const LEGACY_AI_KINDS = { opensea: 'evm' };

    function defaultAiKind() {
        return config().ai_art?.default_subsection || 'evm';
    }

    function normalizeAiKind(kind) {
        if (!kind) return defaultAiKind();
        return LEGACY_AI_KINDS[kind] || kind;
    }

    function isEvmAiKind(kind = currentAiKind) {
        return normalizeAiKind(kind) === 'evm';
    }

    function disabledAiSeries() {
        const disabled = new Set(config().ai_art?.disabled_series || []);
        const series = aiSeriesCatalog().series || {};
        Object.entries(series).forEach(([id, cfg]) => {
            if (cfg?.enabled === false) disabled.add(id);
        });
        return disabled;
    }

    function isSeriesEnabled(seriesId) {
        if (!seriesId || seriesId === 'all') return true;
        return !disabledAiSeries().has(seriesId);
    }

    function seriesNote(seriesId) {
        const notes = config().ai_art?.series_notes || {};
        const catalogNote = aiSeriesCatalog().series?.[seriesId]?.note;
        return notes[seriesId] || catalogNote || 'Coming soon';
    }

    function normalizeAiSeries(seriesId) {
        if (!seriesId || !isSeriesEnabled(seriesId)) return defaultAiSeries();
        return seriesId;
    }

    function isAiPlayGalleryEnabled() {
        return isSeriesEnabled('jb_ai_play');
    }

    function rebuildCollectionToSeries() {
        collectionToSeries = {};
        const series = aiSeriesCatalog().series || {};
        Object.entries(series).forEach(([seriesId, cfg]) => {
            (cfg.collection_ids || []).forEach((colId) => {
                collectionToSeries[colId] = seriesId;
            });
        });
    }

    function resolveAiSeries(nft) {
        if (nft?.ai_series) return nft.ai_series;
        const colId = nft?.collection_id;
        if (colId && collectionToSeries[colId]) return collectionToSeries[colId];
        return null;
    }

    function seriesOrder() {
        const order = aiSeriesCatalog().order || [];
        return [...order, 'all'];
    }

    function seriesSortIndex(seriesId) {
        const order = seriesOrder();
        const idx = order.indexOf(seriesId);
        return idx >= 0 ? idx : order.length;
    }

    function sortBySeriesOrder(nfts) {
        return [...nfts].sort((a, b) => {
            const sa = seriesSortIndex(resolveAiSeries(a) || 'zzz');
            const sb = seriesSortIndex(resolveAiSeries(b) || 'zzz');
            if (sa !== sb) return sa - sb;
            const ra = Number(a.display_rank) || Number(a.token_id) || 0;
            const rb = Number(b.display_rank) || Number(b.token_id) || 0;
            return ra - rb;
        });
    }

    function syncSectionNavLabels() {
        Object.entries(config()).forEach(([id, meta]) => {
            document.querySelectorAll(`[data-section="${id}"]`).forEach((el) => {
                const full = el.querySelector('.section-nav__label--full');
                const short = el.querySelector('.section-nav__label--short');
                if (full && meta.label) full.textContent = meta.label;
                if (short) short.textContent = meta.label_short || meta.label || '';
                if (!full && !short && meta.label) el.textContent = meta.label;
            });
        });
    }

    function syncAiSubnavLabels() {
        const subnav = document.getElementById('ai-subnav');
        const subsections = config().ai_art?.subsections;
        if (!subnav || !subsections?.length) return;

        subsections.forEach(({ id, label }) => {
            const tab = subnav.querySelector(`[data-ai-kind="${id}"]`);
            if (tab && label) tab.textContent = label;
        });
    }

    function syncAiSeriesSubnavLabels() {
        const subnav = document.getElementById('ai-series-subnav');
        const catalog = aiSeriesCatalog();
        if (!subnav) return;

        (catalog.order || []).forEach((id) => {
            const tab = subnav.querySelector(`[data-ai-series="${id}"]`);
            const label = catalog.series?.[id]?.label;
            if (tab && label) tab.textContent = label;
        });

        const allTab = subnav.querySelector('[data-ai-series="all"]');
        const allLabel = config().ai_art?.all_series_label || 'All';
        if (allTab) allTab.textContent = allLabel;

        syncAiSeriesSelect();
    }

    function syncAiSeriesSelect() {
        const select = document.getElementById('ai-series-select');
        if (!select) return;

        const catalog = aiSeriesCatalog();
        const order = catalog.order || [];
        const disabled = disabledAiSeries();
        const allLabel = config().ai_art?.all_series_label || 'All';
        const prev = select.value;

        select.innerHTML = '';
        order.forEach((id) => {
            if (disabled.has(id)) return;
            const label = catalog.series?.[id]?.label || id;
            const option = document.createElement('option');
            option.value = id;
            option.textContent = label;
            select.appendChild(option);
        });
        if (!disabled.has('all')) {
            const allOpt = document.createElement('option');
            allOpt.value = 'all';
            allOpt.textContent = allLabel;
            select.appendChild(allOpt);
        }

        const active =
            currentAiSeries && !disabled.has(currentAiSeries)
                ? currentAiSeries
                : defaultAiSeries();
        if ([...select.options].some((opt) => opt.value === active)) {
            select.value = active;
        } else if (prev && [...select.options].some((opt) => opt.value === prev)) {
            select.value = prev;
        }
    }

    function syncPhotoSubnavLabels() {
        const subnav = document.getElementById('photo-subnav');
        const subsections = config().photography?.subsections;
        if (!subnav || !subsections?.length) return;

        subsections.forEach(({ id, label }) => {
            const tab = subnav.querySelector(`[data-photo-kind="${id}"]`);
            if (tab && label) tab.textContent = label;
        });
    }

    function syncMarketSubnavLabels() {
        const wrap = document.getElementById('market-subnav');
        const cfg = atelierCfg();
        if (!wrap) return;

        (cfg.kind_subsections || []).forEach(({ id, label }) => {
            const tab = wrap.querySelector(`[data-market-kind="${id}"]`);
            if (tab && label) tab.textContent = label;
        });

        (cfg.chain_subsections || []).forEach(({ id, label }) => {
            const tab = wrap.querySelector(`[data-market-chain="${id}"]`);
            if (tab && label) tab.textContent = label;
        });
    }

    function init(siteConfig) {
        site = siteConfig || {};
        currentSection = site.default_section || 'ai_art';
        const aiCfg = config().ai_art;
        const photoCfg = config().photography;
        const mCfg = atelierCfg();
        currentAiKind = defaultAiKind();
        currentAiSeries = defaultAiSeries();
        currentPhotoKind = photoCfg?.default_subsection || 'photo';
        currentMarketKind = mCfg?.default_kind || 'auctions';
        currentMarketChain = mCfg?.default_chain || 'base';
        rebuildCollectionToSeries();
        syncSectionNavLabels();
        syncAiSubnavLabels();
        syncAiSeriesSubnavLabels();
        syncPhotoSubnavLabels();
        syncMarketSubnavLabels();
        bindNav();
        readUrl();
        syncNavUi();
    }

    function bindNav() {
        document.querySelectorAll('[data-section]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const id = el.dataset.section;
                if (!id || !config()[id]) return;
                setSection(id);
            });
        });

        document.querySelectorAll('[data-ai-kind]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const kind = el.dataset.aiKind;
                if (!kind) return;
                setAiKind(kind);
            });
        });

        document.querySelectorAll('[data-ai-series]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const series = el.dataset.aiSeries;
                if (!series) return;
                setAiSeries(series);
            });
        });

        const seriesSelect = document.getElementById('ai-series-select');
        if (seriesSelect) {
            seriesSelect.addEventListener('change', (e) => {
                const series = e.target.value;
                if (!series) return;
                setAiSeries(series);
            });
        }

        document.querySelectorAll('[data-photo-kind]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const kind = el.dataset.photoKind;
                if (!kind) return;
                setPhotoKind(kind);
            });
        });

        document.querySelectorAll('[data-market-kind]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const kind = el.dataset.marketKind;
                if (!kind || el.disabled) return;
                setMarketKind(kind);
            });
        });

        document.querySelectorAll('[data-market-chain]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const chain = el.dataset.marketChain;
                if (!chain || el.disabled) return;
                setMarketChain(chain);
            });
        });

        window.addEventListener('popstate', readUrl);
    }

    function readUrl() {
        const params = new URLSearchParams(window.location.search);
        const section = params.get('section');
        const ai = params.get('ai');
        const photo = params.get('photo');
        const market = params.get('market');
        const chain = params.get('chain') || params.get('auction');
        const series = params.get('series');

        if (section === 'xrpl') {
            currentSection = 'ai_art';
            currentAiKind = 'xrpl';
        } else if (section === 'auctions' || section === 'studio_market') {
            currentSection = 'atelier';
        } else if (section && config()[section]) {
            currentSection = section;
        } else {
            currentSection = site.default_section || 'ai_art';
        }

        if (currentSection === 'ai_art') {
            currentAiKind = normalizeAiKind(ai || defaultAiKind());
            if (isEvmAiKind()) {
                currentAiSeries = normalizeAiSeries(series || defaultAiSeries());
            } else {
                currentAiSeries = defaultAiSeries();
            }
        } else {
            currentAiKind = defaultAiKind();
            currentAiSeries = defaultAiSeries();
        }

        if (currentSection === 'photography' && photo) {
            currentPhotoKind = photo;
        } else if (currentSection === 'photography') {
            currentPhotoKind = config().photography?.default_subsection || 'photo';
        }

        if (currentSection === 'atelier') {
            currentMarketKind = market || atelierCfg()?.default_kind || 'auctions';
            currentMarketChain = chain || atelierCfg()?.default_chain || 'base';
        } else {
            currentMarketKind = atelierCfg()?.default_kind || 'auctions';
            currentMarketChain = atelierCfg()?.default_chain || 'base';
        }

        syncNavUi();
        document.dispatchEvent(new CustomEvent('gallery:section'));
    }

    function writeUrl() {
        const params = new URLSearchParams(window.location.search);
        const work = params.get('work') || params.get('token');

        params.delete('section');
        params.delete('ai');
        params.delete('photo');
        params.delete('market');
        params.delete('chain');
        params.delete('auction');
        params.delete('series');
        if (currentSection !== (site.default_section || 'ai_art')) {
            params.set('section', currentSection);
        }
        if (currentSection === 'ai_art') {
            const def = defaultAiKind();
            if (currentAiKind !== def) {
                params.set('ai', currentAiKind);
            }
            if (isEvmAiKind() && currentAiSeries !== defaultAiSeries()) {
                params.set('series', currentAiSeries);
            }
        }
        if (currentSection === 'photography') {
            const def = config().photography?.default_subsection || 'photo';
            if (currentPhotoKind !== def) {
                params.set('photo', currentPhotoKind);
            }
        }
        if (currentSection === 'atelier') {
            const defKind = atelierCfg()?.default_kind || 'auctions';
            const defChain = atelierCfg()?.default_chain || 'base';
            if (currentMarketKind !== defKind) {
                params.set('market', currentMarketKind);
            }
            if (currentMarketChain !== defChain) {
                params.set('chain', currentMarketChain);
            }
        }
        if (work) params.set('work', work);

        const qs = params.toString();
        const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', next);
    }

    function setSection(id) {
        if (!config()[id]) return;
        currentSection = id;
        if (id === 'ai_art') {
            currentAiKind = defaultAiKind();
            currentAiSeries = defaultAiSeries();
        }
        if (id === 'photography') {
            currentPhotoKind = config().photography?.default_subsection || 'photo';
        }
        if (id === 'atelier') {
            currentMarketKind = atelierCfg()?.default_kind || 'auctions';
            currentMarketChain = atelierCfg()?.default_chain || 'base';
        }
        syncNavUi();
        writeUrl();
        document.dispatchEvent(new CustomEvent('gallery:section'));
        document.getElementById('gallery-root')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function setAiKind(kind) {
        kind = normalizeAiKind(kind);
        const disabled = new Set(config().ai_art?.disabled_subsections || []);
        if (disabled.has(kind)) return;
        currentSection = 'ai_art';
        currentAiKind = kind;
        if (isEvmAiKind(kind)) {
            currentAiSeries = defaultAiSeries();
        }
        syncNavUi();
        writeUrl();
        document.dispatchEvent(new CustomEvent('gallery:section'));
    }

    function setAiSeries(series) {
        if (!isSeriesEnabled(series)) return;
        currentSection = 'ai_art';
        currentAiKind = 'evm';
        currentAiSeries = series;
        syncNavUi();
        writeUrl();
        document.dispatchEvent(new CustomEvent('gallery:section'));
    }

    function setPhotoKind(kind) {
        currentPhotoKind = kind;
        syncNavUi();
        writeUrl();
        document.dispatchEvent(new CustomEvent('gallery:section'));
    }

    function setMarketKind(kind) {
        currentSection = 'atelier';
        currentMarketKind = kind;
        syncNavUi();
        writeUrl();
        document.dispatchEvent(new CustomEvent('gallery:section'));
    }

    function setMarketChain(chain) {
        currentSection = 'atelier';
        currentMarketChain = chain;
        syncNavUi();
        writeUrl();
        document.dispatchEvent(new CustomEvent('gallery:section'));
    }

    function syncNavUi() {
        document.querySelectorAll('[data-section]').forEach((el) => {
            const active = el.dataset.section === currentSection;
            el.classList.toggle('is-active', active);
            if (el.tagName === 'A') {
                el.setAttribute('aria-current', active ? 'page' : 'false');
            } else {
                el.setAttribute('aria-pressed', String(active));
            }
        });

        const aiSubnav = document.getElementById('ai-subnav');
        if (aiSubnav) aiSubnav.hidden = currentSection !== 'ai_art';

        const aiSeriesSubnav = document.getElementById('ai-series-subnav');
        if (aiSeriesSubnav) {
            aiSeriesSubnav.hidden =
                currentSection !== 'ai_art' || !isEvmAiKind();
        }

        const photoSubnav = document.getElementById('photo-subnav');
        if (photoSubnav) photoSubnav.hidden = currentSection !== 'photography';

        const marketSubnav = document.getElementById('market-subnav');
        if (marketSubnav) marketSubnav.hidden = currentSection !== 'atelier';

        const disabledAiKinds = new Set(config().ai_art?.disabled_subsections || []);
        const aiKindNotes = config().ai_art?.subsection_notes || {};
        document.querySelectorAll('[data-ai-kind]').forEach((el) => {
            const kind = el.dataset.aiKind;
            const disabled = disabledAiKinds.has(kind);
            const active =
                currentSection === 'ai_art' &&
                kind === currentAiKind &&
                !disabled;
            el.classList.toggle('is-active', active);
            el.classList.toggle('is-disabled', disabled);
            el.disabled = disabled;
            el.setAttribute('aria-pressed', String(active));
            if (disabled) {
                el.title = aiKindNotes[kind] || 'Coming soon';
            } else {
                el.removeAttribute('title');
            }
        });

        document.querySelectorAll('[data-photo-kind]').forEach((el) => {
            const active =
                currentSection === 'photography' && el.dataset.photoKind === currentPhotoKind;
            el.classList.toggle('is-active', active);
            el.setAttribute('aria-pressed', String(active));
        });

        const disabledSeries = disabledAiSeries();
        document.querySelectorAll('[data-ai-series]').forEach((el) => {
            const series = el.dataset.aiSeries;
            const disabled = disabledSeries.has(series);
            el.hidden = disabled;
            const active =
                currentSection === 'ai_art' &&
                isEvmAiKind() &&
                series === currentAiSeries &&
                !disabled;
            el.classList.toggle('is-active', active);
            el.classList.toggle('is-disabled', disabled);
            el.disabled = disabled;
            el.setAttribute('aria-pressed', String(active));
            if (disabled) {
                el.title = seriesNote(series);
            } else {
                el.removeAttribute('title');
            }
        });

        const seriesSelect = document.getElementById('ai-series-select');
        if (seriesSelect && !aiSeriesSubnav?.hidden) {
            if ([...seriesSelect.options].some((opt) => opt.value === currentAiSeries)) {
                seriesSelect.value = currentAiSeries;
            }
        }

        const disabledKinds = new Set(atelierCfg()?.disabled_kinds || ['editions']);
        document.querySelectorAll('[data-market-kind]').forEach((el) => {
            const kind = el.dataset.marketKind;
            const disabled = disabledKinds.has(kind);
            const active =
                currentSection === 'atelier' &&
                kind === currentMarketKind &&
                !disabled;
            el.classList.toggle('is-active', active);
            el.classList.toggle('is-disabled', disabled);
            el.disabled = disabled;
            el.setAttribute('aria-pressed', String(active));
            if (disabled) {
                el.title = atelierCfg()?.kind_notes?.[kind] || 'Coming soon';
            } else {
                el.removeAttribute('title');
            }
        });

        const disabledChains = new Set(atelierCfg()?.disabled_chains || ['ethereum']);
        document.querySelectorAll('[data-market-chain]').forEach((el) => {
            const chain = el.dataset.marketChain;
            const disabled = disabledChains.has(chain);
            const active =
                currentSection === 'atelier' &&
                chain === currentMarketChain &&
                !disabled;
            el.classList.toggle('is-active', active);
            el.classList.toggle('is-disabled', disabled);
            el.disabled = disabled;
            el.setAttribute('aria-pressed', String(active));
            if (disabled) {
                el.title = atelierCfg()?.chain_notes?.[chain] || 'Coming soon';
            } else {
                el.removeAttribute('title');
            }
        });
    }

    function filterNfts(allNfts) {
        const hiddenSeries = disabledAiSeries();
        const filtered = allNfts.filter((nft) => {
            const medium = nft.medium || 'ai_art';
            if (currentSection === 'ai_art') {
                if (currentAiKind === 'xrpl') return medium === 'xrpl_ai';
                if (medium !== 'ai_art') return false;
                const nftSeries = resolveAiSeries(nft);
                if (nftSeries && hiddenSeries.has(nftSeries)) return false;
                if (isEvmAiKind() && currentAiSeries !== 'all') {
                    return nftSeries === currentAiSeries;
                }
                return true;
            }
            if (currentSection === 'photography') {
                if (medium !== 'photography') return false;
                const kind = nft.photo_kind || 'photo';
                return kind === currentPhotoKind;
            }
            if (currentSection === 'atelier') {
                const chainKey = nft.chain_key || nft.chain || 'base';
                if (chainKey !== currentMarketChain) return false;
                if (currentMarketKind === 'auctions') {
                    return medium === 'manifold_auction';
                }
                if (currentMarketKind === 'editions') {
                    return medium === 'manifold_edition';
                }
                return false;
            }
            return medium === currentSection;
        });

        if (
            currentSection === 'ai_art' &&
            isEvmAiKind() &&
            currentAiSeries === 'all'
        ) {
            return sortBySeriesOrder(filtered);
        }
        return filtered;
    }

    function getCurrentSection() {
        return currentSection;
    }

    function getAiKind() {
        return currentAiKind;
    }

    function getAiSeries() {
        return currentAiSeries;
    }

    function getPhotoKind() {
        return currentPhotoKind;
    }

    function getMarketKind() {
        return currentMarketKind;
    }

    function getMarketChain() {
        return currentMarketChain;
    }

    /** @deprecated use getMarketChain */
    function getAuctionChain() {
        return currentMarketChain;
    }

    function isAtelierSection() {
        return currentSection === 'atelier';
    }

    /** @deprecated use isAtelierSection */
    function isStudioMarketSection() {
        return isAtelierSection();
    }

    function isAuctionsSection() {
        return isAtelierSection();
    }

    function isPhotoOther() {
        return currentSection === 'photography' && currentPhotoKind === 'other';
    }

    function getSectionMeta() {
        const base = config()[currentSection] || {};
        if (currentSection === 'ai_art') {
            const titles = base.explore_titles || {};
            let explore = titles[currentAiKind] || base.explore_title;
            if (isEvmAiKind()) {
                const seriesTitles = base.series_explore_titles || {};
                explore =
                    seriesTitles[currentAiSeries] ||
                    aiSeriesCatalog().series?.[currentAiSeries]?.label ||
                    explore;
                if (currentAiSeries !== 'all' && explore) {
                    explore = `Explore ${explore}`;
                }
            }
            return { ...base, explore_title: explore };
        }
        if (currentSection === 'atelier') {
            const titles = base.explore_titles || {};
            const explore = titles[currentMarketKind] || base.explore_title;
            return { ...base, explore_title: explore };
        }
        return base;
    }

    function emptyMessageForMarket() {
        const msgs = atelierCfg()?.empty_messages || {};
        const kindBlock = msgs[currentMarketKind];
        if (typeof kindBlock === 'string') return kindBlock;
        if (kindBlock && typeof kindBlock === 'object') {
            return (
                kindBlock[currentMarketChain] ||
                kindBlock.base ||
                'Nothing here yet.'
            );
        }
        return 'Nothing here yet.';
    }

    function emptyMessage() {
        if (currentSection === 'ai_art') {
            if (isEvmAiKind()) {
                const seriesMsgs = config().ai_art?.empty_messages_series || {};
                if (seriesMsgs[currentAiSeries]) return seriesMsgs[currentAiSeries];
            }
            const msgs = config().ai_art?.empty_messages || {};
            return msgs[currentAiKind] || 'No works in this section yet.';
        }
        if (currentSection === 'photography') {
            const msgs = config().photography?.empty_messages || {};
            return msgs[currentPhotoKind] || 'No works in this section yet.';
        }
        if (currentSection === 'atelier') {
            return emptyMessageForMarket();
        }
        return 'No works in this section yet.';
    }

    function activateForNft(nft, { silent = false } = {}) {
        const medium = nft.medium || 'ai_art';
        const kind = nft.photo_kind || 'photo';

        if (medium === 'xrpl_ai') {
            if (currentSection === 'ai_art' && currentAiKind === 'xrpl') return;
            currentSection = 'ai_art';
            currentAiKind = 'xrpl';
        } else if (medium === 'ai_art') {
            const series = normalizeAiSeries(resolveAiSeries(nft) || defaultAiSeries());
            if (
                currentSection === 'ai_art' &&
                isEvmAiKind() &&
                currentAiSeries === series
            ) {
                return;
            }
            currentSection = 'ai_art';
            currentAiKind = 'evm';
            currentAiSeries = series;
        } else if (medium === 'photography') {
            if (currentSection === 'photography' && kind === currentPhotoKind) return;
            currentSection = 'photography';
            currentPhotoKind = kind;
        } else if (medium === 'manifold_auction') {
            const chainKey = nft.chain_key || nft.chain || 'base';
            if (
                currentSection === 'atelier' &&
                currentMarketKind === 'auctions' &&
                chainKey === currentMarketChain
            ) {
                return;
            }
            currentSection = 'atelier';
            currentMarketKind = 'auctions';
            currentMarketChain = chainKey;
        } else if (medium === 'manifold_edition') {
            const chainKey = nft.chain_key || nft.chain || 'base';
            currentSection = 'atelier';
            currentMarketKind = 'editions';
            currentMarketChain = chainKey;
        } else {
            if (medium === currentSection) return;
            currentSection = medium;
        }

        syncNavUi();
        if (!silent) {
            writeUrl();
            document.dispatchEvent(new CustomEvent('gallery:section'));
        }
    }

    return {
        init,
        filterNfts,
        getCurrentSection,
        getAiKind,
        getAiSeries,
        isSeriesEnabled,
        isAiPlayGalleryEnabled,
        resolveAiSeries,
        sortBySeriesOrder,
        getPhotoKind,
        setAiSeries,
        getMarketKind,
        getMarketChain,
        getAuctionChain,
        isAtelierSection,
        isStudioMarketSection,
        isAuctionsSection,
        isPhotoOther,
        getSectionMeta,
        emptyMessage,
        activateForNft,
        setSection,
    };
})();