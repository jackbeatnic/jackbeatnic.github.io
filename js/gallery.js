/**
 * Jack Beatnic Gallery — showcase (blueprint Faza 3)
 */
const Gallery = (() => {
    const IMAGE_PROXY = 'weserv';

    let nfts = [];
    let collectionInfo = {};

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

    function currencySuffix(symbol) {
        return symbol.toLowerCase();
    }

    function priceField(nft, prefix, symbol) {
        const key = `${prefix}_${currencySuffix(symbol)}`;
        if (nft[key] != null && nft[key] !== '') return nft[key];
        if (symbol === 'AVAX' && nft[`${prefix}_avax`] != null) return nft[`${prefix}_avax`];
        return null;
    }

    function formatPrice(nft) {
        const symbol = collectionInfo.native_currency || 'AVAX';
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

    async function load() {
        const grid = document.getElementById('gallery-grid');
        try {
            const response = await fetch('gallery.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            nfts = data.nfts || [];
            collectionInfo = data.collection_info || {};

            applyCollectionInfo(collectionInfo);
            applyHero(nfts[0], collectionInfo);
            GalleryFilters.init(nfts);
            TipCreator.init(collectionInfo.creator_wallet);
            render(nfts);

            document.addEventListener('gallery:filter', () => {
                render(GalleryFilters.apply(nfts));
            });
        } catch (error) {
            console.error('Gallery load error:', error);
            grid.innerHTML = '<p class="gallery-error">Failed to load the gallery.</p>';
        }
    }

    function collectionCopy(info) {
        const parts = (info.description || '').split(/\s*[–—]\s*/).map((s) => s.trim());
        return {
            title: parts[0] || info.project_name || '',
            description: parts[1] || info.description || '',
        };
    }

    function applyHero(featured, info) {
        if (!info) return;
        const copy = collectionCopy(info);
        const titleEl = document.getElementById('hero-title');
        const descEl = document.getElementById('hero-description');
        const imgEl = document.getElementById('hero-image');
        if (titleEl) titleEl.textContent = copy.title;
        if (descEl) descEl.textContent = copy.description;
        if (imgEl && featured?.image_url) {
            imgEl.src = ImageProxy.displayUrl(featured.image_url, IMAGE_PROXY, 1280, 640);
            imgEl.alt = featured.name || copy.title;
        }
    }

    function applyCollectionInfo(info) {
        if (!info) return;
        const copy = collectionCopy(info);

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
            countEl.textContent =
                filtered.length === nfts.length
                    ? `${filtered.length} works`
                    : `${filtered.length} of ${nfts.length}`;
        }

        if (filtered.length === 0) {
            container.innerHTML =
                '<p class="gallery-empty">No works match the selected filters.</p>';
            return;
        }

        filtered.forEach((nft) => container.appendChild(buildCard(nft)));
    }

    function buildCard(nft) {
        const card = document.createElement('article');
        card.className = 'nft-card';

        const thumbSrc = ImageProxy.displayUrl(nft.image_url, IMAGE_PROXY);
        const name = escapeHtml(nft.name);
        const description = escapeHtml(nft.ai?.description);
        const category = escapeHtml((nft.ai?.category || '').toUpperCase());
        const mood = nft.ai?.mood_score ?? '—';
        const buyHref = escapeHtml(OpenSeaLinks.buyUrl(nft.opensea_url));
        const offerHref = escapeHtml(OpenSeaLinks.offerUrl(nft.opensea_url));
        const price = formatPrice(nft);

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

        const viewSrc = ImageProxy.displayUrl(nft.image_url, IMAGE_PROXY, 880, 660);

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
                    <div class="color-dots">${colorsHtml}</div>
                </div>
                <p class="nft-card__price" title="${escapeHtml(price.hint)}">
                    <span class="nft-card__price-value">${escapeHtml(price.text)}</span>
                </p>
                <p class="nft-card__description">${description}</p>
                <div class="nft-card__tags">${tagsHtml}</div>
                <div class="nft-card__actions">
                    <a class="btn btn--primary" href="${buyHref}" target="_blank" rel="noopener noreferrer">Buy now</a>
                    <a class="btn btn--ghost" href="${offerHref}" target="_blank" rel="noopener noreferrer">Make offer</a>
                </div>
                <div class="nft-card__footer">
                    <div>
                        <span class="nft-card__category">${category}</span>
                        <span class="nft-card__mood">Mood ${mood}/10</span>
                    </div>
                </div>
            </div>
        `;

        const viewBtn = card.querySelector('.nft-card__view');
        if (viewBtn) {
            viewBtn.addEventListener('click', () => {
                Lightbox.open({
                    src: viewSrc,
                    alt: nft.name,
                    label: nft.name,
                });
            });
        }

        return card;
    }

    function init() {
        setupProtection();
        load();
    }

    return { init };
})();

window.addEventListener('DOMContentLoaded', () => Gallery.init());