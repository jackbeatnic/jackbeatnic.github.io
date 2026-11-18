#!/usr/bin/env node
/**
 * Lists work on the Atelier desk, and encodes a vault deposit.
 * The operator key is read from ATELIER_OPERATOR_KEY and is never printed.
 * Listing sends as that key once the owner has set its address with setOperator.
 * This file does not read an owner key.
 * Listing reads addresses from data/atelier.json. An empty address sends nothing.
 * deposit encodes calldata only. It does not broadcast and does not contact a network.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const key = process.env.ATELIER_OPERATOR_KEY;

function scrub(text) {
  let out = String(text || "");
  const raw = String(key || "").trim();
  if (raw) {
    out = out.split(raw).join("[redacted]");
    const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
    out = out.split(hex).join("[redacted]");
  }
  return out.replace(/0x[a-fA-F0-9]{64}/g, "[redacted]");
}

function fail(message) {
  console.error(scrub(message));
  process.exit(1);
}

if (!key || !String(key).trim()) {
  fail(
    "ATELIER_OPERATOR_KEY is not set. The operator key stays in the environment and is never written into git."
  );
}

const keyBody = String(key).trim().replace(/^0x/i, "");
if (!/^[0-9a-fA-F]{64}$/.test(keyBody)) {
  fail("ATELIER_OPERATOR_KEY is not a usable private key.");
}
for (const arg of process.argv) {
  if (String(arg).toLowerCase().includes(keyBody.toLowerCase())) {
    fail("Refusing an operator key passed on the command line.");
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(here, "../../data/atelier.json");

function usage() {
  console.error(`Usage:
  node atelier.mjs list-fixed --chain avalanche --id 1 --uri ipfs://... --price 1.5 [--start 0] [--end 0]
  node atelier.mjs list-auction --chain avalanche --id 2 --uri ipfs://... --min 0.5 [--reserve 0] --start <unix> --end <unix> [--increment-bps 0] [--extension 0]
  node atelier.mjs list-edition-fixed --chain avalanche --id 1 --supply 10 --price 0.1 --uri ipfs://...
  node atelier.mjs list-edition-step --chain avalanche --id 2 --supply 10 --start-price 0.05 --step 0.01 [--cap 0] --uri ipfs://...
  node atelier.mjs deposit --chain avalanche --mode auction --standard 1155 --collection 0x... --token-id 7 --qty 1 --from 0x... --min 0.02 [--reserve 0] --start <unix> --end <unix> [--increment-bps 500] [--extension 600]
  node atelier.mjs deposit --chain avalanche --mode fixed --standard 721 --collection 0x... --token-id 4 --qty 1 --from 0x... --price 0.02

Avalanche is first. Base uses the same commands after its own deploy.
Prices are native-coin amounts (AVAX or ETH), not wei.
deposit only prints calldata. It does not broadcast and does not contact mainnet.
The key in ATELIER_OPERATOR_KEY is the operator. Listing works once the owner has set that address.
This CLI does not read an owner key.
Do not deploy until Jack confirms.`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[name] = true;
    } else {
      out[name] = next;
      i += 1;
    }
  }
  return out;
}

function required(map, name) {
  const value = map[name];
  if (value === undefined || value === true || value === "") {
    console.error(`Missing --${name}.`);
    usage();
    process.exit(1);
  }
  return String(value);
}

function whole(name, value) {
  if (!/^\d+$/.test(String(value))) fail(`--${name} must be a whole number.`);
  return BigInt(value);
}

function loadDesk() {
  try {
    return JSON.parse(readFileSync(dataPath, "utf8"));
  } catch {
    fail(`Could not read ${dataPath}.`);
  }
  return null;
}

function chainConfig(desk, chainKey) {
  const chain = desk.chains?.[chainKey];
  if (!chain) fail(`Unknown chain "${chainKey}". Use avalanche or base.`);
  return chain;
}

function addressOrStop(chain, field, label) {
  const address = String(chain[field] || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) {
    fail(
      `${label} address on ${chain.name || "this chain"} is empty. Do not deploy until Jack confirms. No transaction was sent.`
    );
  }
  return address;
}

function asAddress(name, value) {
  const address = String(value || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) fail(`--${name} must be an address.`);
  return address;
}

function standardCode(value) {
  const raw = String(value || "")
    .toLowerCase()
    .replace(/^erc-?/, "");
  if (raw === "721") return 1;
  if (raw === "1155") return 2;
  fail("--standard must be 721 or 1155.");
  return 0;
}

async function encodeDeposit(args, deskFile, chainKey, chain) {
  if (args.broadcast || args.send || args.rpc) {
    fail(
      "Deposit encoding does not broadcast and does not run against mainnet. Remove --send, --broadcast, and --rpc."
    );
  }
  const mode = required(args, "mode");
  if (mode !== "fixed" && mode !== "auction") fail("--mode must be fixed or auction.");
  const standard = standardCode(required(args, "standard"));
  const collection = asAddress("collection", required(args, "collection"));
  const tokenId = whole("token-id", required(args, "token-id"));
  const qty = whole("qty", required(args, "qty"));
  const from = asAddress("from", required(args, "from"));
  if (qty === 0n) fail("--qty must be above zero. The vault rejects an empty pull.");
  if (standard === 1 && qty !== 1n) fail("An ERC-721 deposit moves exactly one token.");

  const { encodeFunctionData, parseEther, toFunctionSelector } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");

  function coin(value, flag, { allowZero = false } = {}) {
    let amount;
    try {
      amount = parseEther(String(value));
    } catch {
      fail(`--${flag} must be a native-coin amount such as 0.02 or 1.`);
    }
    if (amount < 0n || (!allowZero && amount === 0n)) fail(`--${flag} must be above zero.`);
    if (amount > (1n << 96n) - 1n) fail(`--${flag} is too large for the desk.`);
    return amount;
  }

  let signature;
  let functionName;
  let callArgs;
  let abi;
  if (mode === "fixed") {
    const start = whole("start", args.start ?? "0");
    const end = whole("end", args.end ?? "0");
    if (end !== 0n && end <= start) fail("Fixed-price end must be after the start, or 0 for no end.");
    signature = "depositFixed(uint8,address,uint256,uint256,address,uint96,uint64,uint64)";
    functionName = "depositFixed";
    abi = [
      {
        type: "function",
        name: "depositFixed",
        stateMutability: "nonpayable",
        inputs: [
          { name: "standard", type: "uint8" },
          { name: "collection", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "qty", type: "uint256" },
          { name: "from", type: "address" },
          { name: "price", type: "uint96" },
          { name: "startTime", type: "uint64" },
          { name: "endTime", type: "uint64" },
        ],
        outputs: [],
      },
    ];
    callArgs = [standard, collection, tokenId, qty, from, coin(required(args, "price"), "price"), start, end];
  } else {
    const start = whole("start", required(args, "start"));
    const end = whole("end", required(args, "end"));
    const minBid = coin(required(args, "min"), "min");
    const reserve = coin(args.reserve ?? "0", "reserve", { allowZero: true });
    const increment = whole("increment-bps", args["increment-bps"] ?? "500");
    const extension = whole("extension", args.extension ?? "300");
    if (end <= start) fail("Auction end must be after the start.");
    if (end - start > 30n * 24n * 60n * 60n) fail("Auction length is at most 30 days.");
    if (reserve !== 0n && reserve < minBid) fail("Reserve is below the minimum bid.");
    if (increment > 5000n) fail("Increment is at most 5000 basis points (50%).");
    if (extension > 3600n) fail("Anti-snipe extension is at most 3600 seconds (1 hour).");
    signature = "depositAuction(uint8,address,uint256,uint256,address,uint96,uint96,uint64,uint64,uint16,uint32)";
    functionName = "depositAuction";
    abi = [
      {
        type: "function",
        name: "depositAuction",
        stateMutability: "nonpayable",
        inputs: [
          { name: "standard", type: "uint8" },
          { name: "collection", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "qty", type: "uint256" },
          { name: "from", type: "address" },
          { name: "minBid", type: "uint96" },
          { name: "reservePrice", type: "uint96" },
          { name: "startTime", type: "uint64" },
          { name: "endTime", type: "uint64" },
          { name: "incrementBps", type: "uint16" },
          { name: "extensionSecs", type: "uint32" },
        ],
        outputs: [],
      },
    ];
    callArgs = [
      standard,
      collection,
      tokenId,
      qty,
      from,
      minBid,
      reserve,
      start,
      end,
      increment,
      extension,
    ];
  }

  const expected = String(deskFile.selectors?.[signature] || "").toLowerCase();
  const actual = toFunctionSelector(signature).toLowerCase();
  if (!expected || actual !== expected) {
    fail(
      `Selector mismatch for ${signature}. The desk file and the contract disagree. Nothing was sent.`
    );
  }

  let operator;
  try {
    operator = privateKeyToAccount(keyBody.startsWith("0x") ? keyBody : `0x${keyBody}`).address;
  } catch {
    fail("ATELIER_OPERATOR_KEY is not a usable private key.");
  }
  const data = encodeFunctionData({ abi, functionName, args: callArgs });
  const rawVault = String(chain.vault || "").trim();
  const to =
    /^0x[0-9a-fA-F]{40}$/.test(rawVault) && !/^0x0{40}$/i.test(rawVault) ? rawVault : "";
  const payload = {
    action: "encode-deposit",
    broadcast: false,
    network: "not-contacted",
    chain: chainKey,
    chainId: Number(chain.chainId),
    operator,
    depositor: from,
    to,
    value: "0",
    data,
  };
  const text = JSON.stringify(payload, null, 2);
  if (text.toLowerCase().includes(keyBody.toLowerCase())) {
    fail("Refusing to print the studio key.");
  }
  console.log(text);
}

const parsed = parseArgs(process.argv.slice(2));
const command = parsed._[0];
if (!command || parsed.help) {
  usage();
  process.exit(command ? 0 : 1);
}

const commands = {
  "list-fixed": "one",
  "list-auction": "one",
  "list-edition-fixed": "edition",
  "list-edition-step": "edition",
};
if (command !== "deposit" && !commands[command]) {
  console.error(`Unknown command "${command}".`);
  usage();
  process.exit(1);
}

const desk = loadDesk();
const chainKey = required(parsed, "chain");
const chain = chainConfig(desk, chainKey);
if (command === "deposit") {
  await encodeDeposit(parsed, desk, chainKey, chain);
  process.exit(0);
}
const field = commands[command];
const label = field === "edition" ? "AtelierEdition" : "AtelierOne";
const address = addressOrStop(chain, field, label);

const { createWalletClient, defineChain, http, parseEther, toFunctionSelector } = await import(
  "viem"
);
const { privateKeyToAccount } = await import("viem/accounts");

function accountFromKey() {
  // Sender is the operator. The owner must already have called setOperator for this address.
  // This CLI never reads an owner key.
  const trimmed = String(key).trim();
  const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  try {
    return privateKeyToAccount(normalized);
  } catch {
    fail("ATELIER_OPERATOR_KEY is not a usable private key.");
  }
  return null;
}

function coin(value, flag, { allowZero = false } = {}) {
  let amount;
  try {
    amount = parseEther(String(value));
  } catch {
    fail(`--${flag} must be a native-coin amount such as 0.5 or 1.`);
  }
  if (amount < 0n || (!allowZero && amount === 0n)) fail(`--${flag} must be above zero.`);
  if (amount > (1n << 96n) - 1n) fail(`--${flag} is too large for the desk.`);
  return amount;
}

function assertSelector(signature) {
  const expected = String(desk.selectors?.[signature] || "").toLowerCase();
  let actual = "";
  try {
    actual = toFunctionSelector(signature).toLowerCase();
  } catch {
    fail(`Could not check the selector for ${signature}. No transaction was sent.`);
  }
  if (!expected || actual !== expected) {
    fail(
      `Selector mismatch for ${signature}. The desk file and the contract disagree. No transaction was sent.`
    );
  }
}

const oneAbi = [
  {
    type: "function",
    name: "listFixed",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "uri", type: "string" },
      { name: "price", type: "uint96" },
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "listAuction",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "uri", type: "string" },
      { name: "minBid", type: "uint96" },
      { name: "reservePrice", type: "uint96" },
      { name: "startTime", type: "uint64" },
      { name: "endTime", type: "uint64" },
      { name: "incrementBps", type: "uint16" },
      { name: "extensionSecs", type: "uint32" },
    ],
    outputs: [],
  },
];

const editionAbi = [
  {
    type: "function",
    name: "listFixed",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "supply", type: "uint32" },
      { name: "price", type: "uint96" },
      { name: "tokenUri", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "listStep",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "supply", type: "uint32" },
      { name: "startPrice", type: "uint96" },
      { name: "step", type: "uint96" },
      { name: "cap", type: "uint96" },
      { name: "tokenUri", type: "string" },
    ],
    outputs: [],
  },
];

function supplyOf(value) {
  const supply = whole("supply", value);
  if (supply < 10n || supply > 1000n) fail("Edition supply must be from 10 to 1000.");
  return supply;
}

let abi;
let functionName;
let args;
let signature;

if (command === "list-fixed") {
  const start = whole("start", parsed.start ?? "0");
  const end = whole("end", parsed.end ?? "0");
  if (end !== 0n && end <= start) fail("Fixed-price end must be after the start, or 0 for no end.");
  signature = "listFixed(uint256,string,uint96,uint64,uint64)";
  abi = oneAbi;
  functionName = "listFixed";
  args = [
    whole("id", required(parsed, "id")),
    required(parsed, "uri"),
    coin(required(parsed, "price"), "price"),
    start,
    end,
  ];
} else if (command === "list-auction") {
  const start = whole("start", required(parsed, "start"));
  const end = whole("end", required(parsed, "end"));
  const minBid = coin(required(parsed, "min"), "min");
  const reserve = coin(parsed.reserve ?? "0", "reserve", { allowZero: true });
  const increment = whole("increment-bps", parsed["increment-bps"] ?? "0");
  const extension = whole("extension", parsed.extension ?? "0");
  if (end <= start) fail("Auction end must be after the start.");
  if (end - start > 30n * 24n * 60n * 60n) fail("Auction length is at most 30 days.");
  if (reserve !== 0n && reserve < minBid) fail("Reserve is below the minimum bid.");
  if (increment > 5000n) fail("Increment is at most 5000 basis points (50%).");
  if (extension > 3600n) fail("Anti-snipe extension is at most 3600 seconds (1 hour).");
  signature = "listAuction(uint256,string,uint96,uint96,uint64,uint64,uint16,uint32)";
  abi = oneAbi;
  functionName = "listAuction";
  args = [
    whole("id", required(parsed, "id")),
    required(parsed, "uri"),
    minBid,
    reserve,
    start,
    end,
    increment,
    extension,
  ];
} else if (command === "list-edition-fixed") {
  signature = "listFixed(uint256,uint32,uint96,string)";
  abi = editionAbi;
  functionName = "listFixed";
  args = [
    whole("id", required(parsed, "id")),
    supplyOf(required(parsed, "supply")),
    coin(required(parsed, "price"), "price"),
    required(parsed, "uri"),
  ];
} else {
  const cap = coin(parsed.cap ?? "0", "cap", { allowZero: true });
  const startPrice = coin(required(parsed, "start-price"), "start-price");
  if (cap !== 0n && cap < startPrice) fail("Cap is below the starting price.");
  signature = "listStep(uint256,uint32,uint96,uint96,uint96,string)";
  abi = editionAbi;
  functionName = "listStep";
  args = [
    whole("id", required(parsed, "id")),
    supplyOf(required(parsed, "supply")),
    startPrice,
    coin(required(parsed, "step"), "step"),
    cap,
    required(parsed, "uri"),
  ];
}

assertSelector(signature);

const account = accountFromKey();
const viemChain = defineChain({
  id: Number(chain.chainId),
  name: chain.name || chainKey,
  nativeCurrency: {
    name: chain.nativeSymbol || "ETH",
    symbol: chain.nativeSymbol || "ETH",
    decimals: 18,
  },
  rpcUrls: { default: { http: [chain.rpc] } },
});
const client = createWalletClient({
  account,
  chain: viemChain,
  transport: http(chain.rpc),
});

let hash;
try {
  hash = await client.writeContract({ address, abi, functionName, args });
} catch (err) {
  fail(err?.shortMessage || err?.message || "The transaction was not sent.");
}

console.log(`Listed on ${chain.name || chainKey}. Contract ${address}. Transaction ${hash}.`);
