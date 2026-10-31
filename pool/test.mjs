import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  blockHex,
  chainAdvanceAddress,
  coinbaseTx,
  ensureBitcoind,
  NUMS,
  p2wpkh,
  pot,
  rpcCall,
  rpcIdToInternal,
  secp,
  sha256,
  startBitcoind,
  stopBitcoind,
  subsidyAt,
  witnessCommitmentScript,
} from "./bitcoin.mjs";
import {
  buildPayoutTx,
  collectShares,
  hasherFromSeed,
  planPayout,
  publicShareLog,
  serializeDistribution,
  windowEndCoinbase,
} from "./payout.mjs";

// Bitcoin Core regtest has no OP_CHECKTEMPLATEVERIFY. The pot leaf is OP_TRUE
// under the BIP341 NUMS key: no key-path spend, no CSV, no recovery key.
// buildPayoutTx is what rejects a substituted payee list. testmempoolaccept
// is asked as well, and a conserving substitution is allowed by bitcoind.

const daemonPath = fileURLToPath(new URL("./daemon.mjs", import.meta.url));

function sats(vout) {
  return Math.round(vout.value * 1e8);
}

function runDaemon(jobPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [daemonPath, jobPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`daemon timed out\n${stderr}\n${stdout}`));
    }, 20000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("hashers are paid from the committed PPLNS tree", async () => {
  const bin = await ensureBitcoind();
  const cfg = await startBitcoind(bin);
  try {
    const chain = chainAdvanceAddress();
    const valid = await rpcCall(cfg, "validateaddress", [chain.address]);
    assert.equal(valid.isvalid, true);

    await rpcCall(cfg, "generatetoaddress", [2850, chain.address]);
    assert.equal(await rpcCall(cfg, "getblockcount"), 2850);
    const template = await rpcCall(cfg, "getblocktemplate", [{ rules: ["segwit"] }]);
    assert.equal(template.height, 2851);
    assert.equal(template.coinbasevalue, subsidyAt(2851));
    assert.equal(template.coinbasevalue, 9536);
    assert.equal(template.transactions.length, 0);

    const ada = hasherFromSeed("ada");
    const bea = hasherFromSeed("bea");
    const cam = hasherFromSeed("cam");
    const windowEnd = windowEndCoinbase(pot().script);
    const job = {
      txid: windowEnd.txid,
      prevHash: rpcIdToInternal(template.previousblockhash),
      ntime: template.curtime,
    };
    const shares = [
      ...collectShares(ada, job, 20),
      ...collectShares(bea, job, 10),
      ...collectShares(cam, job, 1),
    ];
    const shareLog = publicShareLog({
      rewardSats: template.coinbasevalue,
      windowEndCoinbaseHex: windowEnd.hex,
      shares,
      spendCoinbaseTxid: null,
    });
    for (const hasher of [ada, bea, cam]) {
      assert.equal(JSON.stringify(shareLog).includes(hasher.sharePriv.toString("hex")), false);
    }
    const plan = planPayout(shareLog);
    const creditOf = (hasher) => {
      const credit = plan.credits.find((row) => row.shareKey.equals(hasher.shareKey));
      assert.ok(credit, hasher.name);
      return credit;
    };
    assert.equal(creditOf(ada).score, 20);
    assert.equal(creditOf(bea).score, 10);
    assert.equal(creditOf(cam).score, 1);
    assert.equal(creditOf(ada).credit, 6152);
    assert.equal(creditOf(bea).credit, 3076);
    assert.equal(creditOf(cam).credit, 308);
    assert.ok(creditOf(ada).credit !== creditOf(bea).credit);
    assert.ok(creditOf(cam).credit < 330);
    assert.equal(
      creditOf(ada).credit + creditOf(bea).credit + creditOf(cam).credit,
      template.coinbasevalue,
    );
    assert.equal(plan.outputs[0].role, "change");
    assert.equal(plan.outputs[0].value, creditOf(cam).credit);
    assert.equal(plan.outputs[0].script.toString("hex"), pot().script.toString("hex"));
    const paidScripts = plan.outputs.slice(1).map((output) => output.script.toString("hex"));
    assert.ok(paidScripts.includes(ada.script.toString("hex")));
    assert.ok(paidScripts.includes(bea.script.toString("hex")));
    assert.equal(paidScripts.includes(cam.script.toString("hex")), false);
    const amountOf = (hasher) =>
      plan.outputs.find((output) => output.script.equals(hasher.script)).value;
    assert.equal(amountOf(ada), creditOf(ada).credit);
    assert.equal(amountOf(bea), creditOf(bea).credit);

    const coinbase = coinbaseTx({
      height: template.height,
      tag: "pool",
      witnessNonce: Buffer.alloc(32),
      outputs: [
        { value: template.coinbasevalue, script: pot().script },
        { value: 0, script: Buffer.concat([Buffer.from([0x6a, 0x20]), plan.hash]) },
        { value: 0, script: witnessCommitmentScript() },
      ],
    });
    const mined = blockHex(template, coinbase);
    const submit = await rpcCall(cfg, "submitblock", [mined.hex]);
    assert.equal(submit, null);
    assert.equal(await rpcCall(cfg, "getbestblockhash"), mined.blockHash);

    const coinbaseTxOut = await rpcCall(cfg, "getrawtransaction", [mined.txidRpc, true]);
    assert.equal(sats(coinbaseTxOut.vout[0]), template.coinbasevalue);
    assert.equal(coinbaseTxOut.vout[0].scriptPubKey.hex, pot().script.toString("hex"));
    assert.equal(
      coinbaseTxOut.vout[1].scriptPubKey.hex,
      Buffer.concat([Buffer.from([0x6a, 0x20]), plan.hash]).toString("hex"),
    );
    assert.equal(coinbaseTxOut.vout.filter((vout) => sats(vout) > 0).length, 1);
    for (const hasher of [ada, bea, cam]) {
      assert.equal(
        coinbaseTxOut.vout.some((vout) => vout.scriptPubKey.hex === hasher.script.toString("hex")),
        false,
      );
    }
    assert.equal(
      coinbaseTxOut.vout.some((vout) => vout.scriptPubKey.hex === chain.script.toString("hex")),
      false,
    );

    const operatorScript = p2wpkh(
      Buffer.from(secp.getPublicKey(sha256(Buffer.from("operator")), true)),
    );
    assert.equal(
      coinbaseTxOut.vout.some((vout) => vout.scriptPubKey.hex === operatorScript.toString("hex")),
      false,
    );

    const utxo = { txid: mined.txid, vout: 0, value: template.coinbasevalue };
    const goodHex = buildPayoutTx(utxo, plan.outputs, plan.outputs);
    const early = await rpcCall(cfg, "testmempoolaccept", [[goodHex]]);
    assert.equal(early[0].allowed, false);
    assert.match(early[0]["reject-reason"], /premature/);

    await rpcCall(cfg, "generatetoaddress", [100, chain.address]);
    const matured = await rpcCall(cfg, "getrawtransaction", [mined.txidRpc, true]);
    assert.ok(matured.confirmations >= 100);

    assert.equal(plan.outputs[1].role, "hasher");
    assert.equal(plan.outputs[2].role, "hasher");
    const substituted = plan.outputs.map((output, index) =>
      index === 1 ? { script: operatorScript, value: output.value } : output,
    );
    assert.equal(
      substituted.reduce((sum, output) => sum + output.value, 0),
      utxo.value,
    );
    assert.throws(
      () => buildPayoutTx(utxo, substituted, plan.outputs),
      /substituted payee list rejected/,
    );
    const swapped = plan.outputs.map((output) => ({
      script: output.script,
      value: output.value,
    }));
    const firstAmount = swapped[1].value;
    swapped[1].value = swapped[2].value;
    swapped[2].value = firstAmount;
    assert.throws(
      () => buildPayoutTx(utxo, swapped, plan.outputs),
      /substituted payee list rejected/,
    );
    assert.throws(
      () => planPayout({ ...shareLog, payoutScripts: [operatorScript.toString("hex")] }),
      /substituted payee list rejected/,
    );

    const probe = await rpcCall(cfg, "testmempoolaccept", [
      [serializeDistribution(utxo, substituted)],
    ]);
    assert.equal(probe[0].allowed, true, JSON.stringify(probe[0]));
    assert.deepEqual(await rpcCall(cfg, "getrawmempool"), []);
    console.log(
      "Substituted payee list: rejected by the automator. Bitcoin Core allowed it (testmempoolaccept allowed=true); this regtest has no OP_CHECKTEMPLATEVERIFY.",
    );

    shareLog.spendCoinbaseTxid = mined.txidRpc;
    const again = planPayout(shareLog);
    assert.equal(again.hash.toString("hex"), plan.hash.toString("hex"));
    const jobPath = path.join(cfg.datadir, "share-log.json");
    fs.writeFileSync(
      jobPath,
      JSON.stringify({
        rpcUrl: cfg.url,
        rpcUser: cfg.user,
        rpcPassword: cfg.password,
        shareLog,
      }),
    );
    const daemon = await runDaemon(jobPath);
    assert.equal(daemon.code, 0, `${daemon.stderr}\n${daemon.stdout}`);
    console.log(daemon.stdout.trim());
    const txid = daemon.stdout.match(/broadcast ([0-9a-f]{64})/)[1];
    assert.deepEqual(await rpcCall(cfg, "getrawmempool"), [txid]);
    await rpcCall(cfg, "generatetoaddress", [1, chain.address]);

    const payout = await rpcCall(cfg, "getrawtransaction", [txid, true]);
    assert.ok(payout.confirmations >= 1);
    assert.equal(sats(payout.vout[0]), creditOf(cam).credit);
    assert.equal(payout.vout[0].scriptPubKey.hex, pot().script.toString("hex"));
    assert.equal(payout.vout.length, 3);
    const received = new Map(payout.vout.map((vout) => [vout.scriptPubKey.hex, sats(vout)]));
    assert.equal(received.get(ada.script.toString("hex")), creditOf(ada).credit);
    assert.equal(received.get(bea.script.toString("hex")), creditOf(bea).credit);
    assert.equal(received.has(cam.script.toString("hex")), false);
    assert.equal(received.has(operatorScript.toString("hex")), false);
    assert.equal(received.has(chain.script.toString("hex")), false);
    assert.equal(
      [...received.values()].reduce((sum, value) => sum + value, 0),
      template.coinbasevalue,
    );
    const witness = payout.vin[0].txinwitness;
    assert.deepEqual(witness[0], "51");
    assert.equal(witness.length, 2);
    assert.match(witness[1], /^c[01]/);
    assert.equal(witness[1].slice(2), NUMS.toString("hex"));
    assert.equal(await rpcCall(cfg, "gettxout", [mined.txidRpc, 0]), null);

    console.log(
      `RESULT ada=${creditOf(ada).credit} bea=${creditOf(bea).credit} cam_output=none change=${creditOf(cam).credit} operator=0 enforcement=automator bitcoind_rejected_substituted_payout=false`,
    );
  } finally {
    await stopBitcoind(cfg);
  }
});
