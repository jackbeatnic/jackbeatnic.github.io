/**
 * Wallet sign-in: EVM, Sui, XRPL, Tezos, Solana. Signature only, no transaction, no fee.
 * <script src="js/wallet-signin.js" data-api="https://api.jackbeatnic.shop"></script>
 * Adds one floating wallet button (bottom-left). Session token lives in sessionStorage only.
 */
(() => {
    const script = document.currentScript;
    const API = ((script && script.dataset.api) || 'https://api.jackbeatnic.shop').replace(/\/$/, '');
    const KEY = 'jb_wallet_session';
    const EVM_CHAINS = [43114, 8453, 137, 1];
    const svg = (p, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    const ICON = {
        wallet: svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3"/><rect x="3" y="8" width="18" height="11" rx="2.5"/><circle cx="16.5" cy="13.5" r="1.2" fill="currentColor"/>'),
        star: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
        out: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>', 16),
        gift: svg('<rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M12 9v11M3 13h18M12 9c-2-4-6-4-6-1.5S9 9 12 9zm0 0c2-4 6-4 6-1.5S15 9 12 9z"/>', 14),
        bag: svg('<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8a3 3 0 0 1 6 0"/>', 14),
    };
    const CHAINS = [
        { id: 'evm', label: 'EVM', glyph: 'Ξ' },
        { id: 'sui', label: 'Sui', glyph: '💧' },
        { id: 'xrpl', label: 'XRPL', glyph: 'X' },
        { id: 'tezos', label: 'Tezos', glyph: 'ꜩ' },
        { id: 'solana', label: 'Solana', glyph: '◎' },
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
.ws-fab{position:fixed;left:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:150;display:inline-flex;align-items:center;gap:4px;height:40px;min-width:40px;padding:0 11px;border:0;border-radius:20px;background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 0 0 1px rgba(0,0,0,.08),0 2px 10px rgba(0,0,0,.08);color:#333;cursor:pointer;font:600 12px/1 system-ui,-apple-system,sans-serif}
.ws-fab .ws-star{color:#c9971c;display:inline-flex}.ws-fab.ws-err{color:#c0392b}.ws-fab[disabled]{opacity:.6}
.ws-pop{position:fixed;left:12px;bottom:calc(62px + env(safe-area-inset-bottom,0px));z-index:151;min-width:180px;max-width:calc(100vw - 24px);padding:10px;border-radius:14px;background:rgba(255,255,255,.94);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-shadow:0 0 0 1px rgba(0,0,0,.08),0 8px 28px rgba(0,0,0,.14);color:#222;font:13px/1.3 system-ui,-apple-system,sans-serif}
.ws-pop[hidden]{display:none}.ws-row{display:flex;gap:6px;flex-wrap:wrap}
.ws-chain{width:38px;height:38px;border:1px solid rgba(0,0,0,.12);border-radius:10px;background:transparent;color:inherit;cursor:pointer;font:600 15px/1 system-ui,sans-serif}
.ws-chain:hover{background:rgba(0,0,0,.05)}
.ws-line{display:flex;align-items:center;gap:6px;margin:2px 0 6px}.ws-addr{font:12px ui-monospace,monospace;opacity:.7}
.ws-out{margin-left:auto;border:0;background:transparent;color:inherit;cursor:pointer;opacity:.6;padding:2px}.ws-out:hover{opacity:1}
.ws-tag{display:inline-flex;align-items:center;gap:3px;padding:3px 7px;border-radius:9px;background:rgba(0,0,0,.06);font-size:12px}
.ws-tag.gold{background:rgba(201,151,28,.15);color:#8a6510}
@media (max-width:768px){.gallery-protected .site-header.is-menu-open ~ .ws-fab{opacity:0;visibility:hidden}}
@media (prefers-color-scheme:dark){.ws-fab{background:rgba(20,20,20,.66);box-shadow:0 0 0 1px rgba(255,255,255,.1);color:#c8c8c8}
.ws-pop{background:rgba(24,24,24,.95);color:#ddd;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 8px 28px rgba(0,0,0,.5)}
.ws-chain{border-color:rgba(255,255,255,.16)}.ws-chain:hover{background:rgba(255,255,255,.07)}.ws-tag{background:rgba(255,255,255,.08)}}`;

    function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

    function init() {
        const st = el('style'); st.textContent = css; document.head.appendChild(st);
        const fab = el('button', 'ws-fab', ICON.wallet);
        fab.type = 'button'; fab.setAttribute('aria-label', 'Wallet'); fab.setAttribute('aria-haspopup', 'dialog');
        const pop = el('div', 'ws-pop'); pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Wallet sign-in');
        document.body.append(fab, pop);
        let me = null;

        const renderFab = () => {
            fab.innerHTML = ICON.wallet + (me ? `<span>${me.bought}</span>${me.tier ? `<span class="ws-star">${ICON.star}</span>` : ''}` : '');
            fab.title = me ? `${short(me.address)}${me.tier ? ` · ${me.tier.label}` : ''}` : 'Sign in with wallet';
        };
        const renderPop = () => {
            pop.innerHTML = '';
            if (!me) {
                const row = el('div', 'ws-row');
                CHAINS.forEach((c) => {
                    const b = el('button', 'ws-chain', c.glyph);
                    b.type = 'button'; b.title = c.label; b.setAttribute('aria-label', `Sign in with ${c.label}`);
                    b.onclick = () => go(c.id);
                    row.appendChild(b);
                });
                pop.appendChild(row);
                return;
            }
            const line = el('div', 'ws-line', `<span class="ws-addr">${short(me.address)}</span>`);
            const out = el('button', 'ws-out', ICON.out); out.type = 'button'; out.title = 'Sign out'; out.setAttribute('aria-label', 'Sign out');
            out.onclick = async () => { try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {} sessionStorage.removeItem(KEY); me = null; pop.hidden = true; renderFab(); };
            line.appendChild(out); pop.appendChild(line);
            const row = el('div', 'ws-row');
            row.appendChild(el('span', 'ws-tag', `${ICON.bag}${me.bought}`));
            if (me.gifts) row.appendChild(el('span', 'ws-tag', `${ICON.gift}${me.gifts}`));
            if (me.tier) row.appendChild(el('span', 'ws-tag gold', `${ICON.star}${me.tier.label} −${me.discountPct}%`));
            pop.appendChild(row);
        };
        async function refresh() {
            me = null;
            if (load()) { try { me = await api('/api/me'); } catch { sessionStorage.removeItem(KEY); } }
            renderFab(); renderPop();
            if (me) document.dispatchEvent(new CustomEvent('jb:wallet', { detail: me }));
        }
        async function go(family) {
            pop.hidden = true; fab.disabled = true;
            try { save(await adapters[family]()); }
            catch (e) { fab.classList.add('ws-err'); setTimeout(() => fab.classList.remove('ws-err'), 1500); console.warn('wallet sign-in:', e.message || e); }
            fab.disabled = false; refresh();
        }
        fab.onclick = (e) => { e.stopPropagation(); renderPop(); pop.hidden = !pop.hidden; };
        document.addEventListener('click', (e) => { if (!pop.contains(e.target)) pop.hidden = true; });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });
        refresh();
        window.JBWalletSignIn = { me: () => me, refresh, signIn: go };
    }
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
