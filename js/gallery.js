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
        if (symbol === 'XTZ' && prefix === 'current_price' && nft.current_price_xtz != null) {
            return nft.current_price_xtz;
        }
        return null;
    }

    function currencySuffix(symbol) {
        return symbol.toLowerCase();
    }

    const MARKETPLACE_NAMES = {
        objkt: 'OBJKT',
        opensea: 'OpenSea',
        salvor: 'Salvor',
        xrp_cafe: 'XRP.Cafe',
        tradeport: 'TradePort',
    };

    const CHAIN_LABELS = {
        avalanche: 'Avalanche',
        tezos: 'Tezos',
        polygon: 'Polygon',
        base: 'Base',
        ethereum: 'Ethereum',
        sui: 'Sui',
        xrpl: 'XRPL',
    };

    function isObjktNft(nft) {
        return nft.chain === 'tezos' || nft.marketplace === 'objkt';
    }

    function chainLabel(nft) {
        const chain = nft.chain || collectionInfo.chain || 'avalanche';
        return CHAIN_LABELS[chain] || chain;
    }

    function marketplaceName(nft) {
        const key = nft.marketplace || (isObjktNft(nft) ? 'objkt' : 'opensea');
        return MARKETPLACE_NAMES[key] || key;
    }

    function marketplaceLabel(nft) {
        return `View on ${marketplaceName(nft)}`;
    }

    function marketplaceUrl(nft) {
        return nft.marketplace_url || nft.objkt_url || nft.opensea_url || '';
    }

    function tokenLabel(nft) {
        if (isObjktNft(nft) && nft.tezos_token_id != null && nft.tezos_token_id !== '') {
            return `Tezos #${nft.tezos_token_id}`;
        }
        return `Token #${nft.token_id}`;
    }

    function formatPrice(nft) {
        const symbol = currencyForNft(nft);
        const listed = priceField(nft, 'current_price', symbol);
        const mint = priceField(nft, 'mint_price', symbol);
        const lastSale = priceField(nft, 'last_sale_price', symbol);
        if (listed != null && nft.listing_status === 'For Sale') {
            return {
                text: `${listed} ${symbol}`,
                hint: `Listed · ${chainLabel(nft)}`,
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
        return { text: '—', hint: chainLabel(nft), kind: 'unknown' };
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
            TipCreator.init({
                evm_wallet: collectionInfo.creator_wallet,
                btc_wallet: collectionInfo.btc_tip_wallet,
                solana_wallet: collectionInfo.solana_tip_wallet,
                evm_domains: collectionInfo.evm_domains,
                tezos_domains: collectionInfo.tezos_domains,
            });
            GalleryShare.init({
                site_url: collectionInfo.site_url,
            });
            syncSectionPromo();
            refresh();
            scrollToWorkFromUrl();

            document.addEventListener('gallery:filter', refresh);
            document.addEventListener('gallery:likes', refresh);
            document.addEventListener('gallery:section', () => {
                syncSectionNfts();
                syncSectionPromo();
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
        const marketplacesEl = document.getElementById('hero-marketplaces');

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
        if (marketplacesEl) marketplacesEl.hidden = !(info.marketplace_links || []).length;

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

    function showCommunityTokens() {
        const section = GallerySections.getCurrentSection();
        return section === 'ai_art' || section === 'photography';
    }

    function syncSectionPromo() {
        const el = document.getElementById('section-promo');
        const cfg = siteConfig?.community_tokens;
        if (!el) return;

        const tokens = (cfg?.tokens || []).filter((item) => item?.title);
        const show = Boolean(cfg?.enabled) && showCommunityTokens() && tokens.length > 0;
        el.hidden = !show;
        if (!show) return;

        const eyebrowEl = document.getElementById('section-promo-eyebrow');
        const leadEl = document.getElementById('section-promo-lead');
        const listEl = document.getElementById('section-promo-tokens');

        if (eyebrowEl) eyebrowEl.textContent = cfg.eyebrow || '';
        if (leadEl) leadEl.textContent = cfg.lead || '';

        if (!listEl) return;

        listEl.innerHTML = tokens
            .map((token) => {
                const title = escapeHtml(token.title || '');
                const symbol = escapeHtml(token.symbol || '');
                const chain = escapeHtml(token.chain || '');
                const contract = escapeHtml(token.contract || '');
                const url = escapeHtml(token.community_url || '#');
                const cta = escapeHtml(token.cta_label || 'Learn more →');
                const chainBit = chain ? `<span class="section-promo__chain"> · ${chain}</span>` : '';

                return `
                    <article class="section-promo__item">
                        <h3 class="section-promo__title">${title}</h3>
                        <p class="section-promo__token">
                            <span class="section-promo__symbol">${symbol}</span>${chainBit}
                        </p>
                        <p class="section-promo__contract" title="${contract}">${contract}</p>
                        <a class="btn btn--ghost btn--small section-promo__cta" href="${url}" target="_blank" rel="noopener noreferrer">${cta}</a>
                    </article>
                `;
            })
            .join('');
    }

    function renderLinkPills(containerId, items) {
        const el = document.getElementById(containerId);
        if (!el) return;

        const markup = (items || [])
            .filter((item) => item?.url || typeof item === 'string')
            .map((item) => {
                if (typeof item === 'string') {
                    const label = escapeHtml(item);
                    const url = escapeHtml(`https://${item}`);
                    return `<a class="social-links__link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
                }
                const label = escapeHtml(item.label || item.id || 'Link');
                const url = escapeHtml(item.url);
                return `<a class="social-links__link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
            })
            .join('');

        el.innerHTML = markup;
        el.hidden = !markup;
    }

    function renderWalletNames(containerId, items) {
        const el = document.getElementById(containerId);
        if (!el) return;

        const names = (items || []).filter((item) => item?.label).map((item) => item.label);
        if (!names.length) {
            el.hidden = true;
            el.innerHTML = '';
            return;
        }

        el.innerHTML = names
            .map((name) => {
                const safe = escapeHtml(name);
                return `<button type="button" class="wallet-names__pill" data-copy="${safe}" title="Copy ${safe}">${safe}</button>`;
            })
            .join('');

        el.hidden = false;
        el.querySelectorAll('[data-copy]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const value = btn.getAttribute('data-copy') || '';
                const original = btn.textContent;
                try {
                    await navigator.clipboard.writeText(value);
                    btn.textContent = 'Copied';
                } catch {
                    btn.textContent = 'Copy failed';
                }
                window.setTimeout(() => {
                    btn.textContent = original;
                }, 1400);
            });
        });
    }

    function renderSocialLinks(info) {
        renderLinkPills('about-social', info?.social_links);
        renderWalletNames('about-wallets', info?.wallet_names || info?.domain_links);
    }

    function renderMarketplaceLinks(info) {
        const el = document.getElementById('about-marketplaces-nav');
        if (!el) return;

        const items = (info?.marketplace_links || []).filter((item) => item?.url);
        if (!items.length) {
            el.hidden = true;
            el.innerHTML = '';
            return;
        }

        el.innerHTML = items
            .map((item, index) => {
                const label = escapeHtml(item.label || item.id || 'Marketplace');
                const url = escapeHtml(item.url);
                const primary = index === 0 ? ' marketplace-links__link--primary' : '';
                const note = item.note ? ` title="${escapeHtml(item.note)}"` : '';
                return `<a class="marketplace-links__link${primary}" href="${url}" target="_blank" rel="noopener noreferrer"${note}>${label}</a>`;
            })
            .join('');
        el.hidden = false;
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

        renderSocialLinks(info);
        renderMarketplaceLinks(info);
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
        card.querySelector('.nft-tip')?.addEventListener('click', () => {
            TipCreator.open();
        });
        GalleryShare.bindButton(card.querySelector('.nft-share'), nft);
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
        const osHref = escapeHtml(OpenSeaLinks.buyUrl(marketplaceUrl(nft)));
        const marketLabel = marketplaceLabel(nft);
        const tokenLabelText = tokenLabel(nft);
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
                        <p class="nft-card__token">${escapeHtml(tokenLabelText)}</p>
                    </div>
                    <div class="nft-card__engage">
                        <button type="button" class="nft-like" aria-label="Like ${name}" aria-pressed="false">
                            <span class="nft-like__icon" aria-hidden="true">♥</span>
                            <span class="nft-like__count">${likesCount}</span>
                        </button>
                        <button type="button" class="nft-save" aria-label="Save ${name} for later" aria-pressed="false" title="Save for later">
                            <span class="nft-save__icon" aria-hidden="true">☆</span>
                        </button>
                        <button type="button" class="nft-share" aria-label="Share ${name}" title="Share">
                            <span class="nft-share__icon" aria-hidden="true">↗</span>
                        </button>
                        <button type="button" class="nft-tip" aria-label="Tip the artist" title="Tip the artist">
                            <span class="nft-tip__icon" aria-hidden="true">◎</span>
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
                    <a class="btn btn--primary btn--block" href="${osHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(marketLabel)}</a>
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