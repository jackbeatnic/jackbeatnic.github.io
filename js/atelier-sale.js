/**
 * Atelier sales desk. Reads data/atelier.json.
 * An empty contract address shows an empty desk. No secrets.
 * Buy and bid use window.ethereum and wallet_switchEthereumChain.
 */
const AtelierSale = (() => {
    const MAX_LISTINGS = 40;
    const contexts = new WeakMap();
    let configPromise = null;

    function escapeHtml(text) {
        return String(text ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function load() {
        if (!configPromise) {
            configPromise = fetch("data/atelier.json", { cache: "no-store" })
                .then((res) => {
                    if (!res.ok) throw new Error("desk file");
                    return res.json();
                })
                .catch((err) => {
                    configPromise = null;
                    throw err;
                });
        }
        return configPromise;
    }

    function selector(cfg, signature) {
        const raw = cfg.selectors?.[signature];
        if (!raw) throw new Error("Missing selector " + signature);
        return String(raw).toLowerCase().startsWith("0x") ? String(raw) : "0x" + raw;
    }

    function word(value) {
        return BigInt(value).toString(16).padStart(64, "0");
    }

    function callData(cfg, signature, args = []) {
        return (
            "0x" +
            selector(cfg, signature).replace(/^0x/, "") +
            args.map(word).join("")
        );
    }

    function isAddress(value) {
        const address = String(value || "").trim();
        return /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/i.test(address);
    }

    function contractFor(chain, kind) {
        if (!chain) return "";
        return kind === "editions" ? chain.edition : chain.one;
    }

    async function ethCall(rpc, to, data) {
        const res = await fetch(rpc, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [{ to, data }, "latest"],
            }),
        });
        if (!res.ok) throw new Error("The network did not answer.");
        const body = await res.json();
        if (body.error) throw new Error(body.error.message || "The desk rejected the read.");
        if (!body.result || body.result === "0x") throw new Error("Empty answer from the desk.");
        return body.result;
    }

    function wordsOf(hex) {
        const body = String(hex || "").replace(/^0x/, "");
        const out = [];
        for (let i = 0; i + 64 <= body.length; i += 64) {
            out.push(BigInt("0x" + body.slice(i, i + 64)));
        }
        return out;
    }

    function formatNative(wei, symbol) {
        const value = BigInt(wei);
        const name = symbol || "ETH";
        if (value === 0n) return `0 ${name}`;
        const base = 10n ** 18n;
        const whole = value / base;
        const frac = (value % base).toString().padStart(18, "0").slice(0, 8).replace(/0+$/, "");
        if (whole === 0n && !frac) return `${value.toString()} wei`;
        return frac ? `${whole.toString()}.${frac} ${name}` : `${whole.toString()} ${name}`;
    }

    function formatTime(seconds) {
        const n = Number(seconds);
        if (!n) return "";
        const date = new Date(n * 1000);
        if (Number.isNaN(date.getTime())) return "";
        return date.toISOString().replace(".000Z", " UTC").replace("T", " ");
    }

    function parseNative(text) {
        const raw = String(text || "").trim();
        if (!/^\d+(\.\d{1,18})?$/.test(raw)) {
            throw new Error("Enter an amount in the chain coin.");
        }
        const [whole, frac = ""] = raw.split(".");
        const wei = BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
        if (wei <= 0n) throw new Error("Enter an amount above zero.");
        return wei;
    }

    function hexQuantity(wei) {
        return "0x" + BigInt(wei).toString(16);
    }

    function chainIdHex(chainId) {
        return "0x" + Number(chainId).toString(16);
    }

    function nextBid(current, bps) {
        if (!bps) return current + 1n;
        let step = (current * BigInt(bps)) / 10000n;
        if (step === 0n) step = 1n;
        return current + step;
    }

    function unitPrice(run, index) {
        let price = run.price + run.step * BigInt(index);
        if (run.cap !== 0n && price > run.cap) return run.cap;
        return price;
    }

    function emptyDesk(chainName, kind) {
        if (kind === "editions") {
            return `
            <article class="section-promo__item atelier-sale atelier-sale--empty">
                <h3 class="section-promo__title">The desk is empty</h3>
                <p class="section-promo__collector">
                    No edition contract is published on ${escapeHtml(chainName)} yet.
                    The address is empty. Do not deploy until Jack confirms.
                    Editions mint a new run. They are separate from the vault.
                    Avalanche is first. Base uses the same contract later.
                </p>
            </article>`;
        }
        const room = kind === "auctions" ? "auction" : "fixed-price";
        return `
            <article class="section-promo__item atelier-sale atelier-sale--empty">
                <h3 class="section-promo__title">The desk is empty</h3>
                <p class="section-promo__collector">
                    No new one-of-one contract and no vault are published on ${escapeHtml(chainName)} yet.
                    The addresses are empty. Do not deploy until Jack confirms.
                    A new one-of-one is minted. A vault lot is one unit pulled from a token the studio already holds, sold as that same token, with no second id.
                    Nothing is listed in this ${room} room until an address is set.
                    Avalanche is first. Base uses the same contracts later.
                </p>
            </article>`;
    }

    function addressOf(word) {
        return "0x" + BigInt(word).toString(16).padStart(40, "0").slice(-40);
    }

    function shortAddress(address) {
        const value = String(address || "");
        if (value.length < 12) return value;
        return `${value.slice(0, 6)}…${value.slice(-4)}`;
    }

    function decodePiece(hex) {
        const w = wordsOf(hex);
        if (w.length < 12) throw new Error("Short piece record.");
        return {
            kind: Number(w[0]),
            sold: w[1] !== 0n,
            listed: w[2] !== 0n,
            incrementBps: Number(w[3]),
            extensionSecs: Number(w[4]),
            startTime: Number(w[5]),
            endTime: Number(w[6]),
            price: w[8],
            reservePrice: w[9],
            bid: w[10],
        };
    }

    function decodeRun(hex) {
        const w = wordsOf(hex);
        if (w.length < 7) throw new Error("Short edition record.");
        return {
            curve: Number(w[0]),
            listed: w[1] !== 0n,
            supply: Number(w[2]),
            sold: Number(w[3]),
            price: w[4],
            step: w[5],
            cap: w[6],
        };
    }

    function pieceCard(chain, id, piece, paused) {
        const symbol = chain.nativeSymbol || "ETH";
        const now = Math.floor(Date.now() / 1000);
        const idText = id.toString();
        let title = "One-of-one #" + idText;
        let kindLabel = "Fixed price";
        let detail = "";
        let action = "";
        if (piece.kind === 2) {
            title = "Auction #" + idText;
            kindLabel = "Auction";
            const min =
                piece.bid === 0n ? piece.price : nextBid(piece.bid, piece.incrementBps);
            const bits = [`Minimum ${formatNative(min, symbol)}`];
            if (piece.bid > 0n) bits.push(`High bid ${formatNative(piece.bid, symbol)}`);
            if (piece.reservePrice > 0n) bits.push(`Reserve ${formatNative(piece.reservePrice, symbol)}`);
            if (piece.endTime) bits.push(`Ends ${formatTime(piece.endTime)}`);
            if (piece.extensionSecs) {
                bits.push(`Anti-snipe ${piece.extensionSecs}s`);
            }
            detail = bits.join(" · ");
            if (piece.sold) {
                action = `<p class="atelier-sale__note">Sold.</p>`;
            } else if (!piece.listed) {
                return "";
            } else if (now < piece.startTime) {
                action = `<p class="atelier-sale__note">Opens ${escapeHtml(formatTime(piece.startTime))}.</p>`;
            } else if (now >= piece.endTime) {
                action = paused
                    ? `<p class="atelier-sale__note">Ended. Sales are paused.</p>`
                    : `<div class="section-promo__actions">
                        <button type="button" class="btn btn--primary btn--small" data-atelier-action="settle" data-id="${escapeHtml(idText)}">Settle</button>
                       </div>
                       <p class="atelier-sale__note" role="status"></p>`;
            } else if (paused) {
                action = `<p class="atelier-sale__note">Sales are paused. Withdraw still works on the contract.</p>`;
            } else {
                action = `<div class="atelier-sale__field">
                    <input class="atelier-sale__input" data-bid inputmode="decimal" aria-label="Bid in ${escapeHtml(symbol)}" placeholder="${escapeHtml(symbol)}">
                    <button type="button" class="btn btn--primary btn--small" data-atelier-action="bid" data-id="${escapeHtml(idText)}">Place bid</button>
                   </div>
                   <p class="atelier-sale__note" role="status"></p>`;
            }
        } else {
            detail = `Price ${formatNative(piece.price, symbol)}`;
            if (piece.startTime) detail += ` · Opens ${formatTime(piece.startTime)}`;
            if (piece.endTime) detail += ` · Ends ${formatTime(piece.endTime)}`;
            if (piece.sold) {
                action = `<p class="atelier-sale__note">Sold.</p>`;
            } else if (!piece.listed) {
                return "";
            } else if (paused) {
                action = `<p class="atelier-sale__note">Sales are paused. Withdraw still works on the contract.</p>`;
            } else if (
                (piece.startTime && now < piece.startTime) ||
                (piece.endTime && now > piece.endTime)
            ) {
                action = `<p class="atelier-sale__note">This listing is outside its sale window.</p>`;
            } else {
                action = `<div class="section-promo__actions">
                    <button type="button" class="btn btn--primary btn--small" data-atelier-action="buy" data-id="${escapeHtml(idText)}" data-value="${piece.price.toString()}">Buy</button>
                   </div>
                   <p class="atelier-sale__note" role="status"></p>`;
            }
        }
        return `
            <article class="section-promo__item atelier-sale">
                <h3 class="section-promo__title">${escapeHtml(title)}</h3>
                <p class="section-promo__token">
                    <span class="section-promo__symbol">${escapeHtml(kindLabel)}</span>
                    <span class="section-promo__chain"> · ${escapeHtml(chain.name || "Avalanche")}</span>
                </p>
                <p class="atelier-sale__meta"><span class="atelier-sale__price">${escapeHtml(detail)}</span></p>
                ${action}
            </article>`;
    }

    function runCard(chain, id, run, paused) {
        const symbol = chain.nativeSymbol || "ETH";
        const idText = id.toString();
        const left = Math.max(0, run.supply - run.sold);
        const step = run.curve === 2;
        const next = step ? unitPrice(run, run.sold) : run.price;
        const bits = [
            step ? "Step curve" : "Fixed price",
            `${run.sold} of ${run.supply} sold`,
            `Next ${formatNative(next, symbol)}`,
        ];
        if (step && run.step > 0n) bits.push(`Step ${formatNative(run.step, symbol)}`);
        if (step && run.cap > 0n) bits.push(`Cap ${formatNative(run.cap, symbol)}`);
        let action = "";
        if (!run.listed || left === 0) {
            if (run.sold === 0) return "";
            action = `<p class="atelier-sale__note">Sold out.</p>`;
        } else if (paused) {
            action = `<p class="atelier-sale__note">Sales are paused. Withdraw still works on the contract.</p>`;
        } else {
            action = `<div class="atelier-sale__field">
                <input class="atelier-sale__input" data-qty type="number" min="1" max="${left}" value="1" aria-label="Copies">
                <button type="button" class="btn btn--primary btn--small" data-atelier-action="buy" data-id="${escapeHtml(idText)}">Buy</button>
               </div>
               <p class="atelier-sale__note" role="status"></p>`;
        }
        return `
            <article class="section-promo__item atelier-sale">
                <h3 class="section-promo__title">Edition #${escapeHtml(idText)}</h3>
                <p class="section-promo__token">
                    <span class="section-promo__symbol">Edition</span>
                    <span class="section-promo__chain"> · ${escapeHtml(chain.name || "Avalanche")}</span>
                </p>
                <p class="atelier-sale__meta">${escapeHtml(bits.join(" · "))}</p>
                ${action}
            </article>`;
    }

    async function renderOnes(cfg, chain, address, kind) {
        const pausedHex = await ethCall(chain.rpc, address, callData(cfg, "paused()")).catch(
            () => "0x0"
        );
        const paused = BigInt(pausedHex) !== 0n;
        const count = Number(BigInt(await ethCall(chain.rpc, address, callData(cfg, "saleCount()"))));
        const cards = [];
        const limit = Math.min(count, MAX_LISTINGS);
        for (let i = 0; i < limit; i += 1) {
            const id = BigInt(await ethCall(chain.rpc, address, callData(cfg, "saleIdAt(uint256)", [i])));
            const piece = decodePiece(
                await ethCall(chain.rpc, address, callData(cfg, "pieces(uint256)", [id]))
            );
            if (kind === "fixed" && piece.kind !== 1) continue;
            if (kind === "auctions" && piece.kind !== 2) continue;
            const card = pieceCard(chain, id, piece, paused);
            if (card) cards.push(card);
        }
        if (!cards.length) {
            const room = kind === "auctions" ? "auction" : "fixed-price work";
            return `<article class="section-promo__item atelier-sale atelier-sale--empty">
                <h3 class="section-promo__title">Nothing listed</h3>
                <p class="section-promo__collector">The ${escapeHtml(chain.name || "Avalanche")} contract is set, and no ${room} is open on this desk.</p>
            </article>`;
        }
        const more =
            count > limit
                ? `<p class="atelier-sale__status">Showing the first ${limit} listings.</p>`
                : "";
        const banner = paused
            ? `<p class="atelier-sale__status">Sales are paused. Withdraw still works on the contract.</p>`
            : "";
        return banner + cards.join("") + more;
    }

    async function renderEditions(cfg, chain, address) {
        const pausedHex = await ethCall(chain.rpc, address, callData(cfg, "paused()")).catch(
            () => "0x0"
        );
        const paused = BigInt(pausedHex) !== 0n;
        const count = Number(BigInt(await ethCall(chain.rpc, address, callData(cfg, "runCount()"))));
        const cards = [];
        const limit = Math.min(count, MAX_LISTINGS);
        for (let i = 0; i < limit; i += 1) {
            const id = BigInt(await ethCall(chain.rpc, address, callData(cfg, "runIdAt(uint256)", [i])));
            const run = decodeRun(
                await ethCall(chain.rpc, address, callData(cfg, "runs(uint256)", [id]))
            );
            const card = runCard(chain, id, run, paused);
            if (card) cards.push(card);
        }
        if (!cards.length) {
            return `<article class="section-promo__item atelier-sale atelier-sale--empty">
                <h3 class="section-promo__title">Nothing listed</h3>
                <p class="section-promo__collector">The ${escapeHtml(chain.name || "Avalanche")} edition contract is set, and no run is open. Editions are separate from one-of-one sales.</p>
            </article>`;
        }
        const banner = paused
            ? `<p class="atelier-sale__status">Sales are paused. Withdraw still works on the contract.</p>`
            : "";
        return banner + cards.join("");
    }

    function decodeLotSale(hex) {
        const w = wordsOf(hex);
        if (w.length < 11) throw new Error("Short vault sale.");
        return {
            kind: Number(w[0]),
            standard: Number(w[1]),
            sold: w[2] !== 0n,
            listed: w[3] !== 0n,
            startTime: Number(w[4]),
            endTime: Number(w[5]),
            price: w[6],
            reservePrice: w[7],
            bid: w[8],
            incrementBps: Number(w[9]),
            extensionSecs: Number(w[10]),
        };
    }

    function decodeLotAsset(hex) {
        const w = wordsOf(hex);
        if (w.length < 5) throw new Error("Short vault asset.");
        return {
            collection: addressOf(w[0]),
            depositor: addressOf(w[1]),
            tokenId: w[3],
            qty: w[4],
        };
    }

    function vaultCard(chain, vaultAddress, id, sale, asset, paused) {
        const symbol = chain.nativeSymbol || "ETH";
        const now = Math.floor(Date.now() / 1000);
        const idText = id.toString();
        const standard = sale.standard === 1 ? "ERC-721" : "ERC-1155";
        const title = `Vault lot ${idText} · token ${asset.tokenId.toString()}`;
        const origin = `${standard} · qty ${asset.qty.toString()} · ${shortAddress(asset.collection)} · original token, no second id`;
        const to = escapeHtml(vaultAddress);
        let detail = "";
        let action = "";
        if (sale.kind === 2) {
            const min = sale.bid === 0n ? sale.price : nextBid(sale.bid, sale.incrementBps);
            const bits = [`Minimum ${formatNative(min, symbol)}`];
            if (sale.bid > 0n) bits.push(`High bid ${formatNative(sale.bid, symbol)}`);
            if (sale.reservePrice > 0n) bits.push(`Reserve ${formatNative(sale.reservePrice, symbol)}`);
            if (sale.endTime) bits.push(`Ends ${formatTime(sale.endTime)}`);
            detail = bits.join(" · ");
            if (sale.sold) {
                action = `<p class="atelier-sale__note">Sold. The unit went to the buyer.</p>`;
            } else if (!sale.listed) {
                return "";
            } else if (now < sale.startTime) {
                action = `<p class="atelier-sale__note">Opens ${escapeHtml(formatTime(sale.startTime))}.</p>`;
            } else if (now >= sale.endTime) {
                action = paused
                    ? `<p class="atelier-sale__note">Ended. Sales are paused.</p>`
                    : `<div class="section-promo__actions">
                        <button type="button" class="btn btn--primary btn--small" data-atelier-action="settle" data-to="${to}" data-id="${escapeHtml(idText)}">Settle</button>
                       </div>
                       <p class="atelier-sale__note" role="status"></p>`;
            } else if (paused) {
                action = `<p class="atelier-sale__note">Sales are paused. Withdraw still works on the contract.</p>`;
            } else {
                action = `<div class="atelier-sale__field">
                    <input class="atelier-sale__input" data-bid inputmode="decimal" aria-label="Bid in ${escapeHtml(symbol)}" placeholder="${escapeHtml(symbol)}">
                    <button type="button" class="btn btn--primary btn--small" data-atelier-action="bid" data-to="${to}" data-id="${escapeHtml(idText)}">Place bid</button>
                   </div>
                   <p class="atelier-sale__note" role="status"></p>`;
            }
        } else {
            detail = `Price ${formatNative(sale.price, symbol)}`;
            if (sale.startTime) detail += ` · Opens ${formatTime(sale.startTime)}`;
            if (sale.endTime) detail += ` · Ends ${formatTime(sale.endTime)}`;
            if (sale.sold) {
                action = `<p class="atelier-sale__note">Sold. The unit went to the buyer.</p>`;
            } else if (!sale.listed) {
                return "";
            } else if (paused) {
                action = `<p class="atelier-sale__note">Sales are paused. Withdraw still works on the contract.</p>`;
            } else if (
                (sale.startTime && now < sale.startTime) ||
                (sale.endTime && now > sale.endTime)
            ) {
                action = `<p class="atelier-sale__note">This listing is outside its sale window. An ended fixed-price lot can be returned to the depositor.</p>`;
            } else {
                action = `<div class="section-promo__actions">
                    <button type="button" class="btn btn--primary btn--small" data-atelier-action="buy" data-to="${to}" data-id="${escapeHtml(idText)}" data-value="${sale.price.toString()}">Buy</button>
                   </div>
                   <p class="atelier-sale__note" role="status"></p>`;
            }
        }
        const kindLabel = sale.kind === 2 ? "Vault auction" : "Vault fixed price";
        return `
            <article class="section-promo__item atelier-sale">
                <h3 class="section-promo__title">${escapeHtml(title)}</h3>
                <p class="section-promo__token">
                    <span class="section-promo__symbol">${escapeHtml(kindLabel)}</span>
                    <span class="section-promo__chain"> · ${escapeHtml(chain.name || "Avalanche")}</span>
                </p>
                <p class="atelier-sale__meta">${escapeHtml(origin)}</p>
                <p class="atelier-sale__meta"><span class="atelier-sale__price">${escapeHtml(detail)}</span></p>
                ${action}
            </article>`;
    }

    async function renderVault(cfg, chain, address, kind) {
        const pausedHex = await ethCall(chain.rpc, address, callData(cfg, "paused()")).catch(
            () => "0x0"
        );
        const paused = BigInt(pausedHex) !== 0n;
        const count = Number(BigInt(await ethCall(chain.rpc, address, callData(cfg, "lotCount()"))));
        const cards = [];
        const limit = Math.min(count, MAX_LISTINGS);
        for (let i = 0; i < limit; i += 1) {
            const id = BigInt(await ethCall(chain.rpc, address, callData(cfg, "lotIdAt(uint256)", [i])));
            const sale = decodeLotSale(
                await ethCall(chain.rpc, address, callData(cfg, "lotSale(uint256)", [id]))
            );
            if (kind === "fixed" && sale.kind !== 1) continue;
            if (kind === "auctions" && sale.kind !== 2) continue;
            const asset = decodeLotAsset(
                await ethCall(chain.rpc, address, callData(cfg, "lotAsset(uint256)", [id]))
            );
            const card = vaultCard(chain, address, id, sale, asset, paused);
            if (card) cards.push(card);
        }
        if (!cards.length) return { html: "", paused };
        const more =
            count > limit
                ? `<p class="atelier-sale__status">Showing the first ${limit} vault lots.</p>`
                : "";
        const banner = paused
            ? `<p class="atelier-sale__status">Vault sales are paused. Withdraw still works on the contract.</p>`
            : `<p class="atelier-sale__status">Vault · pulled from an existing token. The original supply is unchanged.</p>`;
        return { html: banner + cards.join("") + more, paused };
    }

    function ensureBound(el) {
        if (el.dataset.bound === "1") return;
        el.dataset.bound = "1";
        el.addEventListener("click", (event) => {
            const btn = event.target.closest("[data-atelier-action]");
            if (!btn || !el.contains(btn)) return;
            onAction(el, btn);
        });
    }

    async function switchChain(chain) {
        if (!window.ethereum) throw new Error("No wallet found in this browser.");
        const hexId = chainIdHex(chain.chainId);
        try {
            await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: hexId }],
            });
        } catch (err) {
            if (err && Number(err.code) === 4902) {
                await window.ethereum.request({
                    method: "wallet_addEthereumChain",
                    params: [
                        {
                            chainId: hexId,
                            chainName: chain.name,
                            nativeCurrency: {
                                name: chain.nativeSymbol,
                                symbol: chain.nativeSymbol,
                                decimals: 18,
                            },
                            rpcUrls: [chain.rpc],
                        },
                    ],
                });
            } else {
                throw err;
            }
        }
    }

    async function send(chain, to, data, value) {
        await switchChain(chain);
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const from = accounts && accounts[0];
        if (!from) throw new Error("The wallet did not share an account.");
        return window.ethereum.request({
            method: "eth_sendTransaction",
            params: [{ from, to, data, value: value || "0x0" }],
        });
    }

    async function onAction(root, btn) {
        const ctx = contexts.get(root);
        if (!ctx) return;
        const note = btn.closest(".atelier-sale")?.querySelector(".atelier-sale__note");
        const say = (text) => {
            if (note) note.textContent = text;
        };
        btn.disabled = true;
        try {
            const id = btn.dataset.id;
            const action = btn.dataset.atelierAction;
            if (action === "bid") {
                const raw = btn.closest(".atelier-sale")?.querySelector("[data-bid]")?.value;
                const wei = parseNative(raw);
                const tx = await send(
                    ctx.chain,
                    btn.dataset.to || ctx.address,
                    callData(ctx.cfg, "bid(uint256)", [id]),
                    hexQuantity(wei)
                );
                say("Bid submitted " + tx);
                return;
            }
            if (action === "settle") {
                const tx = await send(
                    ctx.chain,
                    btn.dataset.to || ctx.address,
                    callData(ctx.cfg, "settle(uint256)", [id]),
                    "0x0"
                );
                say("Settle submitted " + tx);
                return;
            }
            if (ctx.kind === "editions") {
                const qty = Number(btn.closest(".atelier-sale")?.querySelector("[data-qty]")?.value || "1");
                if (!Number.isInteger(qty) || qty < 1) {
                    say("Enter a whole number of copies.");
                    return;
                }
                const quoted = BigInt(
                    await ethCall(
                        ctx.chain.rpc,
                        btn.dataset.to || ctx.address,
                        callData(ctx.cfg, "quote(uint256,uint32)", [id, qty])
                    )
                );
                const tx = await send(
                    ctx.chain,
                    btn.dataset.to || ctx.address,
                    callData(ctx.cfg, "buy(uint256,uint32)", [id, qty]),
                    hexQuantity(quoted)
                );
                say("Purchase submitted " + tx);
                return;
            }
            const tx = await send(
                ctx.chain,
                btn.dataset.to || ctx.address,
                callData(ctx.cfg, "buy(uint256)", [id]),
                hexQuantity(btn.dataset.value || "0")
            );
            say("Purchase submitted " + tx);
        } catch (err) {
            say(err?.message || "The wallet did not send the transaction.");
        } finally {
            btn.disabled = false;
        }
    }

    async function mount(el, { chain, kind } = {}) {
        if (!el) return;
        const gen = String(Date.now()) + Math.random().toString(16).slice(2);
        el.dataset.gen = gen;
        const still = () => el.dataset.gen === gen;
        el.innerHTML = `<p class="atelier-sale__status">Reading the desk…</p>`;
        try {
            const cfg = await load();
            if (!still()) return;
            const chainCfg = cfg.chains?.[chain];
            const chainName = chainCfg?.name || (chain === "base" ? "Base" : "Avalanche");
            if (!chainCfg) {
                el.innerHTML = emptyDesk(chainName, kind);
                return;
            }
            if (kind === "editions") {
                const address = chainCfg.edition;
                if (!isAddress(address)) {
                    el.innerHTML = emptyDesk(chainName, kind);
                    return;
                }
                const html = await renderEditions(cfg, chainCfg, address);
                if (!still()) return;
                el.innerHTML = html;
                contexts.set(el, { cfg, chain: chainCfg, address, kind });
                ensureBound(el);
                return;
            }
            const oneAddress = isAddress(chainCfg.one) ? chainCfg.one : "";
            const vaultAddress = isAddress(chainCfg.vault) ? chainCfg.vault : "";
            if (!oneAddress && !vaultAddress) {
                el.innerHTML = emptyDesk(chainName, kind);
                return;
            }
            const parts = [];
            if (oneAddress) {
                parts.push(await renderOnes(cfg, chainCfg, oneAddress, kind));
            }
            if (vaultAddress) {
                const vault = await renderVault(cfg, chainCfg, vaultAddress, kind);
                if (vault.html) {
                    parts.push(vault.html);
                } else if (!oneAddress) {
                    parts.push(`<article class="section-promo__item atelier-sale atelier-sale--empty">
                        <h3 class="section-promo__title">No vault lot is listed</h3>
                        <p class="section-promo__collector">The ${escapeHtml(chainName)} vault address is set. No ${kind === "auctions" ? "auction" : "fixed-price"} lot is open. A lot is a unit pulled from a token the studio already holds.</p>
                    </article>`);
                }
            } else {
                parts.push(`<p class="atelier-sale__status">The vault address is empty, so no pulled work is listed on ${escapeHtml(chainName)}.</p>`);
            }
            if (!still()) return;
            el.innerHTML = parts.join("");
            contexts.set(el, {
                cfg,
                chain: chainCfg,
                address: oneAddress || vaultAddress,
                kind,
            });
            ensureBound(el);
        } catch (err) {
            if (!still()) return;
            el.innerHTML = `<p class="atelier-sale__status">The desk did not answer. ${escapeHtml(err?.message || "")}</p>`;
        }
    }

    return { load, mount };
})();
