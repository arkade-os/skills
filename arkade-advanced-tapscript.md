---
name: arkade-advanced-tapscript
description: >-
  Advanced appendix for the Arkade skill — custom multi-path VTXO contracts,
  tapscript API signatures, and contract lifecycle APIs. Activates after the
  base arkade skill for custom tapscript contracts, multi-party VTXOs, or
  complex spending paths beyond simple send/receive.
read_when:
  - user wants to build custom VTXO contracts with multiple spending paths
  - user asks about mirror VTXO pattern or multi-path tapscript design
  - user needs exact API signatures for MultisigTapscript, CLTVMultisigTapscript, CSVMultisigTapscript
  - user asks about ConditionMultisigTapscript or ConditionCSVMultisigTapscript
  - user wants to spend from a custom VTXO with buildOffchainTx, submitTx, or finalizeTx
  - user asks about VHTLC.Script, DefaultVtxo.Script, or DelegateVtxo.Script
  - user asks about ContractManager or ContractWatcher
  - user is confused about when to use CLTV vs CSV
requires:
  - arkade
metadata:
  appendix_for: arkade
---

# Arkade Advanced — Custom Tapscript Contracts

This is an advanced appendix to the base Arkade skill. It covers custom multi-path VTXO contracts, tapscript API signatures, common contract classes, and lower-level spending APIs. These examples are aligned with `@arkade-os/sdk` v0.4.x APIs.

## Mirror Pattern

For a logical spending condition, model both the collaborative offchain path and the unilateral onchain fallback.

| Path | Includes operator key? | Timelock | Speed | Fallback model |
|------|------------------------|----------|-------|----------------|
| Collaborative offchain | Yes | CLTV for absolute time conditions | Instant | Requires operator liveness |
| Unilateral onchain | No | CSV for relative delays | Delayed | Enforced by Bitcoin L1 |

Guidelines:

- Collaborative paths include the operator pubkey because the operator cosigns preconfirmed offchain spends.
- Unilateral paths do not include the operator pubkey because they are the user fallback when the operator is unavailable.
- Use `CLTVMultisigTapscript` for absolute time conditions in collaborative paths.
- Use `CSVMultisigTapscript` or `ConditionCSVMultisigTapscript` for unilateral exit paths.
- Read the CSV exit delay from `getInfo().exitDelay` instead of hardcoding it.

General pattern:

```text
N logical paths x 2 mirrors = 2N tapscripts
  collaborative = logical signers + operator pubkey (+ CLTV for absolute time)
  unilateral    = logical signers + CSV delay (no operator pubkey)
```

## Operator Setup

```typescript
import { RestArkProvider } from "@arkade-os/sdk";
import { hex } from "@scure/base";

const arkProvider = new RestArkProvider("https://arkade.computer");
const info = await arkProvider.getInfo();

// info.signerPubkey is compressed. Tapscripts use the 32-byte x-only key.
const operatorPubkey = hex.decode(info.signerPubkey).slice(1);

// Arkade reports the exit delay in seconds. Use seconds-based CSV in production.
const exitDelay = BigInt(info.exitDelay);
```

## Tapscript Namespaces

The tapscript helpers are namespace objects with `.encode()`, `.decode()`, and `.is()`. They are not class constructors.

```typescript
const result = MultisigTapscript.encode({ pubkeys: [keyA, operatorPubkey] });
const script = result.script;
```

Avoid:

```typescript
new MultisigTapscript(...);
MultisigTapscript(...);
```

### MultisigTapscript

```typescript
import { MultisigTapscript } from "@arkade-os/sdk";

const result = MultisigTapscript.encode({
  type: MultisigTapscript.MultisigType.CHECKSIGADD,
  pubkeys: [keyA, keyB, operatorPubkey],
});
```

`type` is optional in the SDK and defaults to `CHECKSIG`, but set `CHECKSIGADD` explicitly when that is the intended multisig shape.

### CLTVMultisigTapscript

Use CLTV for absolute timelocks, commonly on collaborative paths.

```typescript
import { CLTVMultisigTapscript, MultisigTapscript } from "@arkade-os/sdk";

const expiry = BigInt(Math.floor(Date.now() / 1000)) + 86_400n;

const result = CLTVMultisigTapscript.encode({
  type: MultisigTapscript.MultisigType.CHECKSIGADD,
  pubkeys: [lenderPubkey, operatorPubkey],
  absoluteTimelock: expiry,
});
```

