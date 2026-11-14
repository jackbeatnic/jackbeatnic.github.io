import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../../js/atelier-sale.js", import.meta.url), "utf8");
const sandbox = { globalThis: {}, console };
sandbox.globalThis = sandbox;
vm.runInNewContext(code, sandbox);
const sale = sandbox.AtelierSale;

const one = 10n ** 18n;

assert.equal(sale.nextBid(one, 500), one + one / 20n);
assert.equal(sale.quoteEdition({ curve: 2, price: one, step: one / 10n, cap: 0n, sold: 1 }, 2), one + one / 10n + one + one / 5n);
assert.equal(sale.quoteEdition({ curve: 2, price: one, step: one, cap: one, sold: 0 }, 1), one);
assert.equal(sale.usdLabel(one, 0), "");
assert.equal(sale.usdLabel(one, 20), "about $20.00");
assert.equal(sale.reserveLabel(one, one / 2n), "Reserve not met");
assert.equal(sale.reserveLabel(one, one), "Reserve met");
assert.equal(sale.reserveLabel(0, 0), "No reserve");
assert.equal(sale.explainError({ code: 4001 }), "The wallet closed the request.");
assert.equal(sale.explainError({ code: "low" }), "That offer is below the minimum.");
assert.equal(sale.explainError({ code: "ended" }), "This auction has ended.");
assert.equal(sale.explainError({ message: "insufficient funds for gas" }), "The wallet does not have enough AVAX for this.");
assert.match(sale.explainError({ message: "0x08c379a0" }), /Nothing was taken/);

const words = [
    2n,
    0n,
    1n,
    500n,
    300n,
    10n,
    99n,
    200n,
    one,
    2n * one,
    one,
    BigInt("0xA11ce0000000000000000000000000000000b0b1"),
];
const hex = "0x" + words.map((v) => v.toString(16).padStart(64, "0")).join("");
const piece = sale.decodePiece(hex);
assert.equal(piece.kind, 2);
assert.equal(piece.hardEnd, 200);
assert.equal(piece.bid, one);
assert.equal(piece.bidder.toLowerCase(), "0xa11ce0000000000000000000000000000000b0b1");

const assetHex =
    "0x" +
    [
        BigInt("0x1111111111111111111111111111111111111111"),
        BigInt("0x2222222222222222222222222222222222222222"),
        BigInt("0x3333333333333333333333333333333333333333"),
        7n,
        1n,
    ]
        .map((v) => v.toString(16).padStart(64, "0"))
        .join("");
const asset = sale.decodeLotAsset(assetHex);
assert.equal(asset.tokenId, 7n);
assert.equal(asset.bidder.toLowerCase(), "0x3333333333333333333333333333333333333333");

const doc = JSON.parse(readFileSync(new URL("../../data/atelier_preview.json", import.meta.url), "utf8"));
const now = 1_700_000_000;
const live = sale.viewsFromPreview(doc.rooms.auctions, now, "AVAX");
const html = sale.boardHtml(live, { symbol: "AVAX", preview: true });
assert.match(html, /Live auction/);
assert.match(html, /Ended/);
assert.match(html, /Reserve not met/);
assert.match(html, /Reserve met/);
assert.match(html, /Next bid at least/);
assert.match(html, /5% above the current bid/);
assert.match(html, /extends the end/);
assert.match(html, /0xA11c…b0b1/);
assert.match(html, /Settle/);
assert.doesNotMatch(html, /sol-mint|sol-chip|lazy mint/i);

const editions = sale.viewsFromPreview(doc.rooms.editions, now, "AVAX");
const editionHtml = sale.boardHtml(editions, { symbol: "AVAX" });
assert.match(editionHtml, /role="meter"/);
assert.match(editionHtml, /7 of 25/);
assert.match(editionHtml, /Next copy/);
assert.match(editionHtml, /0.2 AVAX/);
assert.match(editionHtml, /Copies/);
assert.match(editionHtml, /view\.webp/);

const fixed = sale.viewsFromPreview(doc.rooms.fixed, now, "AVAX");
const fixedHtml = sale.boardHtml(fixed, { symbol: "AVAX" });
assert.match(fixedHtml, /Available/);
assert.match(fixedHtml, /Sold/);
assert.match(fixedHtml, /nft-card__mark--os/);
assert.match(fixedHtml, /nft-card__mark--shop/);
assert.match(fixedHtml, /nft-card__mark--atelier/);
assert.match(fixedHtml, />Buy</);

console.log("atelier-sale tests ok");
