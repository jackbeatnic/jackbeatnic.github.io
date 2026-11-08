# Atelier

Atelier is the studio sales desk. Buyers pay the chain's native coin. Proceeds are pulled with `withdraw`. They are not pushed to the studio in the sale transaction.

Do not deploy until Jack confirms. The addresses in `data/atelier.json` stay empty until that deploy. Nothing in this folder broadcasts a transaction by itself.

Avalanche comes first (chain id 43114). The same source is deployed on Base later (chain id 8453). One-of-one sales and edition runs are two contracts, not one.

## AtelierOne

ERC-721-like desk for a single work.

**Fixed price.** The studio lists one price, with an optional start and an optional end. The buyer pays at least that price. Any extra is credited back and collected with `withdraw`. The work then belongs to the buyer.

**Auction.** One auction per work. The studio sets a minimum bid, an optional reserve, and an optional anti-snipe extension. A new bid must clear the minimum, or the current bid plus the increment. The previous bidder is credited the old bid and withdraws it. A bid inside the extension window moves the end forward, up to a hard end one day after the original end. The auction cannot be cancelled once it has a bid.

After the end, anyone may settle. If the high bid meets the reserve (or there is no reserve), the studio is credited the bid and the winner receives the work. If the reserve is missed, the bidder withdraws the bid and the work returns to the studio.

A new bid must be at least 5% above the current bid. A bid in the last 5 minutes extends the end so that 5 minutes remain, up to one day past the original end.

## Three desks

These are different contracts. They share a source tree, and each chain gets its own deploy. Avalanche (43114) is first. Base (8453) is the same source later. Do not deploy until Jack confirms.

**AtelierOne mints a new one-of-one.** Listing creates an ERC-721-style token that did not exist before. Fixed price or one auction. The new id is the work.

**AtelierEdition mints a new run.** A separate contract. The run is 10 to 1000 copies of a new edition id. Fixed price until sold out, or a step curve. It does not touch tokens Jack already holds on OpenSea or the gallery.

**AtelierVault does not mint.** Jack already holds the work on the studio wallet. The owner, or an operator key the owner sets, pulls an approved ERC-1155 (`safeTransferFrom`) or ERC-721 (`transferFrom`) into the vault. The operator can also list on the minting desks and cancel before a bid or before the first edition copy. It cannot change proceeds, pause, or royalties, and it is not paid the sale. The quantity is chosen per deposit, so one unit can come out of a 20,000 supply. The original contract's supply does not change. The balance moves from the wallet to the vault, so that unit is not also spendable from the wallet. The lot records the original collection, the original token id, the quantity, and the depositor. There is no second token id for the same unit. Calling the one-of-one `listFixed` or `listAuction` on the vault reverts with `CloneId`.

A vault lot sells at a fixed price or by one auction, in the same spirit as AtelierOne: minimum bid, optional reserve, increment, and an anti-snipe extension. The contract raises an increment below 5% to 5%, and an extension below 5 minutes to 5 minutes. On a winning settle the escrowed units go to the buyer and the proceeds are credited for `withdraw`. If the reserve is missed, if the owner or the operator cancels before a bid, or if a fixed-price window ends with no buyer, those same units go back to the depositor.

If the original token implements EIP-2981, the sale pays that royalty, capped at 10%. Otherwise the studio sets a fallback receiver and rate, also capped at 10%. The vault does not list the work on another marketplace, and it does not stop the rest of the supply from staying where it is.

## AtelierVault

The vault is the escrow desk above. It is not a hybrid of the minting contracts.

## Royalties

AtelierOne and AtelierEdition take the configured royalty out of the price on each sale and credit the rest to proceeds. The cap is 10%. `royaltyInfo` reports the same split. This applies only to sales that settle here.

## AtelierEdition

A separate contract from the one-of-one desk. A run is strictly 10 to 1000 copies.

**Fixed.** Every copy costs the same price until the run is sold out.

**Step.** Each sale raises the price of the next copy by a fixed step. An optional cap stops the climb: once the next price would pass the cap, further copies sell at the cap.

The studio can cancel a run only before the first copy sells.

## Later

A metadata lock waits until the files move off GitHub to Arweave, and only after a sale. It is not part of this desk.

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
node atelier.mjs deposit --chain avalanche --mode auction --standard 1155 --collection 0x... --token-id 7 --qty 1 --from 0x... --min 0.02 --reserve 0.02 --start 1735689600 --end 1735776000 --increment-bps 500 --extension 600
```

The CLI reads the studio key from `ATELIER_OPERATOR_KEY`. It never prints the key, and it refuses the key on the command line. Listing commands read addresses from `data/atelier.json`. If that address is empty, they exit and do not send. Prices are native-coin amounts (AVAX on Avalanche, ETH on Base), not wei. `--chain base` is the same command, used only after the Base deploy.

`deposit` only encodes the pull. It prints the calldata and the operator address. It does not broadcast, and it does not open a network connection, including Avalanche and Base. `--send`, `--broadcast`, and `--rpc` are refused. An empty vault address still produces calldata and leaves `to` empty.

## Check locally

```sh
export PATH="$HOME/.foundry/bin:$PATH"
cd atelier
forge test
```

Serve the site and open `?section=atelier`. Avalanche is the first chain. The sale tabs are Fixed price, Auctions, and Editions. Until an address is set, the desk says it is empty.

The older Manifold catalogue can stay linked under the desk. New sales use these contracts.
