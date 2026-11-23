---
name: writing-arkade-contracts
description: >
  Author and edit an Arkade smart contract in `.ark`, and compile it with
  arkadec to an artifact. Use for constructor state, spend functions,
  tapscript leaves, witnesses, output layouts, oracle checks, recursive
  beacons, timelocks, and fixed-point arithmetic. Do not use for compiler
  implementation, spending the artifact, the covenant pictures, the product
  UI, or Arkade regtest.
---

# Writing Arkade Contracts

This skill is used from a fresh project. Compiler `0.1.0` is released (`arkadec` on GitHub Releases, `cargo install arkade-compiler --locked`, or `@arkade-os/compiler` `0.1.0` for JS/TS). Clone the repository for `compiler/examples/`, the grammar, and source builds when no `arkadec` binary is installed.

```bash
git clone --depth 1 https://github.com/arkade-os/compiler.git compiler
```

Ignore `compiler/`. Compiler `0.1.0` compares `.script` (a `ScriptPubKey`), emits `<OPERATOR_KEY:fn>` and `<OPERATOR_EXIT_DELAY>`, and pins instantiated child contracts by `codeHash`. Commit the `.ark` file, the artifact, and the `covenant-viz` README in one commit. Leave the compiler checkout untracked. Paths below are inside the clone.

Open each contract with `pragma arkade ^0.1.0;`. Compiler `0.1.0` enforces the pragma against its version.

Run `arkade-product` first. This file records those choices. It does not invent them.

## The leaf rule

A covenant function with no replacing tapscript synthesizes `<OPERATOR_KEY:fn> OP_CHECKSIG` (`tweak(operator, fn)`), which the SDK expands to the server key plus the function-tweaked emulator key until arkd and the emulator move to a single operator key. Anyone who can build that transaction can pass the `require`. A `require` checks the transaction. It does not identify who may move the coins.

A leaf that is the receiver's signature names their key on the script they took the coins on, as `compiler/examples/option/option_intent.ark` does. Spending those coins is the signature. A standing address accepts sats and names the outputs in its constructor. The submitter does not choose them.

```ark
function finalize() {
  require(tx.numOutputs == 2, "two outputs");
  require(tx.outputs[0].value >= userAmount, "user");
  require(tx.outputs[0].script == userScript, "user");
  require(tx.outputs[1].value >= committedAmount, "committed");
  require(tx.outputs[1].script == committedScript, "committed");
}
```

`userScript` and `committedScript` are constructor `ScriptPubKey`s. `userAmount` and `committedAmount` are constructor `int`s. All four are agreed when the address was funded. When the order moves an asset, check `tx.outputs[i].assets.lookup(assetId)` for that committed amount the same way. A change output is another counted output, with its script checked too. A `checkMultisig` of keys fixed in the constructor only says who may sign. It does not say where the value goes. Put the standing offer beside `compiler/examples/escrow/escrow.ark`, and start from `OptionIntent` when the receiver's script is the authorization.

If the output scripts are arguments of the function, its signer can pay themselves. Pin those scripts in the address that gets funded. That spend approves those outputs, or returns the coins to the funder.

## Standing orders

A standing order is that address, funded once. The funder does not come back online. A later transaction spends the order as one input. The order's `require`s check the outputs. `compiler/examples/option/option_intent.ark` and `compiler/examples/non_interactive_swap/non_interactive_swap.ark` are that shape: the offer is locked, and the other side completes it.

The completing transaction still needs a signature only from whoever is spending their own extra input. The order itself does not ask the funder to sign.

## A continuation draws on an order

A contract that continues itself can take the standing order as another input and pull its value into the next coin. That output's value is at least this coin plus the order. A fee or another payee is a further output, with its script and amount checked, subtracted from that minimum.

```ark
function draw() {
  require(tx.numInputs == 2, "standing order");
  require(tx.inputs[1].script != tx.input.current.script, "one order");
  require(tx.outputs[0].script == tx.input.current.script, "same vault");
  require(tx.outputs[0].value >= tx.input.current.value + tx.inputs[1].value);
}
```

Input 0 is the continuing contract. Input 1 is the order. The order's own script is what allows this continuation: its constructor already named these outputs. Check `tx.numInputs` and the sibling script. A second copy of the same order must not reuse the same outputs. `compiler/examples/fuji_safe/fuji_safe.ark` and `compiler/examples/constant_product/cp_pool.ark` continue themselves with `tx.outputs[0].script == tx.input.current.script`.

