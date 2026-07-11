/**
 * Jack Beatnic Gallery — showcase (blueprint Faza 3)
 */
const Gallery = (() => {
    const IMAGE_PROXY = 'weserv';

    let allNfts = [];
    let sectionNfts = [];
    let collectionInfo = {};
    let siteConfig = {};

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }

    function setupProtection() {
        const blockImageActions = (e) => {
            if (
                e.target.closest('.nft-image-wrap') ||
                e.target.closest('.signature-logo-wrap')
            ) {
                e.preventDefault();
            }
        };
        document.addEventListener('contextmenu', blockImageActions);
        document.addEventListener('dragstart', blockImageActions);
    }

    function currencyForNft(nft) {
        return nft.listing_currency || collectionInfo.native_currency || 'AVAX';
    }

    function priceField(nft, prefix, symbol) {
        const key = `${prefix}_${currencySuffix(symbol)}`;
        if (nft[key] != null && nft[key] !== '') return nft[key];
        if (symbol === 'AVAX' && nft[`${prefix}_avax`] != null) return nft[`${prefix}_avax`];
        return null;
    }

    function currencySuffix(symbol) {
        return symbol.toLowerCase();
    }

    function formatPrice(nft) {
        const symbol = currencyForNft(nft);
        const listed = priceField(nft, 'current_price', symbol);
        const mint = priceField(nft, 'mint_price', symbol);
        const lastSale = priceField(nft, 'last_sale_price', symbol);

        if (listed != null && nft.listing_status === 'For Sale') {
            return {
                text: `${listed} ${symbol}`,
                hint: 'Listed on OpenSea',
                kind: 'listed',
            };
        }
        if (lastSale != null) {
            return {
                text: `${lastSale} ${symbol}`,
                hint: 'Last sale',
                kind: 'sale',
            };
        }
        if (mint != null) {
            return {
                text: `${mint} ${symbol}`,
                hint: 'Mint price',
                kind: 'mint',
            };
        }
        return { text: '—', hint: 'Check OpenSea', kind: 'unknown' };
    }

    function syncSectionNfts() {
        sectionNfts = GallerySections.filterNfts(allNfts);
        const exploreTitle = document.querySelector('.filters-panel__title');
        const meta = GallerySections.getSectionMeta();
        if (exploreTitle) {
            exploreTitle.textContent = meta.explore_title || 'Explore';
        }
        GalleryFilters.reinit(sectionNfts);
        applyHero();
    }

    function heroFeaturedNft() {
        return (
            allNfts.find((nft) => (nft.medium || 'ai_art') === 'ai_art') ||
            sectionNfts[0] ||
            allNfts[0]
        );
    }

    function getDisplayList() {
        const sorted = GalleryLikes.sortForDisplay(sectionNfts);
        const filtered = GalleryFilters.apply(sorted);
        return GalleryLikes.filterSaved(filtered);
    }

    function refresh() {
        render(getDisplayList());
    }

    async function load() {
        const grid = document.getElementById('gallery-grid');
        try {
            const response = await fetch('gallery.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            allNfts = data.nfts || [];
            collectionInfo = data.collection_info || {};
            siteConfig = data.site || {};

            GallerySections.init(siteConfig);
            applyCollectionInfo(collectionInfo);
            GalleryFilters.bindOnce();
            preselectWorkSection();
            syncSectionNfts();
            TipCreator.init(collectionInfo.creator_wallet);
            refresh();
            scrollToWorkFromUrl();

            document.addEventListener('gallery:filter', refresh);
            document.addEventListener('gallery:likes', refresh);
            document.addEventListener('gallery:section', () => {
                syncSectionNfts();
                refresh();
            });
        } catch (error) {
            console.error('Gallery load error:', error);
            grid.innerHTML = '<p class="gallery-error">Failed to load the gallery.</p>';
        }
    }

    function heroIntroParagraphs(info) {
        const intro = info.hero_intro;
        if (Array.isArray(intro)) {
            return intro.map((p) => String(p).trim()).filter(Boolean);
        }
        if (typeof intro === 'string' && intro.trim()) {
            return intro.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
        }
        const fallback =
            (info.description || '').split(/\s*[–—]\s*/).slice(1).join(' — ').trim() ||
            info.description ||
            '';
        return fallback ? [fallback] : [];
    }

    function applyHero() {
        const info = collectionInfo;
        const featured = heroFeaturedNft();
        const titleEl = document.getElementById('hero-title');
        const taglineEl = document.getElementById('hero-tagline');
        const descEl = document.getElementById('hero-description');
        const imgEl = document.getElementById('hero-image');
        const openseaEl = document.getElementById('hero-opensea');

        const title = info.hero_title || info.artist || info.project_name || 'Jack Beatnic';
        const tagline = info.hero_tagline || '';
        const paragraphs = heroIntroParagraphs(info);

        if (titleEl) titleEl.textContent = title;
        if (taglineEl) taglineEl.textContent = tagline;
        if (descEl) {
            descEl.innerHTML = paragraphs
                .map((text) => `<p>${escapeHtml(text)}</p>`)
                .join('');
        }
        if (openseaEl && info.opensea_profile) openseaEl.href = info.opensea_profile;

        const hero = document.querySelector('.hero');
        if (imgEl) {
            if (featured?.image_url) {
                imgEl.src = ImageProxy.displayUrl(featured.image_url, IMAGE_PROXY, 1280, 640);
                imgEl.alt = featured.name || title;
                imgEl.hidden = false;
                hero?.classList.remove('hero--text-only');
            } else {
                imgEl.removeAttribute('src');
                imgEl.alt = title;
                imgEl.hidden = true;
                hero?.classList.add('hero--text-only');
            }
        }
    }

    function applyCollectionInfo(info) {
        if (!info) return;

        const aboutEl = document.getElementById('about-content');
        const aboutParas = Array.isArray(info.about)
            ? info.about
            : info.about
              ? [info.about]
              : [];
        if (aboutEl && aboutParas.length) {
            aboutEl.innerHTML = aboutParas
                .map((text) => `<p>${escapeHtml(text)}</p>`)
                .join('');
        }

        const openseaEl = document.getElementById('about-opensea');
        if (openseaEl && info.opensea_profile) {
            openseaEl.href = info.opensea_profile;
        }
    }

    function render(filtered) {
        const container = document.getElementById('gallery-grid');
        const countEl = document.getElementById('filter-count');
        container.innerHTML = '';

        if (countEl) {
            const total = sectionNfts.length;
            countEl.textContent =
                filtered.length === total
                    ? `${filtered.length} works`
                    : `${filtered.length} of ${total}`;
        }

        if (filtered.length === 0) {
            let msg = GallerySections.emptyMessage();
            if (GalleryLikes.getSavedOnly()) {
                msg = 'No saved works yet — bookmark pieces to find them here.';
            } else if (sectionNfts.length > 0) {
                msg = 'No works match the selected filters.';
            }
            container.innerHTML = `<p class="gallery-empty">${escapeHtml(msg)}</p>`;
            return;
        }

        filtered.forEach((nft) => container.appendChild(buildCard(nft)));
    }

    function bindEngage(card, nft, key) {
        const likeBtn = card.querySelector('.nft-like');
        const saveBtn = card.querySelector('.nft-save');

        const syncState = () => {
            if (likeBtn) {
                likeBtn.classList.toggle('is-active', GalleryLikes.isLiked(key));
                likeBtn.setAttribute('aria-pressed', String(GalleryLikes.isLiked(key)));
            }
            if (saveBtn) {
                saveBtn.classList.toggle('is-active', GalleryLikes.isSaved(key));
                saveBtn.setAttribute('aria-pressed', String(GalleryLikes.isSaved(key)));
            }
        };

        likeBtn?.addEventListener('click', () => {
            GalleryLikes.toggleLike(key);
            syncState();
        });
        saveBtn?.addEventListener('click', () => {
            GalleryLikes.toggleSaved(key);
            syncState();
        });
        syncState();
    }

    function findWorkNft() {
        const params = new URLSearchParams(window.location.search);
        const work = params.get('work') || params.get('token');
        if (!work) return null;
        const tokenId = Number(work);
        if (!Number.isFinite(tokenId)) return null;
        return allNfts.find((item) => Number(item.token_id) === tokenId) || null;
    }

    function preselectWorkSection() {
        const nft = findWorkNft();
        if (nft) GallerySections.activateForNft(nft, { silent: true });
    }

    function scrollToWorkFromUrl() {
        const nft = findWorkNft();
        if (!nft) return;

        window.requestAnimationFrame(() => {
            const key = GalleryLikes.nftKey(nft);
            const card = document.querySelector(`[data-nft-key="${CSS.escape(key)}"]`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('nft-card--highlight');
                window.setTimeout(() => card.classList.remove('nft-card--highlight'), 2400);
            }
        });
    }

    function buildCard(nft) {
        const card = document.createElement('article');
        card.className = 'nft-card';
        card.dataset.tokenId = String(nft.token_id);

        const key = GalleryLikes.nftKey(nft);
        card.dataset.nftKey = key;

        const thumbSrc = ImageProxy.displayUrl(nft.image_url, IMAGE_PROXY);
        const viewSrc = ImageProxy.displayUrl(nft.image_url, IMAGE_PROXY, 880, 660);
        const name = escapeHtml(nft.name);
        const description = escapeHtml(nft.ai?.description);
        const category = escapeHtml((nft.ai?.category || '').toUpperCase());
        const mood = nft.ai?.mood_score ?? '—';
        const osHref = escapeHtml(OpenSeaLinks.buyUrl(nft.opensea_url));
        const price = formatPrice(nft);
        const likesCount = nft.likes_count ?? 0;

        const colorsHtml = (nft.ai?.dominant_colors || [])
            .map(
                (color) =>
                    `<span class="color-dot" style="background-color:${escapeHtml(color)}" title="${escapeHtml(color)}"></span>`
            )
            .join('');

        const tagsHtml = (nft.ai?.vibe_tags || [])
            .slice(0, 4)
            .map((tag) => `<span class="nft-tag">${escapeHtml(tag)}</span>`)
            .join('');

        card.innerHTML = `
            <div class="nft-image-wrap">
                <img src="${thumbSrc}"
                     alt="${name}"
                     width="${ImageProxy.THUMB_WIDTH}"
                     height="${ImageProxy.THUMB_HEIGHT}"
                     loading="lazy"
                     decoding="async"
                     draggable="false"
                     referrerpolicy="no-referrer">
                <button type="button" class="nft-card__view" aria-label="View ${name}">View</button>
                <div class="nft-image-shield" aria-hidden="true"></div>
            </div>
            <div class="nft-card__body">
                <div class="nft-card__head">
                    <div>
                        <h3 class="nft-card__title">${name}</h3>
                        <p class="nft-card__token">Token #${escapeHtml(String(nft.token_id))}</p>
                    </div>
                    <div class="nft-card__engage">
                        <button type="button" class="nft-like" aria-label="Like ${name}" aria-pressed="false">
                            <span class="nft-like__icon" aria-hidden="true">♥</span>
                            <span class="nft-like__count">${likesCount}</span>
                        </button>
                        <button type="button" class="nft-save" aria-label="Save ${name} for later" aria-pressed="false" title="Save for later">
                            <span class="nft-save__icon" aria-hidden="true">☆</span>
                        </button>
                    </div>
                </div>
                <p class="nft-card__price" title="${escapeHtml(price.hint)}">
                    <span class="nft-card__price-value">${escapeHtml(price.text)}</span>
                </p>
                <p class="nft-card__description">${description}</p>
                <div class="nft-card__tags">${tagsHtml}</div>
                <div class="color-dots nft-card__palette">${colorsHtml}</div>
                <div class="nft-card__actions">
                    <a class="btn btn--primary btn--block" href="${osHref}" target="_blank" rel="noopener noreferrer">View on OpenSea</a>
                </div>
                <div class="nft-card__footer">
                    <div>
                        <span class="nft-card__category">${category}</span>
                        <span class="nft-card__mood">Mood ${mood}/10</span>
                    </div>
                </div>
            </div>
        `;

        card.querySelector('.nft-card__view')?.addEventListener('click', () => {
            Lightbox.open({ src: viewSrc, alt: nft.name, label: nft.name });
        });
        bindEngage(card, nft, key);

        return card;
    }

    function init() {
        setupProtection();
        load();
    }

    return { init };
})();

window.addEventListener('DOMContentLoaded', () => Gallery.init());