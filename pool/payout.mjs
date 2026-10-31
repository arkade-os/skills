import {
  coinbaseTx,
  dsha256,
  p2wpkh,
  pot,
  secp,
  serTx,
  sha256,
  taggedHash,
  u32le,
  u64le,
} from "./bitcoin.mjs";

export const DUST = 330;
export const WINDOW_SHARE_COUNT = 256;
export const TAG = "heater-pool-v1";
const POOL_BITS = 0x207fffff;

export function hasherFromSeed(name) {
  const sharePriv = sha256(Buffer.from(`share:${name}`));
  const spendPriv = sha256(Buffer.from(`spend:${name}`));
  if (!secp.utils.isValidPrivateKey(sharePriv) || !secp.utils.isValidPrivateKey(spendPriv)) {
    throw new Error(`bad key for ${name}`);
  }
  const shareKey = Buffer.from(secp.schnorr.getPublicKey(sharePriv));
  const spendKey = Buffer.from(secp.getPublicKey(spendPriv, true));
  return { name, sharePriv, shareKey, spendKey, script: p2wpkh(spendKey) };
}

function shareHeader(share) {
  return Buffer.concat([
    u32le(1),
    share.headerPrev,
    share.headerMerkle,
    u32le(share.ntime),
    u32le(share.headerBits),
    u32le(share.nonce),
  ]);
}

function shareMessage(share) {
  return Buffer.concat([
    share.shareKey,
    share.jobId,
    share.shareHash,
    u32le(share.ntime),
    u32le(share.nonce),
  ]);
}

export function collectShares(hasher, job, count) {
  const shares = [];
  let nonce = 0;
  while (shares.length < count) {
    const headerMerkle = sha256(Buffer.concat([job.txid, hasher.shareKey]));
    const candidate = {
      shareKey: hasher.shareKey,
      spendKey: hasher.spendKey,
      jobId: job.txid,
      ntime: job.ntime,
      nonce,
      headerPrev: job.prevHash,
      headerMerkle,
      headerBits: POOL_BITS,
    };
    const shareHash = dsha256(shareHeader(candidate));
    nonce += 1;
    if (shareHash[31] !== 0) continue;
    candidate.shareHash = shareHash;
    candidate.signature = Buffer.from(
      secp.schnorr.signSync(shareMessage(candidate), hasher.sharePriv),
    );
    if (!secp.schnorr.verifySync(candidate.signature, shareMessage(candidate), hasher.shareKey)) {
      throw new Error("share signature did not verify");
    }
    shares.push(candidate);
  }
  return shares;
}

function hex(value, length) {
  const buf = Buffer.from(value, "hex");
  if (buf.length !== length) throw new Error(`wanted ${length} bytes, got ${buf.length}`);
  return buf;
}

function verifyShare(raw, jobTxid) {
  const share = {
    shareKey: hex(raw.shareKey, 32),
    spendKey: hex(raw.spendKey, 33),
    jobId: hex(raw.jobId, 32),
    ntime: raw.ntime,
    nonce: raw.nonce,
    headerPrev: hex(raw.headerPrev, 32),
    headerMerkle: hex(raw.headerMerkle, 32),
    headerBits: raw.headerBits,
    signature: hex(raw.signature, 64),
  };
  if (!share.jobId.equals(jobTxid)) throw new Error("share outside the window");
  const bound = sha256(Buffer.concat([jobTxid, share.shareKey]));
  if (!share.headerMerkle.equals(bound)) throw new Error("share is not bound to the job");
  share.shareHash = dsha256(shareHeader(share));
  if (share.shareHash[31] !== 0) throw new Error("share misses pool difficulty");
  const ok = secp.schnorr.verifySync(share.signature, shareMessage(share), share.shareKey);
  if (!ok) throw new Error("bad share signature");
  return share;
}

export function merkleRoot(payloads) {
  if (payloads.length === 0) return Buffer.alloc(32);
  let level = payloads.map((payload) => dsha256(payload));
  while (level.length > 1) {
    if (level.length % 2 === 1) level = level.concat([level[level.length - 1]]);
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(dsha256(Buffer.concat([level[i], level[i + 1]])));
    }
    level = next;
  }
  return level[0];
}

function splitReward(reward, rows) {
  const total = rows.reduce((sum, row) => sum + row.score, 0);
  if (total <= 0) throw new Error("no shares");
  const scored = rows.map((row) => {
    const product = reward * row.score;
    return { ...row, base: Math.floor(product / total), frac: product % total };
  });
  let left = reward - scored.reduce((sum, row) => sum + row.base, 0);
  const order = [...scored].sort((a, b) => {
    if (a.frac !== b.frac) return b.frac - a.frac;
    return Buffer.compare(a.shareKey, b.shareKey);
  });
  const plus = new Set();
  for (const row of order) {
    if (left === 0) break;
    plus.add(row.shareKey.toString("hex"));
    left -= 1;
  }
  return scored.map((row) => ({
    shareKey: row.shareKey,
    spendKey: row.spendKey,
    score: row.score,
    credit: row.base + (plus.has(row.shareKey.toString("hex")) ? 1 : 0),
    settled: 0,
  }));
}

function shareLeaf(share) {
  return Buffer.concat([
    share.shareKey,
    share.jobId,
    share.shareHash,
    u32le(share.ntime),
    u32le(share.nonce),
    share.signature,
  ]);
}

function payoutLeaf(credit) {
  return Buffer.concat([
    credit.shareKey,
    credit.spendKey,
    u64le(credit.credit),
    u64le(credit.settled),
  ]);
}

