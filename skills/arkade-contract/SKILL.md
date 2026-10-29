---
name: arkade-contract
description: >
  Spend any Arkade smart contract on mutinynet. The page subscribes,
  ContractManager writes, and the screen reads the repository after
  vtxo_received and vtxo_spent. Use after covenant-viz, for
  programFromArtifact and @arkade-os/sdk. Do not use for the product
  decision, the picture, the UI, or regtest.
---

# Spend any Arkade contract

This skill is used from a fresh project. The artifact is produced by the `writing-arkade-contracts` skill (`arkadec` from a clone of [arkade-os/compiler](https://github.com/arkade-os/compiler)). `covenant-viz` has already drawn the transactions. This skill spends that committed JSON. The same steps cover any contract. Function names on `contract.functions` are the function names in the `.ark` file. Spend the outputs that function checks. If the picture omitted one, regenerate the picture. Do not add an output the function does not check.

Pull the SDK. It is not already in this project.

```bash
pnpm add @arkade-os/sdk
```

`@arkade-os/sdk` 0.5 is that package. `arkade.programFromArtifact` reads the `arkadec` artifact. It is not a separate named export. Do not clone the SDK, and do not pin an older tarball.

## Ownership

- `ContractWatcher` emits `vtxo_received` and `vtxo_spent`. It does not write repositories and it does not read VTXO state from the indexer.
- `ContractManager` is the only writer of contract and VTXO rows. It subscribes to the watcher and fetches fresh VTXOs from the indexer.
- `Wallet` and `ReadonlyWallet` read balance and VTXOs from repositories. Indexer sync goes through the manager.
- Repository interfaces carry `readonly version`. `ContractRepository` is version 3. Version 2 added `Contract.watch` (a row with no value is watched). Version 3 removed the unpaged `getContracts`; implementations provide `getContractsPage`. A new field bumps that version in the interface and every implementation (`inMemory`, `indexedDB`, `sqlite`, `realm`).
- The wallet owns keys. Ask `wallet.getNextSigningDescriptor()` and `wallet.signerForDescriptor(descriptor)`. Do not call `randomSecretKey()` for a signing key, and do not branch on wallet type.

## Load the artifact

```ts
import { arkade } from "@arkade-os/sdk";
import artifact from "./contract.artifact.json" with { type: "json" };

const program = arkade.programFromArtifact(artifact);
```

`arkade.programFromArtifact` keeps the compiler's opcodes. An artifact `functions` array is not a `Program`; `parseArtifact` rejects it and points here. `formatVersion`, when present, is 1. Ignore `updatedAt` when diffing artifacts. Each `<CONTRACT:...>` placeholder becomes a `bytes32` parameter. Pass that child output's 32-byte witness program under the name on `program.params`.

`checkTime` is `OP_CHECKTIME`. The SDK already supports it.

`older(serverExitDelay)` is the exit leaf. The compiler emits `<SERVER_EXIT_DELAY>`. That name is not a constructor input. Do not declare `exit` or `exitDelay`, and do not pass one. `arkade.programFromArtifact` declares `SERVER_EXIT_DELAY` and binds the CSV as a sequence. `client.contract()` fills it from `getInfo().unilateralExitDelay`, as the BIP68 sequence, the same way an omitted `server` is filled from `client.serverKey`. A different value is refused. A seconds delay that is not a multiple of 512 is refused. Do not change `csv.type`. If the installed SDK leaves `$SERVER_EXIT_DELAY` undeclared, that package is behind this compiler. Do not put the delay back in the constructor.

A constructor `int` in `older(name)` is a different leaf, for a delay that varies per instance. The artifact pushes that integer raw. Pass the BIP68 sequence. A literal sequence already in the artifact is decoded with `sequenceToTimelock`. Leave every other opcode alone.

## Open a session

```ts
import { Arkade, InMemoryContractRepository, networks } from "@arkade-os/sdk";

const client = await Arkade.connect({
    service: {
        operatorUrl: "https://mutinynet.arkade.sh",
        emulatorUrl: "https://emulator.mutinynet.arkade.sh",
    },
    storage: {
        contractRepository: new InMemoryContractRepository(),
    },
    network: networks.mutinynet,
});
```

`service` resolves the operator, the indexer, and Esplora, and the emulator when `emulatorUrl` is set. `storage` builds the contract manager this client owns, including the chain tip. `client.dispose()` stops that manager. A manager built by hand has to pass `chainTip` from the onchain provider. Without a tip, a height-typed lock reads as unsatisfied.

Mutinynet is the default session: `https://mutinynet.arkade.sh` for the operator and the indexer, `https://emulator.mutinynet.arkade.sh` for the emulator, `https://mempool.mutinynet.arkade.sh/api` for Esplora, and `https://explorer.mutinynet.arkade.sh/` for the Arkade explorer. That build has no local faucet and no zeroed fees.

Leave `identity` off when this session only watches or spends leaves that do not need a local signer. `ReadonlyWallet` is the wrong stand-in: it requires a pubkey and then watches that pubkey's scripts. Pass `identity` only when a leaf needs this session to sign.

A `Wallet` already owns a manager and both repositories. Pass `contractManager: await wallet.getContractManager()` and omit `storage`. Passing both throws. Do not construct a second manager beside the wallet and write the same scripts through both.

`client.serverKey` is the operator key from `getInfo`. It is part of the taproot tree. It is not a key named in the contract. The emulator is required only when a path actually spends a covenant. `client.emulatorKey` comes from the SDK's network pin, not from the emulator's `/v1/info`. Compare the two when a claim is refused.

## Constructor arguments

`client.contract(program, args)` stores these in the taproot tree. Match the Arkade header.

| Arkade type | Pass |
| --- | --- |
| `pubkey` | `await key.xOnlyPublicKey()`, 32 bytes |
| `bytes32` hash | `sha256(preimage)`. The signer signs the preimage |
| `ScriptPubKey` | `"name.program"` is the witness program, `"name.version"` is `1n` for Taproot |
| `int` amount | satoshis, as `bigint` |
| `int` time | the clock that function reads |
| `bool` | `0` or `1` |
| asset id | `AssetId.fromString` gives `txid` and `groupIndex`. Pass those under the constructor's `bytes32` and `int` names. A parameter of type `AssetId` is `"name.txid"` and `"name.gidx"` |
| `<CONTRACT:...>` | the `bytes32` name on `program.params`, set to that child output's 32-byte program |

An address decodes with `ArkAddress.decode`. `vtxoTaprootKey` is the 32-byte program for `"name.program"`. `pkScript` is what a spend pays: `OP_1` in front of those 32 bytes, hex `5120…`. The manager subscribes to that script. A key you hold becomes the same pair through `new DefaultVtxo.Script({ pubKey, serverPubKey: client.serverKey, csvTimelock: { type: "seconds", value: client.serverExitDelay } })` on mutinynet: `tweakedPublicKey` is the program, `pkScript` is the payment script. `csvTimelock.type` is `"blocks"` when `client.serverExitDelay` is below 512.

A function argument of type `ScriptPubKey` is two call arguments, program then version, in source order. A `ScriptPubKey` argument is not the `pkScript`.

A receive address is where a spend pays. It does not replace a `pubkey` argument.

If the program declares `server` or `user` and the caller omits them, `contract()` fills the client server key and the identity key. Explicit args win. `SERVER_EXIT_DELAY` is reserved the same way `server` is. `contract()` fills it from the operator. Do not pass an exit delay.

## Spend

```ts
const contract = client.contract(program, args);
const [coin] = await contract.getUtxos();
if (!coin) throw new Error("No spendable contract coin is available");

await contract.functions
    .spend(/* witnesses, in source order */)
    .from(coin)
    .to(destination.pkScript, coin.value)
    .send();
```

`.from` / `.to` / `.send()` talks to the operator and the emulator and signs with the session identity. A covenant spend is submitted through the emulator. A tapscript spend is submitted through the operator. Call whichever function the artifact declares, with its inputs in source order. A function with no inputs is called with none. Outputs have to satisfy that function's `tx.outputs[i]` checks: value, script, and any asset amounts. `.to` takes the 34-byte `pkScript`.

`.fund(coins)` adds inputs after the contract coin, signed with the client identity. `.withAsset(spec)` moves an asset group. `.change(script)` is required when the spend is not exact.

`.build()` assembles without broadcasting. `.build()` and `.send()` throw when the leaf has `older`: the offchain builder would create a fresh checkpoint. That exit spends the unrolled onchain output. Take `contract.leafScript(index)`, set the input sequence to that leaf's CSV sequence, sign input 0 with each required key, and broadcast that transaction.

## Watch

```ts
const contract = client.contract(program, args);
const received = await contract.on("vtxo_received", (event) => {
    // funded. event.vtxos
});
const spent = await contract.on("vtxo_spent", (event) => {
    // a function ran; the spending tapleaf says which
});
await contract.on("connection_reset", async () => {
    await contract.getVtxos();
});
```

`on` registers the contract, then listens. It does not replay coins already stored. After `on`, and on every `connection_reset`, read `getVtxos()`. That list includes spent coins. `getUtxos()` is the spendable subset and drops spent and unrolled coins. An empty `getUtxos()` does not mean the contract was never funded. The spent coin arrives on `vtxo_spent`. Its `spentBy` is the spending transaction. `received.off()` stops that one handle.

The page subscribes. `ContractManager` is the writer. The screen reads the repository after that first read, and after `vtxo_received` and `vtxo_spent`. A reload that still shows 0 for a coin the indexer has is a failed test.

`register({ label })` is the same write `on` performs. It stores the program, constructor args, and the server and emulator keys, and adds `pkScript` to the manager's one subscription. Do not also call `indexer.subscribeForScripts`. The same script again is a no-op and does not refetch history. If the first fetch fails, backfill with `client.contractManager.refreshVtxos({ scripts: [row.script], after: 0 })`, where `row` is what `register()` returned.

The indexer coin at txid:vout is the position. `isSpent` false means open. `spentBy` is the spend. Constructor arguments are not on the transaction. `arkade.ArkadeContract.fromContract(client, row)` rebuilds from that stored row, so the address stays the one that was funded after a signer rotation or a change of the exit delay. A second page with no shared storage gets the outpoint, the artifact, and those recorded arguments, then `register()` and `refreshVtxos`. A fresh `client.contract(program, args)` binds this session's server key and exit delay, which is a different address when either changed. Copying the wallet repository is not the restore. `wallet.restore()` still cannot derive the script from a seed.

Leave `metadata.genericallySpendable` unset unless this contract's coins are safe in a generic wallet send. The arkade handler treats anything but explicit `true` as not generically spendable, and `createContract` is first-writer-wins for that script.

Do not poll Esplora for a virtual transaction id. `GET /api/tx/<virtualTxid>` is 404. Ask Mempool only about a transaction that has been unrolled. On mutinynet that Esplora API is `https://mempool.mutinynet.arkade.sh/api`. The Arkade explorer is `https://explorer.mutinynet.arkade.sh/`.

`checkTime` reads the emulator clock, in unix seconds. `older(serverExitDelay)` has not started before unroll. The delay is `client.serverExitDelay`, the operator's `unilateralExitDelay`. The session fills `<SERVER_EXIT_DELAY>`. Do not pass it.
