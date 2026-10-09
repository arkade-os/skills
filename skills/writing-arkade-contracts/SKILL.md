---
name: writing-arkade-contracts
description: >
  Author and edit an Arkade smart contract in `.ark`, and compile it with
  arkadec to an artifact. Use for constructor state, spend functions,
  tapscript leaves, witnesses, output layouts, oracle checks, recursive
  beacons, timelocks, and fixed-point arithmetic. Do not use for compiler
  implementation, spending the artifact, the product UI, or Arkade regtest.
---

# Writing Arkade Contracts

This skill is used from a fresh project. The compiler is not already checked out.

```bash
git clone --depth 1 https://github.com/arkade-os/compiler.git compiler
```

Ignore `compiler/`. `arkadec` is that checkout. Commit the `.ark` file and the artifact. Leave the compiler checkout untracked. Paths below are inside the clone.

Run `arkade-product` first. This file records those choices. It does not invent them.

## The leaf rule

A covenant function with no matching tapscript is the server plus the function-tweaked emulator. Anyone who can build that transaction can pass the `require`. A `require` checks the transaction. It does not identify who may move the coins.

A leaf that is the receiver's signature names their key on the script they took the coins on, as `compiler/examples/option/option_intent.ark` does. Spending those coins is the signature. A standing address accepts sats and names the outputs in its constructor. The submitter does not choose them.

```ark
function finalize() {
  require(tx.outputs[0].scriptPubKey == userScript, "user");
  require(tx.outputs[1].scriptPubKey == optionScript, "option");
}
```

`userScript` and `optionScript` are constructor `bytes32`s, agreed when the address was funded. A `checkMultisig` of keys fixed in the constructor only says who may sign. It does not say where the value goes. Put the standing offer beside `compiler/examples/escrow/escrow.ark`, and start from `OptionIntent` when the receiver's script is the authorization.

If the output scripts are arguments of the function, its signer can pay themselves. Pin those scripts in the address that gets funded. That spend approves those outputs, or returns the coins to the funder.

## The anchor

The first issuance leaves one unit of the control asset on the coin. A reissue cannot name the control asset, so that unit is the anchor the next issuance continues. `.withAsset()` moves a group that already exists. It cannot express a fresh issue.

330 sats is the carrier on a Taproot output. The value the contract tracks is the sats above that carrier, or the asset amount on the continuing coin. A direct send of sats to the contract address is a second coin. It does not continue the contract.

## Start from working code

Read the closest contracts in `compiler/examples/`, then verify syntax against `compiler/src/parser/grammar.pest` and behavior against the compiler and tests. Treat examples and tests as authoritative when prose disagrees.

Compile early:

```bash
cargo run --manifest-path compiler/Cargo.toml -- path/to/contract.ark -o contract.artifact.json
```

## Model state and spend paths

- Put committed state in constructor parameters and per-spend data in function parameters. Declare those parameters in source order. A covenant witness is that list reversed; a tapscript witness follows the tapscript parameter list.
- Constructor parameters are placeholders until instantiation, then constants in the script. Spend paths assume the agreed values. There is no constructor hook, so a domain check inside a spend does not run at compile time and does not see a different value than the one already committed.
- Propagate immutable constructor fields unchanged when recreating a state-bearing contract.
- Construct the next state with `new ContractName(...)` and assert its output script and minimum value. `tx.outputs[i].scriptPubKey` is the 32-byte Taproot witness program, not the `5120…` script. `new` compiles to that same output key.
- Use covenant `function name(...) { ... }` bodies for introspection and state-transition rules.
- Use `function name(...) tapscript { ... }` only for L1 authorization, hashes, and timelocks supported by `compiler/src/compiler/tapscript.rs`.

A covenant function with no matching tapscript gets a synthesized collaborative leaf using `server` and the function-tweaked `emulator` key. Add an explicit matching tapscript only when that authorization is insufficient. A tapscript that matches a function by name must sign bare `emulator` and must not call `tweak(emulator, ...)`.

A leaf may sign `tweak(constructorPubkey, func)` so that key is bound to `func`'s covenant. Every tweaked key in one tapscript must name the same function.

Add unilateral exit as a separate CSV tapscript when required:

```ark
function unilateral(signature ownerSig) tapscript {
  require(older(serverExitDelay));
  require(checkSig(ownerSig, owner));
}
```

`serverExitDelay` is arkd's unilateral exit delay and needs no constructor parameter. For a different fixed delay, write `older(seconds(n))` with a literal or `int` constant. Take a constructor `int` only when the delay varies per instance; it is pushed raw, so the caller passes the BIP68 sequence.

Keep `server`, `emulator`, and `serverExitDelay` out of constructors and covenant bodies. Use them only as reserved key operands in tapscript signature checks. Declare the corresponding signature witnesses on author-written tapscripts.

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

