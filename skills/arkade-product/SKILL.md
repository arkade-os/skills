---
name: arkade-product
description: >
  Decide what an Arkade contract tracks before writing it. Use when a coin, a
  balance, a standing order, a staging output, or a token right is still
  unnamed. Run before writing-arkade-contracts. Do not use for arkadec,
  timelocks, the SDK, or regtest.
---

# Decide the contract

Run this before `writing-arkade-contracts`. The `.ark` file records choices already made. A screen that lists every function is the form this skill exists to prevent. Clocks and the operator-down path are that writing skill's job.

## A coin is not a balance

A coin on a script is one output. A direct send creates a second coin beside the one the contract continues. Only a spend that pays the continuation script changes the position the contract tracks. The screen must say which of those two the user just did.

## A require is not authorization

A covenant function with no matching tapscript is the server plus the function-tweaked emulator. Anyone who can build that transaction can pass the `require`. A `require` checks the transaction. It does not identify who may move the coins.

## The receiver signs by spending

The receiver's key is on the script they named when they took the coins, as in `compiler/examples/option/option_intent.ark`. Spending those coins is the signature. A standing address accepts sats and names the outputs in its constructor. A backend may submit that spend. The submitter does not choose the outputs.

## Pin the outputs in the address

If the output scripts are arguments of the function, its signer can pay themselves. Pin those scripts in the address that gets funded. That spend approves those outputs, or returns the coins to the funder.

## Who can be offline

If the funder must sign every later spend, they have to be online. A standing order names the outputs in the address they fund, so a later transaction spends it without them. A contract that continues itself can take that order as another input and draw the value in. When the payee or the deadline must be chosen at a later call, this call pays a staging output. The next call of that coin pays or rolls. The original constructor does not store that choice.

## A token is the right

`checkSig` keeps a pubkey in the transaction. A token dispensed onto the receiver's script is the right instead. They exercise it by spending that coin and burning the token. The contract checks the burn. It does not ask for their signature.

Then write the contract, draw it with `covenant-viz`, spend the artifact, show the one next action from that picture, and prove it on regtest. When the contract changes, that mermaid story is regenerated in the same commit as the `.ark` file.
