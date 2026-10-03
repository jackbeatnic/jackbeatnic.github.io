/**
 * Wallet sign-in: EVM (browser or WalletConnect), Sui, XRPL (Xaman, Joey, GemWallet, Crossmark), Tezos, Solana.
 * Signature only, no transaction, no fee.
 * <script src="js/wallet-signin.js" data-api="https://api.jackbeatnic.shop"></script>
 * Adds one floating wallet button (bottom-left). Session token lives in sessionStorage only.
 */
(() => {
    const script = document.currentScript;
    const API = ((script && script.dataset.api) || 'https://api.jackbeatnic.shop').replace(/\/$/, '');
    const KEY = 'jb_wallet_session';
    const EVM_CHAINS = [43114, 8453, 137, 1];
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
    const hasEvm = () => Boolean(window.ethereum);
    const hasSol = () => Boolean(window.phantom?.solana || window.solflare || window.solana);
    // Top level: chains. Each chain lists wallet options; `run` = adapter id, `href` = open-in-app deeplink.
    const CHAINS = [
        { id: 'evm', label: 'EVM', glyph: 'Ξ', options: () => [
            hasEvm() && { label: 'Browser', glyph: '🧩', run: 'evm' },
            { label: 'WalletConnect', glyph: 'WC', run: 'evmWc' },
            MOBILE && !hasEvm() && { label: 'MetaMask', glyph: '🦊', href: `https://metamask.app.link/dapp/${PAGE.replace(/^https?:\/\//, '')}` },
        ] },
        { id: 'sui', label: 'Sui', glyph: '💧', options: () => [
            { label: 'Sui wallet', glyph: '🧩', run: 'sui' },
            MOBILE && { label: 'Slush', glyph: '💧', href: `https://my.slush.app/browse/${enc_(PAGE)}` },
        ] },
        { id: 'xrpl', label: 'XRPL', glyph: 'X', options: () => [
            { label: 'Xaman', glyph: 'Xa', run: 'xaman' },
            { label: 'Joey', glyph: '🦘', run: 'joey' },
            !MOBILE && { label: 'Gem / Crossmark', glyph: '🧩', run: 'xrpl' },
        ] },
        { id: 'tezos', label: 'Tezos', glyph: 'ꜩ', options: () => [
            !MOBILE && { label: 'Temple', glyph: '🧩', run: 'tezos' },
            MOBILE && { label: 'Copy link', glyph: '🔗', copy: true, hint: 'Open the copied link in the Temple app browser' },
        ] },
        { id: 'solana', label: 'Solana', glyph: '◎', options: () => [
            hasSol() && { label: 'Browser', glyph: '🧩', run: 'solana' },
            !hasSol() && MOBILE && { label: 'Phantom', glyph: '👻', href: `https://phantom.app/ul/browse/${enc_(PAGE)}?ref=${enc_(location.origin)}` },
            !hasSol() && MOBILE && { label: 'Solflare', glyph: '☀', href: `https://solflare.com/ul/v1/browse/${enc_(PAGE)}?ref=${enc_(location.origin)}` },
            !hasSol() && !MOBILE && { label: 'Phantom', glyph: '🧩', run: 'solana' },
        ] },
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
        async evm() {
            const eth = window.ethereum;
            if (!eth) throw new Error('No EVM wallet');
            const [address] = await eth.request({ method: 'eth_requestAccounts' });
            const cid = parseInt(await eth.request({ method: 'eth_chainId' }), 16);
            const n = await nonce('evm', address, EVM_CHAINS.includes(cid) ? cid : 43114);
            const signature = await eth.request({ method: 'personal_sign', params: [`0x${hex(enc.encode(n.message))}`, address] });
            return verify({ nonce: n.nonce, signature });
        },
        async evmWc() {
            const projectId = await wcProjectId();
            const { EthereumProvider } = await import('https://esm.sh/@walletconnect/ethereum-provider@2.21.1');
            const p = await EthereumProvider.init({ projectId, optionalChains: EVM_CHAINS, showQrModal: true, metadata: WC_META });
            try {
                await cancellable(p.connect());
                const address = p.accounts?.[0];
                if (!address) throw new Error('No account');
                const cid = Number(p.chainId);
                const n = await nonce('evm', address, EVM_CHAINS.includes(cid) ? cid : 43114);
                const signature = await cancellable(p.request({ method: 'personal_sign', params: [`0x${hex(enc.encode(n.message))}`, address] }));
                return await verify({ nonce: n.nonce, signature });
            } finally {
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
        async sui() {
            const { getWallets } = await import('https://esm.sh/@wallet-standard/app@1.1.0');
            const w = getWallets().get().find((x) => x.features['sui:signPersonalMessage']);
            if (!w) throw new Error('No Sui wallet');
            const { accounts } = await w.features['standard:connect'].connect();
            const account = accounts[0];
            const n = await nonce('sui', account.address);
            const { signature } = await w.features['sui:signPersonalMessage'].signPersonalMessage({ message: enc.encode(n.message), account });
            return verify({ nonce: n.nonce, signature });
        },
        async xrpl() {
            const gem = await import('https://esm.sh/@gemwallet/api@3').catch(() => null);
            if (gem && (await gem.isInstalled())?.result?.isInstalled) {
                const pk = (await gem.getPublicKey())?.result;
                if (!pk) throw new Error('Rejected');
                const n = await nonce('xrpl', pk.address);
                const signed = (await gem.signMessage(n.message))?.result?.signedMessage;
                return verify({ nonce: n.nonce, signature: signed, publicKey: pk.publicKey });
            }
            const cm = (await import('https://esm.sh/@crossmarkio/sdk@0.4')).default;
            if (!cm?.sync?.isInstalled?.()) throw new Error('No XRPL wallet (GemWallet or Crossmark)');
            const first = (await cm.methods.signInAndWait()).response.data;
            const n = await nonce('xrpl', first.address);
            const d = (await cm.methods.signInAndWait(hex(enc.encode(n.message)))).response.data;
            return verify({ nonce: n.nonce, signature: d.signature, publicKey: d.publicKey });
        },
        async tezos() {
            const { TempleWallet } = await import('https://esm.sh/@temple-wallet/dapp@8');
            if (!(await TempleWallet.isAvailable())) throw new Error('No Tezos wallet (Temple)');
            const w = new TempleWallet('Jack Beatnic Gallery');
            await w.connect('mainnet');
            const address = await w.getPKH();
            const n = await nonce('tezos', address);
            const b = enc.encode(n.message);
            const payload = `0501${b.length.toString(16).padStart(8, '0')}${hex(b)}`;
            const signature = await w.sign(payload);
            return verify({ nonce: n.nonce, signature, publicKey: w.permission?.publicKey || w.publicKey });
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
.ws-out{margin-left:auto;border:0;background:transparent;color:inherit;cursor:pointer;opacity:.6;padding:2px}.ws-out:hover{opacity:1}
.ws-tag{display:inline-flex;align-items:center;gap:3px;padding:3px 7px;border-radius:9px;background:rgba(0,0,0,.06);font-size:12px}
.ws-tag.gold{background:rgba(201,151,28,.15);color:#8a6510}
@media (max-width:768px){.gallery-protected .site-header.is-menu-open ~ .ws-fab{opacity:0;visibility:hidden}}
@media (prefers-color-scheme:dark){.ws-fab{background:rgba(20,20,20,.66);box-shadow:0 0 0 1px rgba(255,255,255,.1);color:#c8c8c8}
.ws-pop{background:rgba(24,24,24,.96);color:#ddd;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 8px 28px rgba(0,0,0,.5)}
.ws-chain{border-color:rgba(255,255,255,.16)}.ws-chain:hover{background:rgba(255,255,255,.07)}.ws-chain:active,.ws-chain.is-busy{background:rgba(255,255,255,.12)}.ws-tag{background:rgba(255,255,255,.08)}.ws-status.err{color:#ff7b6b}}`;

    function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    const FRIENDLY = {
        'No EVM wallet': 'No wallet in this browser. Use WalletConnect.',
        'No Sui wallet': MOBILE ? 'No Sui wallet here. Open in Slush.' : 'No Sui wallet extension found.',
        'No Solana wallet': 'No Solana wallet here.',
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
            if (isLink) { b.href = o.href; b.rel = 'noopener'; } else b.type = 'button';
            const textGlyph = /^[A-Za-z]{2,}$/.test(o.glyph);
            b.innerHTML = `<span class="ws-g${textGlyph ? ' t' : ''}">${o.glyph}</span><small></small>`;
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

        const renderFab = () => {
            fab.innerHTML = ICON.wallet + (me ? `<span>${me.bought}</span>${me.tier ? `<span class="ws-star">${ICON.star}</span>` : ''}` : '');
            fab.title = me ? `${short(me.address)}${me.tier ? ` · ${me.tier.label}` : ''}` : 'Sign in with wallet';
        };
        const renderChains = () => {
            body.innerHTML = '';
            const row = el('div', 'ws-row');
            CHAINS.forEach((c) => row.appendChild(btn(c, () => renderOptions(c))));
            body.appendChild(row);
        };
        const renderOptions = (c, keepStatus) => {
            lastChain = c;
            if (!keepStatus) setStatus('');
            body.innerHTML = '';
            const row = el('div', 'ws-row');
            const back = el('button', 'ws-chain back', '‹'); back.type = 'button'; back.title = 'Back'; back.setAttribute('aria-label', 'Back');
            back.addEventListener('click', (e) => { e.stopPropagation(); if (!busy) { setStatus(''); lastChain = null; renderChains(); } });
            row.appendChild(back);
            const opts = c.options().filter(Boolean);
            opts.forEach((o) => row.appendChild(btn(o, (b) => {
                if (o.copy) {
                    (navigator.clipboard ? navigator.clipboard.writeText(PAGE) : Promise.reject())
                        .then(() => setStatus(o.hint || 'Link copied.'))
                        .catch(() => setStatus(PAGE));
                    return;
                }
                go(o.run, b, o.label);
            })));
            body.appendChild(row);
            if (!opts.length) setStatus('No wallet option on this device.', 'err');
        };
        const renderMe = () => {
            body.innerHTML = '';
            const line = el('div', 'ws-line', `<span class="ws-addr">${short(me.address)}</span>`);
            const out = el('button', 'ws-out', ICON.out); out.type = 'button'; out.title = 'Sign out'; out.setAttribute('aria-label', 'Sign out');
            out.addEventListener('click', async (e) => {
                e.stopPropagation();
                try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
                sessionStorage.removeItem(KEY); me = null; pop.hidden = true; renderFab(); renderChains();
            });
            line.appendChild(out); body.appendChild(line);
            const row = el('div', 'ws-row');
            row.appendChild(el('span', 'ws-tag', `${ICON.bag}${me.bought}`));
            if (me.gifts) row.appendChild(el('span', 'ws-tag', `${ICON.gift}${me.gifts}`));
            if (me.tier) row.appendChild(el('span', 'ws-tag gold', `${ICON.star}${me.tier.label} −${me.discountPct}%`));
            body.appendChild(row);
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
        hideQr = () => { if (me) return; if (lastChain) renderOptions(lastChain, true); else renderChains(); };

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
                save(await adapters[run]());
                busy = false;
                await refresh();
                pop.hidden = true;
            } catch (e) {
                busy = false;
                console.warn('wallet sign-in:', e && (e.message || e));
                b && b.classList.remove('is-busy');
                hideQr();
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
            if (busy) qrClosed = true; else pop.hidden = true;
        });
        refresh();
        window.JBWalletSignIn = { me: () => me, refresh, signIn: (run) => go(run, null, run) };
    }
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