If funding is delayed significantly after building a CLTV script, rebuild the contract so the timestamp still matches the intended policy.

### CSVMultisigTapscript

Use CSV for relative timelocks, commonly on unilateral paths.

```typescript
import { CSVMultisigTapscript, MultisigTapscript } from "@arkade-os/sdk";

const result = CSVMultisigTapscript.encode({
  type: MultisigTapscript.MultisigType.CHECKSIGADD,
  pubkeys: [userPubkey],
  timelock: { type: "seconds", value: exitDelay },
});
```

Seconds-based CSV values must satisfy BIP-68 encoding constraints: at least 512 seconds and divisible by 512. Use block-based CSV only in testing environments where block production is controlled.

### ConditionMultisigTapscript

Use this for a condition plus collaborative multisig, such as hashlock claim paths.

```typescript
import { ConditionMultisigTapscript, MultisigTapscript } from "@arkade-os/sdk";
import { Script } from "@scure/btc-signer";
import { hash160 } from "@scure/btc-signer/utils.js";

const preimageHash = hash160(secret);
const conditionScript = Script.encode(["HASH160", preimageHash, "EQUAL"]);

const result = ConditionMultisigTapscript.encode({
  conditionScript,
  type: MultisigTapscript.MultisigType.CHECKSIGADD,
  pubkeys: [receiverPubkey, operatorPubkey],
});
```

### ConditionCSVMultisigTapscript

Use this for a condition plus unilateral CSV fallback.

```typescript
import { ConditionCSVMultisigTapscript, MultisigTapscript } from "@arkade-os/sdk";

const result = ConditionCSVMultisigTapscript.encode({
  conditionScript,
  type: MultisigTapscript.MultisigType.CHECKSIGADD,
  pubkeys: [receiverPubkey],
  timelock: { type: "seconds", value: exitDelay },
});
```

## VtxoScript

```typescript
import { VtxoScript, networks } from "@arkade-os/sdk";
import { hex } from "@scure/base";

const vtxoScript = new VtxoScript([
  collaborativePath.script,
  unilateralPath.script,
]);

const arkadeAddress = vtxoScript.address("ark", operatorPubkey).encode();

vtxoScript.tweakedPublicKey;
vtxoScript.pkScript;
vtxoScript.onchainAddress(networks.bitcoin);
vtxoScript.encode();

const leaf = vtxoScript.findLeaf(hex.encode(collaborativePath.script));
```

## Decode Existing Tapscripts

```typescript
import { decodeTapscript } from "@arkade-os/sdk";

const decoded = decodeTapscript(scriptBytes);
decoded.type;
decoded.params;
decoded.script;
```

## Prebuilt Contract Classes

Unlike the namespace `.encode()` helpers, these are classes that extend `VtxoScript`.

### VHTLC.Script

```typescript
import { VHTLC } from "@arkade-os/sdk";
import { hash160 } from "@scure/btc-signer/utils.js";

const vhtlc = new VHTLC.Script({
  sender: senderPubkey,
  receiver: receiverPubkey,
  server: operatorPubkey,
  preimageHash: hash160(secret),
  refundLocktime: BigInt(tipHeight + 144),
  unilateralClaimDelay: { type: "seconds", value: exitDelay },
  unilateralRefundDelay: { type: "seconds", value: exitDelay + 512n },
  unilateralRefundWithoutReceiverDelay: { type: "seconds", value: exitDelay + 1024n },
});

vhtlc.claim();
vhtlc.refund();
vhtlc.refundWithoutReceiver();
vhtlc.unilateralClaim();
vhtlc.unilateralRefund();
vhtlc.unilateralRefundWithoutReceiver();

const address = vhtlc.address("ark", operatorPubkey).encode();
```

### DefaultVtxo.Script

```typescript
import { DefaultVtxo } from "@arkade-os/sdk";

const vtxo = new DefaultVtxo.Script({
  pubKey: userPubkey,
  serverPubKey: operatorPubkey,
  csvTimelock: { type: "seconds", value: exitDelay },
});
```

### DelegateVtxo.Script

```typescript
import { DelegateVtxo } from "@arkade-os/sdk";

const vtxo = new DelegateVtxo.Script({
  pubKey: userPubkey,
  serverPubKey: operatorPubkey,
  delegatePubKey: delegatePubkey,
  csvTimelock: { type: "seconds", value: exitDelay },
});
```