## A staging output postpones the payout

A payee written in the constructor is fixed when the coin is created. A staging output moves that choice to a later call. This function pays a new coin whose script is the staging contract. The next call of that coin pays someone, or rolls the stage again.

```ark
function postpone() {
  require(tx.outputs[0].script == new Staging(stageOwner, stageTimeout));
  require(tx.outputs[0].value >= tx.input.current.value);
}
```

`Staging` is an imported child contract, and `new` arguments must be whole constructor parameters, constants, or literals — never witnesses or computed expressions; variable amounts move in the output's `value` or assets. The original constructor never stored the payee. The later call is the one that pays, and it still has to name its outputs from its own rules. An argument that lets the caller pick any script is the same hole as an unpinned output.

## A token is the right

`checkSig` means that pubkey has to be online. A token on a script the receiver can spend is the right instead. Dispense it onto their script. Exercising the right spends that coin and burns the token: the group leaves with fewer units than it entered, or the units go to an output the contract names and nobody can spend.

```ark
function exercise() {
  let group = tx.assetGroups.lookup(rightAssetId);
  require(group.sumInputs == group.sumOutputs + 1, "burn the right");
}
```

No `checkSig` on that path. Spending the coin that held the token is the authorization. `rightAssetId` is a constructor `AssetId` naming that token; all asset and asset-group lookups take a single `AssetId`. `compiler/examples/fuji_safe/fuji_safe.ark` pays a constructor-pinned burn script and still requires the borrower's signature. `compiler/examples/controlled_mint/controlled_mint.ark` burns the control asset to end issuance, and the issuer signs that path. Those are different burns: one spends a right, the other retires the mint.

## The anchor

The first issuance leaves one unit of the control asset on the coin. A reissue cannot name the control asset, so that unit is the anchor the next issuance continues. `.withAsset()` moves a group that already exists. It cannot express a fresh issue.

330 sats is the carrier on a Taproot output. The value the contract tracks is the sats above that carrier, or the asset amount on the continuing coin. A direct send creates a second coin beside the one the contract continues. Only a spend that pays the continuation script changes the position the contract tracks.

## Start from working code

Read the closest contracts in `compiler/examples/`, then verify syntax against `compiler/src/parser/grammar.pest` and behavior against the compiler and tests. Treat examples and tests as authoritative when prose disagrees.

Compile early:

```bash
cargo run --manifest-path compiler/Cargo.toml -- path/to/contract.ark -o contract.artifact.json
```

## Model state and spend paths

- Put committed state in constructor parameters and per-spend data in function parameters. Declare those parameters in source order. A covenant witness is that list reversed; a tapscript witness follows the tapscript parameter list.
- Constructor parameters are placeholders until instantiation, then constants in the script. Spend paths assume the agreed values. There is no constructor hook, so a domain check inside a spend does not run at compile time and does not see a different value than the one already committed.
- Continue the same contract with `tx.outputs[i].script == tx.input.current.script` or `this.tunnel(...)`; a contract cannot instantiate itself.
- Construct a different imported contract with `new ChildContract(...)` (using only whole constructor parameters, constants, or literals) and assert its output script and minimum value. `tx.outputs[i].script` is a `ScriptPubKey` with `program` and `version`, not the `5120…` script a transaction pays. `new` returns that struct at witness version 1, so the comparison checks the program and the version. Bind the script and read `.program` only when the version must stay out of the check. `tx.input.current.script` is the same struct (`this.activeBytecode` is removed). A destination parameter is a `ScriptPubKey`, not a `bytes32`.
- Use covenant `function name(...) { ... }` bodies for introspection and state-transition rules.
- Use `function name(...) tapscript { ... }` only for L1 authorization, hashes, and timelocks supported by `compiler/src/compiler/tapscript.rs`.

A covenant function with no replacing tapscript gets a synthesized collaborative leaf: `<OPERATOR_KEY:fn> OP_CHECKSIG` (`checkSig(operatorSig, tweak(operator, fn))`), which the SDK currently expands to the server key plus the function-tweaked emulator key until arkd and the emulator move to a single operator key. Add an explicit tapscript only when that authorization is insufficient.

Author-written tapscript rules:

