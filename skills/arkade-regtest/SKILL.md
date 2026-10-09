---
name: arkade-regtest
description: >
  Run Arkade regtest and prove any Arkade contract with one end-to-end test.
  Use for ArkLabsHQ/arkade-regtest, arkd, the Bitcoin faucet, notes, asset
  issuance, and the emulator. Use when testing an Arkade smart contract on
  regtest. Do not write unit tests. Do not use for contract authoring.
---

# Arkade regtest

This skill is used from a fresh project. Pull the stack. It is not already checked out.

```bash
git clone --depth 1 https://github.com/ArkLabsHQ/arkade-regtest.git regtest
printf 'AUTOMINE_INTERVAL=0\n' > .env.regtest
node regtest/regtest.mjs start --env .env.regtest --profile ark --profile emulator
```

[arkade-regtest](https://github.com/ArkLabsHQ/arkade-regtest) is Docker images plus a Node CLI: Bitcoin Core, mempool (Esplora under `/api`), arkd, and the emulator. Docker with the compose plugin, and Node 18 or newer. No `npm install` inside `regtest/`. Ignore that directory. `start` initializes the `ark` client and seeds it with offchain funds.

## One-shot stack

`node regtest/regtest.mjs start` with no profile flag brings up the full stack. A contract test needs `ark` and the emulator, as in the clone command above.

Stop with `node regtest/regtest.mjs stop` (volumes stay). Wipe with `node regtest/regtest.mjs clean`. The SDK checkout's `pnpm run regtest:*:ts-sdk` scripts call this same CLI. Use them only when the working tree is that checkout.

`AUTOMINE_INTERVAL=0` has to be loaded at `start`, as in the command above. The CLI reads `--env <path>` when you pass it, and otherwise the clone's parent `.env.regtest` or `regtest/.env`. A value already in the environment wins over those files. The default auto-miner (one block every 600 seconds) moves block-denominated expiry and sweeps under a running test. Mine with `node regtest/regtest.mjs mine [n]`.

Defaults that matter: arkd `http://localhost:7070` (admin `7071`), Esplora `http://localhost:3000/api`, emulator `http://localhost:7073`, arkd wallet `http://localhost:6060`. The SDK's regtest Esplora default is that `/api` URL. Bitcoin Core RPC is `localhost:18443`, user `admin1`, password `123`.

arkd's default locktimes in this stack are below 512, so they are blocks. Public arkd rejects that. A test of an exit leaf passes the duration the target operator expects: a block count with `csv.type` `"blocks"` on this stack, or seconds (a multiple of 512) with `csv.type` `"seconds"` for public arkd.

## Fund

Onchain, from the node wallet. Amount is BTC. `--confirm` mines one block; without it the coin sits unconfirmed.

```bash
node regtest/regtest.mjs faucet <address> 0.001 --confirm
```

Offchain, the stack's `ark` client sends sats to an Arkade address. The password in the e2e helpers is `secret`.

```bash
docker exec arkd ark send --to <address> --amount 20000 --password secret
```

The SDK checkout has the same commands in `vendor/ts-sdk/packages/ts-sdk/test/e2e/utils.ts` (`faucetOnchain`, `faucetOffchain`, `mineBlocks`, `beforeEachFaucet`). Copy what this test needs to the bottom of its own file. Do not import that module. `beforeEachFaucet` redeems a fresh note because spent rounds leave notes the balance still shows and `ark send` cannot spend:

```bash
docker exec arkd arkd note --amount 200000
docker exec arkd ark redeem-notes -n <note> --password secret
```

Run this project's one end-to-end file against the stack you just started. The SDK checkout's `pnpm run test:integration:ts-sdk` is that repo's own suite, not this project's test.

## Issue an asset

Fund an offchain wallet first, then `wallet.assetManager.issue({ amount })`. Skip this when the contract under test locks only sats. The result's `assetId` is genesis txid plus group index; `AssetId.fromString` splits it into the `bytes32` and `int` a constructor stores.

A control asset is an issuance of amount `1n`. A later `issue({ amount, controlAssetId })` mints under that control. Poll `getVtxos()` until the amount is present. The indexer trails a settle and a mine; `waitFor` on the vtxo. When a locktime must still be immature, read Bitcoin Core with `node regtest/regtest.mjs rpc getblockcount`. An Esplora tip lags that height.

## One functional test

Do not write unit tests. Do not add a file that compiles the artifact and counts opcodes, and do not add a test per `require`. Write one end-to-end test against this running stack, and make that one complete.

The test is the contract's real life, in order, in this one file: the stack answers, coins arrive from the faucet, assets are issued only when the contract locks them, the artifact is registered and funded, each spend function a party can run is run, and the indexer shows the coin leaving on `vtxo_spent`. A continuation pays the next script that function names. A coin whose reading moves is asserted by the amount on the continuing output. A path that must fail is one step in that same test, with the output or the clock the contract rejects.

One of those steps sends sats to the contract address and fails if the UI counts that coin as the contract's position. That send is a second coin. Only a spend that continues the contract coin changes the position.

Virtual txids are not on Esplora. Assert through the indexer. Mine, then ask Esplora, only for an unrolled exit.

A refused emulator signature is a key mismatch until `hex.encode(client.emulatorKey)` differs from the pubkey the emulator serves. Compare those before changing the contract.

If the stack is down, stop. A failing spend will not explain a down arkd. `curl -sf http://localhost:7070/v1/info` and, when the contract has a covenant, the emulator on port 7073.

## Shape of the file

The test is the body of the file. Helpers go at the end. Funding, waiting on the indexer, building constructor args, and decoding an asset id are functions below the test, not a prelude and not a second module of unit tests.
