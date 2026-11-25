# `template/v1` reference

Read from the engine in [arkade-os/executor](https://github.com/arkade-os/executor), `pkg/template`. When this page and that code disagree, the code is right.

- [Fields](#fields)
- [Bindings](#bindings)
- [Three templates that ran](#three-templates-that-ran)
- [Refusals and what they mean](#refusals-and-what-they-mean)
- [Streams](#streams)

## Fields

The document is strict: unknown keys, keys in another case and `null` are refused. Names of variables, inputs and outputs match `^[a-z][a-z0-9_]*$`.

| Field | |
|---|---|
| `format` | `"template/v1"` |
| `type` | `proof`, `virtual` or `onchain` |
| `variables` | name → type: `pubkey`, `signature`, `bytes`, `bytes20`, `bytes32`, `asset`, `int`, `bool` |
| `inputs[]` | at least one |
| `outputs[]` | at least one |
| `fees` | `{"from": input, "max": int or "<int variable>"}`; refused in a `virtual` template |
| `locktime` | onchain templates only; arkd derives it for a `virtual` spend and a `proof` carries none |
| `packets` | the extension output and what happens to the packets of the spent coins |
| `issues`, `burns` | assets the transaction mints or destroys |
| `delegation` | `schedule`, `sealed`, `trigger`: how a service runs the spend; it never changes the transaction |

**Input**

| Field | |
|---|---|
| `name` | |
| `type` | `offchain` or `onchain`; defaults to the template's kind and may differ only in a `proof` |
| `index` | position in the transaction; every input states one or none does |
| `sequence` | onchain templates only |
| `contract.definition` | `{"artifact": "<id>"}`, or the artifact's definition inline |
| `contract.arguments` | every flattened constructor field → binding, no more and no fewer |
| `spend.function`, `spend.leaf` | both by name; they are often the same word |
| `spend.arguments` | the covenant's inputs, in ABI order |
| `spend.witness` | name → binding for each witness item that is not a signature |

**Output**

| Field | |
|---|---|
| `name` | |
| `type` | as for an input; a `proof` lists its offchain outputs before its onchain ones |
| `index` | every output states one or none does; they fill `0..n-1` once, the extension included |
| `each` | an input: the output repeats for each coin of it, and takes from that input alone |
| `value` | `{"from": input}`, `{"from": input, "amount": n}`, or a list of those |
| `locking` | `{"from": input}`, `{"contract": {...}}`, or a script string such as `"5120<program>"` |
| `assets[]` | `{"from": input}` routes every asset; add `"asset"` and `"amount"` to route part of one |

Each input has exactly one draw without `amount`: the remainder. Two, or none, is refused.

**Packets**

| Field | |
|---|---|
| `output_index` | where the extension output goes; with indexed outputs only, and then required |
| `unmatched` | `reject` (default) or `drop`, for a source packet no rule handles |
| `rules[]` | `{"type": 2..255 except 5, "action": "copy" \| "drop" \| "emit", "from": input, "data": binding}`; `data` goes with `emit` only |
| `advertise[]` | names the template that claims outputs |

The extension holds one packet per type, so two `emit` rules for one type are refused. In an intent the order is offchain outputs, the extension, then onchain outputs.

**Schedule**: exactly one of `{"immediate": true}`, `{"before_expiry_seconds": n or "<int variable>"}` for an offchain input, `{"min_confirmations": n}` for an onchain input.

## Bindings

A binding is a JSON integer, a boolean, a string, or `{"program": "<output name>"}`.

- A string concatenates lower-case hex, `<variable>` and `$(expression)`. An odd number of hex digits is refused.
- A lone `<variable>` must have the type of the field it fills, unless the field is `bytes`.
- `$(...)` is Script, run when the transaction is built. It must leave exactly one item. It may not read the outputs being built, the packets, the intent message, or check a signature (`OP_INSPECTOUTPUT…`, `OP_INSPECTPACKET`, `OP_TUNNEL`, `OP_INSPECTINTENTMESSAGE`, `OP_CHECKSIG…` are refused). It may read the input it is evaluated for.
- A `pubkey` variable holds 33 bytes. Where the contract works with the x-only key, write `$(<pk> 1 32 OP_SUBSTR)`.
- An integer written inside a packet is usually fixed-width: `$(<spread_bps> 8 OP_NUM2BIN)`.
- `{"program": "offer"}` is the witness program of the output named `offer`, when that output is locked by a contract. It fills a contract argument only. It is how a deposit address commits to the coin it becomes.
- A JSON integer, a decimal token in an artifact, and an `int` variable are all limited to ±(2^53 − 1).

## Three templates that ran

All three ran on regtest, and the third also on Mutinynet, for [a futures market](https://github.com/louisinger/future) and [its price oracle](https://github.com/louisinger/future/tree/main/oracle).

### Renew a shared coin and keep its state (`proof`)

Every offer of the market sits at one address; its terms are packet 64 of the transaction that created it. The transaction that opened a trade against it also carried a price note, packet 34, which the offer has no use for.

```json
{
  "format": "template/v1",
  "type": "proof",
  "variables": {"...": "the constructor's fields", "renewal_window": "int", "max_fee": "int"},
  "inputs": [{"name": "offer", "contract": {"...": "..."}, "spend": {"function": "renew", "leaf": "renew"}}],
  "outputs": [{"name": "renewed", "value": {"from": "offer"}, "locking": {"from": "offer"},
               "assets": [{"from": "offer"}]}],
  "fees": {"from": "offer", "max": "<max_fee>"},
  "packets": {"rules": [{"type": 64, "action": "copy", "from": "offer"}], "unmatched": "drop"},
  "delegation": {"schedule": {"offer": {"before_expiry_seconds": "<renewal_window>"}}}
}
```

One delegation renews every offer. Before `"unmatched": "drop"` was added, every offer that had been traded against was refused for its packet 34.

### Refund a deposit after its deadline (`virtual`)

The deposit's `refund` leaf is `<deadline> OP_CHECKLOCKTIMEVERIFY OP_DROP <SERVER_KEY> OP_CHECKSIGVERIFY <EMULATOR_KEY:refund> OP_CHECKSIG`, and its covenant requires one input, output 0 paying the trader's program, and at least the input's value there.

```json
{
  "format": "template/v1",
  "type": "virtual",
  "variables": {"trader_program": "bytes32", "deadline": "int", "...": "the other constructor fields"},
  "inputs": [{"name": "deposit", "contract": {"...": "..."}, "spend": {"function": "refund", "leaf": "refund"}}],
  "outputs": [{"name": "refund", "index": 0, "value": {"from": "deposit"}, "locking": "5120<trader_program>"}],
  "packets": {"output_index": 1}
}
```

No schedule and no `locktime`: the executor reads the deadline from the leaf. The page registers this delegation when it shows the deposit address, so a user who pays and leaves gets the coin back. A deposit that is used in time is spent by someone else first, and the delegation never runs.

### Turn a paid deposit into the coin it was for (`virtual`, `emit`, `program`)

A provider pays a deposit address. The executor publishes the offer: one output at the market's offer script, and packet 64 holding the terms the address committed to.

```json
{
  "format": "template/v1",
  "type": "virtual",
  "variables": {"lp_pk": "pubkey", "lp_program": "bytes32", "spread_bps": "int", "...": "..."},
  "inputs": [{
    "name": "deposit",
    "contract": {
      "definition": {"artifact": "<deposit artifact id>"},
      "arguments": {"offerProgram": {"program": "offer"}, "lpPk": "<lp_pk>", "...": "..."}
    },
    "spend": {"function": "register", "leaf": "register"}
  }],
  "outputs": [{
    "name": "offer", "index": 0, "value": {"from": "deposit"},
    "locking": {"contract": {"definition": {"artifact": "<offer artifact id>"}, "arguments": {"...": "..."}}}
  }],
  "packets": {
    "output_index": 1,
    "rules": [{"type": 64, "action": "emit", "from": "deposit",
               "data": "01$(<lp_pk> 1 32 OP_SUBSTR)<lp_program>$(<spread_bps> 8 OP_NUM2BIN)"}]
  }
}
```

The covenant rebuilds the same bytes from its constructor and compares them with packet 64, so the executor cannot publish other terms. A template names two artifacts here; both are registered first.

## Refusals and what they mean

At registration (`invalid_artifact`, `invalid_template`, `unsupported`). The reply carries a JSON pointer to the field when there is one.

| Message | Cause |
|---|---|
| `has unknown field "x"` | strict JSON. In an artifact, a field the compiler added that this executor does not know |
| `unknown placeholder "<X>"`, `unsupported placeholder` | the artifact names a key or delay the parser does not fill; adapt the artifact |
| `artifact … not provided` | register the artifact first; the id in the template is the one the executor returned |
| `missing argument "x"`, `arguments outside its constructor` | `contract.arguments` must be exactly the flattened constructor |
| `int "x" cannot fill a bytes32 field` | the variable's type must be the field's type |
| `function "f" takes N arguments, got M` | the covenant's inputs go in `spend.arguments`, in order |
| `witness item "x" is not bound` | bind it in `spend.witness` |
| `needs signature "x", which nobody injects` | the leaf needs a signature the executor cannot obtain; this spend is not one for a template |
| `an offchain template has no fees` | remove `fees` from a `virtual` template |
| `locktime in a virtual template` | remove it; put the deadline in the leaf |
| `leaf "x" needs an absolute locktime, which a proof does not set` | a `OP_CHECKLOCKTIMEVERIFY` leaf cannot be spent by a `proof` |
| `input "x" needs exactly one remainder draw` | one output must take what is left of each input |
| `every output states an index or none does` | index them all |
| `indexed outputs place the extension with packets.output_index` | add it |
| `the schedule does not fit the input` | `before_expiry_seconds` on an onchain input, or `min_confirmations` on an offchain one |

At a delegation (`invalid_variables`): `N values for M variables`, `missing "x"`, `variable "x": …`. Send every variable, as hex, in the type declared.

When a coin is there (`ineligible`). These count toward disabling the template.

| Message | Cause |
|---|---|
| `source … carries packet N that no rule handles` | add a rule for it, or `"unmatched": "drop"` |
| `expression: stack holds N elements` | an expression must leave one item |
| `locktime N is not accepted by the spent leaves` | a stated locktime below the leaf's, or of the other kind (height against time) |
| `an offchain output needs a valid taproot key` | a `5120<program>` whose 32 bytes are not a point on the curve; validate the program before registering the delegation |

From arkd, when the executor submits the spend: `exit delay is too short` means an exit leaf of the coin has a delay below the operator's `unilateralExitDelay`. The delay is part of the address, so the fix is a new address.

## Streams

A template with `delegation.trigger` is not registered by clients. The executor's operator registers it as a stream on the admin port, and the executor spawns a delegation for every transaction whose extension holds the trigger's packet, capturing variables from it. `delegation.sealed` names variables given encrypted to the executor's key (`encryptionPubkey` of `/v1/info`); in a contract argument a sealed variable may appear only under a hash. The default `claim` template in the executor's `templates/` is the example to copy. A stream is an operator decision: a product that needs one asks for it, it does not assume it.
