/**
 * Jack Beatnic Gallery — showcase (blueprint phase 3)
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

    function isObjktAuction(nft) {
        return nft.medium === 'objkt_auction';
    }

    function isLiveAuction(nft) {
        return isManifoldAuction(nft) || isObjktAuction(nft);
    }

    function currencyForNft(nft) {
        if (nft.listing_currency) return nft.listing_currency;
        if (nft.chain === 'xrpl' || nft.medium === 'xrpl_ai') return 'XRP';
        if (nft.chain === 'sui' || nft.medium === 'sui_ai') return 'SUI';
        if (isObjktAuction(nft) || isObjktNft(nft)) return 'XTZ';
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
        if (symbol === 'SUI' && prefix === 'current_price' && nft.current_price_sui != null) {
            return nft.current_price_sui;
        }
        if (symbol === 'SUI' && prefix === 'mint_price' && nft.mint_price_sui != null) {
            return nft.mint_price_sui;
        }
        return null;
    }

    function currencySuffix(symbol) {
        return symbol.toLowerCase();
    }

    /* Card action icons (2026-10-03): inline SVG, thin strokes, no text labels.
       Heart = Like, Bookmark = Save for later, Share = share sheet, Coin = Tip. */
    const CARD_ICONS = {
        like: '<svg class="nft-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M12 20.3s-7.6-4.6-9.2-9.4C1.7 7.6 3.9 4.4 7.3 4.4c2 0 3.6 1.1 4.7 2.8 1.1-1.7 2.7-2.8 4.7-2.8 3.4 0 5.6 3.2 4.5 6.5-1.6 4.8-9.2 9.4-9.2 9.4z"/></svg>',
        save: '<svg class="nft-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/></svg>',
        share: '<svg class="nft-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path class="nft-icon__line" d="M12 14.5V3.5M8 7.3l4-3.8 4 3.8"/><path class="nft-icon__line" d="M8.5 10.5H6v10h12v-10h-2.5"/></svg>',
        tip: '<svg class="nft-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle class="nft-icon__line" cx="12" cy="12" r="8.5"/><path class="nft-icon__line" d="M14.6 9.2c-.5-.9-1.5-1.4-2.6-1.4-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 1.9 2.6.8 2.6 2.1-1.2 2.1-2.6 2.1c-1.2 0-2.2-.5-2.7-1.5M12 6.3v1.5M12 16.2v1.5"/></svg>',
    };

    const MARKETPLACE_NAMES = {
        objkt: 'OBJKT',
        opensea: 'OpenSea',
        salvor: 'Salvor',
        xrp_cafe: 'Bidds',
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

    function objktAvailability(nft) {
        const supply = Number(nft.supply);
        const walletQty = Number(nft.wallet_quantity);
        const listedQty = Number(nft.listed_quantity);
        if (!Number.isFinite(supply) || supply <= 0) return null;

        if (supply === 1) {
            return {
                supply: 1,
                available: walletQty > 0 ? 1 : 0,
                listed: Number.isFinite(listedQty) && listedQty > 0 ? listedQty : 0,
            };
        }

        return {
            supply,
            available: Number.isFinite(walletQty) && walletQty >= 0 ? walletQty : supply,
            listed: Number.isFinite(listedQty) && listedQty > 0 ? listedQty : 0,
        };
    }

    function objktSupplyHint(nft) {
        if (!isObjktNft(nft)) return '';
        const avail = objktAvailability(nft);
        if (!avail) return '';
        if (avail.supply === 1) return '1/1';
        const parts = [`Edition · ${avail.supply}`, `${avail.available} available`];
        if (avail.listed > 0) {
            parts.push(`${avail.listed} listed`);
        }
        return parts.join(' · ');
    }

    function objktSupplyMetaHtml(nft) {
        const hint = objktSupplyHint(nft);
        if (!hint || isObjktAuction(nft)) return '';
        return `<p class="nft-card__supply">${escapeHtml(hint)}</p>`;
    }

    function isXrpCafeNft(nft) {
        return (
            nft.chain === 'xrpl' ||
            nft.medium === 'xrpl_ai' ||
            nft.marketplace === 'xrp_cafe' ||
            nft.marketplace === 'gh_gallery_lazy' ||
            nft.source === 'xrp_cafe' ||
            nft.source === 'catalog_manifest'
        );
    }

    /** XRPL: ma NFTokenID on-chain (Cafe / listed / sold path). */
    function isXrplMinted(nft) {
        return isXrpCafeNft(nft) && Boolean(nft.xrpl_nft_id);
    }

    /**
     * XRPL: in the catalog, not minted yet — mint on demand
     * (NOT the Sui / TradePort launchpad).
     */
    function isXrplPendingMint(nft) {
        if (!isXrpCafeNft(nft) || nft.xrpl_nft_id) return false;
        const st = (nft.status || '').toLowerCase();
        const ls = (nft.listing_status || '').toLowerCase();
        return (
            st === 'available' ||
            ls === 'mint available' ||
            st === '' ||
            ls === ''
        );
    }

    function xrplSupply(nft) {
        const n = Number(nft?.supply ?? 3000);
        return Number.isFinite(n) && n > 0 ? n : 3000;
    }

    function xrplMintedCount(nft) {
        if (nft?.minted_count != null && nft.minted_count !== '') {
            const n = Number(nft.minted_count);
            if (Number.isFinite(n)) return n;
        }
        return nft?.xrpl_nft_id ? 1 : 0;
    }

    /** Lazy mint: further copies up to 3000, even when copy 1 is already listed on Cafe. */
    function canXrplMintCopy(nft) {
        if (!isXrpCafeNft(nft)) return false;
        if ((nft.status || '').toLowerCase() === 'sold' && !nft.xrpl_nft_id) {
            return false;
        }
        return xrplMintedCount(nft) < xrplSupply(nft);
    }

    function isTradeportNft(nft) {
        // XRPL catalog / Cafe is never TradePort
        if (isXrpCafeNft(nft)) return false;
        return (
            nft.chain === 'sui' ||
            nft.medium === 'sui_ai' ||
            nft.marketplace === 'tradeport' ||
            nft.source === 'tradeport'
        );
    }

    function resolveDualMarketplaces(nft) {
        const list = nft.marketplaces;
        if (Array.isArray(list) && list.length >= 2) {
            return list.slice(0, 2);
        }
        if (nft.salvor_url && nft.opensea_url) return ['salvor', 'opensea'];
        if (nft.manifold_url && nft.opensea_url) return ['manifold', 'opensea'];
        return null;
    }

    function isDualMarketplaceNft(nft) {
        return nft.marketplace === 'dual' || resolveDualMarketplaces(nft) != null;
    }

    function dualMarketplaceUrl(nft, key) {
        if (key === 'salvor') return nft.salvor_url || nft.marketplace_url || '';
        if (key === 'manifold') return nft.manifold_url || nft.marketplace_url || '';
        if (key === 'opensea') {
            return OpenSeaLinks.buyUrl(nft.opensea_url || nft.marketplace_url || '');
        }
        return nft.marketplace_url || '';
    }

    function chainLabel(nft) {
        const chain = nft.chain || collectionInfo.chain || 'avalanche';
        return CHAIN_LABELS[chain] || chain;
    }

    function marketplaceName(nft) {
        if (isShopNft(nft)) return 'Studio Shop';
        if (isFeaturedPromoNft(nft)) {
            if (nft.tradeport_url || nft.chain === 'sui') {
                return MARKETPLACE_NAMES.tradeport;
            }
            if (nft.chain === 'xrpl') return MARKETPLACE_NAMES.xrp_cafe;
            return MARKETPLACE_NAMES.opensea;
        }
        if (isManifoldAuction(nft)) return MARKETPLACE_NAMES.manifold;
        if (isTradeportNft(nft)) return MARKETPLACE_NAMES.tradeport;
        if (isXrpCafeNft(nft)) return MARKETPLACE_NAMES.xrp_cafe;
        const key = nft.marketplace || (isObjktNft(nft) ? 'objkt' : 'opensea');
        return MARKETPLACE_NAMES[key] || key;
    }

    function isLaunchpadMint(nft) {
        // Sui TradePort launchpad only — not to be confused with XRPL "Mint Available"
        if (isXrpCafeNft(nft)) return false;
        return (
            nft.status === 'launchpad' ||
            nft.launchpad === true ||
            nft.listing_status === 'Mint Available'
        );
    }

    /** Mint request (lazy XRPL) — tweet to the artist; later: automated mint_and_list. */
    function xrplMintRequestTweetUrl(nft) {
        const name = nft.name || `JBN #${nft.token_id} X`;
        const price = nft.current_price_xrp ?? nft.price_xrp ?? 16.5;
        const handle = (collectionInfo.twitter_handle || '@JackBeatnicSI').replace(
            /^@/,
            '',
        );
        const text = encodeURIComponent(
            `@${handle} Mint request: ${name} (catalog #${nft.token_id}) · ${price} XRP · my XRPL address: `,
        );
        return `https://twitter.com/intent/tweet?text=${text}`;
    }

    function marketplaceLabel(nft) {
        if (isShopNft(nft)) {
            if (nft.shop_status === 'coming') return 'Coming soon';
            if (nft.demo) return 'Demo checkout';
            return 'Buy from Studio';
        }
        if (isFeaturedPromoNft(nft)) {
            return `View on ${marketplaceName(nft)}`;
        }
        if (isObjktAuction(nft)) return 'Bid on OBJKT';
        if (isManifoldAuction(nft)) return 'Bid on Manifold';
        if (canXrplMintCopy(nft)) return 'Mint';
        if (isXrplMinted(nft)) return 'View on Bidds';
        if (isLaunchpadMint(nft)) return 'Mint on TradePort';
        if (nft.source === 'manifold' && nft.manifold_url) return 'View on Manifold';
        return `View on ${marketplaceName(nft)}`;
    }

    function marketplaceUrl(nft) {
        if (isObjktAuction(nft)) {
            return nft.auction_url || nft.marketplace_url || nft.objkt_url || '';
        }
        if (isManifoldAuction(nft) || nft.manifold_url) {
            return nft.manifold_url || nft.marketplace_url || '';
        }
        if (isTradeportNft(nft)) {
            return nft.tradeport_url || nft.marketplace_url || '';
        }
        if (isXrplPendingMint(nft)) {
            return '';
        }
        if (isFeaturedPromoNft(nft)) {
            return (
                nft.xrp_cafe_url ||
                nft.marketplace_url ||
                nft.opensea_url ||
                nft.tradeport_url ||
                ''
            );
        }
        if (isXrpCafeNft(nft)) {
            if (nft.xrpl_nft_id) {
                return (
                    nft.xrp_cafe_url ||
                    nft.marketplace_url ||
                    `https://bidds.com/nft/${nft.xrpl_nft_id}`
                );
            }
            // don't use marketplace_url if it links to a .json
            const mu = nft.marketplace_url || '';
            if (mu && !/\.json(\?|$)/i.test(mu) && !/meta\/xrpl\//i.test(mu)) {
                return mu;
            }
            return '';
        }
        if (isDualMarketplaceNft(nft)) {
            return nft.salvor_url || nft.marketplace_url || nft.opensea_url || '';
        }
        return nft.marketplace_url || nft.objkt_url || nft.opensea_url || '';
    }

    function buildMarketActionsHtml(nft) {
        const shopReady = studioShopReady(nft);
        const osHref = evmOpenSeaUrl(nft);
        if (shopReady) {
            const coming =
                nft.shop_status === 'coming' ||
                (isShopNft(nft) && (nft.qty_available || 0) <= 0);
            const disabled = coming ? ' disabled' : '';
            const shopBtn = `<button type="button" class="btn btn--primary btn--block shop-buy cta"${disabled}>${ctaInner(shopCtaLabel(nft), shopPriceText(nft))}</button>`;
            if (osHref) {
                return `
                <div class="nft-card__actions nft-card__actions--dual nft-card__actions--priced">
                    ${shopBtn}
                    <a class="btn btn--ghost btn--block cta" href="${escapeHtml(osHref)}" target="_blank" rel="noopener noreferrer">${ctaInner(osCtaLabel(nft), osPriceText(nft))}</a>
                </div>`;
            }
            return `
                <div class="nft-card__actions nft-card__actions--priced">
                    ${shopBtn}
                </div>`;
        }
        const dual = resolveDualMarketplaces(nft);
        if (dual) {
            const [primary, secondary] = dual;
            const primaryHref = escapeHtml(dualMarketplaceUrl(nft, primary));
            const secondaryHref = escapeHtml(dualMarketplaceUrl(nft, secondary));
            const primaryLabel = escapeHtml(
                `View on ${MARKETPLACE_NAMES[primary] || primary}`,
            );
            const secondaryLabel = escapeHtml(
                `View on ${MARKETPLACE_NAMES[secondary] || secondary}`,
            );
            return `
                <div class="nft-card__actions nft-card__actions--dual">
                    <a class="btn btn--primary btn--block" href="${primaryHref}" target="_blank" rel="noopener noreferrer">${primaryLabel}</a>
                    <a class="btn btn--ghost btn--block" href="${secondaryHref}" target="_blank" rel="noopener noreferrer">${secondaryLabel}</a>
                </div>`;
        }
        if (canXrplMintCopy(nft)) {
            const mintLabel = escapeHtml('Mint');
            return `
                <div class="nft-card__actions">
                    <button type="button" class="btn btn--primary btn--block xrpl-mint">${mintLabel}</button>
                </div>`;
        }
        if (
            isLaunchpadMint(nft) &&
            typeof SuiMint !== 'undefined' &&
            SuiMint.isLive()
        ) {
            const tp = escapeHtml(marketplaceUrl(nft));
            return `
                <div class="nft-card__actions nft-card__actions--dual nft-card__actions--priced">
                    <button type="button" class="btn btn--primary btn--block sui-mint cta">${ctaInner('Studio Shop', suiStudioPriceText(nft))}</button>
                    <a class="btn btn--ghost btn--block cta" href="${tp}" target="_blank" rel="noopener noreferrer">${ctaInner('TradePort', tradeportPriceText(nft))}</a>
                </div>`;
        }
        const rawUrl = marketplaceUrl(nft);
        if (!rawUrl) {
            return '';
        }
        // XRPL request / Cafe — don't route through OpenSea buyUrl
        const href = escapeHtml(
            isXrpCafeNft(nft) || isXrplPendingMint(nft)
                ? rawUrl
                : OpenSeaLinks.buyUrl(rawUrl),
        );
        // Single OpenSea / TradePort button: its price sits on the button.
        const tied = singleTiedCta(nft);
        if (tied) {
            return `
                <div class="nft-card__actions nft-card__actions--priced">
                    <a class="btn btn--primary btn--block cta" href="${href}" target="_blank" rel="noopener noreferrer">${ctaInner(tied.label, tied.price)}</a>
                </div>`;
        }
        const label = escapeHtml(marketplaceLabel(nft));
        return `
                <div class="nft-card__actions">
                    <a class="btn btn--primary btn--block" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>
                </div>`;
    }

    /** OpenSea / TradePort single-button cards whose price belongs to that button. */
    function singleTiedCta(nft) {
        if (isShopNft(nft) || isObjktAuction(nft) || isManifoldAuction(nft)) return null;
        if (isXrpCafeNft(nft) || isObjktNft(nft) || isDualMarketplaceNft(nft)) return null;
        const name = marketplaceName(nft);
        if (name === MARKETPLACE_NAMES.tradeport) {
            const label = isLaunchpadMint(nft) ? 'Mint on TradePort' : 'TradePort';
            return { label, price: tradeportPriceText(nft) };
        }
        if (name === MARKETPLACE_NAMES.opensea && isEvmChain(nft)) {
            return { label: 'OpenSea', price: osPriceText(nft) };
        }
        return null;
    }

    /** Card has its prices on the buttons: the separate price line is not shown. */
    function pricesOnButtons(nft) {
        if (studioShopReady(nft)) return true;
        if (isLaunchpadMint(nft) && typeof SuiMint !== 'undefined' && SuiMint.isLive()) return true;
        if (resolveDualMarketplaces(nft) || canXrplMintCopy(nft)) return false;
        return Boolean(marketplaceUrl(nft)) && Boolean(singleTiedCta(nft));
    }

    function tokenLabel(nft) {
        if (isShopNft(nft)) {
            const col = nft.collection_name || nft.collection_id || '';
            const chain = chainLabel(nft);
            return [col, chain].filter(Boolean).join(' · ');
        }
        if (isFeaturedPromoNft(nft)) {
            const col = nft.collection_name || nft.collection_id || '';
            const chain = chainLabel(nft);
            const off =
                nft.pct_off != null && nft.pct_off > 0 ? ` · −${nft.pct_off}%` : '';
            return `${col} · ${chain}${off}`;
        }
        if (isObjktAuction(nft)) {
            const type =
                nft.auction_type === 'dutch' ? 'Dutch auction' : 'English auction';
            const tid =
                nft.tezos_token_id != null && nft.tezos_token_id !== ''
                    ? ` · Tezos #${nft.tezos_token_id}`
                    : '';
            return `${type}${tid}`;
        }
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
        if (isLaunchpadMint(nft)) {
            if (nft.edition_label) return nft.edition_label;
            if (nft.supply > 1) return `Edition · ${nft.supply}`;
            return nft.name || 'Mint on TradePort';
        }
        const tid = nft.onchain_token_id ?? nft.token_id;
        // Title stays OS-short (NS #599 / FS #12). Subtitle is the chain
        // edition so Avalanche / Base / Polygon of the same series stay distinct.
        if (nft.edition_label) {
            return `${nft.edition_label} edition`;
        }
        const series =
            (typeof GallerySections !== 'undefined' && GallerySections.resolveAiSeries)
                ? GallerySections.resolveAiSeries(nft)
                : nft.ai_series;
        const multiChain =
            (typeof GallerySections !== 'undefined' && GallerySections.seriesHasEditions)
                ? GallerySections.seriesHasEditions(series)
                : series === 'nature_stories' ||
                  series === 'flower_stories' ||
                  String(nft.collection_id || '').includes('nature_stories') ||
                  String(nft.collection_id || '').includes('flower_stories');
        if (multiChain) {
            return `${chainLabel(nft)} edition`;
        }
        if (nft.supply > 1) {
            return `Edition · ${nft.supply} · #${tid}`;
        }
        if (nft.supply === 1 && nft.ai_series === 'based_ai') {
            return `1/1 · #${tid}`;
        }
        return `Token #${nft.token_id}`;
    }

    function formatPrice(nft) {
        if (isDualMarketplaceNft(nft)) {
            const symbol = currencyForNft(nft);
            const salvor =
                nft.salvor_price_avax ??
                (symbol === 'AVAX' ? nft.current_price_avax : null) ??
                priceField(nft, 'salvor_price', symbol);
            const opensea =
                nft.opensea_price_avax ?? priceField(nft, 'opensea_price', symbol);
            if (salvor != null) {
                const hint =
                    opensea != null
                        ? `Salvor · OpenSea ${opensea} ${symbol}`
                        : 'Listed on Salvor';
                return {
                    text: `${salvor} ${symbol}`,
                    hint,
                    kind: 'listed',
                };
            }
            if (opensea != null) {
                return {
                    text: `${opensea} ${symbol}`,
                    hint: 'OpenSea',
                    kind: 'listed',
                };
            }
        }
        if (isObjktAuction(nft)) {
            const symbol = currencyForNft(nft);
            const bid = nft.current_bid_xtz;
            const reserve = nft.reserve_xtz;
            const dutchStart = nft.dutch_start_xtz;
            if (bid != null) {
                return {
                    text: `${bid} ${symbol}`,
                    hint: reserve != null ? `Current bid · reserve ${reserve} ${symbol}` : 'Current bid · OBJKT',
                    kind: 'listed',
                };
            }
            if (dutchStart != null) {
                return {
                    text: `${dutchStart} ${symbol}`,
                    hint: 'Dutch auction · OBJKT',
                    kind: 'listed',
                };
            }
            if (reserve != null) {
                return {
                    text: `${reserve} ${symbol}`,
                    hint: 'Reserve · live auction · OBJKT',
                    kind: 'listed',
                };
            }
            return { text: 'Live auction', hint: 'OBJKT · Tezos', kind: 'listed' };
        }
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
        if (isShopNft(nft) || (nft.in_shop && (isFeaturedPromoNft(nft) || nft.in_featured))) {
            const shopCur = (
                nft.shop_currency ||
                nft.listing_currency ||
                nft.currency ||
                'AVAX'
            ).toUpperCase();
            const shopP =
                nft.shop_pay_amount ||
                nft.pay_amount ||
                nft.shop_price ||
                priceField(nft, 'current_price', shopCur);
            const osP = nft.os_list_price;
            const osCur = (nft.os_list_currency || shopCur).toUpperCase();
            const q = nft.qty_available ?? nft.promo_quantity;
            const bits = [];
            if (q != null) bits.push(`${q} available`);
            if (nft.promo_days_left != null) bits.push(`${nft.promo_days_left}d left`);
            if (osP != null && osP !== '') bits.push(`OpenSea ${osP} ${osCur}`);
            bits.push(chainLabel(nft));
            return {
                text:
                    shopP != null && shopP !== ''
                        ? `${shopP} ${shopCur}`
                        : 'Studio price',
                alt:
                    osP != null && osP !== '' && String(osP) !== String(shopP)
                        ? `OpenSea ${osP} ${osCur}`
                        : osP != null && osP !== ''
                          ? `OpenSea ${osP} ${osCur}`
                          : '',
                hint: bits.join(' · '),
                kind: nft.shop_status === 'coming' ? 'mint' : 'listed',
            };
        }
        // Featured multi-chain promo feed
        if (isFeaturedPromoNft(nft)) {
            const symbol = currencyForNft(nft);
            const p =
                priceField(nft, 'current_price', symbol) ?? nft.current_price_avax;
            const left = nft.promo_days_left;
            const q = nft.promo_quantity ?? nft.supply;
            const off = nft.pct_off;
            const bits = [];
            if (q != null) bits.push(`q ${q}`);
            if (left != null) bits.push(left > 0 ? `${left}d left` : 'ends soon');
            if (off != null && off > 0) bits.push(`−${off}%`);
            bits.push(chainLabel(nft));
            return {
                text: p != null && p !== '' ? `${p} ${symbol}` : 'Promo',
                hint: bits.join(' · '),
                kind: 'listed',
            };
        }
        if (
            isLaunchpadMint(nft) &&
            typeof SuiMint !== 'undefined' &&
            SuiMint.priceOf
        ) {
            const p = SuiMint.priceOf(nft);
            return {
                text: p > 0 ? `${p} SUI` : 'Studio price',
                hint: SuiMint.isLive()
                    ? 'From the Studio'
                    : 'Sui · Nature Stories',
                kind: 'mint',
            };
        }
        // XRPL catalog: available = mint on demand; listed = Cafe
        if (isXrpCafeNft(nft)) {
            const p = nft.current_price_xrp ?? nft.price_xrp;
            const priceTxt =
                p != null && p !== '' ? `${p} XRP` : '0.1 XRP';
            if (canXrplMintCopy(nft)) {
                const left = xrplSupply(nft) - xrplMintedCount(nft);
                return {
                    text: priceTxt,
                    hint: isXrplMinted(nft)
                        ? `Studio mint · ${left} / ${xrplSupply(nft)} left`
                        : `Studio mint · ${xrplSupply(nft)} copies`,
                    kind: 'mint',
                };
            }
            if (isXrplMinted(nft)) {
                const forSale =
                    (nft.listing_status || '').toLowerCase() === 'for sale' ||
                    (nft.status || '').toLowerCase() === 'listed';
                return {
                    text: priceTxt,
                    hint: forSale ? 'Listed · XRP.Cafe' : 'On XRPL · XRP.Cafe',
                    kind: forSale ? 'listed' : 'sale',
                };
            }
            if ((nft.status || '').toLowerCase() === 'sold') {
                return { text: 'Sold', hint: 'XRPL', kind: 'sale' };
            }
        }
        const symbol = currencyForNft(nft);
        const listed = priceField(nft, 'current_price', symbol);
        const mint = priceField(nft, 'mint_price', symbol);
        const lastSale = priceField(nft, 'last_sale_price', symbol);
        if (listed != null && nft.listing_status === 'For Sale') {
            let hint = `Listed · ${chainLabel(nft)}`;
            let text = `${listed} ${symbol}`;
            if (isObjktNft(nft)) {
                const supplyHint = objktSupplyHint(nft);
                if (supplyHint) {
                    hint = `${supplyHint} · OBJKT`;
                    if (supplyHint !== '1/1') {
                        text = `${listed} ${symbol} · ${supplyHint}`;
                    }
                }
            }
            return {
                text,
                hint,
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
                hint: isLaunchpadMint(nft) ? 'Mint on TradePort' : 'Mint price',
                kind: 'mint',
            };
        }
        if (isObjktNft(nft)) {
            const supplyHint = objktSupplyHint(nft);
            if (supplyHint) {
                return { text: '—', hint: supplyHint, kind: 'unknown' };
            }
        }
        if (isLaunchpadMint(nft)) {
            return {
                text: 'Mint open',
                hint: nft.supply > 1 ? `Edition · ${nft.supply}` : 'TradePort Launchpad',
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

    function syncSectionNfts(scope = 'full') {
        sectionNfts = GallerySections.filterNfts(allNfts);
        const exploreTitle = document.querySelector('.filters-panel__title');
        const meta = GallerySections.getSectionMeta();
        if (exploreTitle) {
            exploreTitle.textContent = meta.explore_title || 'Explore';
        }
        syncFiltersPanel();
        if (scope === 'series') {
            GalleryFilters.updateSources(sectionNfts);
        } else {
            GalleryFilters.reinit(sectionNfts);
        }
        applyHero();
    }

    function heroFeaturedNft() {
        return (
            allNfts.find((nft) => (nft.medium || 'ai_art') === 'ai_art') ||
            sectionNfts[0] ||
            allNfts[0]
        );
    }

    function photographyDisplayList(nfts) {
        const auctionPks = new Set(
            nfts
                .filter((nft) => isObjktAuction(nft))
                .map((nft) => Number(nft.objkt_token_pk ?? nft.token_id)),
        );
        if (!auctionPks.size) return nfts;

        const deduped = nfts.filter((nft) => {
            if (isObjktAuction(nft)) return true;
            if (nft.medium !== 'photography' || nft.source !== 'objkt') return true;
            return !auctionPks.has(Number(nft.token_id));
        });

        return [...deduped].sort((a, b) => {
            const aLive = isObjktAuction(a) ? 0 : 1;
            const bLive = isObjktAuction(b) ? 0 : 1;
            if (aLive !== bLive) return aLive - bLive;
            const rankA = a.display_rank ?? 999999;
            const rankB = b.display_rank ?? 999999;
            if (rankA !== rankB) return rankA - rankB;
            const likesA = a.likes_count ?? 0;
            const likesB = b.likes_count ?? 0;
            if (likesB !== likesA) return likesB - likesA;
            return Number(a.token_id) - Number(b.token_id);
        });
    }

    function getDisplayList() {
        let sorted = GalleryLikes.sortForDisplay(sectionNfts);
        if (GallerySections.getCurrentSection() === 'photography') {
            sorted = photographyDisplayList(sorted);
        }
        const filtered = GalleryFilters.apply(sorted);
        return GalleryLikes.filterSaved(filtered);
    }

    function refresh() {
        render(getDisplayList());
    }

    let renderGeneration = 0;

    function mergeGalleryPayload(data, extras = []) {
        return [
            ...(data.nfts || []),
            ...extras.flatMap((payload) => payload?.nfts || []),
        ];
    }

    function appendSupplementaryGalleries(extras) {
        const extraNfts = extras.flatMap((payload) => payload?.nfts || []);
        if (!extraNfts.length) return;
        allNfts = [...allNfts, ...extraNfts];
        attachChannelLinks(allNfts);
        if (typeof GallerySections !== 'undefined' && GallerySections.noteLoadedNfts) {
            GallerySections.noteLoadedNfts(allNfts);
        }
        syncSectionNfts('full');
        refresh();
        scrollHashTarget();
    }

    async function loadSupplementaryGalleries() {
        const grid = document.getElementById('gallery-grid');
        try {
            const [aiPlayRes, natureJamRes, basedAiRes] = await Promise.all([
                fetch('ai_play_gallery.json'),
                fetch('nature_jam_gallery.json'),
                fetch('based_ai_gallery.json'),
            ]);
            const aiPlayData = aiPlayRes.ok ? await aiPlayRes.json() : { nfts: [] };
            const natureJamData = natureJamRes.ok ? await natureJamRes.json() : { nfts: [] };
            const basedAiData = basedAiRes.ok ? await basedAiRes.json() : { nfts: [] };
            appendSupplementaryGalleries([aiPlayData, natureJamData, basedAiData]);
        } catch (error) {
            console.warn('Supplementary gallery load:', error);
        } finally {
            grid?.classList.remove('gallery-grid--loading');
        }
    }

    function daysLeft(endsAt) {
        if (!endsAt) return null;
        const end = new Date(endsAt);
        if (Number.isNaN(end.getTime())) return null;
        const ms = end.getTime() - Date.now();
        if (ms <= 0) return 0;
        return Math.ceil(ms / 86400000);
    }

    function isFeaturedPromoNft(nft) {
        return nft?.medium === 'featured_promo';
    }

    function isShopNft(nft) {
        return nft?.medium === 'shop';
    }

    function catalogKey(nft) {
        const cid = String(nft?.collection_id || '').trim();
        const tid = String(nft?.token_id ?? '').trim();
        if (!cid || tid === '') return '';
        return `${cid}:${tid}`;
    }

    function isEvmChain(nft) {
        const c = String(nft?.chain || '').toLowerCase();
        return c === 'avalanche' || c === 'base' || c === 'polygon' || c === 'ethereum';
    }

    function firstPrice(nft, keys) {
        for (const k of keys) {
            if (nft?.[k] != null && nft[k] !== '') return nft[k];
        }
        return null;
    }

    function attachChannelLinks(nfts) {
        const shop = new Map();
        const featured = new Map();
        const gallery = new Set();
        // OpenSea listing of the gallery copy (OS report): the OpenSea price for
        // the same work on Shop cards too (2026-10-03).
        const galleryOs = new Map();
        for (const nft of nfts) {
            const k = catalogKey(nft);
            if (!k) continue;
            if (nft.medium === 'shop') shop.set(k, nft);
            else if (nft.medium === 'featured_promo') featured.set(k, nft);
            else {
                gallery.add(k);
                const listed =
                    nft.listing_status === 'For Sale' || nft.status === 'listed';
                if (listed && isEvmChain(nft) && !galleryOs.has(k)) {
                    const sym = currencyForNft(nft);
                    const gp = priceField(nft, 'current_price', sym);
                    if (gp != null && gp !== '' && Number(gp) > 0) {
                        galleryOs.set(k, { price: gp, currency: sym });
                    }
                }
            }
        }
        for (const nft of nfts) {
            const k = catalogKey(nft);
            if (!k) continue;
            const s = shop.get(k);
            const f = featured.get(k);
            nft.in_shop = Boolean(s);
            nft.in_featured = Boolean(f);
            nft.in_gallery = gallery.has(k);
            if (s && nft !== s) {
                nft.shop_pay_amount = s.pay_amount || s.shop_price;
                nft.shop_price = s.shop_price || s.pay_amount;
                nft.shop_currency = (
                    s.listing_currency ||
                    s.currency ||
                    'AVAX'
                ).toUpperCase();
                if (!nft.pay_amount) nft.pay_amount = s.pay_amount || s.shop_price;
                if (!nft.pay_address) nft.pay_address = s.pay_address;
                if (!nft.sku) nft.sku = s.sku;
                if (!nft.memo) nft.memo = s.memo;
                if (nft.qty_available == null) nft.qty_available = s.qty_available;
                if (!nft.fulfill) nft.fulfill = s.fulfill;
                if (!nft.pool) nft.pool = s.pool;
                if (nft.demo == null) nft.demo = s.demo;
            }
            if (f) {
                const fp = firstPrice(f, [
                    'current_price_avax',
                    'current_price_eth',
                    'current_price_weth',
                    'current_price_sui',
                    'current_price_xrp',
                ]);
                if (fp != null) {
                    nft.os_list_price = fp;
                    nft.os_list_currency = (f.listing_currency || '').toUpperCase();
                }
                if (!nft.opensea_url) nft.opensea_url = f.opensea_url;
            }
            const own = galleryOs.get(k);
            if (nft.os_list_price == null && own) {
                nft.os_list_price = own.price;
                nft.os_list_currency = String(own.currency || '').toUpperCase();
            }
            if (nft.os_list_price == null && s?.os_price) {
                nft.os_list_price = s.os_price;
                nft.os_list_currency = (
                    s.listing_currency ||
                    nft.listing_currency ||
                    'AVAX'
                ).toUpperCase();
            }
            const listed =
                nft.listing_status === 'For Sale' || nft.status === 'listed';
            nft.on_os = Boolean(
                (isEvmChain(nft) && (f || nft.os_list_price != null || (listed && nft.opensea_url))) ||
                    (isEvmChain(s) && (s?.opensea_url || s?.os_price)) ||
                    (isEvmChain(f) && f?.opensea_url),
            );
        }
    }

    function studioShopReady(nft) {
        if (!nft?.in_shop) return false;
        const pay = nft.shop_pay_amount || nft.pay_amount || nft.shop_price;
        const addr = nft.pay_address;
        return Boolean(pay) && Boolean(addr);
    }

    function evmOpenSeaUrl(nft) {
        if (!isEvmChain(nft)) return '';
        const raw = nft.opensea_url || '';
        if (!raw) return '';
        if (/tradeport|xrp\.cafe|objkt|manifold/i.test(raw)) return '';
        return OpenSeaLinks.buyUrl(raw);
    }

    // Prices tied to buttons (2026-10-03, replaces the 2026-10-01 no-price CTAs):
    // each price sits on its own button (Shop price on 'Studio Shop', OpenSea price
    // on 'OpenSea', TradePort price on 'TradePort'). Unknown price = button without a price.
    function shopCtaLabel(nft) {
        return 'Studio Shop';
    }

    function osCtaLabel(nft) {
        return 'OpenSea';
    }

    function hasPrice(v) {
        if (v == null || v === '') return false;
        const n = Number(v);
        return Number.isFinite(n) && n > 0;
    }

    function shopPriceText(nft) {
        const p = nft.shop_pay_amount || nft.pay_amount || nft.shop_price;
        if (!hasPrice(p)) return '';
        const cur = (nft.shop_currency || nft.listing_currency || nft.currency || 'AVAX').toUpperCase();
        return `${p} ${cur}`;
    }

    function osPriceText(nft) {
        let p = nft.os_list_price;
        let cur = nft.os_list_currency || '';
        if (!hasPrice(p) && nft.medium !== 'shop' && isEvmChain(nft)) {
            // Gallery / Featured cards: own OpenSea listing (OS report / featured feed)
            const listed = nft.listing_status === 'For Sale' || nft.status === 'listed';
            if (listed) {
                const sym = currencyForNft(nft);
                p = priceField(nft, 'current_price', sym);
                cur = sym;
            }
        }
        if (!hasPrice(p)) return '';
        return `${p} ${(cur || currencyForNft(nft) || '').toUpperCase()}`.trim();
    }

    function tradeportPriceText(nft) {
        const listed = nft.listing_status === 'For Sale' || nft.status === 'listed';
        const p =
            nft.tradeport_price_sui ??
            nft.mint_price_sui ??
            (listed ? nft.current_price_sui : null);
        return hasPrice(p) ? `${p} SUI` : '';
    }

    function suiStudioPriceText(nft) {
        if (typeof SuiMint === 'undefined' || !SuiMint.priceOf) return '';
        const p = SuiMint.priceOf(nft);
        return hasPrice(p) ? `${p} SUI` : '';
    }

    /** Button content: label, its own price (blue), arrow. */
    function ctaInner(label, price) {
        const priceHtml = price
            ? `<span class="cta__price">${escapeHtml(price)}</span>`
            : '';
        return `<span class="cta__label">${escapeHtml(label)}</span>${priceHtml}<span class="cta__arrow" aria-hidden="true">\u2192</span>`;
    }

    function channelMarksHtml(nft) {
        const marks = [];
        if (nft.on_os) marks.push(['os', 'OS']);
        if (nft.in_shop) marks.push(['shop', 'SHOP']);
        if (nft.in_featured) marks.push(['featured', 'Featured']);
        if (!marks.length) return '';
        return `<div class="nft-card__marks" aria-hidden="true">${marks
            .map(
                ([k, label]) =>
                    `<span class="nft-card__mark nft-card__mark--${k}">${label}</span>`,
            )
            .join('')}</div>`;
    }

    /** featured_promo.json → cards in Featured tab (all chains). */
    function featuredItemsToNfts(doc) {
        const promo = doc?.promo || {};
        const raw = Array.isArray(doc?.items) ? doc.items : [];
        const now = Date.now();
        return raw
            .filter((it) => {
                if (it.permanent) return true;
                const ea = it.ends_at || promo.ends_at;
                if (!ea) return true;
                const t = new Date(ea).getTime();
                return !Number.isNaN(t) && t > now;
            })
            .map((it, idx) => {
                const chain = (it.chain || '').toLowerCase();
                const cur = (it.currency || 'AVAX').toUpperCase();
                const suf = cur.toLowerCase();
                const price = it.price;
                const ends = it.ends_at || promo.ends_at;
                const left = daysLeft(ends);
                const nft = {
                    medium: 'featured_promo',
                    token_id: it.token_id,
                    name: it.name || `#${it.token_id}`,
                    collection_id: it.collection_id,
                    collection_name: it.collection_name,
                    chain,
                    image_url: it.image_url,
                    listing_currency: cur,
                    listing_status: 'For Sale',
                    status: 'listed',
                    supply: it.quantity,
                    promo_quantity: it.quantity,
                    promo_days: it.days != null ? it.days : promo.days,
                    promo_days_left: it.permanent ? null : left,
                    pct_off: it.pct_off != null ? it.pct_off : promo.pct_off,
                    ends_at: ends,
                    opensea_url: it.opensea_url,
                    tradeport_url: it.tradeport_url,
                    marketplace_url:
                        it.marketplace_url ||
                        it.opensea_url ||
                        it.tradeport_url ||
                        '',
                    display_rank: idx + 1,
                };
                if (price != null && price !== '') {
                    nft[`current_price_${suf}`] = price;
                    if (suf === 'avax') nft.current_price_avax = price;
                    if (suf === 'sui') nft.current_price_sui = price;
                    if (suf === 'eth') nft.current_price_eth = price;
                    if (suf === 'xrp') nft.current_price_xrp = price;
                }
                return nft;
            });
    }

    function updateFeaturedChip(count) {
        const chip = document.getElementById('featured-chip');
        const countEl = document.getElementById('featured-chip-count');
        if (!chip) return;
        if (!count || count <= 0) {
            chip.hidden = true;
            return;
        }
        chip.hidden = false;
        if (countEl) {
            countEl.hidden = false;
            countEl.textContent = String(count);
        }
    }

    const SHOP_COLLECTION_NAMES = {
        avalanche_nature_stories: 'Nature Stories',
        avalanche_flower_stories: 'Flower Stories',
        xrpl_jb_ai_nature: 'JB AI Nature',
        xrpl_jbn: 'JB AI Nature',
    };

    function saleItemsToNfts(doc) {
        const raw = Array.isArray(doc?.items) ? doc.items : [];
        const now = Date.now();
        const filtered = raw.filter((it) => {
                if ((it.channel || 'shop') !== 'shop') return false;
                if ((it.status || 'live') !== 'live') return false;
                if ((it.qty_available || 0) <= 0) return false;
                const ea = it.ends_at;
                if (ea) {
                    const t = Date.parse(ea);
                    if (!Number.isNaN(t) && t <= now) return false;
                }
                return true;
            });
        // Display only: one card per token_id, lowest pay_amount (t2 over t1).
        const bestByTid = new Map();
        for (const it of filtered) {
            const tid = String(it.token_id ?? '');
            const pay = Number(it.pay_amount ?? it.price);
            const prev = bestByTid.get(tid);
            const prevPay = prev == null ? Infinity : Number(prev.pay_amount ?? prev.price);
            if (!Number.isFinite(pay)) continue;
            if (prev == null || pay < prevPay) bestByTid.set(tid, it);
        }
        return Array.from(bestByTid.values())
            .map((it, idx) => {
                const chain = (it.chain || '').toLowerCase();
                const cur = (it.currency || 'USD').toUpperCase();
                const suf = cur.toLowerCase();
                const nft = {
                    medium: 'shop',
                    sku: it.sku,
                    token_id: it.token_id,
                    name: it.name || `#${it.token_id}`,
                    contract_address: `shop:${it.sku || it.token_id}`,
                    collection_id: it.collection_id,
                    collection_name:
                        SHOP_COLLECTION_NAMES[it.collection_id] || it.collection_id,
                    chain,
                    image_url: it.image_url,
                    listing_currency: cur,
                    listing_status:
                        it.status === 'live' ? 'For Sale' : it.status || 'hold',
                    status: it.status === 'live' ? 'listed' : it.status,
                    shop_status: it.status || 'live',
                    shop_price: it.pay_amount || it.price,
                    pay_amount: it.pay_amount || (it.price != null ? String(it.price) : ''),
                    qty_available: it.qty_available,
                    promo_quantity: it.qty_available,
                    pool: it.pool,
                    fulfill: it.fulfill,
                    pay_address: it.pay_address,
                    memo: it.memo,
                    demo: Boolean(it.demo),
                    note: it.note,
                    opensea_url: it.opensea_url,
                    ends_at: it.ends_at,
                    os_price: it.os_price,
                    display_rank: idx + 1,
                };
                if (it.ends_at) {
                    const t = Date.parse(it.ends_at);
                    if (!Number.isNaN(t)) {
                        nft.promo_days_left = Math.max(
                            0,
                            Math.ceil((t - now) / 86400000),
                        );
                    }
                }
                if (it.price != null && it.price !== '') {
                    nft[`current_price_${suf}`] = it.price;
                }
                return nft;
            });
    }

    function updateShopChip(count) {
        const chip = document.getElementById('shop-chip');
        const countEl = document.getElementById('shop-chip-count');
        if (!chip) return;
        chip.hidden = false;
        if (countEl) {
            if (!count || count <= 0) {
                countEl.hidden = true;
                countEl.textContent = '';
            } else {
                countEl.hidden = false;
                countEl.textContent = String(count);
            }
        }
    }

    async function loadSaleIndexNfts() {
        try {
            const res = await fetch('data/sale_index.json', { cache: 'no-cache' });
            if (!res.ok) {
                updateShopChip(0);
                return [];
            }
            const doc = await res.json();
            const items = saleItemsToNfts(doc);
            const live = items.filter(
                (it) => it.shop_status === 'live' && (it.qty_available || 0) > 0,
            );
            updateShopChip(live.length || items.length);
            return items;
        } catch (err) {
            console.warn('sale index:', err);
            updateShopChip(0);
            return [];
        }
    }

    async function loadFeaturedPromoNfts() {
        try {
            const res = await fetch('data/featured_promo.json', {
                cache: 'no-cache',
            });
            if (!res.ok) {
                updateFeaturedChip(0);
                return [];
            }
            const doc = await res.json();
            const items = featuredItemsToNfts(doc);
            updateFeaturedChip(items.length);
            return items;
        } catch (err) {
            console.warn('featured promo:', err);
            updateFeaturedChip(0);
            return [];
        }
    }

    async function load() {
        const grid = document.getElementById('gallery-grid');
        try {
            const [mainRes, xrpRes, suiRes, auctionRes, objktAuctionRes, featuredNfts, shopNfts] =
                await Promise.all([
                    fetch('gallery.json'),
                    fetch('xrp_gallery.json', { cache: 'no-cache' }),
                    fetch('sui_gallery.json'),
                    fetch('auctions_gallery.json'),
                    fetch('objkt_auctions_gallery.json'),
                    loadFeaturedPromoNfts(),
                    loadSaleIndexNfts(),
                ]);
            if (!mainRes.ok) throw new Error(`HTTP ${mainRes.status}`);
            const data = await mainRes.json();
            const xrpData = xrpRes.ok ? await xrpRes.json() : { nfts: [] };
            const suiData = suiRes.ok ? await suiRes.json() : { nfts: [] };
            const auctionData = auctionRes.ok ? await auctionRes.json() : { nfts: [] };
            const objktAuctionData = objktAuctionRes.ok
                ? await objktAuctionRes.json()
                : { nfts: [] };

            allNfts = mergeGalleryPayload(data, [
                xrpData,
                suiData,
                auctionData,
                objktAuctionData,
            ]);
            // Featured tab: Avalanche + Sui + … from one feed
            if (featuredNfts?.length) {
                allNfts = [...allNfts, ...featuredNfts];
            }
            if (shopNfts?.length) {
                allNfts = [...allNfts, ...shopNfts];
            }
            attachChannelLinks(allNfts);
            collectionInfo = {
                ...(data.collection_info || {}),
                xrpl: xrpData.collection_info || {},
                sui: suiData.collection_info || {},
                manifold: auctionData.collection_info || {},
                objkt_auctions: objktAuctionData.collection_info || {},
                manifold_links: data.collection_info?.manifold_links || {},
                atelier_wallets:
                    data.collection_info?.atelier_wallets ||
                    data.collection_info?.studio_market_wallets ||
                    {},
                collector_access: data.collection_info?.collector_access || {},
            };
            const mainSections = data.site?.sections || {};
            const xrpSections = xrpData.site?.sections || {};
            const suiSections = suiData.site?.sections || {};
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
            // Do NOT merge promo_lead/promo_eyebrow from Sui/XRPL into the shared ai_art
            // (Sui overwrote XRPL → the XRPL tab showed TradePort).
            const xrpAi = xrpSections.ai_art || {};
            const suiAi = suiSections.ai_art || {};
            const mainAi = mainSections.ai_art || {};
            const xrpPhoto = xrpSections.photography || {};
            const mainPhoto = mainSections.photography || {};
            siteConfig = {
                ...(data.site || {}),
                ai_series_catalog: data.collection_info?.ai_series_catalog || {},
                sections: {
                    featured: {
                        label: 'Featured',
                        label_short: 'Featured',
                        explore_title: 'Featured · promo (Avalanche, Sui, …)',
                        empty_message:
                            'No active promos right now — check back soon.',
                        ...(mainSections.featured || {}),
                    },
                    shop: {
                        label: 'Shop',
                        label_short: 'Shop',
                        explore_title: 'Studio Shop',
                        empty_message:
                            'No live studio offers right now.',
                        promo_eyebrow: 'Studio Shop',
                        promo_lead:
                            'Pick a work, pay with wallet — the NFT comes to that wallet.',
                        ...(mainSections.shop || {}),
                    },
                    ...mainSections,
                    ...auctionSections,
                    ai_art: {
                        ...mainAi,
                        subsections:
                            xrpAi.subsections ||
                            mainAi.subsections,
                        empty_messages: {
                            ...(mainAi.empty_messages || {}),
                            ...(xrpAi.empty_messages || {}),
                            ...(suiAi.empty_messages || {}),
                        },
                        explore_titles: {
                            ...(mainAi.explore_titles || {}),
                            ...(xrpAi.explore_titles || {}),
                            ...(suiAi.explore_titles || {}),
                        },
                        // promo per chain — read in syncSectionPromo
                        kind_promo: {
                            xrpl: {
                                promo_eyebrow: xrpAi.promo_eyebrow,
                                promo_lead: xrpAi.promo_lead,
                                collection_url: xrpAi.collection_url,
                                collection_cta: xrpAi.collection_cta,
                                promo_collections: xrpAi.promo_collections,
                            },
                            sui: {
                                promo_eyebrow: suiAi.promo_eyebrow,
                                promo_lead: suiAi.promo_lead,
                                collection_url: suiAi.collection_url,
                                collection_cta: suiAi.collection_cta,
                                promo_collections: suiAi.promo_collections,
                            },
                        },
                    },
                    photography: {
                        ...mainPhoto,
                        empty_messages: {
                            ...(mainPhoto.empty_messages || {}),
                            ...(xrpPhoto.empty_messages || {}),
                        },
                        explore_titles: {
                            ...(mainPhoto.explore_titles || {}),
                            ...(xrpPhoto.explore_titles || {}),
                        },
                        kind_promo: {
                            xrpl: {
                                promo_eyebrow: xrpPhoto.promo_eyebrow,
                                promo_lead: xrpPhoto.promo_lead,
                            },
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
            GallerySections.noteLoadedNfts(allNfts);
            AtelierWallet.init(collectionInfo);
            applyCollectionInfo(collectionInfo);
            GalleryFilters.bindOnce();
            preselectWorkSection();
            syncSectionNfts('full');
            scrollHashTarget();
            TipCreator.init({
                evm_wallet: collectionInfo.creator_wallet,
                btc_wallet: collectionInfo.btc_tip_wallet,
                solana_wallet: collectionInfo.solana_tip_wallet,
                evm_domains: collectionInfo.evm_domains,
                tezos_domains: collectionInfo.tezos_domains,
            });
            if (typeof ShopCheckout !== 'undefined') ShopCheckout.init();
            GalleryShare.init({
                site_url: collectionInfo.site_url,
            });
            syncSectionPromo();
            refresh();
            scrollToWorkFromUrl();

            document.addEventListener('gallery:filter', refresh);
            document.addEventListener('gallery:likes', refresh);
            document.addEventListener('gallery:engage', (e) => {
                // Card-level like/save: keep scroll position; only touch that card.
                const key = e.detail?.key;
                if (!key) return;
                const card = document.querySelector(`[data-nft-key="${CSS.escape(key)}"]`);
                if (!card) return;
                const likeBtn = card.querySelector('.nft-like');
                const saveBtn = card.querySelector('.nft-save');
                if (likeBtn) {
                    likeBtn.classList.toggle('is-active', GalleryLikes.isLiked(key));
                    likeBtn.setAttribute('aria-pressed', String(GalleryLikes.isLiked(key)));
                }
                if (saveBtn) {
                    saveBtn.classList.toggle('is-active', GalleryLikes.isSaved(key));
                    saveBtn.setAttribute('aria-pressed', String(GalleryLikes.isSaved(key)));
                }
            });
            document.addEventListener('gallery:section', (e) => {
                syncSectionNfts(e.detail?.scope || 'full');
                syncSectionPromo();
                refresh();
            });

            grid?.classList.add('gallery-grid--loading');
            loadSupplementaryGalleries();
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
        if (!imgEl) return;

        // Locked site hero — never rotate with gallery front / promo NFT thumbs (jbg-present).
        // Never use nfts[0] for the page hero. On error, keep a non-black fallback chain.
        const lockedHero = (info.hero_image || info.hero_bg || '').trim();
        const HARD_FALLBACKS = [
            'assets/hero-bg.jpg',
            'https://jackbeatnic.github.io/jbg-present/avalanche_nature_stories/1.view.webp',
            'https://raw.githubusercontent.com/jackbeatnic/jackbeatnic.github.io/main/assets/hero-bg.jpg',
        ];

        const toAbs = (u) => {
            if (!u) return '';
            if (/^https?:\/\//i.test(u)) return u;
            try {
                return new URL(u, window.location.href).href;
            } catch (_) {
                return u;
            }
        };

        const candidates = [];
        const pushUnique = (u) => {
            const abs = toAbs(u);
            if (abs && !candidates.includes(abs)) candidates.push(abs);
        };
        if (lockedHero) pushUnique(lockedHero);
        HARD_FALLBACKS.forEach(pushUnique);

        let idx = 0;
        const tryNext = () => {
            if (idx >= candidates.length) {
                // Keep HTML first-paint src if any; otherwise text-only (not a black broken img).
                if (!imgEl.getAttribute('src') || imgEl.naturalWidth === 0) {
                    imgEl.removeAttribute('src');
                    imgEl.hidden = true;
                    hero?.classList.add('hero--text-only');
                }
                return;
            }
            const url = candidates[idx++];
            const onErr = () => {
                imgEl.removeEventListener('error', onErr);
                tryNext();
            };
            imgEl.addEventListener('error', onErr);
            imgEl.alt = title;
            imgEl.hidden = false;
            hero?.classList.remove('hero--text-only');
            if (imgEl.src === url && imgEl.complete) {
                if (imgEl.naturalWidth > 0) {
                    imgEl.removeEventListener('error', onErr);
                    return;
                }
                onErr();
                return;
            }
            imgEl.src = url;
        };
        tryNext();
    }


    function showCommunityTokens() {
        const section = GallerySections.getCurrentSection();
        // Featured: same coin table as AI Art · EVM
        if (section === 'featured') return true;
        if (section === 'shop') return true;
        if (section === 'photography') return true;
        return section === 'ai_art' && GallerySections.getAiKind() === 'evm';
    }

    function xrpPhotoPromo() {
        return siteConfig?.sections?.photography || {};
    }

    function syncSectionPromo() {
        const el = document.getElementById('section-promo');
        if (!el) return;

        const eyebrowEl = document.getElementById('section-promo-eyebrow');
        const leadEl = document.getElementById('section-promo-lead');
        const listEl = document.getElementById('section-promo-tokens');

        if (GallerySections.getCurrentSection() === 'shop') {
            const meta = GallerySections.getSectionMeta();
            el.hidden = false;
            if (eyebrowEl) eyebrowEl.textContent = meta.promo_eyebrow || 'Studio Shop';
            if (leadEl) {
                leadEl.textContent =
                    meta.promo_lead ||
                    'Buy here. Pay the amount shown. The NFT goes to the wallet you pay from.';
            }
            if (listEl) {
                listEl.innerHTML = `
                    <article class="section-promo__item">
                        <h3 class="section-promo__title">How to buy</h3>
                        <p class="section-promo__token">
                            <span class="section-promo__symbol">1. Open a work</span>
                            <span class="section-promo__chain"> · 2. Pay with wallet · 3. Confirm</span>
                        </p>
                        <p class="section-promo__collector">
                            Pay with wallet. Confirm the amount — do not edit it.
                            <strong>The wallet sends the token number with the payment. A Tip (QR / manual send) does not buy the NFT.</strong>
                            The NFT is sent in a second transaction to the wallet you pay from.
                        </p>
                        <div class="section-promo__actions">
                            <a class="btn btn--ghost btn--small section-promo__cta" href="shop-terms.html">Shop terms</a>
                        </div>
                    </article>`;
            }
            return;
        }

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
            GallerySections.getCurrentSection() === 'photography' &&
            typeof GallerySections.getPhotoChain === 'function' &&
            GallerySections.getPhotoChain() === 'xrpl'
        ) {
            const meta = GallerySections.getSectionMeta();
            const kp = meta.kind_promo?.xrpl || xrpPhotoPromo() || {};
            el.hidden = false;
            if (eyebrowEl) {
                eyebrowEl.textContent =
                    kp.promo_eyebrow || meta.promo_eyebrow || 'Jack Beatnic · XRPL';
            }
            if (leadEl) {
                leadEl.textContent =
                    kp.promo_lead ||
                    'Lazy mint from the studio. Photography and artworks — up to 500 copies of each image. Pay with the destination tag, then accept the 0 XRP offer.';
            }
            if (listEl) listEl.innerHTML = '';
            return;
        }

        if (GallerySections.getCurrentSection() === 'photography') {
            const liveAuctions = allNfts.filter(
                (nft) =>
                    isObjktAuction(nft) &&
                    (nft.photo_kind || 'photo') === GallerySections.getPhotoKind(),
            );
            const meta = GallerySections.getSectionMeta();
            const objktInfo = collectionInfo.objkt_auctions || {};
            const profileUrl =
                meta.objkt_profile ||
                objktInfo.objkt_profile ||
                collectionInfo.objkt_profile ||
                'https://objkt.com/@jackbeatnic/';
            const show = liveAuctions.length > 0;
            el.hidden = !show;
            if (!show) {
                // fall through to community tokens below
            } else {
                if (eyebrowEl) {
                    eyebrowEl.textContent =
                        meta.promo_auction_eyebrow || 'Live on OBJKT';
                }
                if (leadEl) {
                    leadEl.textContent =
                        meta.promo_auction_lead ||
                        'Active Tezos auctions from your wallet — bid on OBJKT.';
                }
                if (listEl) {
                    const cta = escapeHtml(meta.promo_auction_cta || 'Bid on OBJKT');
                    listEl.innerHTML = liveAuctions
                        .map((nft) => {
                            const title = escapeHtml(nft.name || 'Live auction');
                            const price = formatPrice(nft);
                            const href = escapeHtml(marketplaceUrl(nft));
                            const type =
                                nft.auction_type === 'dutch'
                                    ? 'Dutch auction'
                                    : 'English auction';
                            return `
                    <article class="section-promo__item">
                        <h3 class="section-promo__title">OBJKT Auction</h3>
                        <p class="section-promo__token">
                            <span class="section-promo__symbol">${title}</span>
                            <span class="section-promo__chain"> · ${escapeHtml(type)} · <span class="section-promo__price">${escapeHtml(price.text)}</span></span>
                        </p>
                        <a class="btn btn--primary btn--small section-promo__cta" href="${href}" target="_blank" rel="noopener noreferrer">${cta}</a>
                    </article>`;
                        })
                        .join('');
                }
                return;
            }
        }

        if (
            GallerySections.getCurrentSection() === 'ai_art' &&
            GallerySections.getAiKind() === 'sui'
        ) {
            const meta = GallerySections.getSectionMeta();
            const kp = meta.kind_promo?.sui || {};
            const suiInfo = collectionInfo.sui || {};
            // Poetic lead only — no lecture about TradePort / sync
            el.hidden = false;
            if (eyebrowEl) {
                eyebrowEl.textContent =
                    kp.promo_eyebrow || meta.promo_eyebrow || 'Nature Stories · Sui';
            }
            if (leadEl) {
                leadEl.textContent =
                    kp.promo_lead ||
                    'A quiet garden of Sui editions — landscape, light and gentle colour, offered on TradePort.';
            }
            if (listEl) {
                // no marketplace tiles / "Mint on TradePort"
                listEl.innerHTML = '';
            }
            return;
        }

        if (
            GallerySections.getCurrentSection() === 'ai_art' &&
            GallerySections.getAiKind() === 'xrpl'
        ) {
            const meta = GallerySections.getSectionMeta();
            const kp = meta.kind_promo?.xrpl || {};
            // Do NOT take collection_url from Sui / TradePort
            el.hidden = false;
            if (eyebrowEl) {
                eyebrowEl.textContent =
                    kp.promo_eyebrow || 'Jack Beatnic · XRPL';
            }
            if (leadEl) {
                leadEl.textContent =
                    kp.promo_lead ||
                    'Scenes of place and mood for the XRP Ledger — quiet, personal, one at a time.';
            }
            if (listEl) {
                listEl.innerHTML = '';
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
                const rawContract = String(token.contract || '').trim();
                const contract = escapeHtml(rawContract);
                const short = escapeHtml(shortContract(rawContract));
                const url = escapeHtml(token.community_url || '#');
                const cta = escapeHtml(token.cta_label || 'Learn more →');
                const chainBit = chain ? `<span class="section-promo__chain"> · ${chain}</span>` : '';
                const contractBit = rawContract
                    ? `<button type="button" class="section-promo__contract" data-copy-contract="${contract}" data-label="${short}" title="Copy contract" aria-label="Copy contract ${contract}">${short}</button>`
                    : '';

                return `
                    <article class="section-promo__item">
                        <h3 class="section-promo__title">${title}</h3>
                        <p class="section-promo__token">
                            <span class="section-promo__symbol">${symbol}</span>${chainBit}
                        </p>
                        ${contractBit}
                        <a class="btn btn--ghost btn--small section-promo__cta" href="${url}" target="_blank" rel="noopener noreferrer">${cta}</a>
                    </article>
                `;
            })
            .join('');
        bindContractCopy(listEl);
    }

    function shortContract(value) {
        const raw = String(value || '').trim();
        if (raw.length <= 16) return raw;
        return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
    }

    function bindContractCopy(root) {
        if (!root) return;
        root.querySelectorAll('[data-copy-contract]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const value = btn.getAttribute('data-copy-contract') || '';
                const label = btn.getAttribute('data-label') || '';
                let ok = false;
                try {
                    await navigator.clipboard.writeText(value);
                    ok = true;
                } catch {
                    ok = false;
                }
                btn.textContent = ok ? 'Copied' : 'Copy failed';
                window.setTimeout(() => {
                    btn.textContent = label;
                }, 1400);
            });
        });
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

    /* About → "Find me" hub (2026-10-03). Every URL comes from gallery.json
       (collection_info.social_links + marketplace_links); this only decides the
       display name, the handle and the group. Duplicates (same URL) are listed once. */
    const HUB_META = {
        x: { name: 'X', group: 'follow' },
        instagram: { name: 'Instagram', group: 'follow' },
        farcaster: { name: 'Farcaster', group: 'follow' },
        base: { name: 'Base App', group: 'follow' },
        // Two Arena profiles (2026-10-03): photography first (the main one), SI art second.
        // The SI art handle stays @JackBeatnicAI (cannot be renamed); only the label says SI.
        arena: { name: 'Arena', group: 'follow', handle: '@JackBeatnic · Photography' },
        'arena-ai': { name: 'Arena', group: 'follow', handle: '@JackBeatnicAI · SI art' },
        zora: { name: 'Zora', group: 'follow' },
        'zora-ai': { name: 'Zora', group: 'follow' },
        opensea: { name: 'OpenSea', group: 'collect', handle: 'All EVM collections' },
        'tradeport-sui': { name: 'TradePort', group: 'collect', handle: 'Nature Stories SE · Sui' },
        objkt: { name: 'OBJKT', group: 'collect' },
        'objkt-main': { name: 'OBJKT', group: 'collect' },
        'objkt-ai': { name: 'OBJKT', group: 'collect' },
        'salvor-main': { name: 'Salvor', group: 'collect' },
        'salvor-ai': { name: 'Salvor', group: 'collect' },
        'xrp-cafe': { name: 'XRP.Cafe', group: 'collect', handle: 'XRPL works' },
    };
    const HUB_ORDER = [
        'x', 'instagram', 'farcaster', 'base', 'arena', 'arena-ai', 'zora', 'zora-ai',
        'opensea', 'tradeport-sui', 'objkt', 'objkt-main', 'objkt-ai', 'salvor-main', 'salvor-ai', 'xrp-cafe',
    ];

    function hubHandle(url) {
        try {
            const u = new URL(url);
            const seg = u.pathname.split('/').filter(Boolean).pop() || '';
            if (!seg) return u.hostname.replace(/^www\./, '');
            return seg.startsWith('@') ? seg : `@${seg}`;
        } catch {
            return '';
        }
    }

    function hubKey(url) {
        return String(url || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
    }

    function renderFindHub(info) {
        const follow = document.getElementById('about-social');
        const collect = document.getElementById('about-marketplaces-nav');
        const seen = new Set();
        const rows = { follow: [], collect: [] };
        const all = [...(info?.social_links || []), ...(info?.marketplace_links || [])]
            .filter((item) => item?.url && /^https:\/\//.test(item.url));
        all.sort((a, b) => {
            const ia = HUB_ORDER.indexOf(a.id);
            const ib = HUB_ORDER.indexOf(b.id);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        all.forEach((item) => {
            const key = hubKey(item.url);
            if (seen.has(key)) return;
            seen.add(key);
            const meta = HUB_META[item.id] || {
                name: String(item.label || item.id || 'Link').split('/')[0].trim(),
                group: (info?.marketplace_links || []).includes(item) ? 'collect' : 'follow',
            };
            const handle = meta.handle || hubHandle(item.url);
            const name = escapeHtml(meta.name);
            rows[meta.group].push(
                `<li><a class="find-hub__link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer me" aria-label="${name} ${escapeHtml(handle)} (opens in a new tab)">` +
                    `<span class="find-hub__name">${name}</span>` +
                    `<span class="find-hub__handle">${escapeHtml(handle)}</span>` +
                    `<span class="find-hub__arrow" aria-hidden="true">↗</span>` +
                    `</a></li>`,
            );
        });
        if (follow) {
            follow.innerHTML = rows.follow.join('');
            follow.hidden = !rows.follow.length;
        }
        if (collect) {
            collect.innerHTML = rows.collect.join('');
            collect.hidden = !rows.collect.length;
        }
    }

    function renderSocialLinks(info) {
        renderFindHub(info);
        renderWalletNames('about-wallets', info?.wallet_names || info?.domain_links);
    }

    function renderMarketplaceLinks() {
        // Marketplaces are part of the About hub (renderFindHub → #about-marketplaces-nav).
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
        const generation = ++renderGeneration;

        if (countEl) {
            const total = sectionNfts.length;
            countEl.textContent =
                filtered.length === total
                    ? `${filtered.length} works`
                    : `${filtered.length} of ${total}`;
        }

        if (filtered.length === 0) {
            container.classList.remove('gallery-grid--busy');
            let msg = GallerySections.emptyMessage();
            if (GalleryLikes.getSavedOnly()) {
                msg = 'No saved works yet — tap the bookmark icon on a card to save it, then use Saved for later.';
            } else if (GalleryFilters.getListedOnly()) {
                msg = 'No listed works in this view.';
            } else if (sectionNfts.length > 0) {
                msg = 'No works match the selected filters.';
            }
            container.innerHTML = `<p class="gallery-empty">${escapeHtml(msg)}</p>`;
            // Keep the empty grid tall enough that About/Marketplaces does not
            // jump into the viewport (felt like an accidental #anchor jump).
            container.classList.add('gallery-grid--empty');
            return;
        }

        container.classList.remove('gallery-grid--empty');

        container.innerHTML = '';
        container.classList.add('gallery-grid--busy');

        const chunkSize = 48;
        let index = 0;

        function appendChunk() {
            if (generation !== renderGeneration) return;

            const frag = document.createDocumentFragment();
            const end = Math.min(index + chunkSize, filtered.length);
            for (let i = index; i < end; i += 1) {
                const nft = filtered[i];
                frag.appendChild(
                    isLiveAuction(nft) ? buildAuctionCard(nft) : buildCard(nft),
                );
            }
            container.appendChild(frag);
            index = end;

            if (index < filtered.length) {
                requestAnimationFrame(appendChunk);
            } else {
                container.classList.remove('gallery-grid--busy');
            }
        }

        requestAnimationFrame(appendChunk);
    }

    // Artwork caption: full text on desktop; on phones a few lines, tap to read all.
    function bindCaption(card) {
        const cap = card.querySelector('.nft-card__description');
        if (!cap) return;
        cap.addEventListener('click', (e) => {
            e.stopPropagation();
            cap.classList.toggle('is-open');
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

        likeBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            GalleryLikes.toggleLike(key);
            syncState();
        });
        saveBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            GalleryLikes.toggleSaved(key);
            syncState();
        });
        card.querySelector('.nft-tip')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
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

        const collection = params.get('collection') || params.get('col') || '';
        const matches = allNfts.filter((item) => Number(item.token_id) === tokenId);
        if (!matches.length) return null;

        if (collection) {
            const hit = matches.find((item) => item.collection_id === collection);
            if (hit) return hit;
        }

        // Disambiguate common low IDs (NS / Nature Jam / Sui all use 1..N)
        const series = params.get('series');
        if (series && typeof GallerySections.resolveAiSeries === 'function') {
            const bySeries = matches.find(
                (item) => GallerySections.resolveAiSeries(item) === series,
            );
            if (bySeries) return bySeries;
        }

        const ai = params.get('ai');
        if (ai === 'sui') {
            const sui = matches.find((item) => item.medium === 'sui_ai' || item.chain === 'sui');
            if (sui) return sui;
        }
        if (ai === 'xrpl') {
            const xrpl = matches.find((item) => item.medium === 'xrpl_ai' || item.chain === 'xrpl');
            if (xrpl) return xrpl;
        }

        // Prefer currently visible section/series when still ambiguous
        if (matches.length > 1) {
            const sectionHits = matches.filter((item) => {
                try {
                    return GallerySections.filterNfts([item]).length > 0;
                } catch {
                    return true;
                }
            });
            if (sectionHits.length === 1) return sectionHits[0];
            if (sectionHits.length > 1) return sectionHits[0];
        }

        return matches[0];
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

    // Artwork caption: own ai.description, else the same work's caption from the main
    // gallery (Featured / Shop entries carry no ai block). Read-only lookup.
    let captionIndex = null;
    let captionIndexSize = -1;
    function captionFor(nft) {
        const own = typeof nft?.ai?.description === 'string' ? nft.ai.description.trim() : '';
        if (own) return own;
        if (!nft || nft.token_id == null || !nft.collection_id) return '';
        if (!captionIndex || captionIndexSize !== allNfts.length) {
            captionIndex = new Map();
            captionIndexSize = allNfts.length;
            allNfts.forEach((n) => {
                const d = typeof n?.ai?.description === 'string' ? n.ai.description.trim() : '';
                if (d && n.collection_id && n.token_id != null) {
                    const k = `${n.collection_id}|${n.token_id}`;
                    if (!captionIndex.has(k)) captionIndex.set(k, d);
                }
            });
        }
        return captionIndex.get(`${nft.collection_id}|${nft.token_id}`) || '';
    }

    function buildAuctionCard(nft) {
        const card = document.createElement('article');
        card.className = 'nft-card nft-card--auction';
        card.dataset.tokenId = String(nft.token_id);

        const key = GalleryLikes.nftKey(nft);
        card.dataset.nftKey = key;

        const name = escapeHtml(nft.name);
        const description = escapeHtml(captionFor(nft));
        const descriptionHtml = description
            ? `<p class="nft-card__description">${description}</p>`
            : '';
        const bidHref = escapeHtml(marketplaceUrl(nft));
        const price = formatPrice(nft);
        const tokenLabelText = tokenLabel(nft);
        const bidLabel = escapeHtml(marketplaceLabel(nft));

        card.innerHTML = `
            <div class="nft-image-wrap">
                <span class="nft-card__badge">Live auction</span>
                <img alt="${name}"
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
                            ${CARD_ICONS.share}
                        </button>
                    </div>
                </div>
                <p class="nft-card__price" title="${escapeHtml(price.hint)}">
                    <span class="nft-card__price-value">${escapeHtml(price.text)}</span>
                </p>
                ${descriptionHtml}
                <div class="nft-card__actions">
                    <a class="btn btn--primary btn--block" href="${bidHref}" target="_blank" rel="noopener noreferrer">${bidLabel}</a>
                </div>
            </div>
        `;

        attachNftMedia(card, nft);
        GalleryShare.bindButton(card.querySelector('.nft-share'), nft);
        bindCaption(card);

        return card;
    }

    function attachNftMedia(card, nft) {
        const img = card.querySelector('.nft-image-wrap img');
        const presentThumb = ImageProxy.presentUrl(nft, 'thumb');
        // Thumbs: our cache only. Do not queue behind weserv — that hung the grid
        // while View (direct present URL) stayed instant.
        if (img) {
            if (presentThumb) {
                img.src = presentThumb;
            } else {
                ImageProxy.bindFallback(
                    img,
                    ImageProxy.displayCandidates(
                        nft.image_url,
                        IMAGE_PROXY,
                        ImageProxy.THUMB_WIDTH,
                        ImageProxy.THUMB_HEIGHT,
                        'inside',
                        nft,
                        'thumb',
                    ),
                );
            }
        }
        const views = ImageProxy.viewCandidates(nft.image_url, IMAGE_PROXY, nft);
        if (presentThumb && !views.includes(presentThumb)) views.push(presentThumb);
        const caption = [nft.name, tokenLabel(nft)].filter(Boolean).join(' · ');
        const openView = (e) => {
            e?.stopPropagation?.();
            Lightbox.open({
                src: views[0],
                fallbacks: views.slice(1),
                alt: nft.name,
                label: caption,
            });
        };
        card.querySelector('.nft-card__view')?.addEventListener('click', openView);
        card.querySelector('.nft-image-wrap')?.addEventListener('click', (e) => {
            if (e.target.closest('.nft-card__view')) return;
            openView(e);
        });
    }

    function buildCard(nft) {
        const card = document.createElement('article');
        card.className = 'nft-card';
        card.dataset.tokenId = String(nft.token_id);

        const key = GalleryLikes.nftKey(nft);
        card.dataset.nftKey = key;

        const name = escapeHtml(nft.name);
        const description = escapeHtml(captionFor(nft));
        const descriptionHtml = description
            ? `<p class="nft-card__description">${description}</p>`
            : '';
        const category = escapeHtml((nft.ai?.category || '').toUpperCase());
        const tokenLabelText = tokenLabel(nft);
        const supplyMetaHtml = objktSupplyMetaHtml(nft);
        const price = formatPrice(nft);
        const marketActionsHtml = buildMarketActionsHtml(nft);
        const likesCount = nft.likes_count ?? 0;
        // Real mood_score from Grok/AI (Nature Stories etc.) — skip placeholder XRPL 6/10
        const moodScore = nft.ai?.mood_score;
        const showMoodScore =
            moodScore != null &&
            moodScore !== '' &&
            nft.medium !== 'xrpl_ai' &&
            nft.chain !== 'xrpl' &&
            nft.chain !== 'sui' &&
            nft.medium !== 'sui_ai' &&
            nft.medium !== 'photography' &&
            nft.medium !== 'objkt_auction';
        const moodHtml = showMoodScore
            ? `<span class="nft-card__mood">Mood ${escapeHtml(String(moodScore))}/10</span>`
            : '';

        const colorsHtml = (nft.ai?.dominant_colors || [])
            .map(
                (color) =>
                    `<span class="color-dot" style="background-color:${escapeHtml(color)}" title="${escapeHtml(color)}"></span>`
            )
            .join('');

        const tagsHtml = (nft.ai?.vibe_tags || [])
            .filter((tag) => {
                const k = String(tag).toLowerCase();
                return ![
                    'ai play', 'ai art', 'nature jam', 'nature stories', 'flower stories',
                    'based ai', 'polygon', 'avalanche', 'base', 'sui', 'xrpl', 'xrp cafe',
                    'tradeport', 'launchpad', 'experimental', 'opensea', 'photography', 'photo',
                ].includes(k);
            })
            .slice(0, 4)
            .map((tag) => `<span class="nft-tag">${escapeHtml(tag)}</span>`)
            .join('');

        const marks = channelMarksHtml(nft);
        const priceAlt = price.alt
            ? `<span class="nft-card__price-alt">${escapeHtml(price.alt)}</span>`
            : '';
        const priceLineHtml = pricesOnButtons(nft)
            ? ''
            : `<p class="nft-card__price" title="${escapeHtml(price.hint)}">
                    <span class="nft-card__price-value">${escapeHtml(price.text)}</span>
                    ${priceAlt}
                </p>`;

        card.innerHTML = `
            <div class="nft-image-wrap">
                <img alt="${name}"
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
                        ${marks}
                        ${supplyMetaHtml}
                    </div>
                    <div class="nft-card__engage">
                        <button type="button" class="nft-like" aria-label="Like ${name}" title="Like" aria-pressed="false">
                            ${CARD_ICONS.like}
                            <span class="nft-like__count"${likesCount > 0 ? '' : ' hidden'}>${likesCount}</span>
                        </button>
                        <button type="button" class="nft-save" aria-label="Save ${name} for later" aria-pressed="false" title="Save for later">
                            ${CARD_ICONS.save}
                        </button>
                        <button type="button" class="nft-share" aria-label="Share ${name}" title="Share">
                            ${CARD_ICONS.share}
                        </button>
                        <button type="button" class="nft-tip" aria-label="Tip the artist" title="Tip the artist">
                            ${CARD_ICONS.tip}
                        </button>
                    </div>
                </div>
                ${priceLineHtml}
                ${descriptionHtml}
                <div class="nft-card__tags">${tagsHtml}</div>
                <div class="color-dots nft-card__palette">${colorsHtml}</div>
                ${marketActionsHtml}
                <div class="nft-card__footer">
                    <div>
                        <span class="nft-card__category">${category}</span>
                        ${moodHtml}
                    </div>
                </div>
            </div>
        `;

        attachNftMedia(card, nft);
        bindEngage(card, nft, key);
        bindCaption(card);
        card.querySelectorAll('.shop-buy').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof ShopCheckout !== 'undefined') ShopCheckout.open(nft);
            });
        });
        card.querySelector('.xrpl-mint')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof XrplMint !== 'undefined') XrplMint.open(nft);
        });
        card.querySelector('.sui-mint')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof SuiMint !== 'undefined') SuiMint.open(nft);
        });

        return card;
    }

    /* Anchor scroll that survives a growing page (2026-10-03).
       The grid appends cards in rAF chunks and images lazy-load, so a single
       scrollIntoView() computed at click time lands "halfway". We scroll, then keep
       re-aiming at the target while the layout keeps changing (ResizeObserver),
       until it is stable or the user scrolls/touches. CSS scroll-margin-top covers
       the fixed header. */
    let anchorSettle = null;

    function stopAnchorSettle() {
        if (!anchorSettle) return;
        anchorSettle.stop();
        anchorSettle = null;
    }

    function anchorTop(el) {
        const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
        const top = el.getBoundingClientRect().top + window.scrollY - margin;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        return Math.max(0, Math.min(top, max));
    }

    function scrollToPageAnchor(id, { smooth = true } = {}) {
        const el = document.getElementById(id);
        if (!el) return false;
        stopAnchorSettle();

        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: anchorTop(el), behavior: smooth && !reduce ? 'smooth' : 'auto' });

        const started = Date.now();
        let lastTarget = anchorTop(el);
        let stableSince = Date.now();
        let timer = 0;
        const aim = () => {
            const t = anchorTop(el);
            if (Math.abs(t - lastTarget) > 2) {
                lastTarget = t;
                stableSince = Date.now();
                window.scrollTo({ top: t, behavior: 'auto' });
            } else if (Math.abs(window.scrollY - t) > 2 && Date.now() - started > 900) {
                // smooth scroll finished short of a moved target
                window.scrollTo({ top: t, behavior: 'auto' });
            }
            if (Date.now() - stableSince > 1200 || Date.now() - started > 8000) {
                stopAnchorSettle();
            }
        };
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(aim) : null;
        ro?.observe(document.body);
        timer = window.setInterval(aim, 150);
        const cancel = () => stopAnchorSettle();
        const opts = { passive: true, once: true };
        window.addEventListener('wheel', cancel, opts);
        window.addEventListener('touchstart', cancel, opts);
        window.addEventListener('keydown', cancel, { once: true });
        anchorSettle = {
            stop() {
                ro?.disconnect();
                window.clearInterval(timer);
                window.removeEventListener('wheel', cancel);
                window.removeEventListener('touchstart', cancel);
                window.removeEventListener('keydown', cancel);
            },
        };
        return true;
    }

    const PAGE_ANCHORS = ['about', 'about-marketplaces', 'about-find'];

    function bindHeroAnchors() {
        // Hero band "Marketplaces" / "About" + top-bar "About" (and any in-page link to them).
        document.addEventListener('click', (e) => {
            const a = e.target.closest?.('a[href^="#"]');
            if (!a) return;
            const id = a.getAttribute('href').slice(1);
            if (!PAGE_ANCHORS.includes(id)) return;
            e.preventDefault();
            if (scrollToPageAnchor(id)) {
                history.replaceState(
                    {},
                    '',
                    `${window.location.pathname}${window.location.search}#${id}`,
                );
            }
        });
    }

    function scrollHashTarget() {
        const id = (window.location.hash || '').replace(/^#/, '');
        if (!id) return;
        if (PAGE_ANCHORS.includes(id) || id === 'explore') {
            window.requestAnimationFrame(() => scrollToPageAnchor(id, { smooth: false }));
        }
    }

    function setupBackToTop() {
        const btn = document.getElementById('back-to-top');
        const fab = document.getElementById('scroll-top-fab');
        const brand = document.querySelector('.site-brand');
        const toTop = () => {
            stopAnchorSettle();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        const sync = () => {
            btn?.classList.toggle('is-visible', window.scrollY > 400);
            // Subtle mobile arrow: only after a long scroll (~3 screens).
            fab?.classList.toggle('is-visible', window.scrollY > window.innerHeight * 3);
        };
        btn?.addEventListener('click', toTop);
        fab?.addEventListener('click', toTop);
        // Tap the signature / brand in the top bar → back to top.
        if (brand) {
            brand.setAttribute('role', 'link');
            brand.setAttribute('tabindex', '0');
            brand.setAttribute('aria-label', 'Jack Beatnic — back to top');
            brand.addEventListener('click', toTop);
            brand.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toTop();
                }
            });
        }
        window.addEventListener('scroll', sync, { passive: true });
        sync();
    }

    function init() {
        setupProtection();
        setupBackToTop();
        bindHeroAnchors();
        if (typeof XrplMint !== 'undefined') XrplMint.init();
        if (typeof SuiMint !== 'undefined') SuiMint.init();
        const ready =
            typeof SuiMint !== 'undefined' && SuiMint.load
                ? SuiMint.load()
                : Promise.resolve();
        Promise.resolve(ready).then(() => load());
    }

    return { init };
})();

window.addEventListener('DOMContentLoaded', () => Gallery.init());