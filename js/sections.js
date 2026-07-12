/**
 * Sekcje galerii: AI Art (domyślnie) + Photography (Photo / Other).
 */
const GallerySections = (() => {
    let site = {};
    let currentSection = 'ai_art';
    let currentPhotoKind = 'photo';

    function config() {
        return site.sections || {};
    }

    function sectionIds() {
        return Object.keys(config());
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

    function syncPhotoSubnavLabels() {
        const subnav = document.getElementById('photo-subnav');
        const subsections = config().photography?.subsections;
        if (!subnav || !subsections?.length) return;

        subsections.forEach(({ id, label }) => {
            const tab = subnav.querySelector(`[data-photo-kind="${id}"]`);
            if (tab && label) tab.textContent = label;
        });
    }

    function init(siteConfig) {
        site = siteConfig || {};
        currentSection = site.default_section || 'ai_art';
        const photoCfg = config().photography;
        currentPhotoKind = photoCfg?.default_subsection || 'photo';
        syncSectionNavLabels();
        syncPhotoSubnavLabels();
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

        document.querySelectorAll('[data-photo-kind]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const kind = el.dataset.photoKind;
                if (!kind) return;
                setPhotoKind(kind);
            });
        });

        window.addEventListener('popstate', readUrl);
    }

    function readUrl() {
        const params = new URLSearchParams(window.location.search);
        const section = params.get('section');
        const photo = params.get('photo');

        if (section && config()[section]) {
            currentSection = section;
        } else {
            currentSection = site.default_section || 'ai_art';
        }

        if (currentSection === 'photography' && photo) {
            currentPhotoKind = photo;
        } else if (currentSection === 'photography') {
            currentPhotoKind = config().photography?.default_subsection || 'photo';
        }

        syncNavUi();
        document.dispatchEvent(new CustomEvent('gallery:section'));
    }

    function writeUrl() {
        const params = new URLSearchParams(window.location.search);
        const work = params.get('work') || params.get('token');

        params.delete('section');
        params.delete('photo');
        if (currentSection !== (site.default_section || 'ai_art')) {
            params.set('section', currentSection);
        }
        if (currentSection === 'photography') {
            const def = config().photography?.default_subsection || 'photo';
            if (currentPhotoKind !== def) {
                params.set('photo', currentPhotoKind);
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
        if (id === 'photography') {
            currentPhotoKind = config().photography?.default_subsection || 'photo';
        }
        syncNavUi();
        writeUrl();
        document.dispatchEvent(new CustomEvent('gallery:section'));
        document.getElementById('gallery-root')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function setPhotoKind(kind) {
        currentPhotoKind = kind;
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

        const subnav = document.getElementById('photo-subnav');
        if (subnav) {
            subnav.hidden = currentSection !== 'photography';
        }

        document.querySelectorAll('[data-photo-kind]').forEach((el) => {
            const active =
                currentSection === 'photography' && el.dataset.photoKind === currentPhotoKind;
            el.classList.toggle('is-active', active);
            el.setAttribute('aria-pressed', String(active));
        });
    }

    function filterNfts(allNfts) {
        return allNfts.filter((nft) => {
            const medium = nft.medium || 'ai_art';
            if (currentSection === 'ai_art') {
                return medium === 'ai_art';
            }
            if (currentSection === 'photography') {
                if (medium !== 'photography') return false;
                const kind = nft.photo_kind || 'photo';
                return kind === currentPhotoKind;
            }
            return medium === currentSection;
        });
    }

    function getCurrentSection() {
        return currentSection;
    }

    function getPhotoKind() {
        return currentPhotoKind;
    }

    function isPhotoOther() {
        return currentSection === 'photography' && currentPhotoKind === 'other';
    }

    function getSectionMeta() {
        return config()[currentSection] || {};
    }

    function emptyMessage() {
        if (currentSection !== 'photography') {
            return 'No works in this section yet.';
        }
        const msgs = config().photography?.empty_messages || {};
        return msgs[currentPhotoKind] || 'No works in this section yet.';
    }

    function activateForNft(nft, { silent = false } = {}) {
        const medium = nft.medium || 'ai_art';
        const kind = nft.photo_kind || 'photo';
        const same =
            medium === currentSection &&
            (medium !== 'photography' || kind === currentPhotoKind);
        if (same) return;

        currentSection = medium;
        if (medium === 'photography') {
            currentPhotoKind = kind;
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
        getPhotoKind,
        isPhotoOther,
        getSectionMeta,
        emptyMessage,
        activateForNft,
        setSection,
    };
})();