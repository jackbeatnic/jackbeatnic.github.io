/**
 * Studio shop checkout — payment instructions only.
 * No private key. No Seaport. Demo rows must not receive funds.
 */
const ShopCheckout = (() => {
    let modal;
    let current = null;

    function qrUrl(value) {
        return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=8&data=${encodeURIComponent(value)}`;
    }

    function shortAddress(addr) {
        if (!addr || addr.length < 14) return addr || '';
        return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    }

    function exactAmount(item) {
        // Keep the catalog string. A JS number can round 1.797001 → 1.797.
        const raw = item?.pay_amount ?? item?.shop_price ?? item?.price;
        if (raw == null || raw === '') return '';
        return String(raw).trim();
    }

    function amountText(item) {
        const cur = (item.currency || item.listing_currency || '').toUpperCase();
        const price = exactAmount(item);
        if (!price) return '—';
        return `${price} ${cur || ''}`.trim();
    }

    function amountCopy(item) {
        return exactAmount(item);
    }

    function truncatedAmount(exact) {
        const m = String(exact).match(/^(\d+)\.(\d{4,})$/);
        if (!m) return '';
        return `${m[1]}.${m[2].slice(0, 3)}`;
    }

    const CHAINS = {
        avalanche: {
            key: 'avalanche',
            chainId: '0xa86a',
            chainIdDec: 43114,
            chainName: 'Avalanche C-Chain',
            nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
            rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
            blockExplorerUrls: ['https://snowtrace.io'],
            explorerTx: (hash) => `https://snowtrace.io/tx/${hash}`,
        },
    };

    function chainForItem(item) {
        const key = String(item?.chain || 'avalanche').toLowerCase();
        return CHAINS[key] || null;
    }

    /** Decimal AVAX string → wei hex. Never use Number(); 1.797001 must stay exact. */
    function amountToWeiHex(amount) {
        const s = String(amount || '').trim();
        if (!/^\d+(\.\d+)?$/.test(s)) {
            throw new Error('Bad amount');
        }
        const [wholeRaw, fracRaw = ''] = s.split('.');
        const whole = BigInt(wholeRaw || '0');
        const frac = BigInt((fracRaw + '000000000000000000').slice(0, 18));
        const wei = whole * (10n ** 18n) + frac;
        return `0x${wei.toString(16)}`;
    }

    function getInjectedProvider() {
        const eth = window.ethereum;
        if (eth?.providers?.length) {
            return (
                eth.providers.find((p) => p.isAvalanche || p.isCore) ||
                eth.providers.find((p) => p.isMetaMask) ||
                eth.providers[0]
            );
        }
        if (eth) return eth;
        if (window.avalanche) return window.avalanche;
        return null;
    }

    async function ensureChain(provider, chain) {
        const current = await provider.request({ method: 'eth_chainId' });
        if (String(current).toLowerCase() === chain.chainId.toLowerCase()) return;
        try {
            await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: chain.chainId }],
            });
        } catch (err) {
            const missing = err?.code === 4902 || /unrecognized chain/i.test(String(err?.message || ''));
            if (!missing) throw err;
            await provider.request({
                method: 'wallet_addEthereumChain',
                params: [
                    {
                        chainId: chain.chainId,
                        chainName: chain.chainName,
                        nativeCurrency: chain.nativeCurrency,
                        rpcUrls: chain.rpcUrls,
                        blockExplorerUrls: chain.blockExplorerUrls,
                    },
                ],
            });
        }
    }

    function setPayStatus(text, kind) {
        const el = modal?.querySelector('#shop-modal-pay-status');
        if (!el) return;
        if (!text) {
            el.hidden = true;
            el.textContent = '';
            el.removeAttribute('data-kind');
            return;
        }
        el.hidden = false;
        el.dataset.kind = kind || '';
        el.textContent = text;
    }

    function setPayBusy(busy, label) {
        const btn = modal?.querySelector('#shop-pay-wallet');
        const wc = modal?.querySelector('#shop-pay-wc');
        if (btn) {
            btn.disabled = busy;
            if (label) btn.textContent = label;
            else if (!busy) btn.textContent = 'Pay with wallet';
        }
        if (wc) wc.disabled = busy;
    }

    async function connectInjected() {
        const provider = getInjectedProvider();
        if (!provider) {
            throw new Error(
                'No browser wallet found. Install Core or MetaMask, or use WalletConnect, or copy the amount.',
            );
        }
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        const from = accounts?.[0];
        if (!from) throw new Error('Wallet did not return an address.');
        return { provider, from };
    }

    let wcProvider = null;
    let wcProjectId = '';

    async function loadWalletConnectProjectId() {
        if (wcProjectId) return wcProjectId;
        try {
            const res = await fetch('data/walletconnect.json', { cache: 'no-cache' });
            if (!res.ok) return '';
            const doc = await res.json();
            wcProjectId = String(doc.projectId || doc.project_id || '').trim();
        } catch {
            wcProjectId = '';
        }
        return wcProjectId;
    }

    async function connectWalletConnect(chain) {
        const projectId = await loadWalletConnectProjectId();
        if (!projectId) {
            throw new Error(
                'WalletConnect is not configured yet. Use Core / MetaMask in this browser, or copy the amount.',
            );
        }
        const { EthereumProvider } = await import(
            'https://esm.sh/@walletconnect/ethereum-provider@2.21.1'
        );
        if (!wcProvider) {
            wcProvider = await EthereumProvider.init({
                projectId,
                chains: [chain.chainIdDec],
                showQrModal: true,
                metadata: {
                    name: 'Jack Beatnic Gallery',
                    description: 'Studio shop',
                    url: 'https://jackbeatnic.github.io',
                    icons: ['https://jackbeatnic.github.io/assets/og-preview.jpg'],
                },
            });
        }
        await wcProvider.connect();
        const from = wcProvider.accounts?.[0];
        if (!from) throw new Error('WalletConnect did not return an address.');
        return { provider: wcProvider, from };
    }

    async function sendShopPayment(item, { walletConnect = false } = {}) {
        if (!item || item.demo || item.shop_status === 'coming') {
            throw new Error('This row is not for sale.');
        }
        const chain = chainForItem(item);
        if (!chain) {
            throw new Error(`Wallet pay is not wired for ${item.chain || 'this chain'} yet.`);
        }
        const to = String(item.pay_address || '').trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
            throw new Error('Missing studio pay address.');
        }
        const value = amountToWeiHex(exactAmount(item));
        const { provider, from } = walletConnect
            ? await connectWalletConnect(chain)
            : await connectInjected();
        await ensureChain(provider, chain);
        const raw = await provider.request({
            method: 'eth_sendTransaction',
            params: [{ from, to, value }],
        });
        const hash =
            typeof raw === 'string' && raw && !raw.startsWith('0x') ? `0x${raw}` : raw;
        return { hash, from, chain };
    }

    async function handlePay(walletConnect) {
        if (!current) return;
        setPayBusy(true, walletConnect ? 'WalletConnect…' : 'Confirm in wallet…');
        setPayStatus(
            walletConnect
                ? 'Scan the WalletConnect code, then confirm the exact amount.'
                : 'Confirm the exact amount in Core or MetaMask. Do not edit it.',
            'pending',
        );
        try {
            const { hash, from, chain } = await sendShopPayment(current, { walletConnect });
            const statusEl = modal.querySelector('#shop-modal-pay-status');
            const okHash = /^0x[0-9a-fA-F]{64}$/.test(String(hash || ''));
            if (statusEl && okHash) {
                const url = chain.explorerTx(hash);
                statusEl.hidden = false;
                statusEl.dataset.kind = 'ok';
                statusEl.replaceChildren();
                statusEl.appendChild(
                    document.createTextNode(
                        `Payment sent from ${shortAddress(from)}. The NFT goes to that wallet after confirmation. `,
                    ),
                );
                const a = document.createElement('a');
                a.href = url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = 'View transaction';
                statusEl.appendChild(a);
            } else {
                setPayStatus(
                    `Payment sent from ${shortAddress(from)}. The NFT goes to that wallet after confirmation.`,
                    'ok',
                );
            }
        } catch (err) {
            if (err?.code === 4001 || /rejected/i.test(String(err?.message || ''))) {
                setPayStatus('Cancelled in the wallet.', 'err');
            } else {
                setPayStatus(err?.message || 'Wallet payment failed.', 'err');
            }
        } finally {
            setPayBusy(false);
        }
    }

    function copy(btn, value) {
        if (!btn || !value) return;
        const original = btn.textContent;
        navigator.clipboard
            .writeText(value)
            .then(() => {
                btn.textContent = 'Copied';
            })
            .catch(() => {
                btn.textContent = 'Copy failed';
            })
            .finally(() => {
                window.setTimeout(() => {
                    btn.textContent = original;
                }, 1600);
            });
    }

    function fill(item) {
        current = item;
        const demo = Boolean(item.demo);
        const coming = item.shop_status === 'coming' || item.status === 'coming';
        const name = item.name || item.sku || 'Work';
        const amount = amountText(item);
        const exact = exactAmount(item);
        const wrong = truncatedAmount(exact);
        const tid = item.token_id != null && item.token_id !== '' ? String(item.token_id) : '';
        const addr = item.pay_address || '';
        const memo = item.memo || item.sku || '';
        const qty = item.qty_available ?? item.promo_quantity;
        const fulfill = item.fulfill || 'stock';
        const cur = (item.currency || item.listing_currency || 'AVAX').toUpperCase();

        const title = modal.querySelector('#shop-modal-title');
        const lead = modal.querySelector('#shop-modal-lead');
        const banner = modal.querySelector('#shop-modal-banner');
        const nameEl = modal.querySelector('#shop-modal-name');
        const metaEl = modal.querySelector('#shop-modal-meta');
        const amountEl = modal.querySelector('#shop-modal-amount');
        const amountHint = modal.querySelector('#shop-modal-amount-hint');
        const addrEl = modal.querySelector('#shop-modal-address');
        const memoEl = modal.querySelector('#shop-modal-memo');
        const qr = modal.querySelector('#shop-modal-qr');
        const fulfillEl = modal.querySelector('#shop-modal-fulfill');

        if (title) title.textContent = demo ? 'Demo checkout' : 'Pay the studio';
        if (nameEl) nameEl.textContent = name;
        if (metaEl) {
            const bits = [
                item.collection_name || item.collection_id || '',
                tid ? `token #${tid}` : '',
                item.chain || '',
                qty != null ? `${qty} available` : '',
            ].filter(Boolean);
            metaEl.textContent = bits.join(' · ');
        }
        if (amountEl) amountEl.textContent = amount;
        if (amountHint) {
            if (demo || coming || !exact) {
                amountHint.hidden = true;
                amountHint.textContent = '';
            } else {
                amountHint.hidden = false;
                const bits = [];
                if (tid && wrong) {
                    bits.push(
                        `${name} = ${exact} ${cur} — not ${wrong}. Rounding will not match.`,
                    );
                } else if (wrong) {
                    bits.push(`Send ${exact} — not ${wrong}. Rounding will not match.`);
                }
                if (tid) {
                    bits.push(`Last digits = token #${tid}. That is how the studio matches the work.`);
                }
                amountHint.textContent = bits.join(' ');
            }
        }
        if (addrEl) addrEl.textContent = addr || '—';
        if (memoEl) memoEl.textContent = memo || '—';
        if (fulfillEl) {
            fulfillEl.textContent =
                fulfill === 'mint_on_demand'
                    ? 'The NFT is created after payment confirms on-chain.'
                    : 'Send from the wallet that should receive the NFT. After the payment confirms on-chain, one edition is transferred automatically — usually under a minute.';
        }

        if (banner) {
            if (demo || coming) {
                banner.hidden = false;
                banner.textContent = coming
                    ? 'Coming soon. Do not send funds.'
                    : 'Skeleton only. Do not send funds.';
            } else {
                banner.hidden = false;
                banner.classList.add('shop-modal__banner--ok');
                banner.textContent =
                    'Pay with wallet to send the exact amount (token id is in the figure). Copy-amount is only a fallback. Memo is optional.';
            }
        }

        if (lead) {
            lead.textContent = demo
                ? 'This panel shows how a studio purchase will work. It is not an open sale.'
                : 'Connect Core or MetaMask, confirm the transfer, done. The NFT is sent to the wallet you pay from.';
        }

        const payBtn = modal.querySelector('#shop-pay-wallet');
        const wcBtn = modal.querySelector('#shop-pay-wc');
        if (payBtn) {
            payBtn.hidden = demo || coming || !addr || !exact;
            payBtn.disabled = false;
            payBtn.textContent = 'Pay with wallet';
        }
        if (wcBtn) {
            wcBtn.hidden = demo || coming || !addr || !exact || !wcProjectId;
            wcBtn.disabled = false;
        }
        setPayStatus('', '');

        if (qr) {
            if (addr && !demo && !coming) {
                qr.hidden = false;
                qr.src = qrUrl(addr);
                qr.alt = `QR for ${shortAddress(addr)}`;
            } else {
                qr.removeAttribute('src');
                qr.hidden = true;
                qr.alt = '';
            }
        }

        modal.dataset.demo = demo ? '1' : '0';
    }

    function show() {
        if (!modal) return;
        modal.hidden = false;
        document.body.classList.add('shop-open');
        modal.querySelector('.shop-modal__close')?.focus();
    }

    function hide() {
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove('shop-open');
        current = null;
    }

    function open(item) {
        if (!item || !modal) return;
        fill(item);
        show();
    }

    function init() {
        modal = document.getElementById('shop-modal');
        if (!modal) return;

        modal.querySelector('.shop-modal__close')?.addEventListener('click', hide);
        modal.querySelector('.shop-modal__backdrop')?.addEventListener('click', hide);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.hidden) hide();
        });

        modal.querySelector('#shop-copy-address')?.addEventListener('click', () => {
            copy(modal.querySelector('#shop-copy-address'), current?.pay_address || '');
        });
        modal.querySelector('#shop-copy-memo')?.addEventListener('click', () => {
            copy(modal.querySelector('#shop-copy-memo'), current?.memo || current?.sku || '');
        });
        modal.querySelector('#shop-copy-amount')?.addEventListener('click', () => {
            copy(modal.querySelector('#shop-copy-amount'), amountCopy(current || {}));
        });
        modal.querySelector('#shop-pay-wallet')?.addEventListener('click', (e) => {
            e.preventDefault();
            handlePay(false);
        });
        modal.querySelector('#shop-pay-wc')?.addEventListener('click', (e) => {
            e.preventDefault();
            handlePay(true);
        });
        loadWalletConnectProjectId().then((id) => {
            const wcBtn = modal.querySelector('#shop-pay-wc');
            if (wcBtn && !id) {
                wcBtn.title =
                    'WalletConnect needs a Reown project id in data/walletconnect.json';
            }
        });
    }

    return { init, open, hide, amountToWeiHex };
})();
