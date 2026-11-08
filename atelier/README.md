# Atelier

Atelier is the studio sales desk. Buyers pay the chain's native coin. Proceeds are pulled with `withdraw`. They are not pushed to the studio in the sale transaction.

Do not deploy until Jack confirms. The addresses in `data/atelier.json` stay empty until that deploy. Nothing in this folder broadcasts a transaction by itself.

Avalanche comes first (chain id 43114). The same source is deployed on Base later (chain id 8453). One-of-one sales and edition runs are two contracts, not one.

## AtelierOne

ERC-721-like desk for a single work.

**Fixed price.** The studio lists one price, with an optional start and an optional end. The buyer pays at least that price. Any extra is credited back and collected with `withdraw`. The work then belongs to the buyer.

**Auction.** One auction per work. The studio sets a minimum bid, an optional reserve, and an optional anti-snipe extension. A new bid must clear the minimum, or the current bid plus the increment. The previous bidder is credited the old bid and withdraws it. A bid inside the extension window moves the end forward, up to a hard end one day after the original end. The auction cannot be cancelled once it has a bid.

After the end, anyone may settle. If the high bid meets the reserve (or there is no reserve), the studio is credited the bid and the winner receives the work. If the reserve is missed, the bidder withdraws the bid and the work returns to the studio.

## AtelierEdition

A separate contract from the one-of-one desk. A run is strictly 10 to 1000 copies.

**Fixed.** Every copy costs the same price until the run is sold out.

**Step.** Each sale raises the price of the next copy by a fixed step. An optional cap stops the climb: once the next price would pass the cap, further copies sell at the cap.

The studio can cancel a run only before the first copy sells.

## Pause and payments

`setPaused` blocks buys and bids. It does not block `withdraw`. Sale functions follow checks, effects, then interaction, and they use `nonReentrant`. The buyer or the studio pulls funds. The contract does not send them during the sale.

## Operator

The operator is the studio key, later, on the US VPS. The key stays in the environment. It is never written into git, the page, or a log line.

```sh
cd atelier/operator
npm install
export ATELIER_OPERATOR_KEY="0x..."   # shell only — do not commit this
node atelier.mjs list-fixed --chain avalanche --id 1 --uri ipfs://... --price 1.5
node atelier.mjs list-auction --chain avalanche --id 2 --uri ipfs://... --min 0.5 --reserve 1 --start 1735689600 --end 1735776000 --increment-bps 500 --extension 600
node atelier.mjs list-edition-fixed --chain avalanche --id 1 --supply 25 --price 0.08 --uri ipfs://...
node atelier.mjs list-edition-step --chain avalanche --id 2 --supply 25 --start-price 0.05 --step 0.01 --cap 0.2 --uri ipfs://...
```

The CLI reads addresses from `data/atelier.json`. If `ATELIER_OPERATOR_KEY` is missing, it exits. If the contract address for that chain is empty, it exits and does not send. Prices are native-coin amounts (AVAX on Avalanche, ETH on Base), not wei. `--chain base` is the same command, used only after the Base deploy.

## Check locally

```sh
export PATH="$HOME/.foundry/bin:$PATH"
cd atelier
forge test
```

Serve the site and open `?section=atelier`. Avalanche is the first chain. The sale tabs are Fixed price, Auctions, and Editions. Until an address is set, the desk says it is empty.

The older Manifold catalogue can stay linked under the desk. New sales use these contracts.
