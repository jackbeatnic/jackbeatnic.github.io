/**
 * JB Gallery (Solana Edition) — "Mint on Solana" button + checkout.
 * One transaction built by the studio API (kasa): pay (SOL or USDC) to Jack + mint the Core asset to
 * the buyer. Kasa pre-signs as the collection's update delegate; the buyer's wallet signs and pays.
 * No private key in the browser. No personal data: wallet address only.
 * Hidden unless data/shop_sol.json enabled=true, or preview with ?solmint=1 (?solmint=0 to clear).
 */
const SolMint = (() => {
    const LS = 'jbg_solmint_preview';
    const CHAINS = { mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' };
    let site = { enabled: false, api: 'https://api.jackbeatnic.shop' };
    let apiCfg = null;
    let catalog = null;
    let ready = null;
    let modal = null;
    let current = null;
    let walletsApi = null;

    try {
        const q = new URLSearchParams(location.search).get('solmint');
        if (q === '1') localStorage.setItem(LS, '1');
        if (q === '0') localStorage.removeItem(LS);
    } catch { /* private mode */ }
    const preview = () => { try { return localStorage.getItem(LS) === '1'; } catch { return false; } };

    async function api(path, body) {
        const r = await fetch(site.api.replace(/\/$/, '') + path, body
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            : { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
    }

    function load() {
        if (ready) return ready;
        ready = (async () => {
            try {
                const r = await fetch('data/shop_sol.json', { cache: 'no-cache' });
                if (r.ok) site = { ...site, ...(await r.json()) };
            } catch { /* keep defaults */ }
            if (!site.enabled && !preview()) return false;
            try {
                const r = await fetch('data/sol_catalog.json', { cache: 'no-cache' });
                catalog = r.ok ? (await r.json()).works || {} : {};
                apiCfg = await api('/api/sol/config');
            } catch { return false; }
            document.querySelectorAll('.nft-card[data-nft-key]').forEach((c) => c.__solNft && decorate(c, c.__solNft));
            return true;
        })();
        return ready;
    }

    function capOf(nft) {
        if (!catalog || !nft) return 0;
        const key = typeof GalleryLikes !== 'undefined' ? GalleryLikes.nftKey(nft) : '';
        const i = key.lastIndexOf(':');
        return (catalog[key.slice(0, i)] || {})[key.slice(i + 1)] || 0;
    }

    function decorate(card, nft) {
        card.__solNft = nft;
        if (!catalog || !apiCfg || card.querySelector('.sol-mint-btn') || !capOf(nft)) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--ghost btn--block sol-mint-btn';
        btn.innerHTML = '<span aria-hidden="true">◎</span> Mint on Solana';
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(nft); });
        (card.querySelector('.nft-card__actions') || card.querySelector('.nft-card__body') || card).appendChild(btn);
    }

    /* ---------- wallets ---------- */
    async function standardWallets() {
        try {
            if (!walletsApi) walletsApi = (await import('https://esm.sh/@wallet-standard/app@1.1.0')).getWallets();
            await new Promise((r) => setTimeout(r, 150));
            return walletsApi.get().filter((w) => w.features && w.chains && w.chains.some((c) => String(c).startsWith('solana:'))
                && (w.features['solana:signTransaction'] || w.features['solana:signAndSendTransaction']));
        } catch { return []; }
    }
    const b64 = { to: (u8) => btoa(String.fromCharCode(...u8)), from: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };
    const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    function b58decode(s) {
        const bytes = [];
        for (const ch of s) {
            let carry = B58.indexOf(ch);
            if (carry < 0) throw new Error('bad base58');
            for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
            while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
        }
        let z = 0; while (s[z] === '1') z++;
        return Uint8Array.from([...new Array(z).fill(0), ...bytes.reverse()]);
    }
    function b58encode(u8) {
        const d = [];
        for (const b of u8) {
            let c = b;
            for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; }
            while (c) { d.push(c % 58); c = (c / 58) | 0; }
        }
        let z = 0; while (z < u8.length && u8[z] === 0) z++;
        return '1'.repeat(z) + d.reverse().map((x) => B58[x]).join('');
    }
    function withFeePayerSig(txBytes, sig) { // buyer = fee payer = signature slot 0
        const out = new Uint8Array(txBytes); out.set(sig, 1); return out;
    }

    /** Returns a signer {address, label, sign(txB64) -> {tx} | {signature}} */
    async function connectStandard(w) {
        const res = await w.features['standard:connect'].connect();
        const account = (res && res.accounts && res.accounts[0]) || w.accounts[0];
        if (!account) throw new Error('No Solana account');
        const chain = CHAINS[apiCfg.network] || CHAINS.mainnet;
        return {
            address: account.address, label: w.name,
            async sign(txB64) {
                const transaction = b64.from(txB64);
                if (w.features['solana:signTransaction']) {
                    const out = await w.features['solana:signTransaction'].signTransaction({ account, transaction, chain });
                    return { tx: b64.to((Array.isArray(out) ? out[0] : out).signedTransaction) };
                }
                const out = await w.features['solana:signAndSendTransaction'].signAndSendTransaction({ account, transaction, chain });
                return { signature: b58encode((Array.isArray(out) ? out[0] : out).signature) };
            },
        };
    }
    async function connectWc(kind) {
        const doc = await (await fetch('data/walletconnect.json', { cache: 'no-cache' })).json();
        const projectId = doc.projectId || doc.project_id;
        if (!projectId) throw new Error('WalletConnect not configured');
        const { default: UniversalProvider } = await import('https://esm.sh/@walletconnect/universal-provider@2.21.1');
        const up = await UniversalProvider.init({ projectId, metadata: { name: 'Jack Beatnic Gallery', description: 'Mint on Solana', url: location.origin, icons: [location.origin + '/favicon.ico'] } });
        const chain = CHAINS[apiCfg.network] || CHAINS.mainnet;
        up.on('display_uri', (uri) => {
            const link = kind === 'trust' ? `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}` : uri;
            status(`Open your wallet to connect: <a href="${link}" target="_blank" rel="noopener">${kind === 'trust' ? 'Open Trust Wallet' : 'WalletConnect link'}</a>`);
            if (kind === 'trust' && /Android|iPhone|iPad/i.test(navigator.userAgent)) location.href = link;
        });
        const session = await up.connect({ optionalNamespaces: { solana: { chains: [chain], methods: ['solana_signTransaction', 'solana_signAndSendTransaction'], events: [] } } });
        const acc = (session.namespaces.solana?.accounts || [])[0];
        if (!acc) throw new Error('No Solana account');
        const address = String(acc).split(':').pop();
        return {
            address, label: session.peer?.metadata?.name || 'WalletConnect', close: () => up.disconnect().catch(() => {}),
            async sign(txB64) {
                const res = await up.request({ method: 'solana_signTransaction', params: { transaction: txB64 } }, chain);
                if (res.transaction) return { tx: res.transaction };
                return { tx: b64.to(withFeePayerSig(b64.from(txB64), b58decode(res.signature))) };
            },
        };
    }

    /* ---------- modal ---------- */
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function ensureModal() {
        if (modal) return modal;
        const st = document.createElement('style');
        st.textContent = `.sol-mint-btn{margin-top:.4rem}.sol-wallets{display:grid;gap:.4rem;margin:.6rem 0}.sol-wallets button{display:flex;align-items:center;gap:.5rem;justify-content:flex-start}
.sol-wallets img{width:22px;height:22px;border-radius:5px}.sol-cur{display:flex;gap:.4rem;margin:.5rem 0}.sol-cur button[aria-pressed="true"]{outline:2px solid currentColor}
.sol-status{min-height:1.4em;font-size:.92rem;margin-top:.6rem;word-break:break-word}.sol-net{display:inline-block;font-size:.75rem;padding:.1rem .45rem;border-radius:99px;background:#f5a524;color:#111;margin-left:.4rem}`;
        document.head.appendChild(st);
        modal = document.createElement('div');
        modal.className = 'shop-modal'; modal.hidden = true; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
        modal.innerHTML = `<div class="shop-modal__backdrop" data-close></div><div class="shop-modal__panel">
<button type="button" class="shop-modal__close" data-close aria-label="Close">×</button>
<h2 class="shop-modal__title">Mint on Solana <span class="sol-net" hidden></span></h2>
<p class="shop-modal__lead">A Solana Edition of this work, minted straight to your wallet in one transaction.</p>
<div style="display:flex;gap:.7rem;align-items:center"><img class="shop-modal__thumb sol-thumb" alt="" width="56" height="56" referrerpolicy="no-referrer">
<div><p class="shop-modal__name sol-name"></p><p class="shop-modal__meta sol-meta"></p></div></div>
<div class="sol-cur"><button type="button" class="btn btn--ghost" data-cur="SOL" aria-pressed="true">Pay in SOL</button><button type="button" class="btn btn--ghost" data-cur="USDC" aria-pressed="false">Pay in USDC</button></div>
<p class="sol-price" style="font-size:1.15rem;font-weight:600"></p>
<p class="shop-modal__meta">Plus Solana network fee and ~0.004 SOL account rent. Royalty on resales: 9%.</p>
<div class="sol-wallets"></div><p class="sol-status" aria-live="polite"></p></div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
        modal.querySelectorAll('[data-cur]').forEach((b) => b.addEventListener('click', () => {
            modal.querySelectorAll('[data-cur]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
            current.cur = b.dataset.cur; paintPrice();
        }));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal && !modal.hidden) close(); });
        return modal;
    }
    function close() { if (modal) modal.hidden = true; if (current?.signer?.close) current.signer.close(); current = null; }
    function status(html) { if (modal) modal.querySelector('.sol-status').innerHTML = html; }
    function paintPrice() {
        const it = current?.item; if (!it) return;
        const p = current.cur === 'USDC' ? `${it.usdc.toFixed(2)} USDC` : `${it.sol.toFixed(4)} SOL`;
        const promo = it.price_kind === 'promo' && it.promo_ends_at ? ` · promo until ${new Date(it.promo_ends_at).toISOString().slice(0, 10)}` : '';
        modal.querySelector('.sol-price').textContent = `${p} (≈ $${it.price_usd.toFixed(2)})${promo}`;
    }
    async function open(nft) {
        if (!(await load())) return;
        ensureModal();
        const key = GalleryLikes.nftKey(nft);
        current = { nft, key, cur: 'SOL', item: null, signer: null };
        modal.querySelector('.sol-net').hidden = apiCfg.network === 'mainnet';
        modal.querySelector('.sol-net').textContent = apiCfg.network;
        modal.querySelector('.sol-name').textContent = `${nft.name} (Solana Edition)`;
        modal.querySelector('.sol-meta').textContent = 'Loading…';
        modal.querySelector('.sol-price').textContent = '';
        const th = modal.querySelector('.sol-thumb'); th.src = nft.image_url || ''; th.hidden = !nft.image_url;
        modal.querySelectorAll('[data-cur]').forEach((b) => { b.hidden = b.dataset.cur === 'USDC' && !apiCfg.currencies.includes('USDC'); b.setAttribute('aria-pressed', String(b.dataset.cur === 'SOL')); });
        status(''); modal.hidden = false;
        const wl = modal.querySelector('.sol-wallets'); wl.innerHTML = '';
        if (!apiCfg.live) { modal.querySelector('.sol-meta').textContent = 'Coming soon.'; status('Solana minting is not open yet.'); return; }
        try {
            current.item = await api(`/api/sol/item?key=${encodeURIComponent(key)}`);
            modal.querySelector('.sol-meta').textContent = `${current.item.left} of ${current.item.cap} Solana copies left`;
            paintPrice();
        } catch (e) { modal.querySelector('.sol-meta').textContent = ''; status(esc(e.message)); return; }
        if (current.item.left < 1) { status('Sold out on Solana.'); return; }
        const opts = (await standardWallets()).map((w) => ({ label: w.name, icon: w.icon, run: () => connectStandard(w) }));
        opts.push({ label: 'Trust Wallet', run: () => connectWc('trust') }, { label: 'WalletConnect', run: () => connectWc('wc') });
        if (!opts.length || (opts.length === 2 && /Android|iPhone|iPad/i.test(navigator.userAgent))) {
            const here = encodeURIComponent(location.href);
            opts.unshift({ label: 'Open in Phantom', href: `https://phantom.app/ul/browse/${here}?ref=${encodeURIComponent(location.origin)}` },
                { label: 'Open in Solflare', href: `https://solflare.com/ul/v1/browse/${here}?ref=${encodeURIComponent(location.origin)}` });
        }
        for (const o of opts) {
            const b = document.createElement(o.href ? 'a' : 'button');
            b.className = 'btn btn--primary btn--block';
            if (o.href) b.href = o.href; else b.type = 'button';
            b.innerHTML = `${o.icon ? `<img src="${esc(o.icon)}" alt="">` : '<span aria-hidden="true">◎</span>'} ${esc(o.label)}`;
            if (o.run) b.addEventListener('click', () => buy(o));
            wl.appendChild(b);
        }
    }
    async function buy(opt) {
        const wl = modal.querySelector('.sol-wallets');
        wl.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try {
            status(`Connecting ${esc(opt.label)}…`);
            current.signer = current.signer || await opt.run();
            status('Preparing your transaction…');
            const q = await api('/api/sol/quote', { key: current.key, buyer: current.signer.address, currency: current.cur });
            status(`Approve in your wallet: ${esc(q.amount_display)} for ${esc(q.name)} (valid ${Math.max(10, q.expires_at - Math.floor(Date.now() / 1000))} s).`);
            const signed = await current.signer.sign(q.tx);
            if (signed.tx) { status('Sending…'); await api('/api/sol/submit', { quote_id: q.quote_id, tx: signed.tx }); }
            status('Confirming on Solana…');
            let r = { status: 'pending' };
            for (let i = 0; i < 40 && r.status === 'pending'; i++) {
                await new Promise((res) => setTimeout(res, 2500));
                r = await api('/api/sol/confirm', { quote_id: q.quote_id }).catch(() => ({ status: 'pending' }));
            }
            const cl = apiCfg.network === 'mainnet' ? '' : `?cluster=${apiCfg.network}`;
            if (r.status === 'sold') {
                status(`Minted: <strong>${esc(q.name)}</strong>. <a href="https://explorer.solana.com/address/${esc(q.asset)}${cl}" target="_blank" rel="noopener">View on Solana Explorer</a>`);
                wl.innerHTML = '';
            } else {
                status(r.status === 'expired' ? 'The checkout expired before it was signed. Nothing was charged. Try again.' : 'Still confirming. Check your wallet in a minute.');
                wl.querySelectorAll('button').forEach((b) => { b.disabled = false; });
            }
        } catch (e) {
            const m = /reject|denied|cancel/i.test(String(e && e.message)) ? 'Cancelled in the wallet. Nothing was charged.' : esc(e && e.message || e);
            status(m);
            wl.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        }
    }

    /* ---------- owner setup (sol-setup.html) ---------- */
    async function setup(root) {
        site = { ...site, ...(await fetch('data/shop_sol.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => ({}))) };
        apiCfg = await api('/api/sol/config');
        const out = (h) => { root.querySelector('.out').innerHTML = h; };
        root.querySelector('.cfg').innerHTML = `Network: <b>${esc(apiCfg.network)}</b><br>Collection: <b>${esc(apiCfg.collection_name)}</b><br>
Owner (update authority, payout, royalties): <code>${esc(apiCfg.owner)}</code><br>Royalties: ${apiCfg.royalty_bps / 100}%<br>
Existing collection: ${apiCfg.collection ? `<code>${esc(apiCfg.collection)}</code>` : 'none yet'}`;
        if (apiCfg.collection) { out('The collection already exists. Nothing to do.'); return; }
        const list = root.querySelector('.wallets');
        for (const w of await standardWallets()) {
            const b = document.createElement('button'); b.className = 'btn btn--primary'; b.type = 'button'; b.textContent = `Connect ${w.name}`;
            b.addEventListener('click', async () => {
                try {
                    const s = await connectStandard(w);
                    if (s.address !== apiCfg.owner) { out(`Connected <code>${esc(s.address)}</code>, but the owner wallet is <code>${esc(apiCfg.owner)}</code>. Switch account in the wallet.`); return; }
                    out('Preparing the collection transaction…');
                    const t = await fetch(`${site.api}/api/sol/setup-tx?owner=${encodeURIComponent(s.address)}`).then((r) => r.json());
                    if (!t.tx) throw new Error(t.error || 'setup failed');
                    out(`Approve in ${esc(w.name)}: create <b>${esc(t.name)}</b> (${esc(t.collection)}), royalties ${t.royalty_bps / 100}%, studio mint key <code>${esc(t.delegate)}</code> as update delegate.`);
                    const signed = await s.sign(t.tx);
                    if (signed.tx) await api('/api/sol/setup-submit', { collection: t.collection, tx: signed.tx });
                    for (let i = 0; i < 30; i++) {
                        await new Promise((r) => setTimeout(r, 2500));
                        const c = await api('/api/sol/setup-confirm', { collection: t.collection }).catch(() => ({ status: 'pending' }));
                        if (c.status === 'done') { out(`Done. Collection <a href="https://explorer.solana.com/address/${esc(t.collection)}${apiCfg.network === 'mainnet' ? '' : '?cluster=' + apiCfg.network}" target="_blank" rel="noopener">${esc(t.collection)}</a> created.`); return; }
                    }
                    out('Sent. Still confirming; reload this page in a minute.');
                } catch (e) { out(esc(e.message || e)); }
            });
            list.appendChild(b);
        }
        if (!list.children.length) list.textContent = 'No Solana wallet extension found. Install Solflare or Phantom, or open this page in the wallet app browser.';
    }

    return { load, decorate, open, setup };
})();
if (typeof document !== 'undefined' && !document.querySelector('[data-sol-setup]')) {
    window.addEventListener('DOMContentLoaded', () => SolMint.load());
}
