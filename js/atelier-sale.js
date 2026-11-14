/**
 * Atelier desk for guests. Reads data/atelier.json.
 * An empty contract shows an invitation, not a technical note.
 * Buy and bid ask the wallet to switch to Avalanche (43114) before sending.
 * ?atelier=preview paints sample cards and never sends a transaction.
 */
const AtelierSale = (() => {
    const MAX_LISTINGS = 40;
    const BID_TOPIC = "0xdcd726e11f8b5e160f00290f0fe3a1abb547474e53a8e7a8f49a85e7b1ca3199";
    const STATE_LABEL = {
        available: "Available",
        live: "Live auction",
        sold: "Sold",
        ended: "Ended",
    };
    const contexts = new WeakMap();

    let configPromise = null;

    function escapeHtml(text) {
        return String(text ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function previewOn() {
        try {
            return new URLSearchParams(location.search).get("atelier") === "preview";
        } catch {
            return false;
        }
    }

    function previewFails() {
        try {
            return new URLSearchParams(location.search).get("atelierFail") === "1";
        } catch {
            return false;
        }
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
        return "0x" + selector(cfg, signature).replace(/^0x/, "") + args.map(word).join("");
    }

    function isAddress(value) {
        const address = String(value || "").trim();
        return /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/i.test(address);
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

    async function rpc(rpcUrl, method, params) {
        const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        if (!res.ok) throw new Error("The network did not answer.");
        const body = await res.json();
        if (body.error) throw new Error(body.error.message || "The network did not answer.");
        return body.result;
    }

    function wordsOf(hex) {
        const body = String(hex || "").replace(/^0x/, "");
        const out = [];
        for (let i = 0; i + 64 <= body.length; i += 64) out.push(BigInt("0x" + body.slice(i, i + 64)));
        return out;
    }

    function addressOf(wordValue) {
        return "0x" + BigInt(wordValue).toString(16).padStart(40, "0").slice(-40);
    }

    function shortAddress(address) {
        const value = String(address || "");
        if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return "";
        if (/^0x0{40}$/i.test(value)) return "";
        return `${value.slice(0, 6)}…${value.slice(-4)}`;
    }

    function formatNative(wei, symbol) {
        const value = BigInt(wei || 0);
        const name = symbol || "AVAX";
        if (value === 0n) return `0 ${name}`;
        const base = 10n ** 18n;
        const whole = value / base;
        const frac = (value % base).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
        return frac ? `${whole}.${frac} ${name}` : `${whole} ${name}`;
    }

    function parseNative(text) {
        const raw = String(text || "").trim();
        if (!/^\d+(\.\d{1,18})?$/.test(raw)) throw new Error("Enter an amount in AVAX.");
        const [whole, frac = ""] = raw.split(".");
        const wei = BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
        if (wei <= 0n) throw new Error("Enter an amount above zero.");
        return wei;
    }

    function nativeToWei(text) {
        return parseNative(text);
    }

    function hexQuantity(wei) {
        return "0x" + BigInt(wei).toString(16);
    }

    function chainIdHex(chainId) {
        return "0x" + Number(chainId).toString(16);
    }

    function nextBid(current, bps) {
        const cur = BigInt(current || 0);
        const stepBps = BigInt(bps || 0);
        if (stepBps === 0n) return cur + 1n;
        let step = (cur * stepBps) / 10000n;
        if (step === 0n) step = 1n;
        return cur + step;
    }

    function unitPrice(run, index) {
        const i = BigInt(index || 0);
        let price = BigInt(run.price) + BigInt(run.step || 0) * i;
        const cap = BigInt(run.cap || 0);
        if (cap !== 0n && price > cap) return cap;
        return price;
    }

    function quoteEdition(run, qty) {
        const q = BigInt(qty || 0);
        if (q <= 0n) return 0n;
        if (Number(run.curve) !== 2) return BigInt(run.price) * q;
        let cost = 0n;
        for (let i = 0n; i < q; i += 1n) cost += unitPrice(run, BigInt(run.sold || 0) + i);
        return cost;
    }

    function usdLabel(wei, rate) {
        const n = Number(rate);
        if (!Number.isFinite(n) || n <= 0) return "";
        const whole = Number(BigInt(wei || 0) / 10n ** 14n) / 10000;
        if (!Number.isFinite(whole)) return "";
        const usd = whole * n;
        const text = usd >= 100 ? String(Math.round(usd)) : usd.toFixed(2);
        return `about $${text}`;
    }

    function bpsLabel(bps) {
        const pct = Number(bps || 0) / 100;
        if (!pct) return "";
        const text = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
        return `${text}% above the current bid`;
    }

    function reserveLabel(reserve, bid) {
        const floor = BigInt(reserve || 0);
        if (floor === 0n) return "No reserve";
        return BigInt(bid || 0) >= floor ? "Reserve met" : "Reserve not met";
    }

    function formatWhen(seconds) {
        const n = Number(seconds);
        if (!n) return "";
        const date = new Date(n * 1000);
        if (Number.isNaN(date.getTime())) return "";
        return date.toISOString().replace(".000Z", " UTC").replace("T", " ");
    }

    function formatRemain(seconds) {
        const left = Math.max(0, Math.floor(Number(seconds) || 0));
        const days = Math.floor(left / 86400);
        const hours = Math.floor((left % 86400) / 3600);
        const mins = Math.floor((left % 3600) / 60);
        const secs = left % 60;
        if (days > 0) return `${days}d ${hours}h ${mins}m`;
        if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
        return `${mins}m ${String(secs).padStart(2, "0")}s`;
    }

    function explainError(err) {
        const raw = String(err?.message || err || "");
        const code = Number(err?.code);
        if (code === 4001 || /user rejected|user denied|rejected the request/i.test(raw)) {
            return "The wallet closed the request.";
        }
        if (code === 4902) return "Add Avalanche in the wallet, then try again.";
        if (/insufficient funds/i.test(raw)) return "The wallet does not have enough AVAX for this.";
        if (err?.code === "low" || /below the minimum|BadPrice/i.test(raw)) {
            return "That offer is below the minimum.";
        }
        if (err?.code === "ended" || /BadTime|auction has ended/i.test(raw)) {
            return "This auction has ended.";
        }
        if (/PausedSale|sales are paused/i.test(raw)) return "Sales are paused for the moment.";
        if (/BadState/i.test(raw)) return "This work is no longer available.";
        if (/Enter an amount/i.test(raw)) return raw;
        if (/wallet browser|did not share/i.test(raw)) return raw;
        if (/network did not answer/i.test(raw)) return "The network did not answer. Try again in a moment.";
        return "The wallet did not finish. Nothing was taken.";
    }

    function txUrl(chain, hash) {
        if (!hash) return "";
        if (Number(chain?.chainId) === 43114) return `https://snowtrace.io/tx/${hash}`;
        if (Number(chain?.chainId) === 8453) return `https://basescan.org/tx/${hash}`;
        return "";
    }

    function decodeString(hex) {
        const body = String(hex || "").replace(/^0x/, "");
        if (body.length < 128) return "";
        try {
            const offset = Number(BigInt("0x" + body.slice(0, 64))) * 2;
            const len = Number(BigInt("0x" + body.slice(offset, offset + 64)));
            if (!len || offset + 64 + len * 2 > body.length) return "";
            const data = body.slice(offset + 64, offset + 64 + len * 2);
            let out = "";
            for (let i = 0; i < data.length; i += 2) {
                out += String.fromCharCode(parseInt(data.slice(i, i + 2), 16));
            }
            return out;
        } catch {
            return "";
        }
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
            hardEnd: Number(w[7]),
            price: w[8],
            reservePrice: w[9],
            bid: w[10],
            bidder: addressOf(w[11]),
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
            bidder: addressOf(w[2]),
            tokenId: w[3],
            qty: w[4],
        };
    }

    function viewImage(url) {
        const raw = String(url || "").trim();
        if (!raw) return "";
        return raw.replace(/\.thumb\.webp(?=($|\?))/, ".view.webp");
    }

    function emptyCopy(kind, chainName) {
        if (chainName === "Base") {
            return {
                title: "On Avalanche for now",
                text: "These offers are on Avalanche for now. The same desk opens here later.",
            };
        }
        if (kind === "auctions") {
            return {
                title: "No auction is open",
                text: "When a work is offered, you place a bid from your wallet. The highest bid at the close takes it.",
            };
        }
        if (kind === "editions") {
            return {
                title: "No edition is open",
                text: "A small run of one work, from ten copies to a thousand, will be offered here.",
            };
        }
        return {
            title: "Nothing at a set price",
            text: "New work from the studio appears here. One work, one price, paid in AVAX.",
        };
    }

    function marksHtml(marks) {
        const order = [
            ["os", "OS"],
            ["shop", "SHOP"],
            ["atelier", "ATELIER"],
        ];
        const have = new Set(marks || ["atelier"]);
        if (!have.has("atelier")) have.add("atelier");
        const html = order
            .filter(([key]) => have.has(key))
            .map(([key, label]) => `<span class="nft-card__mark nft-card__mark--${key}">${label}</span>`)
            .join("");
        return `<div class="atelier-card__marks" aria-hidden="true">${html}</div>`;
    }

    function priceHtml(label, usd) {
        const extra = usd ? `<span class="atelier-card__usd">${escapeHtml(usd)}</span>` : "";
        return `<p class="atelier-card__price"><span>${escapeHtml(label)}</span>${extra}</p>`;
    }

    function auctionBlock(view, symbol) {
        const a = view.auction;
        if (!a) return "";
        const rows = [];
        if (view.state === "live" || view.state === "ended") {
            rows.push(
                `<p class="atelier-card__line"><span>Time left</span> <strong data-countdown data-end="${a.endTime || 0}">${escapeHtml(
                    a.endTime && a.endTime * 1000 > Date.now() ? formatRemain(a.endTime - Date.now() / 1000) : "Ended"
                )}</strong></p>`
            );
        }
        rows.push(
            `<p class="atelier-card__line"><span>Highest bid</span> <strong>${escapeHtml(
                a.highLabel || "No bids yet"
            )}${a.highBy ? ` · ${escapeHtml(a.highBy)}` : ""}</strong></p>`
        );
        if (view.state === "live") {
            rows.push(
                `<p class="atelier-card__line"><span>Next bid at least</span> <strong>${escapeHtml(a.nextLabel)}</strong></p>`
            );
            if (a.incrementLabel) {
                rows.push(`<p class="atelier-card__quiet">${escapeHtml(a.incrementLabel)}</p>`);
            }
        }
        rows.push(
            `<p class="atelier-card__line"><span>Reserve</span> <strong>${escapeHtml(a.reserveLabel)}</strong></p>`
        );
        if (a.extensionLabel) rows.push(`<p class="atelier-card__quiet">${escapeHtml(a.extensionLabel)}</p>`);
        if (view.state === "ended") {
            rows.push(`<p class="atelier-card__quiet">${escapeHtml(a.after)}</p>`);
        }
        const history = [...(a.bids || [])]
            .reverse()
            .map(
                (bid) =>
                    `<li><span>${escapeHtml(bid.who)}</span> <span>${escapeHtml(bid.amount)}</span></li>`
            )
            .join("");
        const list = history
            ? `<ol class="atelier-bids">${history}</ol>`
            : `<p class="atelier-card__quiet">No bids yet.</p>`;
        return `${rows.join("")}<h4 class="atelier-card__sub">Bids</h4>${list}`;
    }

    function editionBlock(view) {
        const ed = view.edition;
        if (!ed) return "";
        const width = Math.max(0, Math.min(100, ed.pct));
        return `
            <div class="atelier-meter" role="meter" aria-valuemin="0" aria-valuemax="${ed.supply}" aria-valuenow="${ed.sold}" aria-label="${ed.sold} of ${ed.supply} sold">
                <span style="width:${width}%"></span>
            </div>
            <p class="atelier-card__line"><span>Sold</span> <strong>${ed.sold} of ${ed.supply}</strong></p>
            <p class="atelier-card__line"><span>This copy</span> <strong>${escapeHtml(ed.nowLabel)}</strong></p>
            ${
                ed.nextLabel
                    ? `<p class="atelier-card__line"><span>Next copy</span> <strong>${escapeHtml(ed.nextLabel)}</strong></p>`
                    : ""
            }
            ${
                ed.capLabel
                    ? `<p class="atelier-card__quiet">The price rises no higher than ${escapeHtml(ed.capLabel)}.</p>`
                    : ""
            }`;
    }

    function actionHtml(view, symbol) {
        if (view.paused && view.action !== "none") {
            return `<p class="atelier-card__note">Sales are paused for the moment.</p>`;
        }
        if (view.action === "buy" && view.edition && view.edition.left > 1) {
            return `<div class="atelier-card__field">
                <label class="atelier-card__label" for="qty-${escapeHtml(view.key)}">Copies</label>
                <input id="qty-${escapeHtml(view.key)}" class="atelier-card__input" data-qty type="number" min="1" max="${view.edition.left}" value="1" inputmode="numeric">
                <button type="submit" class="btn btn--primary btn--small" data-atelier-action="buy">Buy</button>
            </div>
            <p class="atelier-card__pay" data-pay></p>
            <p class="atelier-card__note" role="status"></p>`;
        }
        if (view.action === "buy") {
            return `<div class="atelier-card__field">
                <button type="submit" class="btn btn--primary btn--small" data-atelier-action="buy">Buy</button>
            </div>
            <p class="atelier-card__note" role="status"></p>`;
        }
        if (view.action === "bid") {
            return `<div class="atelier-card__field">
                <label class="atelier-card__label" for="bid-${escapeHtml(view.key)}">Your bid in ${escapeHtml(symbol)}</label>
                <input id="bid-${escapeHtml(view.key)}" class="atelier-card__input" data-bid inputmode="decimal" placeholder="${escapeHtml(symbol)}" autocomplete="off">
                <button type="submit" class="btn btn--primary btn--small" data-atelier-action="bid">Place bid</button>
            </div>
            <p class="atelier-card__note" role="status"></p>`;
        }
        if (view.action === "settle") {
            return `<div class="atelier-card__field">
                <button type="submit" class="btn btn--primary btn--small" data-atelier-action="settle">Settle</button>
            </div>
            <p class="atelier-card__note" role="status"></p>`;
        }
        return "";
    }

    function cardHtml(view, symbol) {
        const titleId = `atelier-title-${view.key}`;
        const img = view.image
            ? `<img src="${escapeHtml(view.image)}" alt="${escapeHtml(view.title)}" width="1200" height="1200" decoding="async" loading="${view.eager ? "eager" : "lazy"}">`
            : "";
        const collection = [view.collection, view.chainName || "Avalanche"].filter(Boolean).join(" · ");
        return `<article class="atelier-card" data-state="${escapeHtml(view.state)}" data-key="${escapeHtml(view.key)}" aria-labelledby="${titleId}">
            <figure class="atelier-card__frame${view.image ? "" : " is-quiet"}">
                ${img}
                <figcaption class="atelier-state atelier-state--${escapeHtml(view.state)}">${escapeHtml(STATE_LABEL[view.state] || "")}</figcaption>
                ${marksHtml(view.marks)}
            </figure>
            <div class="atelier-card__body">
                <h3 id="${titleId}" class="atelier-card__title">${escapeHtml(view.title)}</h3>
                <p class="atelier-card__meta">${escapeHtml(collection)}</p>
                ${priceHtml(view.priceLabel, view.usdLabel)}
                ${auctionBlock(view, symbol)}
                ${editionBlock(view)}
                <form class="atelier-card__form" data-key="${escapeHtml(view.key)}">
                    ${actionHtml(view, symbol)}
                </form>
            </div>
        </article>`;
    }

    function boardHtml(views, opts = {}) {
        const symbol = opts.symbol || "AVAX";
        const cards = (views || [])
            .map((view, index) => cardHtml({ ...view, eager: index < 2 }, symbol))
            .join("");
        const banner = opts.preview
            ? `<p class="atelier-preview-banner">Preview. Nothing here is for sale, and no wallet is asked to pay.</p>`
            : "";
        const paused = opts.paused
            ? `<p class="atelier-sale__status">Sales are paused for the moment.</p>`
            : "";
        return `${banner}${paused}<div class="atelier-board">${cards}</div>
            <dialog class="atelier-sheet" aria-labelledby="atelier-sheet-title">
                <h2 id="atelier-sheet-title" class="atelier-sheet__title">Review</h2>
                <p class="atelier-sheet__lead" data-sheet-lead></p>
                <dl class="atelier-sheet__facts" data-sheet-facts></dl>
                <p class="atelier-sheet__status" data-sheet-status role="status"></p>
                <div class="atelier-sheet__actions">
                    <button type="button" class="btn btn--primary btn--small" data-sheet-confirm>Confirm in wallet</button>
                    <button type="button" class="btn btn--ghost btn--small" data-sheet-back>Back</button>
                </div>
            </dialog>`;
    }

    function emptyHtml(kind, chainName) {
        const copy = emptyCopy(kind, chainName);
        return `<article class="atelier-empty">
            <h3>${escapeHtml(copy.title)}</h3>
            <p>${escapeHtml(copy.text)}</p>
        </article>`;
    }

    function extensionLabel(secs) {
        const n = Number(secs || 0);
        if (!n) return "";
        const mins = Math.max(1, Math.round(n / 60));
        return `A bid in the final ${mins} minutes extends the end by the same amount.`;
    }

    function viewFromPiece(chain, id, piece, extras) {
        const now = extras.now;
        const symbol = chain.nativeSymbol || "AVAX";
        const auction = piece.kind === 2;
        const rate = extras.rate;
        if (!piece.listed && !piece.sold) {
            if (!(auction && piece.endTime && now >= piece.endTime)) return null;
        }
        let state = "available";
        if (piece.sold) state = "sold";
        else if (auction && now >= piece.endTime) state = "ended";
        else if (!auction && piece.endTime && now > piece.endTime) state = "ended";
        else if (auction && now >= (piece.startTime || 0)) state = "live";
        const min = piece.bid === 0n ? piece.price : nextBid(piece.bid, piece.incrementBps);
        const show = auction ? (piece.bid > 0n ? piece.bid : piece.price) : piece.price;
        const bidder = shortAddress(piece.bidder);
        const won =
            auction &&
            piece.bid > 0n &&
            (piece.reservePrice === 0n || piece.bid >= piece.reservePrice);
        let action = "none";
        if (!extras.paused && piece.listed && !piece.sold) {
            if (state === "live") action = "bid";
            else if (state === "available") action = "buy";
            else if (state === "ended" && auction) action = "settle";
        }
        const bids = (extras.bids || []).map((bid) => ({
            who: shortAddress(bid.who) || "A wallet",
            amount: formatNative(bid.amount, symbol),
        }));
        return {
            key: `${extras.prefix || "one"}-${id}`,
            id: id.toString(),
            to: extras.to || "",
            title: extras.title || (auction ? `Auction ${id}` : `Piece ${id}`),
            collection: extras.collection || "",
            chainName: chain.name || "Avalanche",
            image: extras.image || "",
            marks: extras.marks || ["atelier"],
            state,
            priceLabel: formatNative(show, symbol),
            usdLabel: usdLabel(show, rate),
            paused: Boolean(extras.paused),
            action,
            payWei: piece.price,
            minWei: min,
            kind: auction ? "auction" : "fixed",
            auction: auction
                ? {
                      endTime: piece.endTime || 0,
                      highLabel: piece.bid > 0n ? formatNative(piece.bid, symbol) : "",
                      highBy: bidder,
                      nextLabel: formatNative(min, symbol),
                      incrementLabel: piece.bid > 0n ? bpsLabel(piece.incrementBps) : "Opening bid",
                      reserveLabel: reserveLabel(piece.reservePrice, piece.bid),
                      extensionLabel: extensionLabel(piece.extensionSecs),
                      bids,
                      after: won
                          ? `Highest bid is with ${bidder || "the winner"}. Settle sends the work.`
                          : "The reserve was not met. Settling returns the bid.",
                  }
                : null,
            edition: null,
        };
    }

    function viewFromRun(chain, id, run, extras) {
        if (!run.listed && run.sold === 0) return null;
        const symbol = chain.nativeSymbol || "AVAX";
        const left = Math.max(0, run.supply - run.sold);
        const step = run.curve === 2;
        const nowPrice = step ? unitPrice(run, run.sold) : run.price;
        const next = step && left > 1 ? unitPrice(run, run.sold + 1) : 0n;
        const soldOut = left === 0 || !run.listed;
        return {
            key: `edition-${id}`,
            id: id.toString(),
            title: extras.title || `Edition ${id}`,
            collection: extras.collection || "Atelier",
            chainName: chain.name || "Avalanche",
            image: extras.image || "",
            marks: extras.marks || ["atelier"],
            state: soldOut ? "sold" : "available",
            priceLabel: formatNative(nowPrice, symbol),
            usdLabel: usdLabel(nowPrice, extras.rate),
            paused: Boolean(extras.paused),
            action: soldOut || extras.paused ? "none" : "buy",
            kind: "edition",
            run,
            edition: {
                sold: run.sold,
                supply: run.supply,
                left,
                pct: run.supply ? Math.round((run.sold / run.supply) * 100) : 0,
                nowLabel: formatNative(nowPrice, symbol),
                nextLabel: next > 0n ? formatNative(next, symbol) : "",
                capLabel: step && run.cap > 0n ? formatNative(run.cap, symbol) : "",
            },
        };
    }

    function weiFromDecimal(text) {
        return nativeToWei(String(text));
    }

    function viewsFromPreview(doc, nowSeconds, symbol) {
        const now = nowSeconds || Math.floor(Date.now() / 1000);
        const out = [];
        for (const item of doc || []) {
            const price = item.price ? weiFromDecimal(item.price) : 0n;
            const bid = item.bid ? weiFromDecimal(item.bid) : 0n;
            const reserve = item.reserve ? weiFromDecimal(item.reserve) : 0n;
            const endTime = now + Number(item.countdownIn || 0);
            if (item.kind === "edition") {
                const run = {
                    curve: item.curve === "step" ? 2 : 1,
                    listed: item.state !== "sold",
                    supply: Number(item.supply || 0),
                    sold: Number(item.sold || 0),
                    price,
                    step: item.step ? weiFromDecimal(item.step) : 0n,
                    cap: item.cap ? weiFromDecimal(item.cap) : 0n,
                };
                const view = viewFromRun(
                    { nativeSymbol: symbol || "AVAX", name: "Avalanche" },
                    item.key,
                    run,
                    {
                        title: item.title,
                        collection: item.collection,
                        image: item.image,
                        marks: item.marks,
                    }
                );
                if (view) {
                    view.key = item.key;
                    out.push(view);
                }
                continue;
            }
            const piece = {
                kind: item.state === "live" || item.state === "ended" ? 2 : item.bid ? 2 : 1,
                sold: item.state === "sold",
                listed: item.state !== "sold",
                incrementBps: Number(item.incrementBps || 0),
                extensionSecs: Number(item.extensionSecs || 0),
                startTime: 0,
                endTime: item.state === "available" || item.state === "sold" ? 0 : endTime,
                price,
                reservePrice: reserve,
                bid,
                bidder: item.bidder || "",
            };
            if (item.state === "ended") {
                piece.kind = 2;
                piece.listed = true;
                piece.sold = false;
                piece.endTime = endTime;
            }
            if (item.state === "live") {
                piece.kind = 2;
                piece.listed = true;
            }
            const view = viewFromPiece(
                { nativeSymbol: symbol || "AVAX", name: "Avalanche" },
                item.key,
                piece,
                {
                    title: item.title,
                    collection: item.collection,
                    image: viewImage(item.image),
                    marks: item.marks,
                    now,
                    bids: (item.bids || []).map((row) => ({
                        who: row.who,
                        amount: weiFromDecimal(row.amount),
                    })),
                }
            );
            if (!view) continue;
            view.key = item.key;
            if (item.action) view.action = item.action;
            if (item.state === "sold") view.action = "none";
            out.push(view);
        }
        return out;
    }

    function tick(root) {
        const now = Date.now();
        root.querySelectorAll("[data-countdown]").forEach((el) => {
            const end = Number(el.dataset.end || 0) * 1000;
            el.textContent = !end || end <= now ? "Ended" : formatRemain((end - now) / 1000);
        });
    }

    function bindImages(root) {
        root.querySelectorAll(".atelier-card__frame img").forEach((img) => {
            img.addEventListener("error", () => {
                img.hidden = true;
                img.closest(".atelier-card__frame")?.classList.add("is-quiet");
            });
        });
    }

    function paintPay(form, view, symbol) {
        const slot = form.querySelector("[data-pay]");
        if (!slot || !view?.edition) return;
        const qty = Number(form.querySelector("[data-qty]")?.value || "1");
        if (!Number.isInteger(qty) || qty < 1) {
            slot.textContent = "";
            return;
        }
        try {
            const cost = quoteEdition(view.run, qty);
            slot.textContent = `You pay ${formatNative(cost, symbol)} for ${qty}.`;
        } catch {
            slot.textContent = "";
        }
    }

    async function switchChain(chain) {
        if (previewOn()) return;
        if (!window.ethereum) throw new Error("Open this page in a wallet browser to buy or bid.");
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
                            chainName: chain.name || "Avalanche",
                            nativeCurrency: {
                                name: chain.nativeSymbol || "AVAX",
                                symbol: chain.nativeSymbol || "AVAX",
                                decimals: 18,
                            },
                            rpcUrls: [chain.rpc],
                            blockExplorerUrls: ["https://snowtrace.io"],
                        },
                    ],
                });
            } else {
                throw err;
            }
        }
    }

    async function connect(chainKey) {
        const cfg = await load();
        const chain = cfg.chains?.[chainKey] || cfg.chains?.avalanche;
        if (!chain) throw new Error("The network did not answer.");
        if (previewOn()) return "0x0000000000000000000000000000000000000001";
        if (!window.ethereum) throw new Error("Open this page in a wallet browser to buy or bid.");
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const from = accounts && accounts[0];
        if (!from) throw new Error("The wallet did not share an account.");
        await switchChain(chain);
        return from;
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

    function sheetFacts(pairs) {
        return pairs
            .map(
                ([term, detail]) =>
                    `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(detail)}</dd></div>`
            )
            .join("");
    }

    function openSheet(root, plan) {
        const dialog = root.querySelector(".atelier-sheet");
        if (!dialog) return Promise.resolve(false);
        dialog.querySelector("[data-sheet-lead]").textContent = plan.lead;
        dialog.querySelector("[data-sheet-facts]").innerHTML = sheetFacts(plan.facts);
        const status = dialog.querySelector("[data-sheet-status]");
        status.textContent = "";
        const confirmBtn = dialog.querySelector("[data-sheet-confirm]");
        const backBtn = dialog.querySelector("[data-sheet-back]");
        confirmBtn.disabled = false;
        confirmBtn.textContent = previewOn() ? "Confirm preview" : "Confirm in wallet";
        if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
        confirmBtn.focus();
        return new Promise((resolve) => {
            const finish = (ok) => {
                confirmBtn.removeEventListener("click", onYes);
                backBtn.removeEventListener("click", onNo);
                dialog.removeEventListener("cancel", onNo);
                if (dialog.open) dialog.close();
                resolve(ok);
            };
            const onYes = () => finish(true);
            const onNo = (event) => {
                event?.preventDefault?.();
                finish(false);
            };
            confirmBtn.addEventListener("click", onYes);
            backBtn.addEventListener("click", onNo);
            dialog.addEventListener("cancel", onNo);
        });
    }

    async function waitReceipt(chain, hash) {
        for (let i = 0; i < 12; i += 1) {
            const receipt = await rpc(chain.rpc, "eth_getTransactionReceipt", [hash]).catch(() => null);
            if (receipt) return receipt;
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        return null;
    }

    function noteHtml(note, text, link) {
        if (!note) return;
        note.textContent = text;
        if (link) {
            const a = document.createElement("a");
            a.href = link;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = "View on Snowtrace";
            note.appendChild(document.createTextNode(" "));
            note.appendChild(a);
        }
    }

    async function onAction(root, form) {
        const ctx = contexts.get(root);
        if (!ctx) return;
        const key = form.dataset.key;
        const view = ctx.views.get(key);
        if (!view) return;
        const note = form.querySelector(".atelier-card__note");
        const btn = form.querySelector("[data-atelier-action]");
        const say = (text, link) => noteHtml(note, text, link);
        const action = btn?.dataset.atelierAction;
        const symbol = ctx.chain.nativeSymbol || "AVAX";
        try {
            let value = 0n;
            let data = "0x";
            let lead = "";
            let facts = [];
            if (action === "bid") {
                const wei = parseNative(form.querySelector("[data-bid]")?.value);
                if (view.minWei != null && wei < BigInt(view.minWei)) {
                    const error = new Error("below");
                    error.code = "low";
                    throw error;
                }
                if (view.auction?.endTime && Math.floor(Date.now() / 1000) >= view.auction.endTime) {
                    const error = new Error("ended");
                    error.code = "ended";
                    throw error;
                }
                value = wei;
                if (!previewOn()) data = callData(ctx.cfg, "bid(uint256)", [view.id]);
                lead = "Your offer becomes the highest bid. A later bid returns this amount to your wallet.";
                facts = [
                    ["You offer", formatNative(wei, symbol)],
                    ["Network", "Avalanche"],
                    ["Work", view.title],
                ];
            } else if (action === "settle") {
                if (!previewOn()) data = callData(ctx.cfg, "settle(uint256)", [view.id]);
                lead = view.auction?.after || "This closes the auction.";
                facts = [
                    ["Network", "Avalanche"],
                    ["Work", view.title],
                    ["You pay", `0 ${symbol}`],
                ];
            } else if (view.kind === "edition") {
                const qty = Number(form.querySelector("[data-qty]")?.value || "1");
                if (!Number.isInteger(qty) || qty < 1 || (view.edition && qty > view.edition.left)) {
                    say("Enter a whole number of copies.");
                    return;
                }
                value = view.run ? quoteEdition(view.run, qty) : 0n;
                if (!previewOn() && ctx.chain.rpc) {
                    value = BigInt(
                        await ethCall(
                            ctx.chain.rpc,
                            view.to || ctx.address,
                            callData(ctx.cfg, "quote(uint256,uint32)", [view.id, qty])
                        )
                    );
                }
                if (!previewOn()) data = callData(ctx.cfg, "buy(uint256,uint32)", [view.id, qty]);
                lead = "The copies are sent to the wallet you confirm with.";
                facts = [
                    ["Copies", String(qty)],
                    ["You pay", formatNative(value, symbol)],
                    ["Network", "Avalanche"],
                ];
            } else {
                value = BigInt(view.payWei || 0);
                if (!previewOn()) data = callData(ctx.cfg, "buy(uint256)", [view.id]);
                lead = "The work is sent to the wallet you confirm with.";
                facts = [
                    ["You pay", formatNative(value, symbol)],
                    ["Network", "Avalanche"],
                    ["Work", view.title],
                ];
            }
            facts.push(["Wallet", "Avalanche C-Chain"]);
            const ok = await openSheet(root, { lead, facts });
            if (!ok) return;
            if (btn) btn.disabled = true;
            say("Waiting for the wallet…");
            if (previewOn()) {
                say("Pending on Avalanche…");
                await new Promise((resolve) => setTimeout(resolve, 700));
                if (previewFails()) {
                    say("The transaction did not go through. Nothing was taken.");
                    return;
                }
                const hash = "0x" + "ab".repeat(32);
                say("Confirmed. Preview only — nothing was sent.", txUrl(ctx.chain, hash));
                return;
            }
            const hash = await send(ctx.chain, view.to || ctx.address, data, hexQuantity(value));
            say("Pending on Avalanche…", txUrl(ctx.chain, hash));
            const receipt = await waitReceipt(ctx.chain, hash);
            if (receipt && BigInt(receipt.status || "0x1") === 0n) {
                say("The transaction did not go through. Nothing was taken.", txUrl(ctx.chain, hash));
                return;
            }
            say(receipt ? "Confirmed." : "Submitted. It can take a moment to appear.", txUrl(ctx.chain, hash));
        } catch (err) {
            say(explainError(err));
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function ensureBound(root) {
        if (root.dataset.bound === "1") return;
        root.dataset.bound = "1";
        root.addEventListener("submit", (event) => {
            const form = event.target.closest(".atelier-card__form");
            if (!form || !root.contains(form)) return;
            event.preventDefault();
            onAction(root, form);
        });
        root.addEventListener("input", (event) => {
            const form = event.target.closest?.(".atelier-card__form");
            if (!form) return;
            const ctx = contexts.get(root);
            const view = ctx?.views.get(form.dataset.key);
            const note = form.querySelector(".atelier-card__note");
            if (note && event.target.matches?.("[data-bid], [data-qty]")) note.textContent = "";
            if (view?.edition) paintPay(form, view, ctx.chain.nativeSymbol || "AVAX");
        });
    }

    function show(root, html, ctx) {
        if (root._atelierTimer) clearInterval(root._atelierTimer);
        root.innerHTML = html;
        contexts.set(root, ctx);
        ensureBound(root);
        bindImages(root);
        root.querySelectorAll(".atelier-card__form").forEach((form) => {
            const view = ctx.views.get(form.dataset.key);
            if (view?.edition) paintPay(form, view, ctx.chain.nativeSymbol || "AVAX");
        });
        tick(root);
        root._atelierTimer = setInterval(() => tick(root), 1000);
        if (typeof ctx.onCount === "function") ctx.onCount(ctx.views.size);
    }

    async function loadDesk() {
        try {
            const res = await fetch("data/atelier_desk.json", { cache: "no-store" });
            if (!res.ok) return [];
            const doc = await res.json();
            return Array.isArray(doc.items) ? doc.items : [];
        } catch {
            return [];
        }
    }

    function matchDesk(items, hint) {
        return (items || []).find((item) => {
            if (hint.saleId != null && item.sale_id != null && String(item.sale_id) === String(hint.saleId)) {
                return true;
            }
            if (item.token_id == null || String(item.token_id) !== String(hint.tokenId)) return false;
            if (item.contract && hint.collection) {
                return String(item.contract).toLowerCase() === String(hint.collection).toLowerCase();
            }
            return true;
        });
    }

    function deskImage(item) {
        if (!item) return "";
        if (item.image_url) return viewImage(item.image_url);
        if (item.collection_id && item.token_id != null) {
            return `https://jackbeatnic.art/jbg-present/${item.collection_id}/${item.token_id}.view.webp`;
        }
        return "";
    }

    async function metaFromUri(uri) {
        const clean = String(uri || "").trim();
        if (!clean) return {};
        if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(clean)) return { image: viewImage(clean) };
        if (!/^https?:\/\//i.test(clean)) return {};
        try {
            const res = await fetch(clean);
            if (!res.ok) return {};
            const json = await res.json();
            return {
                title: json.name || "",
                image: viewImage(json.image || ""),
            };
        } catch {
            return {};
        }
    }

    async function bidLogs(chain, address) {
        try {
            const latest = BigInt(await rpc(chain.rpc, "eth_blockNumber", []));
            const span = 2_000_000n;
            const from = latest > span ? latest - span : 0n;
            const logs = await rpc(chain.rpc, "eth_getLogs", [
                {
                    address,
                    topics: [BID_TOPIC],
                    fromBlock: "0x" + from.toString(16),
                    toBlock: "latest",
                },
            ]);
            const grouped = new Map();
            for (const log of logs || []) {
                const id = BigInt(log.topics?.[1] || "0x0").toString();
                const who = addressOf(log.topics?.[2] || "0x0");
                const amount = BigInt(log.data || "0x0");
                if (!grouped.has(id)) grouped.set(id, []);
                grouped.get(id).push({ who, amount });
            }
            return grouped;
        } catch {
            return new Map();
        }
    }

    async function renderOnes(cfg, chain, address, kind, desk, rate) {
        const paused = BigInt(await ethCall(chain.rpc, address, callData(cfg, "paused()")).catch(() => "0x0")) !== 0n;
        const count = Number(BigInt(await ethCall(chain.rpc, address, callData(cfg, "saleCount()"))));
        const logs = await bidLogs(chain, address);
        const views = [];
        const limit = Math.min(count, MAX_LISTINGS);
        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < limit; i += 1) {
            const id = BigInt(await ethCall(chain.rpc, address, callData(cfg, "saleIdAt(uint256)", [i])));
            const piece = decodePiece(await ethCall(chain.rpc, address, callData(cfg, "pieces(uint256)", [id])));
            if (kind === "fixed" && piece.kind !== 1) continue;
            if (kind === "auctions" && piece.kind !== 2) continue;
            const uri = decodeString(
                await ethCall(chain.rpc, address, callData(cfg, "tokenURI(uint256)", [id])).catch(() => "0x")
            );
            const meta = await metaFromUri(uri);
            const item = matchDesk(desk, { saleId: id, tokenId: id });
            const view = viewFromPiece(chain, id, piece, {
                now,
                paused,
                rate,
                to: address,
                title: item?.name || meta.title,
                collection: item?.collection_name || "",
                image: deskImage(item) || meta.image,
                marks: ["atelier"],
                bids: logs.get(id.toString()) || [],
                prefix: "one",
            });
            if (view) views.push(view);
        }
        return { views, paused };
    }

    async function renderEditions(cfg, chain, address, desk, rate) {
        const paused = BigInt(await ethCall(chain.rpc, address, callData(cfg, "paused()")).catch(() => "0x0")) !== 0n;
        const count = Number(BigInt(await ethCall(chain.rpc, address, callData(cfg, "runCount()"))));
        const views = [];
        const limit = Math.min(count, MAX_LISTINGS);
        for (let i = 0; i < limit; i += 1) {
            const id = BigInt(await ethCall(chain.rpc, address, callData(cfg, "runIdAt(uint256)", [i])));
            const run = decodeRun(await ethCall(chain.rpc, address, callData(cfg, "runs(uint256)", [id])));
            const uri = decodeString(
                await ethCall(chain.rpc, address, callData(cfg, "uri(uint256)", [id])).catch(() => "0x")
            );
            const meta = await metaFromUri(uri);
            const item = matchDesk(desk, { saleId: id, tokenId: id });
            const view = viewFromRun(chain, id, run, {
                paused,
                rate,
                title: item?.name || meta.title,
                collection: item?.collection_name || "Atelier",
                image: deskImage(item) || meta.image,
            });
            if (view) views.push(view);
        }
        return { views, paused };
    }

    async function renderVault(cfg, chain, address, kind, desk, rate) {
        const paused = BigInt(await ethCall(chain.rpc, address, callData(cfg, "paused()")).catch(() => "0x0")) !== 0n;
        const count = Number(BigInt(await ethCall(chain.rpc, address, callData(cfg, "lotCount()"))));
        const logs = kind === "auctions" ? await bidLogs(chain, address) : new Map();
        const views = [];
        const limit = Math.min(count, MAX_LISTINGS);
        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < limit; i += 1) {
            const id = BigInt(await ethCall(chain.rpc, address, callData(cfg, "lotIdAt(uint256)", [i])));
            const sale = decodeLotSale(await ethCall(chain.rpc, address, callData(cfg, "lotSale(uint256)", [id])));
            if (kind === "fixed" && sale.kind !== 1) continue;
            if (kind === "auctions" && sale.kind !== 2) continue;
            const asset = decodeLotAsset(await ethCall(chain.rpc, address, callData(cfg, "lotAsset(uint256)", [id])));
            const item = matchDesk(desk, { saleId: id, tokenId: asset.tokenId, collection: asset.collection });
            const piece = {
                kind: sale.kind,
                sold: sale.sold,
                listed: sale.listed,
                incrementBps: sale.incrementBps,
                extensionSecs: sale.extensionSecs,
                startTime: sale.startTime,
                endTime: sale.endTime,
                price: sale.price,
                reservePrice: sale.reservePrice,
                bid: sale.bid,
                bidder: asset.bidder,
            };
            const view = viewFromPiece(chain, id, piece, {
                now,
                paused,
                rate,
                to: address,
                title: item?.name || `Piece ${asset.tokenId}`,
                collection: item?.collection_name || "From an existing work",
                image: deskImage(item),
                bids: logs.get(id.toString()) || [],
                prefix: "vault",
            });
            if (view) views.push(view);
        }
        return { views, paused };
    }

    async function mount(el, { chain, kind, onCount } = {}) {
        if (!el) return;
        const gen = String(Date.now()) + Math.random().toString(16).slice(2);
        el.dataset.gen = gen;
        const still = () => el.dataset.gen === gen;
        el.innerHTML = `<p class="atelier-sale__status">Looking for works…</p>`;
        try {
            const cfg = await load();
            if (!still()) return;
            const chainCfg = cfg.chains?.[chain] || { name: chain === "base" ? "Base" : "Avalanche" };
            const chainName = chainCfg.name || "Avalanche";
            const symbol = chainCfg.nativeSymbol || "AVAX";
            const rate = Number(cfg.avaxUsd || cfg.avax_usd || 0) || 0;
            if (previewOn()) {
                const res = await fetch("data/atelier_preview.json", { cache: "no-store" });
                const doc = res.ok ? await res.json() : { rooms: {} };
                const room = kind === "editions" ? "editions" : kind === "fixed" ? "fixed" : "auctions";
                const views = viewsFromPreview(doc.rooms?.[room] || [], Math.floor(Date.now() / 1000), symbol);
                if (!still()) return;
                const map = new Map(views.map((view) => [view.key, view]));
                show(el, views.length ? boardHtml(views, { symbol, preview: true }) : emptyHtml(kind, chainName), {
                    cfg,
                    chain: chainCfg,
                    address: "",
                    kind,
                    views: map,
                    onCount,
                });
                return;
            }
            if (chain === "base" || !chainCfg.rpc) {
                el.innerHTML = emptyHtml(kind, chainName);
                if (onCount) onCount(0);
                return;
            }
            const desk = await loadDesk();
            if (kind === "editions") {
                if (!isAddress(chainCfg.edition)) {
                    el.innerHTML = emptyHtml(kind, chainName);
                    if (onCount) onCount(0);
                    return;
                }
                const built = await renderEditions(cfg, chainCfg, chainCfg.edition, desk, rate);
                if (!still()) return;
                const map = new Map(built.views.map((view) => [view.key, view]));
                show(
                    el,
                    built.views.length
                        ? boardHtml(built.views, { symbol, paused: built.paused })
                        : emptyHtml(kind, chainName),
                    { cfg, chain: chainCfg, address: chainCfg.edition, kind, views: map, onCount }
                );
                return;
            }
            const parts = [];
            let paused = false;
            if (isAddress(chainCfg.one)) {
                const one = await renderOnes(cfg, chainCfg, chainCfg.one, kind, desk, rate);
                parts.push(...one.views);
                paused = paused || one.paused;
            }
            if (isAddress(chainCfg.vault)) {
                const vault = await renderVault(cfg, chainCfg, chainCfg.vault, kind, desk, rate);
                parts.push(...vault.views);
                paused = paused || vault.paused;
            }
            if (!still()) return;
            if (!parts.length) {
                el.innerHTML = emptyHtml(kind, chainName);
                if (onCount) onCount(0);
                return;
            }
            const map = new Map(parts.map((view) => [view.key, view]));
            show(el, boardHtml(parts, { symbol, paused }), {
                cfg,
                chain: chainCfg,
                address: chainCfg.one || chainCfg.vault,
                kind,
                views: map,
                onCount,
            });
        } catch {
            if (!still()) return;
            el.innerHTML = `<p class="atelier-sale__status">The works could not be loaded. Try again in a moment.</p>`;
        }
    }

    return {
        load,
        mount,
        connect,
        shortAddress,
        nextBid,
        quoteEdition,
        explainError,
        usdLabel,
        formatNative,
        reserveLabel,
        viewsFromPreview,
        boardHtml,
        decodePiece,
        decodeLotAsset,
    };
})();

globalThis.AtelierSale = AtelierSale;