## Lower-Level Spending Lifecycle

For most applications, prefer wallet and contract-manager APIs. Use the lower-level flow only when implementing custom spending.

```typescript
import {
  buildOffchainTx,
  CSVMultisigTapscript,
  RestIndexerProvider,
  Transaction,
} from "@arkade-os/sdk";
import { base64, hex } from "@scure/base";

const indexer = new RestIndexerProvider("https://arkade.computer");
const result = await indexer.getVtxos({
  scripts: [hex.encode(vtxoScript.pkScript)],
  spendableOnly: true,
});

const vtxo = result.vtxos[0];
const operatorUnrollScript = CSVMultisigTapscript.decode(
  hex.decode(info.checkpointTapscript),
);

const input = {
  txid: vtxo.txid,
  vout: vtxo.vout,
  value: vtxo.value,
  tapLeafScript: vtxoScript.findLeaf(hex.encode(collaborativePath.script)),
  tapTree: vtxoScript.encode(),
};

const outputs = [{
  amount: vtxo.value,
  script: recipientVtxoScript.pkScript,
}];

const { arkTx, checkpoints } = buildOffchainTx(
  [input],
  outputs,
  operatorUnrollScript,
);

const tx = Transaction.fromPSBT(arkTx.toPSBT());
const signedTx = await identity.sign(tx);

const { arkTxid, signedCheckpointTxs } = await arkProvider.submitTx(
  base64.encode(signedTx.toPSBT()),
  checkpoints.map((checkpoint) => base64.encode(checkpoint.toPSBT())),
);

const finalCheckpoints = await Promise.all(
  signedCheckpointTxs.map(async (checkpointB64) => {
    const checkpoint = Transaction.fromPSBT(base64.decode(checkpointB64));
    const signed = await identity.sign(checkpoint, [0]);
    return base64.encode(signed.toPSBT());
  }),
);

await arkProvider.finalizeTx(arkTxid, finalCheckpoints);
```

## Contract Lifecycle APIs

### ContractWatcher

`ContractWatcher` watches persisted contract records and emits contract events. The current API uses `addContract()` and `startWatching()`.

```typescript
import { ContractWatcher } from "@arkade-os/sdk";

const watcher = new ContractWatcher({
  indexerProvider,
  walletRepository,
  failsafePollIntervalMs: 60_000,
});

await watcher.addContract(contract);

const stop = await watcher.startWatching((event) => {
  console.log(`${event.type} on contract ${event.contractScript}`);
});

stop();
```

### ContractManager

`ContractManager.create()` takes repositories and an indexer provider. It does not take `wallet` or `arkProvider` directly.

```typescript
import { ContractManager } from "@arkade-os/sdk";

const manager = await ContractManager.create({
  indexerProvider,
  contractRepository,
  walletRepository,
});

const contract = await manager.createContract({
  label: "Custom VTXO",
  type: "custom",
  params: { role: "example" },
  script: hex.encode(vtxoScript.pkScript),
  address: vtxoScript.address("ark", operatorPubkey).encode(),
});

const unsubscribe = manager.onContractEvent((event) => {
  console.log(event.type, event.contractScript);
});

const contractsWithVtxos = await manager.getContractsWithVtxos();
const paths = await manager.getAllSpendingPaths({
  contractScript: contract.script,
});

unsubscribe();
manager.dispose();
```

## Quick Reference

Collaborative offchain paths:

- Include the operator pubkey.
- Use CLTV for absolute time conditions.
- Use `MultisigTapscript`, `ConditionMultisigTapscript`, or `CLTVMultisigTapscript`.

Unilateral onchain paths:

- Do not include the operator pubkey.
- Use CSV for relative time conditions.
- Use `CSVMultisigTapscript` or `ConditionCSVMultisigTapscript`.

Common gotchas:

- `operatorPubkey = hex.decode(info.signerPubkey).slice(1)` converts compressed to x-only.
- `.encode()` returns `{ type, params, script }`; pass `.script` into `VtxoScript`.
- `MultisigTapscript.encode()` defaults to `CHECKSIG`; set `CHECKSIGADD` explicitly when needed.
- Use `exitDelay` from `getInfo()` for CSV paths.
- `VtxoScript.address(prefix, operatorPubkey).encode()` is a two-step address encoding.
- Prebuilt `VHTLC`, `DefaultVtxo`, and `DelegateVtxo` scripts are constructors; tapscript helpers are namespaces.
