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

    function isManifoldAuction(nft) {
        return nft.medium === 'manifold_auction' || nft.marketplace === 'manifold';
    }

    function currencyForNft(nft) {
        if (nft.listing_currency) return nft.listing_currency;
        if (nft.chain === 'xrpl' || nft.medium === 'xrpl_ai') return 'XRP';
        if (isManifoldAuction(nft)) return nft.listing_currency || 'ETH';
        return collectionInfo.native_currency || 'AVAX';
    }

    function priceField(nft, prefix, symbol) {
        const key = `${prefix}_${currencySuffix(symbol)}`;
        if (nft[key] != null && nft[key] !== '') return nft[key];
        if (symbol === 'AVAX' && nft[`${prefix}_avax`] != null) return nft[`${prefix}_avax`];
        if (symbol === 'XTZ' && prefix === 'current_price' && nft.current_price_xtz != null) {
            return nft.current_price_xtz;
        }
        if (symbol === 'XRP' && prefix === 'current_price' && nft.current_price_xrp != null) {
            return nft.current_price_xrp;
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
        manifold: 'Manifold',
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

    function isXrpCafeNft(nft) {
        return (
            nft.chain === 'xrpl' ||
            nft.medium === 'xrpl_ai' ||
            nft.marketplace === 'xrp_cafe' ||
            nft.source === 'xrp_cafe'
        );
    }

    function chainLabel(nft) {
        const chain = nft.chain || collectionInfo.chain || 'avalanche';
        return CHAIN_LABELS[chain] || chain;
    }

    function marketplaceName(nft) {
        if (isManifoldAuction(nft)) return MARKETPLACE_NAMES.manifold;
        if (isXrpCafeNft(nft)) return MARKETPLACE_NAMES.xrp_cafe;
        const key = nft.marketplace || (isObjktNft(nft) ? 'objkt' : 'opensea');
        return MARKETPLACE_NAMES[key] || key;
    }

    function marketplaceLabel(nft) {
        if (isManifoldAuction(nft)) return 'Bid on Manifold';
        if (nft.source === 'manifold' && nft.manifold_url) return 'View on Manifold';
        return `View on ${marketplaceName(nft)}`;
    }

    function marketplaceUrl(nft) {
        if (isManifoldAuction(nft) || nft.manifold_url) {
            return nft.manifold_url || nft.marketplace_url || '';
        }
        if (isXrpCafeNft(nft)) {
            return (
                nft.xrp_cafe_url ||
                nft.marketplace_url ||
                (nft.xrpl_nft_id ? `https://xrp.cafe/nft/${nft.xrpl_nft_id}` : '')
            );
        }
        return nft.marketplace_url || nft.objkt_url || nft.opensea_url || '';
    }

    function tokenLabel(nft) {
        if (isObjktNft(nft) && nft.tezos_token_id != null && nft.tezos_token_id !== '') {
            return `Tezos #${nft.tezos_token_id}`;
        }
        if (nft.chain === 'xrpl' || nft.medium === 'xrpl_ai') {
            return nft.name || `XRPL #${nft.nft_serial || nft.token_id}`;
        }
        if (isManifoldAuction(nft)) {
            const chain = chainLabel(nft);
            return `Manifold · ${chain}`;
        }
        return `Token #${nft.token_id}`;
    }

    function formatPrice(nft) {
        if (isManifoldAuction(nft)) {
            const symbol = currencyForNft(nft);
            const bid = nft.current_bid_eth;
            const reserve = nft.reserve_eth;
            if (bid != null && reserve != null && bid > reserve) {
                return {
                    text: `${bid} ${symbol}`,
                    hint: `Current bid · reserve ${reserve} ${symbol}`,
                    kind: 'listed',
                };
            }
            if (reserve != null) {
                return {
                    text: `${reserve} ${symbol}`,
                    hint: 'Reserve · live auction',
                    kind: 'listed',
                };
            }
            return { text: 'Live auction', hint: chainLabel(nft), kind: 'listed' };
        }
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

    function syncFiltersPanel() {
        const panel = document.getElementById('explore');
        if (!panel) return;
        panel.hidden = GallerySections.isAtelierSection();
    }

    function syncSectionNfts() {
        sectionNfts = GallerySections.filterNfts(allNfts);
        const exploreTitle = document.querySelector('.filters-panel__title');
        const meta = GallerySections.getSectionMeta();
        if (exploreTitle) {
            exploreTitle.textContent = meta.explore_title || 'Explore';
        }
        syncFiltersPanel();
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

    function isAiPlayGalleryEnabledInData(data) {
        const catalog = data?.collection_info?.ai_series_catalog || {};
        if (catalog.series?.jb_ai_play?.enabled === false) return false;
        const disabled = data?.site?.sections?.ai_art?.disabled_series || [];
        return !disabled.includes('jb_ai_play');
    }

    async function load() {
        const grid = document.getElementById('gallery-grid');
        try {
            const mainRes = await fetch('gallery.json');
            if (!mainRes.ok) throw new Error(`HTTP ${mainRes.status}`);
            const data = await mainRes.json();
            const aiPlayEnabled = isAiPlayGalleryEnabledInData(data);

            const [xrpRes, aiPlayRes, auctionRes] = await Promise.all([
                fetch('xrp_gallery.json'),
                aiPlayEnabled ? fetch('ai_play_gallery.json') : Promise.resolve(null),
                fetch('auctions_gallery.json'),
            ]);
            const xrpData = xrpRes.ok ? await xrpRes.json() : { nfts: [] };
            const aiPlayData =
                aiPlayEnabled && aiPlayRes?.ok ? await aiPlayRes.json() : { nfts: [] };
            const auctionData = auctionRes.ok ? await auctionRes.json() : { nfts: [] };

            allNfts = [
                ...(data.nfts || []),
                ...(xrpData.nfts || []),
                ...(aiPlayData.nfts || []),
                ...(auctionData.nfts || []),
            ];
            collectionInfo = {
                ...(data.collection_info || {}),
                xrpl: xrpData.collection_info || {},
                manifold: auctionData.collection_info || {},
                manifold_links: data.collection_info?.manifold_links || {},
                atelier_wallets:
                    data.collection_info?.atelier_wallets ||
                    data.collection_info?.studio_market_wallets ||
                    {},
                collector_access: data.collection_info?.collector_access || {},
            };
            const mainSections = data.site?.sections || {};
            const xrpSections = xrpData.site?.sections || {};
            const auctionSections = auctionData.site?.sections || {};
            const manifoldChains = collectionInfo.manifold?.chains || {};
            const disabledMarketChains = Object.entries(manifoldChains)
                .filter(([, cfg]) => cfg && cfg.enabled === false)
                .map(([key]) => key);
            const mainMarket =
                mainSections.atelier ||
                mainSections.studio_market ||
                mainSections.auctions ||
                {};
            const auctionMarket =
                auctionSections.atelier ||
                auctionSections.studio_market ||
                auctionSections.auctions ||
                {};
            siteConfig = {
                ...(data.site || {}),
                ai_series_catalog: data.collection_info?.ai_series_catalog || {},
                sections: {
                    ...mainSections,
                    ...xrpSections,
                    ...auctionSections,
                    ai_art: {
                        ...(mainSections.ai_art || {}),
                        ...(xrpSections.ai_art || {}),
                        subsections:
                            xrpSections.ai_art?.subsections ||
                            mainSections.ai_art?.subsections,
                        empty_messages: {
                            ...(mainSections.ai_art?.empty_messages || {}),
                            ...(xrpSections.ai_art?.empty_messages || {}),
                        },
                        explore_titles: {
                            ...(mainSections.ai_art?.explore_titles || {}),
                            ...(xrpSections.ai_art?.explore_titles || {}),
                        },
                    },
                    atelier: {
                        ...mainMarket,
                        ...auctionMarket,
                        disabled_chains: disabledMarketChains,
                    },
                },
            };

            GallerySections.init(siteConfig);
            AtelierWallet.init(collectionInfo);
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
        if (section === 'photography') return true;
        return section === 'ai_art' && GallerySections.getAiKind() === 'opensea';
    }

    function syncSectionPromo() {
        const el = document.getElementById('section-promo');
        if (!el) return;

        const eyebrowEl = document.getElementById('section-promo-eyebrow');
        const leadEl = document.getElementById('section-promo-lead');
        const listEl = document.getElementById('section-promo-tokens');

        if (GallerySections.isAtelierSection()) {
            const meta = GallerySections.getSectionMeta();
            const linkPack = collectionInfo.manifold_links || {};
            const navLinks = (linkPack.nav || []).filter((item) => item?.url && item?.label);
            const show = navLinks.length > 0;
            el.hidden = !show;
            if (!show) return;

            const marketKind = GallerySections.getMarketKind();
            const chainLabel =
                GallerySections.getMarketChain() === 'ethereum' ? 'Ethereum' : 'Base';
            const kindLabel = marketKind === 'editions' ? 'Limited Editions' : 'Auctions';

            if (eyebrowEl) eyebrowEl.textContent = meta.promo_eyebrow || 'The Atelier';
            if (leadEl) {
                leadEl.textContent =
                    meta.promo_lead ||
                    'A private room for those who collect closely — rare auctions and numbered editions in small batches, offered straight from the studio.';
            }
            if (listEl) {
                const collectorHint =
                    meta.promo_collector ||
                    'Returning collectors may soon unlock early access and quiet releases — nothing personal, only your wallet.';
                const connectLabel = escapeHtml(AtelierWallet.connectLabel());
                const connectBlock = AtelierWallet.connectEnabled()
                    ? `<button type="button" class="btn btn--primary btn--small section-promo__connect" id="atelier-connect-wallet">${connectLabel}</button>`
                    : '';
                const linkButtons = navLinks
                    .map((item) => {
                        const href = escapeHtml(item.url);
                        const label = escapeHtml(item.label);
                        const hint = item.hint ? ` title="${escapeHtml(item.hint)}"` : '';
                        const primary = item.id === 'studio' ? ' btn--primary' : ' btn--ghost';
                        return `<a class="btn btn--small section-promo__cta${primary}" href="${href}" target="_blank" rel="noopener noreferrer"${hint}>${label}</a>`;
                    })
                    .join('');

                listEl.innerHTML = `
                    <article class="section-promo__item">
                        <h3 class="section-promo__title">The Atelier</h3>
                        <p class="section-promo__token">
                            <span class="section-promo__symbol">${escapeHtml(kindLabel)}</span>
                            <span class="section-promo__chain"> · ${escapeHtml(chainLabel)}</span>
                        </p>
                        <p class="section-promo__collector">${escapeHtml(collectorHint)}</p>
                        <div class="section-promo__actions">
                            ${connectBlock}
                            ${linkButtons}
                        </div>
                    </article>
                `;

                const connectBtn = listEl.querySelector('#atelier-connect-wallet');
                connectBtn?.addEventListener('click', async () => {
                    try {
                        await AtelierWallet.connect();
                    } catch (err) {
                        connectBtn.title = err?.message || 'Coming soon';
                    }
                });
            }
            return;
        }

        if (
            GallerySections.getCurrentSection() === 'ai_art' &&
            GallerySections.getAiKind() === 'xrpl'
        ) {
            const meta = GallerySections.getSectionMeta();
            const xrplInfo = collectionInfo.xrpl || {};
            const collectionUrl =
                meta.collection_url ||
                xrplInfo.xrp_cafe_collection_vanity ||
                xrplInfo.xrp_cafe_collection ||
                '';
            const show = Boolean(collectionUrl);
            el.hidden = !show;
            if (!show) return;

            if (eyebrowEl) eyebrowEl.textContent = meta.promo_eyebrow || 'JB AI Nature on XRPL';
            if (leadEl) {
                leadEl.textContent =
                    meta.promo_lead || 'Collect and trade on XRP.Cafe.';
            }
            if (listEl) {
                const url = escapeHtml(collectionUrl);
                const cta = escapeHtml(meta.collection_cta || 'View collection on XRP.Cafe');
                listEl.innerHTML = `
                    <article class="section-promo__item">
                        <h3 class="section-promo__title">XRP.Cafe</h3>
                        <p class="section-promo__token">
                            <span class="section-promo__symbol">JB AI Nature</span>
                            <span class="section-promo__chain"> · XRPL</span>
                        </p>
                        <a class="btn btn--ghost btn--small section-promo__cta" href="${url}" target="_blank" rel="noopener noreferrer">${cta}</a>
                    </article>
                `;
            }
            return;
        }

        const cfg = siteConfig?.community_tokens;
        const tokens = (cfg?.tokens || []).filter((item) => item?.title);
        const show = Boolean(cfg?.enabled) && showCommunityTokens() && tokens.length > 0;
        el.hidden = !show;
        if (!show) return;

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

        filtered.forEach((nft) => {
            container.appendChild(
                isManifoldAuction(nft) ? buildAuctionCard(nft) : buildCard(nft)
            );
        });
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

    function buildAuctionCard(nft) {
        const card = document.createElement('article');
        card.className = 'nft-card nft-card--auction';
        card.dataset.tokenId = String(nft.token_id);

        const key = GalleryLikes.nftKey(nft);
        card.dataset.nftKey = key;

        const thumbSrc = ImageProxy.displayUrl(nft.image_url, IMAGE_PROXY);
        const viewSrc = ImageProxy.displayUrl(
            nft.image_url,
            IMAGE_PROXY,
            ImageProxy.VIEW_MAX_WIDTH,
            ImageProxy.VIEW_MAX_HEIGHT,
        );
        const name = escapeHtml(nft.name);
        const description = escapeHtml(nft.ai?.description);
        const bidHref = escapeHtml(marketplaceUrl(nft));
        const price = formatPrice(nft);
        const tokenLabelText = tokenLabel(nft);

        card.innerHTML = `
            <div class="nft-image-wrap">
                <span class="nft-card__badge">Live auction</span>
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
                        <button type="button" class="nft-share" aria-label="Share ${name}" title="Share">
                            <span class="nft-share__icon" aria-hidden="true">↗</span>
                        </button>
                    </div>
                </div>
                <p class="nft-card__price" title="${escapeHtml(price.hint)}">
                    <span class="nft-card__price-value">${escapeHtml(price.text)}</span>
                </p>
                <p class="nft-card__description">${description}</p>
                <div class="nft-card__actions">
                    <a class="btn btn--primary btn--block" href="${bidHref}" target="_blank" rel="noopener noreferrer">Bid on Manifold</a>
                </div>
            </div>
        `;

        card.querySelector('.nft-card__view')?.addEventListener('click', () => {
            Lightbox.open({ src: viewSrc, alt: nft.name, label: nft.name });
        });
        GalleryShare.bindButton(card.querySelector('.nft-share'), nft);

        return card;
    }

    function buildCard(nft) {
        const card = document.createElement('article');
        card.className = 'nft-card';
        card.dataset.tokenId = String(nft.token_id);

        const key = GalleryLikes.nftKey(nft);
        card.dataset.nftKey = key;

        const thumbSrc = ImageProxy.displayUrl(nft.image_url, IMAGE_PROXY);
        const viewSrc = ImageProxy.displayUrl(
            nft.image_url,
            IMAGE_PROXY,
            ImageProxy.VIEW_MAX_WIDTH,
            ImageProxy.VIEW_MAX_HEIGHT,
        );
        const name = escapeHtml(nft.name);
        const description = escapeHtml(nft.ai?.description);
        const category = escapeHtml((nft.ai?.category || '').toUpperCase());
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