export function commitmentHash({
  shareRoot,
  payoutRoot,
  windowEndJobId,
  windowShareCount,
  rewardSats,
}) {
  const payload = Buffer.concat([
    Buffer.from([1]),
    shareRoot,
    payoutRoot,
    windowEndJobId,
    u32le(windowShareCount),
    u64le(rewardSats),
  ]);
  return taggedHash(TAG, payload);
}

// Payees come from the signed shares. A list carried next to the log is refused.
export function planPayout(log) {
  if (log.outputs || log.payouts || log.payoutScripts || log.payoutAmounts) {
    throw new Error("substituted payee list rejected");
  }
  if (log.version !== 1 || log.tag !== TAG) throw new Error("bad share log");
  if (log.windowShareCount !== WINDOW_SHARE_COUNT) throw new Error("window cap");
  const jobTxid = dsha256(Buffer.from(log.windowEndCoinbaseHex, "hex"));
  let shares = log.shares.map((share) => verifyShare(share, jobTxid));
  shares.sort(
    (a, b) =>
      a.ntime - b.ntime || a.nonce - b.nonce || Buffer.compare(a.shareHash, b.shareHash),
  );
  if (shares.length > log.windowShareCount) {
    shares = shares.slice(shares.length - log.windowShareCount);
  }
  const grouped = new Map();
  for (const share of shares) {
    const key = share.shareKey.toString("hex");
    const row = grouped.get(key);
    if (!row) {
      grouped.set(key, { shareKey: share.shareKey, spendKey: share.spendKey, score: 1 });
    } else if (!row.spendKey.equals(share.spendKey)) {
      throw new Error("spend key changed for a share key");
    } else {
      row.score += 1;
    }
  }
  const credits = splitReward(log.rewardSats, [...grouped.values()]);
  const shareRoot = merkleRoot(
    [...shares].sort((a, b) => Buffer.compare(a.shareHash, b.shareHash)).map(shareLeaf),
  );
  const payoutRoot = merkleRoot(
    [...credits].sort((a, b) => Buffer.compare(a.shareKey, b.shareKey)).map(payoutLeaf),
  );
  const hash = commitmentHash({
    shareRoot,
    payoutRoot,
    windowEndJobId: jobTxid,
    windowShareCount: log.windowShareCount,
    rewardSats: log.rewardSats,
  });
  const potScript = pot().script;
  const payable = credits
    .filter((credit) => credit.credit >= DUST)
    .sort((a, b) => Buffer.compare(a.shareKey, b.shareKey));
  const change = credits
    .filter((credit) => credit.credit < DUST)
    .reduce((sum, credit) => sum + credit.credit, 0);
  const outputs = [{ script: potScript, value: change, role: "change" }];
  for (const credit of payable) {
    outputs.push({
      script: p2wpkh(credit.spendKey),
      value: credit.credit,
      role: "hasher",
      shareKey: credit.shareKey,
    });
  }
  const paid = outputs.reduce((sum, output) => sum + output.value, 0);
  if (paid !== log.rewardSats) throw new Error("payout does not sum to the reward");
  return { hash, outputs, credits, potScript };
}

export function outputsEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i].value !== right[i].value) return false;
    if (!Buffer.from(left[i].script).equals(Buffer.from(right[i].script))) return false;
  }
  return true;
}

// Builds the Bitcoin transaction only. It does not decide who gets paid.
export function serializeDistribution(utxo, outputs) {
  const paid = outputs.reduce((sum, output) => sum + output.value, 0);
  if (paid !== utxo.value) throw new Error("payout must conserve the pot");
  const tx = {
    version: 2,
    locktime: 0,
    vin: [
      {
        txid: utxo.txid,
        vout: utxo.vout,
        scriptSig: Buffer.alloc(0),
        sequence: 0xffffffff,
        witness: pot().witness,
      },
    ],
    vout: outputs.map((output) => ({
      value: output.value,
      script: Buffer.from(output.script),
    })),
  };
  return serTx(tx).toString("hex");
}

// Conservation is not enough. The scripts and amounts have to be the ones
// planPayout derived from the share log.
export function buildPayoutTx(utxo, proposedOutputs, committedOutputs) {
  if (!outputsEqual(proposedOutputs, committedOutputs)) {
    throw new Error("substituted payee list rejected");
  }
  return serializeDistribution(utxo, committedOutputs);
}

export function publicShareLog({ rewardSats, windowEndCoinbaseHex, shares, spendCoinbaseTxid }) {
  return {
    version: 1,
    tag: TAG,
    windowShareCount: WINDOW_SHARE_COUNT,
    rewardSats,
    windowEndCoinbaseHex,
    spendCoinbaseTxid,
    shares: shares.map((share) => ({
      shareKey: share.shareKey.toString("hex"),
      spendKey: share.spendKey.toString("hex"),
      jobId: share.jobId.toString("hex"),
      ntime: share.ntime,
      nonce: share.nonce,
      headerPrev: share.headerPrev.toString("hex"),
      headerMerkle: share.headerMerkle.toString("hex"),
      headerBits: share.headerBits,
      signature: share.signature.toString("hex"),
    })),
  };
}

export function windowEndCoinbase(potScript) {
  const tx = coinbaseTx({
    height: 1,
    tag: "job1",
    outputs: [
      { value: 0, script: potScript },
      { value: 0, script: Buffer.concat([Buffer.from([0x6a, 0x20]), Buffer.alloc(32)]) },
    ],
  });
  const raw = serTx(tx);
  return { hex: raw.toString("hex"), txid: dsha256(raw) };
}