- Any non-CSV leaf must include `operator` or `tweak(operator, fn)`.
- A tapscript with the same name as an Arkade Script function replaces its synthesized leaf, must have no CSV delay, and must tweak at least one key to that function (`tweak(operator, fn)` or `tweak(constructorPubkey, fn)`). Bare `operator` is never tweaked implicitly.
- A CSV tapscript bound to an Arkade Script function must take a different name and tweak a key to that function; it sits beside the function's synthesized leaf in the spend group.
- Every tweaked key in one tapscript must name the same function.
- Tapscript `checkMultisig([keys], [sigs])` takes no threshold (always N-of-N).

Add unilateral exit as a separate CSV tapscript when required:

```ark
function unilateral(signature ownerSig) tapscript {
  require(older(operatorExitDelay));
  require(checkSig(ownerSig, owner));
}
```

`operatorExitDelay` is a reserved placeholder, the same kind as `operator`. `older(operatorExitDelay)` lowers to `<OPERATOR_EXIT_DELAY>`. It is not a constructor parameter. The caller does not pass an exit delay. The SDK maps `<OPERATOR_EXIT_DELAY>` to its reserved `SERVER_EXIT_DELAY` binding and fills it from the operator's `unilateralExitDelay`, the same way it maps `<OPERATOR_KEY>` to `server` and fills it from the operator key. For a different fixed delay, write `older(seconds(n))` with a literal or `int` constant. Take a constructor `int` only when the delay varies per instance; it is pushed raw, so the caller passes the BIP68 sequence.

Keep `operator` and `operatorExitDelay` out of constructor parameters, constants, covenant bodies, and tapscript inputs. Use `operator` only as a key operand in tapscript signature checks (bare or in `tweak(operator, fn)`), and declare its signature witness (`signature operatorSig`) on author-written tapscripts. Use `operatorExitDelay` only in `older(operatorExitDelay)`. The old `server`, `emulator`, and `serverExitDelay` names are removed.

Do not use the removed `options { ... }` syntax.

## Design outputs before code

Treat output positions as part of the contract interface. If an output is conditional, write complete assertions for each branch because later output indices shift.

Prefer routing a sub-dust amount into an existing output when ownership remains correct. Follow the current project convention:

- Require at least 330 sats for a viable Taproot output.
- Emit an optional output only when its value is greater than 330 sats.

Use `>=` for minimum funding assertions unless exact value is a genuine invariant.

## Handle witnesses and time safely

Reconstruct oracle messages with the exact field order and encoding used by the signer. Follow `compiler/examples/escrow/escrow.ark` or `compiler/examples/threshold_oracle/threshold_oracle.ark`.

Do not mix time domains:

- `checkTime(timestamp)` reads the emulator clock in Unix seconds and compiles to `OP_CHECKTIME`. Put it in `require`. The operator runs that clock and can accept the spend early. Offchain spends of the leaf are rebuilt with nLockTime 0, so `tx.locktime` does not enforce the same deadline. The path when the operator cannot co-sign is `older(operatorExitDelay)` on a tapscript the owner signs. Neither clock is an application countdown.
- `tx.locktime` reads Bitcoin nLockTime and is not a clock; reading it in an Arkade Script function is denied by default (`offchain-locktime` lint). CLTV is `after(...)` in tapscripts.
- Write timelock literals as `older(blocks(n))`, `older(seconds(n))`, `after(blocks(height))`, or `after(seconds(timestamp))`. `seconds(n)` in `older` must be a multiple of 512 and compiles to the BIP68 time-based sequence. A parameter or a unitless literal is pushed raw, so a CSV parameter must already be the BIP68 sequence. Public arkd rejects block-type timelocks, so prefer `older(operatorExitDelay)` on exit leaves. The CSV counter starts when the output is mined, not when the virtual coin is created.
- `tx.offchainTime` is gone.

```ark
require(checkTime(oracleTime), "future-dated oracle");
```

For multi-input covenant checks, compare `this.activeInputIndex` with the witness-selected sibling index and verify the sibling input script before using its values. Checks written against `tx.outputs` are transaction-wide: a second input that carries the same script can satisfy them without adding a second set of outputs. Name the input set the path allows. A path that spends only this coin requires `tx.numInputs == 1`. A path that needs other coins must identify those inputs by index and by script, not only by value.

## Keep arithmetic bounded

Assume signed 64-bit intermediates and truncating integer division.

- Bound user-controlled rates, fees, timestamps, and amounts before arithmetic.
- Interleave multiplication and division when a full product could overflow.
- Check whether truncation can produce a zero update while advancing state; require a meaningful delta when repeated zero-value updates would enable griefing.
- Document scale in names or nearby code and keep it consistent across state transitions.

