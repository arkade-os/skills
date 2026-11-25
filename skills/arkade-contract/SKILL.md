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

This skill is used from a fresh project. The artifact is produced by the `writing-arkade-contracts` skill (`arkadec` `0.1.0` from [arkade-os/compiler](https://github.com/arkade-os/compiler), or `@arkade-os/sdk/compiler` with `@arkade-os/compiler` `0.1.0`). `covenant-viz` has already drawn the transactions. This skill spends that committed JSON. The same steps cover any contract. Function names on `contract.functions` are the function names in the `.ark` file. Spend the outputs that function checks. If the transaction omitted one, regenerate the README. Do not add an output the function does not check. When the spend is not exact and the function does not pin `tx.numOutputs`, the change `.change(script)` adds is drawn unconstrained.

Pull the SDK. It is not already in this project.

```bash
pnpm add @arkade-os/sdk
```

`@arkade-os/sdk` 0.5.8 or later is that package. `arkade.programFromArtifact` reads the `arkadec` artifact. It is not a separate named export. Do not clone the SDK, and do not pin an older tarball.

## Ownership

- `ContractWatcher` emits `vtxo_received` and `vtxo_spent`. It does not write repositories and it does not read VTXO state from the indexer.
- `ContractManager` is the only writer of contract and VTXO rows. It subscribes to the watcher and fetches fresh VTXOs from the indexer.
- `Wallet` and `ReadonlyWallet` read balance and VTXOs from repositories. Indexer sync goes through the manager.
- Repository interfaces carry `readonly version`. `ContractRepository` is version 3. Version 2 added `Contract.watch` (a row with no value is watched). Version 3 removed the unpaged `getContracts`; implementations provide `getContractsPage`. A new field bumps that version in the interface and every implementation (`inMemory`, `indexedDB`, `sqlite`, `realm`).
- The wallet owns keys. Ask `wallet.getNextSigningDescriptor()` and `wallet.signerForDescriptor(descriptor)`. Do not call `randomSecretKey()` for a signing key, and do not branch on wallet type.

## Load the artifact

Artifacts from compiler `0.1.0` and later need an SDK release that includes [ts-sdk#1266](https://github.com/arkade-os/ts-sdk/pull/1266) (operator key and exit delay). Nested arrays, `AssetGroupInput` and `AssetGroupOutput` also need [ts-sdk#1271](https://github.com/arkade-os/ts-sdk/pull/1271), and `{ contracts }` needs [ts-sdk#1235](https://github.com/arkade-os/ts-sdk/pull/1235). No release has any of them as of 2026-11-25. SDK 0.5.14 throws one of these before the contract has an address:

- `covenant leaf must sign with the emulator or a tweaked constructor key`
- `'$OPERATOR_KEY' is referenced but not declared in program params`, or the same for `'$OPERATOR_EXIT_DELAY'`
- `debug file needs a functions object`, when `{ contracts }` is passed

If the newest release still throws one, stop and report it. Do not edit the artifact, and do not bind `contract_…` keys by hand.

```ts
import { arkade } from "@arkade-os/sdk";
import artifact from "./contract.artifact.json" with { type: "json" };

const program = arkade.programFromArtifact(artifact);
// When the artifact instantiates child contracts with `new`:
// const program = arkade.programFromArtifact(artifact, { contracts: [childArtifact] });
```

`arkade.programFromArtifact` reads compiler `0.1.0` artifacts (and keeps reading `0.1.0-rc.1` artifacts) while preserving the compiler's opcodes. An artifact `functions` array is not a `Program`; `parseArtifact` rejects it and points here. `formatVersion`, when present, is 1. Ignore `updatedAt` when diffing artifacts. Pass a build's debug file as `{ debug }` (or bare `debug`) to attach `sourceMap` entries. To compile `.ark` sources directly in JS/TS, import `compile(input, { contracts, debug })` from `@arkade-os/sdk/compiler` with the optional peer `@arkade-os/compiler` (`^0.1.0`); it returns `{ program, artifact, debug?, diagnostics }`. Recompiling an older `0.1.0-rc.1` contract with `0.1.0` can change its Arkade Script and therefore its address; stored contracts keep the `Program` they were created with.

Compiler `0.1.0` emits `<OPERATOR_KEY>`, `<OPERATOR_KEY:fn>`, and `<OPERATOR_EXIT_DELAY>`. `programFromArtifact` maps `<OPERATOR_KEY>` to `server` and `<OPERATOR_EXIT_DELAY>` to `SERVER_EXIT_DELAY`. Until arkd and the emulator support a single operator key, `programFromArtifact` internally expands `<OPERATOR_KEY:fn>` into `<SERVER_KEY>` plus `<EMULATOR_KEY:fn>` (or `<EMULATOR_KEY:fn>` alone in a CSV leaf, without duplicating `<SERVER_KEY>` if `<OPERATOR_KEY>` or `<SERVER_KEY>` is already present). `OP_MERKLEBRANCHROOT` is the canonical opcode name (`OP_MERKLEBRANCHVERIFY` remains an encode alias). `checkTime` is `OP_CHECKTIME`.

When a contract instantiates other contracts with `new`, pass the artifact of every child it instantiates, directly or transitively, as one flat array in any order, in `options.contracts` on `programFromArtifact` or `compile`. The SDK recomputes each child's `codeHash` (SHA-256 of compact JSON excluding `source`, `compiler`, `updatedAt`, `fingerprint`, and `codeHash`, in `arkadec`'s own key order) and checks it against the parent's `contracts` pin. Keep the JSON `arkadec` wrote verbatim without reordering keys (for example, do not round-trip child artifacts through Postgres `jsonb`), or `codeHash` verification fails. Pre-`0.1.0` parent artifacts without `contracts` pins are refused. `client.contract()` compiles each child with the contract's `serverKey`, `emulatorKey`, and `client.serverExitDelay` from only the parent's mapped values (a child's `user` never falls back to the client's identity key), recurses for grandchildren, and binds each `contract_…` `bytes32` parameter to that child's 32-byte witness program automatically. Do not pass `contract_…` by hand; a mismatched value throws.

`older(operatorExitDelay)` is the exit leaf. Compiler `0.1.0` emits `<OPERATOR_EXIT_DELAY>` (older artifacts emit `<SERVER_EXIT_DELAY>`). That name is not a constructor input. Do not declare `exit` or `exitDelay`, and do not pass one. `arkade.programFromArtifact` maps `<OPERATOR_EXIT_DELAY>` to `SERVER_EXIT_DELAY` and binds the CSV as a sequence. `client.contract()` fills it from `getInfo().unilateralExitDelay`, as the BIP68 sequence, the same way an omitted `server` is filled from `client.serverKey`. A different value is refused. A seconds delay that is not a multiple of 512 is refused. Do not change `csv.type`. If the installed SDK rejects `<OPERATOR_EXIT_DELAY>` or leaves `$SERVER_EXIT_DELAY` undeclared, that package is behind compiler `0.1.0`. Do not put the delay back in the constructor.

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

`client.serverKey` is the operator key from `getInfo`. It is part of the taproot tree. It is not a key named in the contract. The emulator is required only when a path actually spends a covenant. `client.emulatorKey` is the 33-byte key from the SDK's network pin, not from the emulator's `/v1/info`. Encode it with `hex` from `@scure/base` and compare that string to the emulator's `signerPubkey` when a claim is refused.

## Constructor arguments

`client.contract(program, args)` stores these in the taproot tree. Match the Arkade header.

| Arkade type | Pass |
| --- | --- |
| `pubkey` | `await key.xOnlyPublicKey()`, 32 bytes |
| `bytes32` hash | `sha256(preimage)`. The signer signs the preimage |
| `ScriptPubKey` | `{ program, version }` (or `"name.program"` and `"name.version"`), with `version: 1n` for Taproot |
| `int` amount | satoshis, as `bigint` |
| `int` time | the clock that function reads |
| `bool` | `0` or `1` |
| `AssetId` | `{ txid, gidx: groupIndex }` (or `"name.txid"` and `"name.gidx"`), from `AssetId.fromString` |
| `AssetGroupInput` / `AssetGroupOutput` | `{ type, index, amount }` (`int`s, or `"name.type"`, `"name.index"`, `"name.amount"`) |
| `T[n]` / `T[a][b]` | nested arrays (e.g. `[[1n, 2n], [3n, 4n]]`) or flattened dotted names outermost index first (`"grid.0.1"`) |
| `<CONTRACT:...>` | derived automatically from `options.contracts`; do not pass by hand |

Structs (including structs containing nested arrays and arrays of structs) and nested fixed-size arrays flatten outermost index first (`grid.0.0` … `grid.1.2`) and can be passed whole by source name in `client.contract(program, args)` or by flattened dotted names. User structs cannot shadow built-in struct names (`AssetId`, `Outpoint`, `ECPoint`, `ScriptPubKey`, `AssetEntry`, `AssetLookup`, `AssetGroupInput`, `AssetGroupOutput`, `G2Point`).

An address decodes with `ArkAddress.decode`. `vtxoTaprootKey` is the 32-byte program for `"name.program"`. `pkScript` is what a spend pays: `OP_1` in front of those 32 bytes, hex `5120…`. The manager subscribes to that script. A key you hold becomes the same pair through `new DefaultVtxo.Script({ pubKey, serverPubKey: client.serverKey, csvTimelock: { type: "seconds", value: client.serverExitDelay } })` on mutinynet: `tweakedPublicKey` is the program, `pkScript` is the payment script. `csvTimelock.type` is `"blocks"` when `client.serverExitDelay` is below 512.

A function argument of type `ScriptPubKey` is one call argument, `{ program, version }`, not the two names a constructor takes. It is not the `pkScript` either.

A receive address is where a spend pays. It does not replace a `pubkey` argument.

If the program declares `server` or `user` and the caller omits them, `contract()` fills the client server key and the identity key. Explicit args win. `SERVER_EXIT_DELAY` is reserved the same way `server` is. `contract()` fills it from the operator. Do not pass an exit delay. Instantiated `<CONTRACT:…>` keys are also filled automatically from `options.contracts`; a child contract's `user` never falls back to the client's identity key.

## Spend

```ts
const contract = client.contract(program, args);
const [coin] = await contract.getUtxos();
if (!coin) throw new Error("No spendable contract coin is available");

await contract.functions
    .spend({ arkadeScript: [/* inputs, in source order */] })
    .from(coin)
    .to(destination.pkScript, coin.value)
    .send();
```

`.from` / `.to` / `.send()` talks to the operator and the emulator and signs with the session identity. A covenant spend is submitted through the emulator. A tapscript spend is submitted through the operator. Call whichever function the artifact declares, with one object that groups its inputs by the witness they fill. `arkadeScript` holds the inputs of an Arkade Script function. `tapscript` holds the inputs of a tapscript function other than signatures, which are PSBT signatures that `send()` adds for the session identity. An Arkade Script function and a tapscript function with the same name share one call, which can fill both lists. Each list takes one argument per source parameter, in source order, and a struct goes in whole. Leave out a list with no inputs, and call a function with no inputs with no arguments. A positional call throws. Outputs have to satisfy that function's `tx.outputs[i]` checks: value, script, and any asset amounts. `.to` takes the 34-byte `pkScript`.

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

The indexer coin at txid:vout is the position. `isSpent` false means open. `spentBy` is the spend. Constructor arguments are not on the transaction. `arkade.ArkadeContract.fromContract(client, row)` rebuilds from that stored row, so the address stays the one that was funded after a signer rotation or a change of the exit delay; persisted rows store only the resolved `bytes32` child keys, so `fromContract` restores without child artifacts. A second page with no shared storage gets the outpoint, the artifact (plus any child artifacts it instantiates, passed via `programFromArtifact(artifact, { contracts })`), and those recorded arguments, then `register()` and `refreshVtxos`. A fresh `client.contract(program, args)` binds this session's server key and exit delay (including for linked child contracts), which produces a different address when either changed. After a signer rotation or an exit-delay change, restore from the stored row with `fromContract` instead. Copying the wallet repository is not the restore. `wallet.restore()` still cannot derive the script from a seed.

Leave `metadata.genericallySpendable` unset unless this contract's coins are safe in a generic wallet send. The arkade handler treats anything but explicit `true` as not generically spendable, and `createContract` is first-writer-wins for that script.

Do not poll Esplora for a virtual transaction id. `GET /api/tx/<virtualTxid>` is 404. Ask Mempool only about a transaction that has been unrolled. On mutinynet that Esplora API is `https://mempool.mutinynet.arkade.sh/api`. The Arkade explorer is `https://explorer.mutinynet.arkade.sh/`.

`checkTime` reads the emulator clock, in unix seconds. `older(operatorExitDelay)` has not started before unroll. The delay is `client.serverExitDelay`, the operator's `unilateralExitDelay`. The session fills `<OPERATOR_EXIT_DELAY>` (bound as `SERVER_EXIT_DELAY`). Do not pass it.