- `checkTime(timestamp)` reads the emulator clock in Unix seconds and compiles to `OP_CHECKTIME`. Put it in `require`. The operator runs that clock and can accept the spend early. Offchain spends of the leaf are rebuilt with nLockTime 0, so `tx.time` does not enforce the same deadline. The path when the operator cannot co-sign is `older(serverExitDelay)` on a tapscript the owner signs. Neither clock is an application countdown.
- Use `tx.time` for Bitcoin nLockTime/CLTV.
- Write timelock literals as `older(blocks(n))`, `older(seconds(n))`, `after(blocks(height))`, or `after(seconds(timestamp))`. `seconds(n)` in `older` must be a multiple of 512 and compiles to the BIP68 time-based sequence. A parameter or a unitless literal is pushed raw, so a CSV parameter must already be the BIP68 sequence. Public arkd rejects block-type timelocks, so prefer `older(serverExitDelay)` on exit leaves. The CSV counter starts when the output is mined, not when the virtual coin is created.
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
- Bind a computed array index to an identifier before indexing; array indices accept identifiers or number literals.
- Use assignments as statements, not expressions.
- Keep `require` messages short and descriptive.

Check the current grammar rather than preserving workarounds from old examples.

## Reuse representative examples

| Need | Start with |
|---|---|
| Basic covenant plus unilateral exit | `compiler/examples/htlc/htlc.ark` |
| Oracle attestation, introspection-pinned payouts, branching output layouts | `compiler/examples/escrow/escrow.ark` |
| Standing offer: outputs pinned in the address the funder pays | `compiler/examples/option/option_intent.ark` |
| Recursive state and cross-input validation | `compiler/examples/stability/stability_vault.ark` |
| Conditional output and dust routing | `compiler/examples/stability/stability_offer.ark` |
| Asset introspection | `compiler/examples/token_vault/token_vault.ark` |
| Threshold signatures | `compiler/examples/threshold_oracle/threshold_oracle.ark` |
| Several files, `new` child contracts | `compiler/examples/layerzero/`, `compiler/examples/non_interactive_swap/` |
| Recursive price beacon | `compiler/tests/features/beacon.rs` |

Most of `compiler/examples/stability/` is commented out and predates the current grammar. Read it for shape, not syntax.

## Compile an artifact

The artifact is the contract the SDK spends. Commit it when an application loads it. Do not hand-edit it.

```bash
cargo run --manifest-path compiler/Cargo.toml -- path/to/contract.ark -o contract.artifact.json
```

`compile_file` loads the entry and its relative imports. `compile_sources(entry, files)` compiles an in-memory project. The JSON shape is `contractName`, `constructorInputs`, `structs`, `functions` (spend groups of `{ name, arkade?, leaves }`), `source`, `compiler`, `warnings`, and `updatedAt`. Ignore `updatedAt` when diffing. `source.files` is every imported file, verbatim; recompile that bundle with the same compiler version.

`constructorInputs` and `arkade.inputs` are the source ABI. Clients expand arrays and structs into scalar leaves and serialize covenant inputs in reverse `arkade.inputs` order. After instantiation the only remaining placeholders are `<VTXO:Contract(...)>` tokens.

`compiler/playground/contracts.js` and `compiler/playground/pkg/` are generated. A playground folder is an entry in the `projects` object in `compiler/playground/main.js`. Regenerate the contract bundle with `compiler/playground/generate_contracts.sh`. `compiler/examples/**/*.json` is compiler output and is ignored.

## Compose several contracts

One contract or library per file. `import "./other.ark";` is relative to the importing file, direct-import scope, depth 128, no cycles. The entry contract owns the artifact's spend groups. Imported files supply constructors, constants, and helpers.

`new Child(args)` checks the constructor and emits `<VTXO:Child(...)>`. The runtime resolves that to the child Taproot script. A `bytes32` compared with `scriptPubKey` is the 32-byte witness program. The output a transaction pays still carries the full script, `OP_1` plus those 32 bytes.

A contract instantiates itself, with no import, to continue state (`compiler/examples/fuji_safe`). Copy every field that must not change. A field omitted from `new` is not preserved.

## Continue state

Two places hold state, and they upgrade differently.

Script state is the constructor. Continuing it is `new SameContract(...)` on the output, copying every field that must stay and passing a new value only for a field this function is allowed to change. A changed constructor is a different script. Anything that pinned the old script stops matching.

A reading that must move without changing the script is an asset amount. The function continues the same constructor, then sets `tx.outputs[0].assets.lookup(...)` to the new amount. A clock is a second asset that the function requires not to move backwards. A passthrough function is the same continuation with each watched amount `output >= input`, so another contract can spend this coin in the same transaction without draining it. `compiler/tests/features/beacon.rs` is that pattern for an oracle. `compiler/examples/token_vault` is the control asset, amount 1, that has to be present on the way in and on the way out.

Another contract sees that coin only when it is an input of this transaction. Check the sibling script, or the control asset, read the amount, and require the continuation output. A signer copied into the constructor is fixed for that script. Rotating it is a new script. Consumers that must follow the rotation recognize the control asset on the new script, not the previous constructor.

An attestation is a signature over a message the contract rebuilds in the signer's field order. Several signatures over one message require distinct keys. Bound the attested values before arithmetic.

## Validate the contract

1. Sketch constructor state, witness inputs, authorizers, and output positions before writing the body.
2. Adapt the closest example instead of inventing a new pattern.
3. Compile after each structural change.
4. Do not add a unit test. The proof is the `arkade-regtest` file: the contract's real life, and a direct send that the UI must not count as the contract's position. Helpers in that file go at the end.
5. Run `compiler/playground/build.sh` when a playground example changes.

`arkade-product` comes before this skill. Spending that artifact, building the one next action, and running regtest are `arkade-contract`, `arkade-product-ui`, and `arkade-regtest`.
