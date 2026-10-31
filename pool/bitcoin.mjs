import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { hmac } from "@noble/hashes/hmac";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2";
import * as secp from "@noble/secp256k1";

// Schnorr signing needs a synchronous hash. Node's crypto covers the rest.
secp.utils.sha256Sync = (...msgs) => nobleSha256(Buffer.concat(msgs.map((m) => Buffer.from(m))));
secp.utils.hmacSha256Sync = (key, ...msgs) =>
  hmac(nobleSha256, key, Buffer.concat(msgs.map((m) => Buffer.from(m))));

export { secp };

// BIP341 NUMS point. The pot's internal key is this point, so a key-path
// signature cannot spend it. Nobody knows the discrete log.
export const NUMS = Buffer.from(
  "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0",
  "hex",
);

const BITCOIN_VERSION = "32.1";
const TARBALL = `bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz`;
const TARBALL_SHA256 =
  "61545c17c3120fb7412f896d248b11993af04ec8817aad3649c55b2afb044963";

export function sha256(buf) {
  return createHash("sha256").update(buf).digest();
}

export function dsha256(buf) {
  return sha256(sha256(buf));
}

export function hash160(buf) {
  return createHash("ripemd160").update(sha256(buf)).digest();
}

export function taggedHash(tag, msg) {
  const tagHash = sha256(Buffer.from(tag, "utf8"));
  return sha256(Buffer.concat([tagHash, tagHash, msg]));
}

export function reversed(buf) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[buf.length - 1 - i];
  return out;
}

export function u32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

export function u64le(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}

export function compact(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xfe;
  b.writeUInt32LE(n >>> 0, 1);
  return b;
}

function pushData(data) {
  if (data.length >= 76) throw new Error("push too long");
  return Buffer.concat([Buffer.from([data.length]), data]);
}

function scriptNum(n) {
  if (n === 0) return Buffer.from([0]);
  const bytes = [];
  let x = n;
  while (x > 0) {
    bytes.push(x & 0xff);
    x >>= 8;
  }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(0);
  return Buffer.from(bytes);
}

export function p2wpkh(compressedPub) {
  if (compressedPub.length !== 33) throw new Error("spend key must be compressed");
  return Buffer.concat([Buffer.from([0x00, 0x14]), hash160(compressedPub)]);
}

// The only leaf is OP_TRUE. There is no CHECKSIG, no CSV, and no recovery key.
// Bitcoin will accept any outputs. The automator is what rejects a substituted
// payee list. A per-block CTV template would be a new address every block.
let potCache;
export function pot() {
  if (potCache) return potCache;
  const leafVersion = 0xc0;
  const leafScript = Buffer.from([0x51]);
  const merkle = taggedHash(
    "TapLeaf",
    Buffer.concat([Buffer.from([leafVersion]), compact(leafScript.length), leafScript]),
  );
  const tweakHash = taggedHash("TapTweak", Buffer.concat([NUMS, merkle]));
  const tweak = BigInt(`0x${tweakHash.toString("hex")}`);
  if (tweak >= secp.CURVE.n) throw new Error("tap tweak out of range");
  const internal = secp.Point.fromHex(`02${NUMS.toString("hex")}`);
  const tweaked = internal.add(secp.Point.BASE.multiply(tweak));
  const parity = tweaked.hasEvenY() ? 0 : 1;
  const outputKey = Buffer.from(tweaked.toRawX());
  const script = Buffer.concat([Buffer.from([0x51, 0x20]), outputKey]);
  const control = Buffer.concat([Buffer.from([leafVersion | parity]), NUMS]);
  potCache = { script, witness: [leafScript, control] };
  return potCache;
}

export function witnessCommitmentScript() {
  const commitment = dsha256(Buffer.alloc(64));
  return Buffer.concat([Buffer.from("6a24aa21a9ed", "hex"), commitment]);
}

export function serTx(tx) {
  const witness = tx.vin.some((input) => input.witness && input.witness.length);
  const parts = [u32le(tx.version)];
  if (witness) parts.push(Buffer.from([0x00, 0x01]));
  parts.push(compact(tx.vin.length));
  for (const input of tx.vin) {
    if (input.txid.length !== 32) throw new Error("prevout txid");
    parts.push(input.txid, u32le(input.vout));
    const scriptSig = input.scriptSig ?? Buffer.alloc(0);
    parts.push(compact(scriptSig.length), scriptSig, u32le(input.sequence));
  }
  parts.push(compact(tx.vout.length));
  for (const output of tx.vout) {
    parts.push(u64le(output.value), compact(output.script.length), output.script);
  }
  if (witness) {
    for (const input of tx.vin) {
      const stack = input.witness ?? [];
      parts.push(compact(stack.length));
      for (const item of stack) parts.push(compact(item.length), item);
    }
  }
  parts.push(u32le(tx.locktime));
  return Buffer.concat(parts);
}

export function txidRaw(tx) {
  const copy = {
    ...tx,
    vin: tx.vin.map((input) => ({ ...input, witness: undefined })),
  };
  return dsha256(serTx(copy));
}

export function txidRpc(tx) {
  return reversed(txidRaw(tx)).toString("hex");
}

