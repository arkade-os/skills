---
name: arkade-executor
description: >
  Make an Arkade contract act while nobody is online: write an executord
  template, register it, and register a delegation so the executor renews,
  refunds, publishes or forwards the coin by itself. Use for
  arkade-os/executor, executord, `template/v1` documents, delegations,
  renewal before a coin expires, a refund after a deadline, a standing order
  that completes later, and any "who sends this transaction when the user
  closed the page" question. Use after writing-arkade-contracts and
  arkade-contract. Do not use for the contract's rules, or for a spend that
  needs a signature or a fresh value at the time it happens.
---

# Run an Arkade contract with nobody online

[executord](https://github.com/arkade-os/executor) watches addresses and sends a transaction when a coin arrives or a time comes. It holds no key of yours. It can only send the spend a **template** describes, and the operator signs that spend only if the contract's own script accepts it. So the contract stays the rule, and the template is the recipe for one transaction the contract already allows.

Three documents, in this order:

1. **Artifact**: the contract, as `writing-arkade-contracts` compiled it.
2. **Template**: one spend of that contract, with `<variables>` where instances differ.
3. **Delegation**: a template plus values for its variables. It is what makes the executor watch an address.

The page still does everything a person must be present for. A page that works with no executor, and hands over what it can when one is there, is the shape to aim for.

## What a template can run

Decide this before writing anything. A spend fits a template only when every item of its witness is known when the delegation is registered:

- Signatures of the operator and the emulator. The executor asks for them.
- Values fixed at registration, passed as variables.

It does not fit when it needs:

- **The owner's signature.** Cancel, withdraw, close: the page does those.
- **A value that exists only at that moment**, such as a price. The executor cannot fetch anything.

What usually fits: renew a coin before it expires, refund a deposit after its deadline, turn a paid deposit into the coin it was for (publish an offer, open a vault), board a confirmed onchain deposit, forward a payment to a fixed script.

If the step you want does not fit, that is a contract question, not a template one. Add a function whose only conditions are time and the shape of the outputs, then template that.

## The leaf the executor spends

The executor's artifact parser is stricter than the SDK's. It accepts the top-level fields `contractName`, `constructorInputs`, `structs`, `functions` (and drops `formatVersion`, `source`, `compiler`, `updatedAt`, `fingerprint`). Any other field is refused. In `asm` it accepts opcodes, decimal numbers up to 2^53 − 1, `0x` hex pushes, constructor names, and these placeholders only: `<SERVER_KEY>`, `<COSIGNER_KEY>`, `<EMULATOR_KEY:fn>`, `<TWEAK:pubkey:fn>`.

A leaf it can spend has every signature marked `"injected": true`:

```json
{
  "name": "refund",
  "asm": ["<deadline>", "OP_CHECKLOCKTIMEVERIFY", "OP_DROP",
          "<SERVER_KEY>", "OP_CHECKSIGVERIFY", "<EMULATOR_KEY:refund>", "OP_CHECKSIG"],
  "witness": [
    {"name": "serverSig", "type": "signature", "encoding": "schnorr-64", "injected": true},
    {"name": "emulatorSig", "type": "signature", "encoding": "schnorr-64", "injected": true}
  ]
}
```

A leaf with a signature that is not injected is refused at registration: `needs signature "ownerSig", which nobody injects`.

Which keys a covenant leaf names depends on who runs the covenants for that operator. Do not guess. Read a default artifact from the executor you target and copy its leaf:

```bash
curl -s https://executor.mutinynet.arkade.sh/v1/templates | jq -r '.templates[] | .id + " " + .type'
curl -s https://executor.mutinynet.arkade.sh/v1/artifact/<id from a template's artifactIds> | jq -r .artifact.document
```

When the compiler's artifact differs from that (another key placeholder, an exit-delay placeholder the parser does not know, an extra top-level field, a decimal above 2^53 − 1), adapt the artifact in the build script, once, and use the adapted artifact everywhere: the SDK, the tests and the executor. A larger number is written as the `0x` push of the same bytes, so the script is unchanged. The address comes from the script, so two different artifacts for one contract mean the page and the executor watch different addresses.

## Write the template

A template is strict JSON: an unknown key, a key in another case or a `null` is refused. The smallest useful one renews a coin:

```json
{
  "format": "template/v1",
  "type": "proof",
  "variables": {"owner": "pubkey", "exit_delay": "int", "renewal_window": "int", "max_fee": "int"},
  "inputs": [{
    "name": "funds",
    "contract": {
      "definition": {"artifact": "<64 hex id the executor returned for the artifact>"},
      "arguments": {"owner": "<owner>", "exitDelay": "<exit_delay>",
                    "renewalWindow": "<renewal_window>", "maxFee": "<max_fee>"}
    },
    "spend": {"function": "renew", "leaf": "renew"}
  }],
  "outputs": [{
    "name": "renewed",
    "value": {"from": "funds"},
    "locking": {"from": "funds"},
    "assets": [{"from": "funds"}]
  }],
  "fees": {"from": "funds", "max": "<max_fee>"},
  "delegation": {"schedule": {"funds": {"before_expiry_seconds": "<renewal_window>"}}}
}
```

`type` decides what is sent, and several fields follow from it:

| `type` | What the executor sends | `fees` | Inputs |
|---|---|---|---|
| `virtual` | an offchain transaction | refused: the outputs take the whole input | offchain |
| `proof` | an intent that joins a batch (renewal, boarding) | `{"from": input, "max": n}`, the most that may leave | offchain, or `"type": "onchain"` for a boarding deposit |
| `onchain` | a bitcoin transaction | same as `proof` | onchain |

`delegation.schedule` says when an input is due. With none, a coin is spent as soon as it is there. `{"before_expiry_seconds": n}` waits until that long before an offchain coin expires. `{"min_confirmations": n}` waits for an onchain coin to be buried.

- **Arguments** bind every constructor field, by its flattened name: a struct parameter `AssetId oracleId` is `"oracleId.txid"` and `"oracleId.gidx"`.
- **A binding** is an integer, a boolean, or a string that concatenates hex, `<variable>` and `$(expression)`. `"5120<program>"` is a taproot output script. `"$(<pk> 1 32 OP_SUBSTR)"` runs Script at build time and must leave exactly one item, here the x-only key of a 33-byte one. One space between tokens, no nesting.
- **Outputs** take every sat of every input exactly once: each input needs exactly one draw with no `amount`, the remainder. `locking` is `{"from": input}` for the same script, `{"contract": {...}}` for a contract, or a script string.
- **Indexes.** When the covenant reads `tx.outputs[0]`, give every output an `"index"` and place the extension with `"packets": {"output_index": n}`. Either every output has an index or none.
- **A locktime in the leaf** needs no field. The executor reads `OP_CHECKLOCKTIMEVERIFY` from the leaf and waits for it.

[references/template-v1.md](references/template-v1.md) lists every field, the three templates this skill was written from, and what each refusal means. Read it when a registration is refused or the template is not one of the shapes above.

### Packets

A coin whose terms travel in an extension packet needs the template to say what happens to each packet type of the transaction that created it. The default is to refuse the coin when it carries a packet no rule handles.

```json
"packets": {
  "rules": [{"type": 64, "action": "copy", "from": "offer"}],
  "unmatched": "drop"
}
```

`copy` carries the packet to the new transaction, `emit` writes one from a binding, `drop` discards one. Set `"unmatched": "drop"` whenever a coin can be created by a transaction that carries other packets, for instance a price note next to the state. Without it the executor refuses those coins, and each refusal counts against the template.

## Check it before anyone registers it

[scripts/check](scripts/check) runs the documents through the executor's own engine, with no executor and no network. It needs Go; the first run downloads the engine.

```bash
cd <this skill>/scripts/check
go run . template.json - contract.artifact.json          # ids, or the refusal
go run . -server <serverPubkey> -emulator <emulatorPubkey> \
  template.json delegation.json contract.artifact.json   # and the script each input resolves to
```

It prints the id the executor will return for each artifact and for the template, so the template can name its artifacts, and the app its template, before anything is posted. With a delegation and the two keys of `/v1/info`, it prints the script of each input: compare it with the script the SDK derives. `go.mod` pins the engine to a commit of arkade-os/executor; an id that differs from the one a live executor returns means that executor runs another version.

Some values pass every check here and at registration, and fail only when a coin is there. Each such failure counts against the template, so check them in the page before registering a delegation:

- **A `5120<program>` output needs a valid taproot key.** 32 arbitrary bytes are a point on the curve about half the time. Anything else is refused at every attempt: `an offchain output needs a valid taproot key`.
- **An exit leaf's delay must be at least the operator's `unilateralExitDelay`.** arkd refuses to spend a coin whose script has a shorter one: `exit delay is too short`. Take the delay from the SDK session, never from a constant. It is part of the address, so it cannot be fixed afterwards.

## Register

Artifacts first, then the templates that name them. A document travels as a JSON string inside `{"document": ...}`, and every request other than `GET` needs `Content-Type: application/json`.

```bash
post() {
  jq -Rs '{document: .}' "$2" |
    curl -sS --fail-with-body -X POST -H 'content-type: application/json' --data-binary @- "$url/v1/$1"
}
post artifact contract.artifact.json   # .artifact.id goes into the template
post template renew.json               # .template.id goes into the app
```

- An id is the hash of the document's canonical form. Registering twice returns the same id, so a deploy script can always post.
- The template names its artifacts by id, and the app names its templates by id. Commit both ids. A test that recomputes them catches a contract edit that silently changed an address.
- The public port (`7080`) reads artifacts and templates. It also registers them only when the executor runs with `EXECUTOR_PUBLIC_REGISTRY=true`; otherwise its operator posts them on the admin port (`7081`), which is private.
- At startup, ask the executor what it has: `GET /v1/info` returns `serverPubkey` and `emulatorPubkey`, and `GET /v1/template/<id>` answers 200 or not. Addresses depend on both keys. If they are not the keys the SDK session uses, or the template is missing, the page keeps doing the step itself.

## Delegate

```bash
curl -sS -X POST -H 'content-type: application/json' "$url/v1/delegation" -d '{
  "templateId": "<template id>",
  "variables": {"owner": "02…33 bytes", "exit_delay": "0002", "renewal_window": "805101", "max_fee": "e803"},
  "expiresAt": 0
}'
```

- **Every value is lower-case hex of the bytes Script would push.** A `pubkey` is the 33-byte compressed key. An `int` is a minimal little-endian script number, with an extra `00` when the top bit is set: 1000 is `e803`, 86400 is `805101`, 128 is `8000`, and 0 is the empty string. Decimal text is the usual mistake. `"86400"` is refused as `invalid_variables`, but `"1001"` is valid hex for 272 and is accepted: the address check below is what catches it.
- Send every declared variable and nothing else.
- `expiresAt` is unix seconds, at least a day ahead by default; 0 never expires.
- The reply lists `delegation.inputs[].address`. Compare it with the address the SDK derived before showing either to a user. A mismatch means the artifact, an argument or a key differs, and a coin sent there would not be the one the page tracks.
- Registering the same template and variables again returns the same delegation. Do it at every start: a delegation that never received a coin is dropped after a week by default, and sooner when the executor is full.
- One delegation covers every coin that arrives at its address. A contract whose script is the same for all its coins, with the state in a packet, needs one delegation for the whole market, not one per coin.
- A coin is tracked under one delegation. Two templates registered on one address do not each get a turn at the same coin.
- The public port allows about five requests per second per client. Send delegations one after another.

`GET /v1/delegation?address=<address>` returns the delegation and its coins: `status`, `due`, `expiresAt` and `spentBy`. That is how the page tells a user why a coin moved while they were away.

## Renewal

A coin expires. Anything meant to live longer than one batch needs a `renew` function and a `proof` template like the one above. The function that compiled and ran for the contracts this skill comes from:

```solidity
function renew() {
  require(checkTime(this.expiry - renewalWindow), "too early");
  require(tx.intent.field(bytes("type")) == bytes("register"), "not a registration");
  require(tx.intent.field(bytes("onchain_output_indexes")) == bytes("[]"), "onchain output");
  int out = this.activeInputIndex - 1;
  require(tx.outputs[out].value + maxFee >= tx.input.current.value, "fee");
  require(this.tunnel(out, { script: true, value: false, assets: true }), "tunnel");
}
```

- **Input 0 of an intent is its message.** The coin at input `i` pays output `i - 1`, hence `activeInputIndex - 1`.
- **The window is when a coin becomes eligible, not when it is renewed.** The executor may hold it until shortly before it expires (`EXECUTOR_RESERVE`, 15 minutes by default) so that renewals share a batch. Do not read a coin that is inside its window and not yet renewed as a failure.
- **Leave room for the fee.** The coin must hold its dust plus `maxFee`. A coin that the fee would push under dust is skipped: it is not renewed and it does not count as a failure, so it expires quietly.
- **arkd up to v0.9.26 takes a coin into a batch only if its script has an exit leaf.** A shared contract that names no owner has none to offer. Give it an exit leaf on the BIP 341 point nobody can sign for, `50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0`. It satisfies arkd and gives nobody a way out; say so in the README.
- **A new coin expires with the earliest coin it was made from.** A counterparty can spend an old coin next to yours and shorten its life. Renewal is what puts it back.
- **Carry the state.** `copy` the packets the contract reads and route the assets, as above. A renewal that drops them leaves a coin its own script can no longer spend.

## What switches a template off

A template refused ten times in a row (default) is disabled for everyone, until the executor's operator enables it again. A success resets the count. Coins arkd refuses for their state, and coins that fees or dust leave unspendable, do not count.

- Anyone can send a coin to a shared address. Ten coins the template cannot spend switch renewal off for the whole market. State that in the README of a contract with a shared address.
- The template cannot be changed. A fix is a new document, a new id, a new registration, and new delegations from the app.

## Prove it on regtest

Extend the one end-to-end test of `arkade-regtest`; do not add a second suite. Start the stack with the executor:

```bash
node regtest/regtest.mjs start --env .env.regtest --profile executor
```

It serves the public API on `7280` and the admin API on `7281`. Then, in the test: register the artifact and the template on the admin port, register the delegation on the public port, fund the address it returned with a plain send, and wait until `GET /v1/delegation?address=` shows the coin `spent`. Assert the result through the indexer: the output the template promised exists, with its value, packets and assets. No page and no SDK call sends that transaction. If one does, the test proves the page, not the executor.

- A deadline is checked against chain time. With `AUTOMINE_INTERVAL=0` nothing mines: after the deadline, mine a dozen blocks, or the refund never becomes eligible.
- A renewal is due `renewal_window` seconds before the coin expires. On regtest, pass a window longer than the batch's life so it is due at once.
- When nothing happens, the admin port explains it: `GET /v1/admin/delegation/<id>/attempts` lists each try and its refusal, and `GET /v1/admin/status` the queue.
