# Git workflow

The VPS is the writer for everyday updates. The studio computer is a backup and the place for a change you mean to make. The promo worker and a local edit must not both rewrite the same file and then push.

## Who writes what

The worker may commit only served state on `main` and `pages-live`:

- `data/` — Featured, shop, prices, promo boards
- `nft/` — share landings
- catalog JSON at the repo root: `gallery.json`, `xrp_gallery.json`, `sui_gallery.json`, `nature_jam_gallery.json`, `ai_play_gallery.json`, `based_ai_gallery.json`, `auctions_gallery.json`, `objkt_auctions_gallery.json`

Those paths stay where the site already fetches them. Moving them would blank the live gallery.

The worker must not commit hand-edited layout or code: `index.html`, `js/`, `css/`, `assets/`, or `*.py`. A path guard rejects that commit. Layout reaches the live branch only when a person passes `--layout`.

Outside git, on disk only:

- `vps/jobs/` — promo queue
- `listing/data/` — agent state
- `listing/logi/` — run logs

Preview WebP files live in the separate `jbg-present` repo. The worker commits those image files, not scripts.

## Before you edit locally

From the studio tree:

```bash
./vps/before_local.sh
```

That fetches and runs `git pull --rebase` on this repo (`main`), on `jbg-present` (`main`), and on the `pages-live` worktree. If a tracked file is already dirty, the script stops. Commit or stash first. Do not start editing on top of an unpushed local commit.

By hand, when the worktree is clean and you have no local commits:

```bash
git pull --rebase origin main
```

## After you edit locally

Commit messages in this public repo stay in English. Author time stays UTC.

```bash
./vps/after_local.sh "Short English description of the change"
```

The script commits (it refuses `.env`), runs `git pull --rebase`, pushes, then on the VPS runs `git pull --rebase` so the worker sees the new commit. Until that pull finishes, the worker is still on the old files and the next push can tangle the queue.

By hand:

```bash
git add path/you/changed
git commit -m "Short English description"
git pull --rebase origin main
git push origin HEAD:main
```

Then, on the VPS checkout of this repo, `jbg-present`, and the `pages-live` worktree:

```bash
git pull --rebase origin main
```

Use `origin pages-live` in the live worktree.

## rsync

One direction for state that is not in git: VPS to the studio computer.

```bash
./vps/backup_from_vps.sh
```

Do not rsync this repo or `jbg-present` both ways. Those trees are git history. A two-way rsync overwrites commits and makes the next pull conflict. Script setup still copies code one way, studio computer to VPS, without secrets and without JPG. That copy is not a second history of this gallery repo.

## Branches

The worker stays on `main` and commits only the state files above. It also updates `pages-live` with that same data so the live site moves.

For a layout or code change that can collide with the worker, use a branch and a pull request:

```bash
git checkout -b cursor/short-name
# edit, commit, push, open a pull request into main
```

Ship layout to the live site only on purpose (`--layout`), after the branch is merged.

## Atelier mark

A work offered on the Atelier desk is marked ATELIER on its SI Art card, next to OS and SHOP. The library filter of the same name appears once at least one work carries the mark. `featured: true` also places that card on the Featured tab.

The VPS worker writes `data/atelier_desk.json` only. One item:

```json
{
  "collection_id": "avalanche_flower_stories",
  "token_id": 4967,
  "chain": "avalanche",
  "name": "FS #6722",
  "currency": "AVAX",
  "price": "0.02",
  "featured": true
}
```

`collection_id` and `token_id` must be the SI Art pair. Featured, Shop, and the Atelier card then use that card's preview and its promo board. Do not invent a second image.

A new piece, minted by the technical wallet and not yet on SI Art, uses `collection_id` `atelier_one` or `atelier_edition`. Before `featured` is true, commit in `jbg-present`:

- `{collection_id}/{token_id}.thumb.webp` — small preview
- `{collection_id}/{token_id}.view.webp` — large preview
- `promo/{collection_id}/{token_id as four digits}.jpg` — promo board

Then refresh `data/promo_boards.json` with `build_promo_board_index.py` and set `image_url` to the thumb. The mint transaction is sent by the technical key. The piece does not need a second copy.

Do not offer the Solana lazy-mint mirror on an Atelier card or on the Atelier section. SI Art, Shop, and Photography keep that mirror.