export function coinbaseTx({ height, tag, outputs, witnessNonce }) {
  const scriptSig = Buffer.concat([
    pushData(scriptNum(height)),
    pushData(Buffer.from(tag, "utf8")),
  ]);
  return {
    version: 2,
    locktime: 0,
    vin: [
      {
        txid: Buffer.alloc(32),
        vout: 0xffffffff,
        scriptSig,
        sequence: 0xffffffff,
        witness: witnessNonce ? [witnessNonce] : undefined,
      },
    ],
    vout: outputs,
  };
}

function mineHeader(prefix) {
  for (let nonce = 0; nonce < 100000; nonce++) {
    const header = Buffer.concat([prefix, u32le(nonce)]);
    const hash = dsha256(header);
    // Regtest powLimit is 0x7fff…ff. The hash is a little-endian uint256,
    // so the most significant byte is the last one.
    if (hash[31] <= 0x7f) return header;
  }
  throw new Error("failed to find a regtest nonce");
}

export function blockHex(template, coinbase) {
  const txid = txidRaw(coinbase);
  const prefix = Buffer.concat([
    u32le(template.version),
    reversed(Buffer.from(template.previousblockhash, "hex")),
    txid,
    u32le(template.curtime),
    u32le(Number.parseInt(template.bits, 16)),
  ]);
  const header = mineHeader(prefix);
  return {
    hex: Buffer.concat([header, compact(1), serTx(coinbase)]).toString("hex"),
    txid,
    txidRpc: reversed(txid).toString("hex"),
    blockHash: reversed(dsha256(header)).toString("hex"),
  };
}

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const ret = [];
  for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
  ret.push(0);
  for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
  return ret;
}

function bech32Checksum(hrp, data) {
  const values = hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const ret = [];
  for (let p = 0; p < 6; p++) ret.push((mod >> (5 * (5 - p))) & 31);
  return ret;
}

function convertBits(data, from, to, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits) ret.push((acc << (to - bits)) & maxv);
  return ret;
}

function encodeBech32(hrp, version, program) {
  const data = [version, ...convertBits([...program], 8, 5, true)];
  const full = data.concat(bech32Checksum(hrp, data));
  return hrp + "1" + full.map((d) => CHARSET[d]).join("");
}

// Blocks that only move the chain forward pay this address. It is not a
// hasher payout and the pool coinbase does not use it.
export function chainAdvanceAddress() {
  const program = hash160(Buffer.from("chain-advance"));
  return {
    address: encodeBech32("bcrt", 0, program),
    script: Buffer.concat([Buffer.from([0x00, 0x14]), program]),
  };
}

export function rpcIdToInternal(rpcHex) {
  return reversed(Buffer.from(rpcHex, "hex"));
}

export async function rpcCall(cfg, method, params = []) {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization:
        "Basic " + Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64"),
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: "pool", method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`${method}: ${json.error.message}`);
  }
  return json.result;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

export async function ensureBitcoind() {
  const root = "/tmp/bitcoin-core";
  const bin = path.join(root, `bitcoin-${BITCOIN_VERSION}`, "bin", "bitcoind");
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(root, { recursive: true });
  const tarPath = path.join(root, TARBALL);
  const res = await fetch(
    `https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/${TARBALL}`,
  );
  if (!res.ok) throw new Error(`bitcoin core download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tarPath));
  const got = await sha256File(tarPath);
  if (got !== TARBALL_SHA256) throw new Error(`bitcoin core checksum ${got}`);
  await new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xzf", tarPath, "-C", root], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tar ${code}`))));
  });
  if (!fs.existsSync(bin)) throw new Error("bitcoind missing after extract");
  return bin;
}

export async function startBitcoind(bin) {
  const datadir = fs.mkdtempSync(path.join(os.tmpdir(), "heater-pool-"));
  const rpcport = await freePort();
  const p2pport = await freePort();
  const args = [
    "-regtest",
    `-datadir=${datadir}`,
    `-rpcport=${rpcport}`,
    `-port=${p2pport}`,
    "-rpcbind=127.0.0.1",
    "-rpcallowip=127.0.0.1",
    "-rpcuser=pool",
    "-rpcpassword=pool",
    "-server=1",
    "-listen=0",
    "-txindex=1",
    "-disablewallet=1",
    "-minrelaytxfee=0",
    "-blockmintxfee=0",
    "-dustrelayfee=0",
    "-acceptnonstdtxn=1",
    "-fallbackfee=0",
  ];
  const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore"] });
  const cfg = {
    url: `http://127.0.0.1:${rpcport}/`,
    user: "pool",
    password: "pool",
    datadir,
    proc,
    rpcport,
  };
  const deadline = Date.now() + 20000;
  let last = "no response";
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      const log = fs.existsSync(path.join(datadir, "regtest", "debug.log"))
        ? fs.readFileSync(path.join(datadir, "regtest", "debug.log"), "utf8").slice(-2000)
        : "";
      throw new Error(`bitcoind exited ${proc.exitCode}\n${log}`);
    }
    try {
      await rpcCall(cfg, "getblockcount");
      return cfg;
    } catch (error) {
      last = error.message;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`bitcoind did not start: ${last}`);
}

export async function stopBitcoind(cfg) {
  if (!cfg) return;
  try {
    await rpcCall(cfg, "stop");
  } catch {
    cfg.proc.kill("SIGTERM");
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      cfg.proc.kill("SIGKILL");
      resolve();
    }, 5000);
    cfg.proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function subsidyAt(height) {
  const halvings = Math.floor(height / 150);
  if (halvings >= 64) return 0;
  return Number(5_000_000_000n >> BigInt(halvings));
}
