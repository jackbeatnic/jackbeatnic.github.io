/**
 * Sekcje galerii: AI Art, Photography, The Atelier + Tip.
 */
const GallerySections = (() => {
    let site = {};
    let currentSection = 'ai_art';
    let currentAiKind = 'opensea';
    let currentPhotoKind = 'photo';
    let currentMarketKind = 'auctions';
    let currentMarketChain = 'base';

    function config() {
        return site.sections || {};
    }

    function atelierCfg() {
        return config().atelier || config().studio_market || {};
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
        currentAiKind = aiCfg?.default_subsection || 'opensea';
        currentPhotoKind = photoCfg?.default_subsection || 'photo';
        currentMarketKind = mCfg?.default_kind || 'auctions';
        currentMarketChain = mCfg?.default_chain || 'base';
        syncSectionNavLabels();
        syncAiSubnavLabels();
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
            currentAiKind = ai || config().ai_art?.default_subsection || 'opensea';
        } else {
            currentAiKind = config().ai_art?.default_subsection || 'opensea';
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
        if (currentSection !== (site.default_section || 'ai_art')) {
            params.set('section', currentSection);
        }
        if (currentSection === 'ai_art') {
            const def = config().ai_art?.default_subsection || 'opensea';
            if (currentAiKind !== def) {
                params.set('ai', currentAiKind);
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
            currentAiKind = config().ai_art?.default_subsection || 'opensea';
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
        currentSection = 'ai_art';
        currentAiKind = kind;
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

        const photoSubnav = document.getElementById('photo-subnav');
        if (photoSubnav) photoSubnav.hidden = currentSection !== 'photography';

        const marketSubnav = document.getElementById('market-subnav');
        if (marketSubnav) marketSubnav.hidden = currentSection !== 'atelier';

        document.querySelectorAll('[data-ai-kind]').forEach((el) => {
            const active = currentSection === 'ai_art' && el.dataset.aiKind === currentAiKind;
            el.classList.toggle('is-active', active);
            el.setAttribute('aria-pressed', String(active));
        });

        document.querySelectorAll('[data-photo-kind]').forEach((el) => {
            const active =
                currentSection === 'photography' && el.dataset.photoKind === currentPhotoKind;
            el.classList.toggle('is-active', active);
            el.setAttribute('aria-pressed', String(active));
        });

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
        return allNfts.filter((nft) => {
            const medium = nft.medium || 'ai_art';
            if (currentSection === 'ai_art') {
                if (currentAiKind === 'xrpl') return medium === 'xrpl_ai';
                return medium === 'ai_art';
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
    }

    function getCurrentSection() {
        return currentSection;
    }

    function getAiKind() {
        return currentAiKind;
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
            const explore = titles[currentAiKind] || base.explore_title;
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
            if (currentSection === 'ai_art' && currentAiKind === 'opensea') return;
            currentSection = 'ai_art';
            currentAiKind = 'opensea';
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
        getPhotoKind,
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