## Respect grammar limits

- `&&` and `||` are available in covenant bodies and short-circuit; ternary expressions are not.
- `==` and `!=` on `int`, `bool`, and `AssetGroup` compare numbers. A witness number that is not minimally encoded fails the spend.
- Array reads and writes accept `int` index expressions (runtime indexes emit bounds checks). Nested fixed-size arrays such as `int[2][3]` work in constructors, Arkade Script inputs, structs, and locals; tapscript inputs stay scalar.
- Use `bytes2int`, `bytes2uint`, and `int2bytes` (`bin2num` and `num2bin` are removed). The `asset` scalar type is removed; use `AssetId`. `merkleRoot(...)` emits `OP_MERKLEBRANCHROOT`.
- Unused parameters and locals are denied by default (`unused-variable`), and unsigned covenant functions warn (`unsigned-spend-path`). Annotate intentional cases with `@allow(lint, "reason")`, and run `arkadec --check` or `--explain <lint>` to inspect lints.
- Use assignments as statements, not expressions.
- Keep `require` messages short and descriptive.

Check the current grammar rather than preserving workarounds from old examples.

## Reuse representative examples

| Need | Start with |
|---|---|
| Basic covenant plus unilateral exit | `compiler/examples/htlc/htlc.ark` |
| Oracle attestation, introspection-pinned payouts, branching output layouts | `compiler/examples/escrow/escrow.ark` |
| Standing order: outputs pinned in the address the funder pays | `compiler/examples/option/option_intent.ark` |
| Non-interactive completion of a locked offer | `compiler/examples/non_interactive_swap/non_interactive_swap.ark` |
| Shared pool continuation with standing swap/deposit/exit orders | `compiler/examples/constant_product/cp_pool.ark` |
| Self-continuation, and a right burned to a named script | `compiler/examples/fuji_safe/fuji_safe.ark` |
| Burn the control asset to end issuance | `compiler/examples/controlled_mint/controlled_mint.ark` |
| Recursive state and cross-input validation | `compiler/examples/stability/stability_vault.ark` |
| Conditional output and dust routing | `compiler/examples/stability/stability_offer.ark` |
| Asset introspection | `compiler/examples/token_vault/token_vault.ark` |
| Threshold signatures | `compiler/examples/threshold_oracle/threshold_oracle.ark` |
| Several files, `new` child contracts | `compiler/examples/layerzero/`, `compiler/examples/non_interactive_swap/` |
| Recursive price beacon | `compiler/tests/features/beacon.rs` |

Most of `compiler/examples/stability/` is commented out and predates the current grammar (its self-instantiation cannot compile in `0.1.0`). Read it for shape, not syntax.

## Compile an artifact

The artifact is the contract the SDK loads and spends. Commit it when an application loads it. Do not hand-edit it, and keep the JSON `arkadec` wrote verbatim without reordering keys.

```bash
arkadec path/to/contract.ark -o contract.artifact.json
# or from the source clone:
cargo run --manifest-path compiler/Cargo.toml -- path/to/contract.ark -o contract.artifact.json
```

`compile_file` loads the entry and its relative imports. `compile_sources(entry, files)` (and `@arkade-os/compiler` `0.1.0` / `@arkade-os/sdk/compiler`) compiles an in-memory project. Pass `--debug` to write a sibling `.debug.json` file (replacing the artifact extension, linked by `artifactFingerprint`) and `--check` to typecheck and lint without writing an artifact. The JSON shape is `formatVersion` (1), `contractName`, `structs` (absent when none), `constructorInputs`, `functions` (spend groups of `{ name, arkade?, leaves }`), `contracts` (when the contract instantiates others with `new`, mapping each child name to its `codeHash`), `codeHash`, `source`, `compiler`, `updatedAt`, and `fingerprint`. Warnings are printed and are not in the artifact. Ignore `updatedAt` when diffing. `codeHash` is the sha256 of compact JSON for `formatVersion` through `contracts` in `arkadec`'s key order, and `fingerprint` covers the artifact before `fingerprint` and `updatedAt`. `source.files` is every imported file, verbatim; recompile that bundle with the same compiler version.

