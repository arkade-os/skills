import fs from "node:fs";
import { rpcCall, rpcIdToInternal } from "./bitcoin.mjs";
import { buildPayoutTx, planPayout } from "./payout.mjs";

// No key, no prompt. Reads the public share log, checks it against the
// coinbase commitment, and broadcasts the one distribution that matches.
const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const cfg = { url: job.rpcUrl, user: job.rpcUser, password: job.rpcPassword };
const shareLog = job.shareLog;

function sats(vout) {
  return Math.round(vout.value * 1e8);
}

async function loadMatureCoinbase() {
  const deadline = Date.now() + 30000;
  let last = "missing";
  while (Date.now() < deadline) {
    try {
      const tx = await rpcCall(cfg, "getrawtransaction", [shareLog.spendCoinbaseTxid, true]);
      if ((tx.confirmations ?? 0) >= 100) return tx;
      last = `confirmations ${tx.confirmations ?? 0}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`coinbase is not mature: ${last}`);
}

const plan = planPayout(shareLog);
const coinbase = await loadMatureCoinbase();
if (sats(coinbase.vout[0]) !== shareLog.rewardSats) {
  throw new Error("pot value does not match the share log");
}
if (coinbase.vout[0].scriptPubKey.hex !== plan.potScript.toString("hex")) {
  throw new Error("coinbase does not pay the pot");
}
const committed = Buffer.concat([Buffer.from([0x6a, 0x20]), plan.hash]);
if (coinbase.vout[1].scriptPubKey.hex !== committed.toString("hex")) {
  throw new Error("coinbase commitment does not match the share log");
}
for (const vout of coinbase.vout.slice(1)) {
  if (sats(vout) !== 0) throw new Error("coinbase pays something other than the pot");
}

const utxo = {
  txid: rpcIdToInternal(shareLog.spendCoinbaseTxid),
  vout: 0,
  value: shareLog.rewardSats,
};
const hex = buildPayoutTx(utxo, plan.outputs, plan.outputs);
const txid = await rpcCall(cfg, "sendrawtransaction", [hex]);
for (const output of plan.outputs) {
  console.log(`${output.role} ${output.value}`);
}
console.log(`broadcast ${txid}`);
console.log("enforcement=automator");
