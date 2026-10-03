/**
 * Wallet sign-in: EVM (browser or WalletConnect), Sui, XRPL (Xaman, GemWallet, Crossmark), Tezos (Temple, Kukai), Solana.
 * Signature only, no transaction, no fee.
 * <script src="js/wallet-signin.js" data-api="https://api.jackbeatnic.shop"></script>
 * Adds one floating wallet button (bottom-left). Session token lives in sessionStorage only.
 */
(() => {
    const script = document.currentScript;
    const API = ((script && script.dataset.api) || 'https://api.jackbeatnic.shop').replace(/\/$/, '');
    const KEY = 'jb_wallet_session';
    const EVM_CHAINS = [43114, 8453, 137, 1];
    const EVM_NETS = [
        { id: 43114, key: 'avalanche', label: 'Avalanche', rpc: 'https://api.avax.network/ext/bc/C/rpc', symbol: 'AVAX', explorer: 'https://snowtrace.io' },
        { id: 8453, key: 'base', label: 'Base', rpc: 'https://mainnet.base.org', symbol: 'ETH', explorer: 'https://basescan.org' },
        { id: 137, key: 'polygon', label: 'Polygon', rpc: 'https://polygon-rpc.com', symbol: 'POL', explorer: 'https://polygonscan.com' },
        { id: 1, key: 'ethereum', label: 'Ethereum', rpc: 'https://cloudflare-eth.com', symbol: 'ETH', explorer: 'https://etherscan.io' },
    ];
    const EVM_VIEW = 'jb_wallet_evm_chain';
    let lastEth = null;
    let pickEvmNet = async () => EVM_NETS[0];
    const evmNetById = (id) => EVM_NETS.find((n) => n.id === Number(id));
    async function ensureEvmChain(eth, id) {
        const hexId = `0x${Number(id).toString(16)}`;
        try {
            await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
        } catch (e) {
            const missing = e && (e.code === 4902 || /4902|unrecognized chain/i.test(String(e.message || e)));
            const net = evmNetById(id);
            if (!missing || !net) throw e;
            await eth.request({
                method: 'wallet_addEthereumChain',
                params: [{
                    chainId: hexId,
                    chainName: net.label,
                    nativeCurrency: { name: net.symbol, symbol: net.symbol, decimals: 18 },
                    rpcUrls: [net.rpc],
                    blockExplorerUrls: [net.explorer],
                }],
            });
        }
    }
    const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.matchMedia && matchMedia('(pointer:coarse)').matches);
    const PAGE = location.href.split('#')[0];
    const svg = (p, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    const ICON = {
        wallet: svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3"/><rect x="3" y="8" width="18" height="11" rx="2.5"/><circle cx="16.5" cy="13.5" r="1.2" fill="currentColor"/>'),
        star: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
        out: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>', 16),
        gift: svg('<rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M12 9v11M3 13h18M12 9c-2-4-6-4-6-1.5S9 9 12 9zm0 0c2-4 6-4 6-1.5S15 9 12 9z"/>', 14),
        bag: svg('<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8a3 3 0 0 1 6 0"/>', 14),
        phone: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>', 14),
        link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 14),
    };
    const WC_META = {
        name: 'Jack Beatnic Gallery',
        description: 'Wallet sign-in',
        url: 'https://jackbeatnic.github.io',
        icons: ['https://jackbeatnic.github.io/assets/og-preview.jpg'],
    };
    const enc_ = encodeURIComponent;
    const log = (...a) => console.info('wallet sign-in:', ...a);
    const WC_ICON = new URL('../assets/wallets/walletconnect.svg', (script && script.src) || location.href).href;
    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const b58 = (bytes) => {
        let n = 0n; for (const x of bytes) n = n * 256n + BigInt(x);
        let out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
        for (const x of bytes) { if (x !== 0) break; out = '1' + out; }
        return out;
    };
    const TRUST_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#0500FF"/><path d="M20 8l10 3.6v8.2c0 6.2-4.2 10.4-10 12.2-5.8-1.8-10-6-10-12.2v-8.2z" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/></svg>');
    const KUKAI_ICON = 'data:image/png;base64,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';
    const BEACON_JS = 'https://cdn.jsdelivr.net/npm/@airgap/beacon-sdk@4.8.1/dist/walletbeacon.min.js';
    const BEACON_SRI = 'sha384-BRG93bqbyUWvDu3ImCSrlsOmHKakx1XM9AZiihMekRYBJinl0IKE5XZxTU14EG1K';
    const JOEY_ENABLED = false;
    const JOEY_ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#F47B20"/><g fill="#fff"><ellipse cx="15" cy="12" rx="3.6" ry="9" transform="rotate(-12 15 12)"/><ellipse cx="25" cy="12" rx="3.6" ry="9" transform="rotate(12 25 12)"/><ellipse cx="20" cy="26" rx="10" ry="8.5"/></g><circle cx="16.5" cy="25" r="1.4" fill="#F47B20"/><circle cx="23.5" cy="25" r="1.4" fill="#F47B20"/></svg>');
    // EIP-6963: every EVM extension announces itself (MetaMask, Core, Rabby, Coinbase, ...)
    const evmProviders = new Map();
    window.addEventListener('eip6963:announceProvider', (e) => {
        const d = e.detail;
        if (d && d.info && d.provider && !evmProviders.has(d.info.uuid)) { evmProviders.set(d.info.uuid, d); log('EVM wallet found', d.info.name, d.info.rdns); }
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    let walletsApi = null;
    async function standardWallets(feature) {
        try {
            if (!walletsApi) walletsApi = (await import('https://esm.sh/@wallet-standard/app@1.1.0')).getWallets();
            await sleep(150);
            const list = walletsApi.get().filter((w) => w.features && w.features[feature]);
            log('wallet-standard', feature, list.map((w) => w.name));
            return list;
        } catch (e) { log('wallet-standard load failed', e.message); return []; }
    }
    const hasSolLegacy = () => Boolean(window.phantom?.solana || window.solflare || window.solana);
    const wIcon = (w) => (w.icon || (w.info && w.info.icon) || '');
    // Top level: chains. options() -> list of { label, glyph|icon, run: () => Promise<session> | href | copy }
    const CHAINS = [
        { id: 'evm', label: 'EVM', glyph: 'Ξ', options: async () => {
            window.dispatchEvent(new Event('eip6963:requestProvider'));
            await sleep(120);
            const found = [...evmProviders.values()].map((d) => ({ label: d.info.name, icon: d.info.icon, run: () => adapters.evm(d.provider, d.info.name) }));
            if (!found.length && window.ethereum) found.push({ label: 'Browser', glyph: '🧩', run: () => adapters.evm(window.ethereum, 'Browser') });
            return [...found,
                { label: 'WalletConnect', icon: WC_ICON, run: () => adapters.evmWc() },
                MOBILE && !found.length && { label: 'MetaMask', glyph: '🦊', href: `https://metamask.app.link/dapp/${PAGE.replace(/^https?:\/\//, '')}` }];
        } },
        { id: 'sui', label: 'Sui', glyph: '💧', options: async () => {
            const ws = (await standardWallets('sui:signPersonalMessage')).map((w) => ({ label: w.name, icon: wIcon(w), run: () => adapters.sui(w) }));
            if (!ws.length && !MOBILE) return [{ label: 'No Sui wallet', glyph: '∅', run: async () => { throw new Error('No Sui wallet'); } }];
            return [...ws, MOBILE && !ws.length && { label: 'Slush', glyph: '💧', href: `https://my.slush.app/browse/${enc_(PAGE)}` }];
        } },
        { id: 'xrpl', label: 'XRPL', glyph: 'X', options: async () => [
            { label: 'Xaman', glyph: 'Xa', run: () => adapters.xaman() },
            // Joey is disabled: it broadcast the sign-in transaction despite submit:false. No sign-only method yet.
            JOEY_ENABLED && { label: 'Joey', icon: JOEY_ICON, run: () => adapters.joey() },
            !MOBILE && { label: 'GemWallet', glyph: '💎', run: () => adapters.gem() },
            !MOBILE && { label: 'Crossmark', glyph: '✚', run: () => adapters.crossmark() },
        ] },
        { id: 'tezos', label: 'Tezos', glyph: 'ꜩ', options: async () => [
            !MOBILE && { label: 'Temple', glyph: '🏛', run: () => adapters.tezos() },
            { label: 'Kukai', icon: KUKAI_ICON, run: () => adapters.kukai() },
            MOBILE && { label: 'Copy link', glyph: '🔗', copy: true, hint: 'Open the copied link in the Temple app browser' },
        ] },
        { id: 'solana', label: 'Solana', glyph: '◎', options: async () => {
            const ws = (await standardWallets('solana:signMessage')).map((w) => ({ label: w.name, icon: wIcon(w), run: () => adapters.solanaStd(w) }));
            if (!ws.length && hasSolLegacy()) ws.push({ label: 'Browser', glyph: '🧩', run: () => adapters.solana() });
            return [...ws,
                { label: 'Trust Wallet', icon: TRUST_ICON, run: () => adapters.solanaWc('trust') },
                { label: 'WalletConnect', icon: WC_ICON, run: () => adapters.solanaWc('wc') },
                !ws.length && MOBILE && { label: 'Phantom', glyph: '👻', href: `https://phantom.app/ul/browse/${enc_(PAGE)}?ref=${enc_(location.origin)}` },
                !ws.length && MOBILE && { label: 'Solflare', glyph: '☀', href: `https://solflare.com/ul/v1/browse/${enc_(PAGE)}?ref=${enc_(location.origin)}` },
                !ws.length && !MOBILE && { label: 'Solflare', glyph: '☀', href: 'https://solflare.com/download', newTab: true, hint: 'Get Solflare' }];
        } },
    ];

    const enc = new TextEncoder();
    const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const short = (a) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
    const save = (s) => sessionStorage.setItem(KEY, JSON.stringify(s));
    const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };

    async function api(path, opts = {}) {
        const s = load();
        const headers = { 'Content-Type': 'application/json' };
        if (s && s.token) headers.Authorization = `Bearer ${s.token}`;
        const r = await fetch(API + path, { ...opts, headers });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { status: r.status });
        return j;
    }
    const nonce = (family, address, chainId) =>
        api(`/api/nonce?${new URLSearchParams({ family, address, ...(chainId ? { chainId: String(chainId) } : {}) })}`);
    const verify = (body) => api('/api/verify', { method: 'POST', body: JSON.stringify(body) });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let wcId = '';
    async function wcProjectId() {
        if (wcId) return wcId;
        const doc = await (await fetch('data/walletconnect.json', { cache: 'no-cache' })).json();
        wcId = String(doc.projectId || doc.project_id || '').trim();
        if (!wcId) throw new Error('WalletConnect not configured');
        return wcId;
    }
    async function qrDataUrl(text) {
        const mod = await import('https://esm.sh/qrcode@1.5.4');
        return (mod.default || mod).toDataURL(text, { margin: 1, width: 440 });
    }
    // reject when the user cancels the QR panel or after `ms`
    const cancellable = (promise, ms = 180000) => new Promise((resolve, reject) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (qrClosed) { clearInterval(iv); reject(new Error('Cancelled')); }
            else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('expired')); }
        }, 400);
        promise.then((v) => { clearInterval(iv); resolve(v); }, (e) => { clearInterval(iv); reject(e); });
    });
    let showQr = async () => {};
    let hideQr = () => {};
    let qrClosed = false;

    /* ---------- chain adapters: each returns the verify() result ---------- */
    const adapters = {
        async evm(eth = window.ethereum, name = 'Browser') {
            if (!eth) throw new Error('No EVM wallet');
            log('EVM connect', name);
            lastEth = eth;
            const [address] = await eth.request({ method: 'eth_requestAccounts' });
            let cid = parseInt(await eth.request({ method: 'eth_chainId' }), 16);
            if (!evmNetById(cid)) {
                const net = await pickEvmNet();
                await ensureEvmChain(eth, net.id);
                cid = net.id;
            }
            const n = await nonce('evm', address, cid);
            log('EVM sign', name, address, 'chain', cid);
            const signature = await eth.request({ method: 'personal_sign', params: [`0x${hex(enc.encode(n.message))}`, address] });
            const session = await verify({ nonce: n.nonce, signature });
            session.chainId = String(cid);
            return session;
        },
        async evmWc() {
            const projectId = await wcProjectId();
            const { EthereumProvider } = await import('https://esm.sh/@walletconnect/ethereum-provider@2.21.1');
            const p = await EthereumProvider.init({ projectId, optionalChains: EVM_CHAINS, showQrModal: true, metadata: WC_META });
            try {
                await cancellable(p.connect());
                lastEth = p;
                const address = p.accounts?.[0];
                if (!address) throw new Error('No account');
                let cid = Number(p.chainId);
                if (!evmNetById(cid)) {
                    const net = await pickEvmNet();
                    await ensureEvmChain(p, net.id);
                    cid = net.id;
                }
                const n = await nonce('evm', address, cid);
                const signature = await cancellable(p.request({ method: 'personal_sign', params: [`0x${hex(enc.encode(n.message))}`, address] }));
                const session = await verify({ nonce: n.nonce, signature });
                session.chainId = String(cid);
                return session;
            } finally {
                if (lastEth === p) lastEth = null;
                p.disconnect().catch(() => {});
            }
        },
        async xaman() {
            const s = await api('/api/xaman/signin', { method: 'POST', body: '{}' });
            await showQr(s.qr, s.link, 'Xaman');
            const until = Date.now() + 5 * 60 * 1000;
            try {
                while (Date.now() < until && !qrClosed) {
                    await sleep(2500);
                    if (qrClosed) break;
                    const st = await api(`/api/xaman/status/${s.uuid}?poll=${encodeURIComponent(s.poll)}`);
                    if (st.state === 'signed') return st;
                    if (st.state === 'rejected' || st.state === 'expired') throw new Error(st.state);
                }
                throw new Error('Cancelled');
            } finally { hideQr(); }
        },
        async joey() {
            const projectId = await wcProjectId();
            const { default: UniversalProvider } = await import('https://esm.sh/@walletconnect/universal-provider@2.21.1');
            const up = await UniversalProvider.init({ projectId, metadata: WC_META });
            up.on('display_uri', async (uri) => {
                await showQr(await qrDataUrl(uri), `joey://settings/wc?uri=${encodeURIComponent(uri)}`, 'Joey');
            });
            try {
                const session = await cancellable(up.connect({
                    namespaces: { xrpl: { chains: ['xrpl:0'], methods: ['xrpl_signTransaction'], events: [] } },
                }));
                hideQr();
                const account = String(session.namespaces.xrpl.accounts[0]).split(':').pop();
                const n = await nonce('xrpl', account);
                const res = await cancellable(up.request({
                    method: 'xrpl_signTransaction',
                    params: { tx_json: n.txJson, options: { autofill: false, submit: false } },
                }, 'xrpl:0'));
                const signed = res?.tx_json || res?.tx_blob || res?.result?.tx_json || res;
                return await verify({ nonce: n.nonce, txJson: signed });
            } finally {
                hideQr();
                up.disconnect().catch(() => {});
            }
        },
        async sui(w) {
            if (!w) throw new Error('No Sui wallet');
            log('Sui connect', w.name, Object.keys(w.features));
            const res = await w.features['standard:connect'].connect();
            const account = (res && res.accounts && res.accounts[0]) || w.accounts[0];
            if (!account) throw new Error('No Sui account');
            log('Sui account', account.address, account.chains);
            const n = await nonce('sui', account.address);
            const out = await w.features['sui:signPersonalMessage'].signPersonalMessage({ message: enc.encode(n.message), account, chain: 'sui:mainnet' });
            log('Sui signed, scheme flag', out && out.signature ? atob(out.signature).charCodeAt(0) : '?');
            return verify({ nonce: n.nonce, signature: out.signature });
        },
        async gem() {
            const gem = await import('https://esm.sh/@gemwallet/api@3');
            const inst = await gem.isInstalled();
            log('GemWallet installed', inst?.result?.isInstalled);
            if (!inst?.result?.isInstalled) throw new Error('GemWallet not found');
            const pk = (await gem.getPublicKey())?.result;
            if (!pk) throw new Error('Rejected');
            log('GemWallet account', pk.address);
            const n = await nonce('xrpl', pk.address);
            const signed = (await gem.signMessage(n.message))?.result?.signedMessage;
            if (!signed) throw new Error('Rejected');
            return verify({ nonce: n.nonce, signature: signed, publicKey: pk.publicKey });
        },
        async crossmark() {
            const cm = (await import('https://esm.sh/@crossmarkio/sdk@0.4')).default;
            const installed = await Promise.race([Promise.resolve(cm.sync.isInstalled()), sleep(1500).then(() => cm.sync.isInstalled())]);
            log('Crossmark installed', installed);
            if (!installed) throw new Error('Crossmark not found');
            const first = (await cm.methods.signInAndWait()).response.data;
            log('Crossmark account', first.address);
            const n = await nonce('xrpl', first.address);
            const d = (await cm.methods.signInAndWait(hex(enc.encode(n.message)))).response.data;
            return verify({ nonce: n.nonce, signature: d.signature, publicKey: d.publicKey });
        },
        async tezos() {
            const req = (payload, timeout = 120000) => new Promise((resolve, reject) => {
                const reqId = Math.random().toString(36).slice(2) + Date.now().toString(36);
                const t = setTimeout(() => { window.removeEventListener('message', h); reject(new Error('Temple timeout')); }, timeout);
                const h = (evt) => {
                    const r = evt.data;
                    if (evt.source !== window || !r || r.reqId !== reqId) return;
                    if (r.type === 'TEMPLE_PAGE_RESPONSE') { clearTimeout(t); window.removeEventListener('message', h); resolve(r.payload); }
                    if (r.type === 'TEMPLE_PAGE_ERROR_RESPONSE') { clearTimeout(t); window.removeEventListener('message', h); reject(new Error(r.payload === 'NOT_GRANTED' ? 'Rejected' : String(r.payload || 'Temple error'))); }
                };
                window.addEventListener('message', h);
                window.postMessage({ type: 'TEMPLE_PAGE_REQUEST', payload, reqId }, '*');
            });
            const available = await new Promise((resolve) => {
                const h = (evt) => { if (evt.source === window && evt.data?.type === 'TEMPLE_PAGE_RESPONSE' && evt.data?.payload === 'PONG') { done(true); } };
                const done = (v) => { window.removeEventListener('message', h); clearTimeout(t); resolve(v); };
                window.addEventListener('message', h);
                window.postMessage({ type: 'TEMPLE_PAGE_REQUEST', payload: 'PING' }, '*');
                const t = setTimeout(() => done(false), 800);
            });
            log('Temple available', available);
            if (!available) throw new Error('Temple not found');
            const perm = await req({ type: 'PERMISSION_REQUEST', network: 'mainnet', appMeta: { name: 'Jack Beatnic Gallery' }, force: false });
            log('Temple account', perm && perm.pkh);
            if (!perm || !perm.pkh) throw new Error('Rejected');
            const n = await nonce('tezos', perm.pkh);
            const b = enc.encode(n.message);
            const payload = `0501${b.length.toString(16).padStart(8, '0')}${hex(b)}`;
            const res = await req({ type: 'SIGN_REQUEST', sourcePkh: perm.pkh, payload });
            return verify({ nonce: n.nonce, signature: res.signature, publicKey: perm.publicKey });
        },
        async kukai() {
            // Beacon pairing (Kukai featured first). Sign-only: requestSignPayload, never an operation.
            // Beacon relay nodes reject requests that carry a Referer header (HTTP 403), so drop it for this page from now on.
            if (!document.querySelector('meta[name="referrer"][content="no-referrer"]')) {
                const m = document.createElement('meta'); m.name = 'referrer'; m.content = 'no-referrer'; document.head.appendChild(m);
            }
            if (!window.beacon || !window.beacon.DAppClient) {
                log('Beacon loading');
                await new Promise((resolve, reject) => {
                    const sc = document.createElement('script');
                    sc.src = BEACON_JS; sc.integrity = BEACON_SRI; sc.crossOrigin = 'anonymous'; sc.async = true;
                    sc.onload = resolve; sc.onerror = () => reject(new Error('Beacon failed to load'));
                    document.head.appendChild(sc);
                });
            }
            const B = window.beacon;
            const client = new B.DAppClient({ name: 'Jack Beatnic Gallery', network: { type: B.NetworkType.MAINNET }, featuredWallets: ['kukai', 'temple'] });
            try {
                await client.clearActiveAccount().catch(() => {});
                const perm = await client.requestPermissions();
                const address = perm.address || perm.accountInfo?.address;
                const publicKey = perm.publicKey || perm.accountInfo?.publicKey;
                log('Beacon account', address, perm.walletKey || '');
                if (!address || !publicKey) throw new Error('Rejected');
                const n = await nonce('tezos', address);
                const b = enc.encode(n.message);
                const payload = `0501${b.length.toString(16).padStart(8, '0')}${hex(b)}`;
                const res = await client.requestSignPayload({ signingType: B.SigningType.MICHELINE, payload, sourceAddress: address });
                return await verify({ nonce: n.nonce, signature: res.signature, publicKey });
            } catch (e) {
                const t = e && (e.errorType || e.title || e.message);
                log('Beacon error', t);
                if (/ABORTED|NOT_GRANTED|aborted/i.test(String(t))) throw new Error('Rejected');
                throw e;
            } finally {
                client.clearActiveAccount().catch(() => {});
                client.disconnect && client.disconnect().catch(() => {});
            }
        },
        async solanaWc(wallet) {
            // WalletConnect v2, Solana namespace, sign-only (solana_signMessage). wallet: 'trust' or 'wc'.
            const SOL_MAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
            const projectId = await wcProjectId();
            const { default: UniversalProvider } = await import('https://esm.sh/@walletconnect/universal-provider@2.21.1');
            const up = await UniversalProvider.init({ projectId, metadata: WC_META });
            const label = wallet === 'trust' ? 'Trust Wallet' : 'WalletConnect';
            up.on('display_uri', async (uri) => {
                log('Solana WalletConnect pairing uri ready', label);
                const link = wallet === 'trust' ? `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}` : uri;
                await showQr(await qrDataUrl(uri), link, label);
            });
            try {
                const session = await cancellable(up.connect({
                    optionalNamespaces: { solana: { chains: [SOL_MAIN], methods: ['solana_signMessage'], events: [] } },
                }));
                hideQr();
                const acc = (session.namespaces.solana?.accounts || [])[0];
                if (!acc) throw new Error('No Solana account');
                const address = String(acc).split(':').pop();
                log('Solana WalletConnect account', address, session.peer?.metadata?.name);
                const n = await nonce('solana', address);
                const res = await cancellable(up.request({ method: 'solana_signMessage', params: { message: b58(enc.encode(n.message)), pubkey: address } }, SOL_MAIN));
                return await verify({ nonce: n.nonce, signature: res.signature });
            } finally {
                hideQr();
                up.disconnect().catch(() => {});
            }
        },
        async solanaStd(w) {
            log('Solana connect', w.name);
            const res = await w.features['standard:connect'].connect();
            const account = (res && res.accounts && res.accounts[0]) || w.accounts[0];
            if (!account) throw new Error('No Solana account');
            const n = await nonce('solana', account.address);
            const out = await w.features['solana:signMessage'].signMessage({ account, message: enc.encode(n.message) });
            const sig = (Array.isArray(out) ? out[0] : out).signature;
            return verify({ nonce: n.nonce, signature: hex(sig) });
        },
        async solana() {
            const p = window.phantom?.solana || window.solflare || window.solana;
            if (!p) throw new Error('No Solana wallet');
            const res = await p.connect();
            const address = (res?.publicKey || p.publicKey).toString();
            const n = await nonce('solana', address);
            const out = await p.signMessage(enc.encode(n.message), 'utf8');
            return verify({ nonce: n.nonce, signature: hex(out.signature || out) });
        },
    };

    /* ---------- UI ---------- */
    const css = `
.ws-fab{position:fixed;left:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:150;display:inline-flex;align-items:center;gap:4px;height:40px;min-width:40px;padding:0 11px;border:0;border-radius:20px;background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 0 0 1px rgba(0,0,0,.08),0 2px 10px rgba(0,0,0,.08);color:#333;cursor:pointer;font:600 12px/1 system-ui,-apple-system,sans-serif;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.ws-fab .ws-star{color:#c9971c;display:inline-flex}.ws-fab.ws-err{color:#c0392b}
.ws-pop{position:fixed;left:12px;bottom:calc(62px + env(safe-area-inset-bottom,0px));z-index:151;min-width:180px;max-width:calc(100vw - 24px);padding:10px;border-radius:14px;background:rgba(255,255,255,.95);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-shadow:0 0 0 1px rgba(0,0,0,.08),0 8px 28px rgba(0,0,0,.14);color:#222;font:13px/1.3 system-ui,-apple-system,sans-serif}
.ws-pop[hidden]{display:none}.ws-row{display:flex;gap:6px;flex-wrap:wrap}
.ws-chain{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:56px;height:52px;padding:4px 2px;border:1px solid rgba(0,0,0,.12);border-radius:11px;background:transparent;color:inherit;cursor:pointer;text-decoration:none;font:600 16px/1 system-ui,sans-serif;-webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:transform .08s,background .12s}
.ws-chain small{font:500 9.5px/1.1 system-ui,sans-serif;opacity:.75;max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-chain .ws-g{height:18px;display:inline-flex;align-items:center}.ws-chain .ws-g.t{font-size:12px;font-weight:700}
.ws-chain:hover{background:rgba(0,0,0,.05)}.ws-chain:active,.ws-chain.is-busy{transform:scale(.94);background:rgba(0,0,0,.08)}
.ws-chain.back{width:28px}
.ws-status{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px}.ws-status[hidden]{display:none}.ws-status.err{color:#c0392b}
.ws-spin{width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:ws-r .7s linear infinite;flex:none}
@keyframes ws-r{to{transform:rotate(360deg)}}
.ws-qr{display:flex;flex-direction:column;align-items:center;gap:8px}.ws-qr img{width:200px;height:200px;border-radius:8px;background:#fff;padding:6px}
.ws-qr-row{display:flex;gap:8px;align-items:center}.ws-qr a,.ws-qr button{display:inline-flex;align-items:center;gap:4px;padding:7px 11px;border:1px solid rgba(127,127,127,.35);border-radius:9px;background:transparent;color:inherit;font:600 12px system-ui,sans-serif;text-decoration:none;cursor:pointer}
@media (pointer:coarse){.ws-qr img{width:150px;height:150px}}
.ws-line{display:flex;align-items:center;gap:6px;margin:2px 0 6px}.ws-addr{font:12px ui-monospace,monospace;opacity:.7}
.ws-signout{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:9px;padding:8px 10px;border:1px solid rgba(127,127,127,.4);border-radius:10px;background:transparent;color:inherit;cursor:pointer;font:600 12px system-ui,sans-serif}
.ws-hint{margin-top:8px;font:11px/1.35 system-ui,sans-serif;opacity:.75}
.ws-signout:active{transform:scale(.97)}.ws-chain img{width:20px;height:20px;border-radius:5px;object-fit:contain}
.ws-tag{display:inline-flex;align-items:center;gap:3px;padding:3px 7px;border-radius:9px;background:rgba(0,0,0,.06);font-size:12px}
.ws-tag.gold{background:rgba(201,151,28,.15);color:#8a6510}
.ws-nets{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 8px}
.ws-net{display:inline-flex;flex-direction:column;align-items:flex-start;gap:1px;padding:5px 8px;border:1px solid rgba(0,0,0,.14);border-radius:9px;background:transparent;color:inherit;cursor:pointer;font:600 11px/1.2 system-ui,sans-serif}
.ws-net small{font-weight:500;opacity:.7}
.ws-net.is-on{background:rgba(0,0,0,.08)}
@media (max-width:768px){.gallery-protected .site-header.is-menu-open ~ .ws-fab{opacity:0;visibility:hidden}}
@media (prefers-color-scheme:dark){.ws-fab{background:rgba(20,20,20,.66);box-shadow:0 0 0 1px rgba(255,255,255,.1);color:#c8c8c8}
.ws-pop{background:rgba(24,24,24,.96);color:#ddd;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 8px 28px rgba(0,0,0,.5)}
.ws-chain{border-color:rgba(255,255,255,.16)}.ws-chain:hover{background:rgba(255,255,255,.07)}.ws-chain:active,.ws-chain.is-busy{background:rgba(255,255,255,.12)}.ws-tag{background:rgba(255,255,255,.08)}.ws-status.err{color:#ff7b6b}
.ws-net{border-color:rgba(255,255,255,.18)}.ws-net.is-on{background:rgba(255,255,255,.12)}}`;

    function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    const FRIENDLY = {
        'No EVM wallet': 'No wallet in this browser. Use WalletConnect.',
        'No Sui wallet': MOBILE ? 'No Sui wallet here. Open in Slush.' : 'No Sui wallet extension found.',
        'No Solana wallet': 'No Solana wallet here.',
        'GemWallet not found': 'GemWallet extension not found.',
        'Crossmark not found': 'Crossmark extension not found.',
        'Temple not found': 'Temple extension not found.',
        'Beacon failed to load': 'Kukai connector failed to load.',
        'Temple timeout': 'Temple did not answer.',
        'signature mismatch': 'Signature not accepted.',
        'nonce invalid': 'Expired. Try again.',
        Cancelled: 'Cancelled.',
        rejected: 'Rejected in wallet.',
        expired: 'Expired. Try again.',
    };
    const friendly = (e) => {
        const m = String((e && (e.message || e)) || 'Failed');
        if (FRIENDLY[m]) return FRIENDLY[m];
        if (/user rejected|denied|reject/i.test(m)) return 'Rejected in wallet.';
        if (/No (XRPL|Tezos) wallet/.test(m)) return m.replace(/\(.*\)/, '').trim() + '.';
        return m.length > 60 ? 'Sign-in failed. Try again.' : m;
    };

    function init() {
        const st = el('style'); st.textContent = css; document.head.appendChild(st);
        const fab = el('button', 'ws-fab', ICON.wallet);
        fab.type = 'button'; fab.setAttribute('aria-label', 'Wallet'); fab.setAttribute('aria-haspopup', 'dialog');
        const pop = el('div', 'ws-pop'); pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Wallet sign-in');
        const body = el('div');
        const status = el('div', 'ws-status'); status.hidden = true; status.setAttribute('aria-live', 'polite');
        pop.append(body, status);
        document.body.append(fab, pop);
        let me = null;
        let busy = false;
        let errTimer = 0;
        let lastChain = null;

        const evmView = () => {
            const saved = sessionStorage.getItem(EVM_VIEW);
            return EVM_NETS.find((n) => n.key === saved) || evmNetById(me && me.chainId) || EVM_NETS[0];
        };
        const rememberEvm = (net) => { if (net) sessionStorage.setItem(EVM_VIEW, net.key); };
        const chainQty = (key) => {
            const map = me && me.ownedByChain;
            if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return null;
            const n = Number(map[key] || 0);
            return (me.ownedCapped && me.ownedCapped[key]) ? `${n.toLocaleString()}+` : n.toLocaleString();
        };
        const boughtOn = (key) => (me.byCollection || []).reduce((sum, row) => {
            if (row.chain !== key || row.kind === 'gift') return sum;
            return sum + Number(row.q || 0);
        }, 0);
        pickEvmNet = () => new Promise((resolve, reject) => {
            body.innerHTML = '';
            const note = el('div', 'ws-hint');
            note.textContent = 'Choose the network';
            const row = el('div', 'ws-nets');
            EVM_NETS.forEach((net) => {
                const b = el('button', 'ws-net');
                b.type = 'button';
                b.textContent = net.label;
                b.addEventListener('click', (e) => { e.stopPropagation(); pop._evmCancel = null; resolve(net); });
                row.appendChild(b);
            });
            body.append(note, row);
            pop.hidden = false;
            setStatus('Choose the network', 'busy');
            const cancel = () => { reject(new Error('Cancelled')); };
            pop._evmCancel = cancel;
        });

        const setStatus = (text, kind) => {
            clearTimeout(errTimer);
            if (!text) { status.hidden = true; status.innerHTML = ''; return; }
            status.hidden = false;
            status.className = `ws-status${kind === 'err' ? ' err' : ''}`;
            status.innerHTML = kind === 'busy' ? `<span class="ws-spin"></span><span></span>` : '<span></span>';
            status.lastChild.textContent = text;
            if (kind === 'err') errTimer = setTimeout(() => setStatus(''), 6000);
        };
        const btn = (o, onTap) => {
            const isLink = Boolean(o.href);
            const b = el(isLink ? 'a' : 'button', 'ws-chain');
            if (isLink) { b.href = o.href; b.rel = 'noopener'; if (o.newTab) b.target = '_blank'; } else b.type = 'button';
            const textGlyph = /^[A-Za-z]{2,}$/.test(o.glyph || '');
            if (o.icon && /^(data:image\/|https:\/\/)/.test(o.icon)) {
                b.innerHTML = '<span class="ws-g"><img alt="" width="20" height="20"></span><small></small>';
                b.querySelector('img').src = o.icon;
            } else {
                b.innerHTML = `<span class="ws-g${textGlyph ? ' t' : ''}"></span><small></small>`;
                b.firstChild.textContent = o.glyph || '•';
            }
            b.lastChild.textContent = o.label;
            b.title = o.hint || o.label;
            b.setAttribute('aria-label', o.hint || o.label);
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isLink) { setStatus(`Opening ${o.label}…`, 'busy'); return; }
                e.preventDefault();
                onTap(b);
            });
            return b;
        };

        const fabNumber = () => {
            if (me.family === 'evm') {
                const shown = chainQty(evmView().key);
                if (shown != null) return shown;
            }
            return Math.max(me.owned || 0, me.bought || 0).toLocaleString();
        };
        const renderFab = () => {
            fab.innerHTML = ICON.wallet + (me ? `<span></span>${me.tier ? `<span class="ws-star">${ICON.star}</span>` : ''}` : '');
            if (me) fab.querySelector('span').textContent = fabNumber();
            const net = me && me.family === 'evm' ? evmView() : null;
            fab.title = me
                ? `${net ? `${net.label} · ` : ''}${short(me.address)}${me.tier ? ` · ${me.tier.label}` : ''}`
                : 'Sign in with wallet';
        };
        const renderChains = () => {
            body.innerHTML = '';
            const row = el('div', 'ws-row');
            CHAINS.forEach((c) => row.appendChild(btn(c, () => renderOptions(c))));
            body.appendChild(row);
        };
        const renderOptions = async (c, keepStatus) => {
            lastChain = c;
            if (!keepStatus) setStatus('');
            body.innerHTML = '';
            const row = el('div', 'ws-row');
            const back = el('button', 'ws-chain back', '‹'); back.type = 'button'; back.title = 'Back'; back.setAttribute('aria-label', 'Back');
            back.addEventListener('click', (e) => { e.stopPropagation(); if (!busy) { setStatus(''); lastChain = null; renderChains(); } });
            row.appendChild(back);
            body.appendChild(row);
            setStatus('Looking for wallets…', 'busy');
            const opts = (await c.options()).filter(Boolean);
            if (lastChain !== c) return;
            setStatus('');
            opts.forEach((o) => row.appendChild(btn(o, (b) => {
                if (o.copy) {
                    (navigator.clipboard ? navigator.clipboard.writeText(PAGE) : Promise.reject())
                        .then(() => setStatus(o.hint || 'Link copied.'))
                        .catch(() => setStatus(PAGE));
                    return;
                }
                go(o.run, b, o.label);
            })));
            if (!opts.length) setStatus('No wallet option on this device.', 'err');
        };
        const renderMe = () => {
            body.innerHTML = '';
            const evm = me.family === 'evm';
            const net = evm ? evmView() : null;
            const line = el('div', 'ws-line', `<span class="ws-addr"></span>`);
            line.firstChild.textContent = evm
                ? `EVM · ${net.label} · ${short(me.address)}`
                : `${(me.family || '').toUpperCase()} · ${short(me.address)}`;
            body.appendChild(line);
            if (evm) {
                const nets = el('div', 'ws-nets');
                EVM_NETS.forEach((item) => {
                    const b = el('button', `ws-net${item.key === net.key ? ' is-on' : ''}`);
                    b.type = 'button';
                    const count = chainQty(item.key);
                    b.innerHTML = '<b></b><small></small>';
                    b.firstChild.textContent = item.label;
                    b.lastChild.textContent = count == null ? '…' : count;
                    b.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (item.key === evmView().key) return;
                        rememberEvm(item);
                        renderFab();
                        renderMe();
                        if (!lastEth || !lastEth.request) return;
                        ensureEvmChain(lastEth, item.id).catch((err) => {
                            const rejected = err && (err.code === 4001 || /reject|denied/i.test(String(err.message || err)));
                            setStatus(rejected
                                ? 'Chain change rejected in the wallet. The count still follows the network you picked.'
                                : 'The wallet stayed on its previous network. The count follows the network you picked.', 'err');
                        });
                    });
                    nets.appendChild(b);
                });
                body.appendChild(nets);
            }
            const row = el('div', 'ws-row');
            const tag = (cls, icon, text) => { const t = el('span', cls, icon + '<span></span>'); t.lastChild.textContent = text; return t; };
            const ownedLabel = evm ? (chainQty(net.key) || '0') : String(me.owned ?? 0);
            const boughtLabel = evm ? boughtOn(net.key).toLocaleString() : String(me.bought ?? 0);
            row.appendChild(tag('ws-tag', ICON.bag, `Owned ${ownedLabel}`));
            row.appendChild(tag('ws-tag', ICON.bag, `Bought ${boughtLabel}`));
            if (me.gifts) row.appendChild(tag('ws-tag', ICON.gift, `Gifts ${me.gifts}`));
            if (me.tier) row.appendChild(tag('ws-tag gold', ICON.star, `${me.tier.label} −${me.discountPct}%`));
            body.appendChild(row);
            const viaXaman = (load() || {}).via === 'xaman';
            const xamanHint = 'To fully disconnect, remove Jack Beatnic Gallery in Xaman > Settings > Linked apps';
            if (viaXaman) { const h = el('div', 'ws-hint'); h.textContent = xamanHint; body.appendChild(h); }
            const out = el('button', 'ws-signout', `${ICON.out}<span>Sign out</span>`); out.type = 'button';
            out.addEventListener('click', async (e) => {
                e.stopPropagation();
                try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
                log('signed out');
                sessionStorage.removeItem(KEY);
                sessionStorage.removeItem(EVM_VIEW);
                lastEth = null;
                me = null; renderFab(); renderChains();
                if (viaXaman) setStatus(`Signed out. ${xamanHint}.`); else pop.hidden = true;
            });
            body.appendChild(out);
        };
        const render = () => { setStatus(''); lastChain = null; me ? renderMe() : renderChains(); };

        showQr = async (img, link, label) => {
            qrClosed = false;
            body.innerHTML = '';
            const box = el('div', 'ws-qr');
            const im = el('img'); im.src = img; im.alt = `${label} QR`;
            const row = el('div', 'ws-qr-row');
            const a = el('a', '', `${ICON.phone}<span></span>`); a.lastChild.textContent = label;
            a.href = link; a.rel = 'noopener';
            a.addEventListener('click', (e) => e.stopPropagation());
            const x = el('button', '', '×'); x.type = 'button'; x.title = 'Cancel'; x.setAttribute('aria-label', 'Cancel');
            x.addEventListener('click', (e) => { e.stopPropagation(); qrClosed = true; });
            row.append(a, x);
            if (MOBILE) box.append(row, im); else box.append(im, row);
            body.appendChild(box);
            pop.hidden = false;
            setStatus(MOBILE ? `Open ${label}, approve, come back` : `Scan with ${label}`, 'busy');
        };
        hideQr = async () => { if (me || !body.querySelector('.ws-qr')) return; if (lastChain) await renderOptions(lastChain, true); else renderChains(); };

        async function refresh() {
            me = null;
            if (load()) { try { me = await api('/api/me'); } catch { sessionStorage.removeItem(KEY); } }
            renderFab(); render();
            if (me) document.dispatchEvent(new CustomEvent('jb:wallet', { detail: me }));
        }
        async function go(run, b, label) {
            if (busy) return;
            busy = true; qrClosed = false;
            b && b.classList.add('is-busy');
            setStatus(`${label || 'Wallet'}: confirm in wallet…`, 'busy');
            try {
                log('start', label);
                const session = await (typeof run === 'function' ? run() : adapters[run]());
                log('signed in', session.family, session.address, 'via', session.via, 'chain', session.chainId || '');
                const signedNet = evmNetById(session.chainId);
                if (signedNet) rememberEvm(signedNet);
                save(session);
                busy = false;
                await refresh();
                pop.hidden = true;
            } catch (e) {
                busy = false;
                console.warn('wallet sign-in:', e && (e.message || e));
                b && b.classList.remove('is-busy');
                await hideQr();
                setStatus(friendly(e), 'err');
                fab.classList.add('ws-err'); setTimeout(() => fab.classList.remove('ws-err'), 1500);
            }
        }
        fab.addEventListener('click', (e) => {
            e.stopPropagation();
            if (busy) { pop.hidden = false; return; }
            if (pop.hidden) render();
            pop.hidden = !pop.hidden;
        });
        document.addEventListener('click', (e) => { if (!busy && !pop.contains(e.target) && e.target !== fab) pop.hidden = true; });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (pop._evmCancel) { const cancel = pop._evmCancel; pop._evmCancel = null; cancel(); return; }
            if (busy) qrClosed = true; else pop.hidden = true;
        });
        refresh();
        window.JBWalletSignIn = { me: () => me, refresh, signIn: (run) => go(run, null, String(run)), evmWallets: () => [...evmProviders.values()].map((d) => d.info.name) };
    }
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
