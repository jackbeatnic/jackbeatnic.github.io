/**
 * Sekcje galerii: AI Art, Photography, Auctions (Manifold) + Tip.
 */
const GallerySections = (() => {
    let site = {};
    let currentSection = 'ai_art';
    let currentAiKind = 'opensea';
    let currentPhotoKind = 'photo';
    let currentAuctionChain = 'base';

    function config() {
        return site.sections || {};
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

    function syncAuctionSubnavLabels() {
        const subnav = document.getElementById('auction-subnav');
        const subsections = config().auctions?.subsections;
        if (!subnav || !subsections?.length) return;

        subsections.forEach(({ id, label }) => {
            const tab = subnav.querySelector(`[data-auction-chain="${id}"]`);
            if (tab && label) tab.textContent = label;
        });
    }

    function init(siteConfig) {
        site = siteConfig || {};
        currentSection = site.default_section || 'ai_art';
        const aiCfg = config().ai_art;
        const photoCfg = config().photography;
        const auctionCfg = config().auctions;
        currentAiKind = aiCfg?.default_subsection || 'opensea';
        currentPhotoKind = photoCfg?.default_subsection || 'photo';
        currentAuctionChain = auctionCfg?.default_subsection || 'base';
        syncSectionNavLabels();
        syncAiSubnavLabels();
        syncPhotoSubnavLabels();
        syncAuctionSubnavLabels();
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

        document.querySelectorAll('[data-auction-chain]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const chain = el.dataset.auctionChain;
                if (!chain || el.disabled) return;
                setAuctionChain(chain);
            });
        });

        window.addEventListener('popstate', readUrl);
    }

    function readUrl() {
        const params = new URLSearchParams(window.location.search);
        const section = params.get('section');
        const ai = params.get('ai');
        const photo = params.get('photo');
        const auction = params.get('auction');

        if (section === 'xrpl') {
            currentSection = 'ai_art';
            currentAiKind = 'xrpl';
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

        if (currentSection === 'auctions') {
            currentAuctionChain = auction || config().auctions?.default_subsection || 'base';
        } else {
            currentAuctionChain = config().auctions?.default_subsection || 'base';
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
        if (currentSection === 'auctions') {
            const def = config().auctions?.default_subsection || 'base';
            if (currentAuctionChain !== def) {
                params.set('auction', currentAuctionChain);
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
        if (id === 'auctions') {
            currentAuctionChain = config().auctions?.default_subsection || 'base';
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

    function setAuctionChain(chain) {
        currentSection = 'auctions';
        currentAuctionChain = chain;
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
        if (aiSubnav) {
            aiSubnav.hidden = currentSection !== 'ai_art';
        }

        const photoSubnav = document.getElementById('photo-subnav');
        if (photoSubnav) {
            photoSubnav.hidden = currentSection !== 'photography';
        }

        const auctionSubnav = document.getElementById('auction-subnav');
        if (auctionSubnav) {
            auctionSubnav.hidden = currentSection !== 'auctions';
        }

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

        const disabledAuctionChains = new Set(config().auctions?.disabled_subsections || []);
        document.querySelectorAll('[data-auction-chain]').forEach((el) => {
            const chain = el.dataset.auctionChain;
            const disabled = disabledAuctionChains.has(chain);
            const active =
                currentSection === 'auctions' && chain === currentAuctionChain && !disabled;
            el.classList.toggle('is-active', active);
            el.classList.toggle('is-disabled', disabled);
            el.disabled = disabled;
            el.setAttribute('aria-pressed', String(active));
            if (disabled) {
                el.title = config().auctions?.empty_messages?.[chain] || 'Coming soon';
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
            if (currentSection === 'auctions') {
                if (medium !== 'manifold_auction') return false;
                const chainKey = nft.chain_key || nft.chain || 'base';
                return chainKey === currentAuctionChain;
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

    function getAuctionChain() {
        return currentAuctionChain;
    }

    function isAuctionsSection() {
        return currentSection === 'auctions';
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
        if (currentSection === 'auctions') {
            const titles = base.explore_titles || {};
            const explore = titles[currentAuctionChain] || base.explore_title;
            return { ...base, explore_title: explore };
        }
        return base;
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
        if (currentSection === 'auctions') {
            const msgs = config().auctions?.empty_messages || {};
            return msgs[currentAuctionChain] || 'No live auctions right now.';
        }
        return 'No works in this section yet.';
    }

    function activateForNft(nft, { silent = false } = {}) {
        const medium = nft.medium || 'ai_art';
        const kind = nft.photo_kind || 'photo';

        if (medium === 'xrpl_ai') {
            const same = currentSection === 'ai_art' && currentAiKind === 'xrpl';
            if (same) return;
            currentSection = 'ai_art';
            currentAiKind = 'xrpl';
        } else if (medium === 'ai_art') {
            const same = currentSection === 'ai_art' && currentAiKind === 'opensea';
            if (same) return;
            currentSection = 'ai_art';
            currentAiKind = 'opensea';
        } else if (medium === 'photography') {
            const same = currentSection === 'photography' && kind === currentPhotoKind;
            if (same) return;
            currentSection = 'photography';
            currentPhotoKind = kind;
        } else if (medium === 'manifold_auction') {
            const chainKey = nft.chain_key || nft.chain || 'base';
            const same =
                currentSection === 'auctions' && chainKey === currentAuctionChain;
            if (same) return;
            currentSection = 'auctions';
            currentAuctionChain = chainKey;
        } else {
            const same = medium === currentSection;
            if (same) return;
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
        getAuctionChain,
        isAuctionsSection,
        isPhotoOther,
        getSectionMeta,
        emptyMessage,
        activateForNft,
        setSection,
    };
})();