`constructorInputs` and `arkade.inputs` are the source ABI. Clients expand arrays (including nested fixed-size arrays such as `int[2][3]`, outermost index first) and structs into scalar leaves. A `ScriptPubKey` expands to `program` (`bytes`) then `version` (`int`). An `AssetId` expands to `txid` (`bytes32`) then `gidx` (`int`). `AssetGroupInput` and `AssetGroupOutput` each expand to `type`, `index`, `amount` (`int`). Covenant inputs are serialized in reverse `arkade.inputs` order. `<CONTRACT:Contract(<args>)>` placeholders are resolved by the SDK from the child artifacts passed in `options.contracts` and verified against `contracts` (`codeHash`).

`compiler/playground/contracts.js` and `compiler/playground/pkg/` are generated. A playground folder is an entry in the `projects` object in `compiler/playground/main.js`. Regenerate the contract bundle with `compiler/playground/generate_contracts.sh`. `compiler/examples/**/*.json` is compiler output and is ignored.

## Compose several contracts

One contract or library per file. `import "./other.ark";` is relative to the importing file, direct-import scope, depth 128, no cycles. The entry contract owns the artifact's spend groups. Imported files supply constructors, constants, and helpers.

`new Child(args)` checks the imported child's constructor, emits `<CONTRACT:Child(<args>)>`, and pins `Child`'s `codeHash` in the parent artifact's `contracts` map. Arguments must be whole constructor parameters, constants, or literals; witness values and computed expressions (such as struct fields) are rejected. Compile each instantiated child into its own artifact too, and pass all direct and transitive child artifacts in `programFromArtifact(artifact, { contracts: [...] })` (or `compile(input, { contracts: [...] })`). The SDK verifies each child's `codeHash` and derives its 32-byte witness program automatically; callers do not pass the `contract_…` parameter by hand. A destination parameter is a `ScriptPubKey`. The output a transaction pays still carries the full script, `OP_1` plus the 32-byte program.

A contract cannot instantiate itself, directly or through other contracts. To continue the same contract on an output, compare against `tx.input.current.script` or use `this.tunnel(...)` (`compiler/examples/fuji_safe/fuji_safe.ark`, `compiler/examples/constant_product/cp_pool.ark`).

## Continue state

Two places hold state, and they advance differently.

Continuing the same contract keeps its constructor fixed by checking `tx.outputs[0].script == tx.input.current.script` or `require(this.tunnel(0))`. `this.tunnel(0)` keeps this input's script program and version, its bitcoin value, and its assets on that output; the explicit form is `this.tunnel(0, {script: true, value: true, assets: false})`, with an optional third argument excluding specific `AssetId` values. Moving to a different stage contract uses `new NextStage(...)` for an imported child contract whose constructor arguments are parent parameters, constants, or literals.

A reading or reserve that moves without changing the script lives in output sats (above the 330-sat carrier) or an asset amount. The function continues the same script, then enforces `tx.outputs[0].value` or `tx.outputs[0].assets.lookup(assetId)` for the new amount. A clock is a second asset that the function requires not to move backwards. A passthrough function is the same continuation with each watched amount `output >= input`, so another contract can spend this coin in the same transaction without draining it. `compiler/tests/features/beacon.rs` is that pattern for an oracle, `compiler/examples/constant_product/cp_pool.ark` tracks reserves in sats and assets, and `compiler/examples/token_vault` is the control asset, amount 1, that has to be present on the way in and on the way out.

Another contract sees that coin only when it is an input of this transaction. Check the sibling script, or the control asset, read the amount, and require the continuation output. A signer copied into the constructor is fixed for that script. Rotating it is a new script. Consumers that must follow the rotation recognize the control asset on the new script, not the previous constructor.

An attestation is a signature over a message the contract rebuilds in the signer's field order. Several signatures over one message require distinct keys. Bound the attested values before arithmetic.

## Validate the contract

1. Sketch constructor state, witness inputs, authorizers, and output positions before writing the body.
2. Adapt the closest example instead of inventing a new pattern.
3. Compile after each structural change.
4. Do not add a unit test. The proof is the `arkade-regtest` file: the contract's real life, and a direct send that the UI must not count as the contract's position. Helpers in that file go at the end.
5. Run `compiler/playground/build.sh` when a playground example changes.

`arkade-product` comes before this skill. `covenant-viz` redraws the README in the same commit as the `.ark` file. Spending that artifact, showing the one next action from that transaction, and running regtest are `arkade-contract`, `arkade-product-ui`, and `arkade-regtest`.
