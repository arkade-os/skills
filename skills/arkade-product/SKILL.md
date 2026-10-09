---
name: arkade-product
description: >
  Decide what an Arkade contract tracks before writing it. Use when a coin, a
  balance, a direct send, or who may choose the outputs is still unnamed. Run
  before writing-arkade-contracts. Do not use for arkadec, timelocks, the SDK,
  or regtest.
---

# Decide the contract

Run this before `writing-arkade-contracts`. The `.ark` file records choices already made. A screen that lists every function is the form this skill exists to prevent. Clocks and the operator-down path are that writing skill's job.

## A coin is not a balance

A coin on a script is one output. A direct send creates a second coin beside the one the contract continues. Only a spend that pays the continuation script changes the position the contract tracks. The screen must say which of those two the user just did.

## A require is not authorization

A covenant with no tapscript is the server plus the tweaked emulator. Anyone who can build the transaction can pass it. A `require` checks the transaction. It does not identify who may move the coins.

## The receiver signs by spending

The receiver's key is on the script they named when they took the coins, as in `compiler/examples/option/option_intent.ark`. Spending those coins is the signature. A standing address can accept sats and name the outputs. A backend may submit that spend. It may not choose the outputs.

## Pin the outputs in the address

If the output scripts are arguments of the function the submitter calls, the submitter can pay themselves. Pin those scripts in the address that gets funded. That function can approve those outputs, or return the coins to the funder.

Then write the contract, spend the artifact, build the one next action, and prove it on regtest. When the contract changes, the app README changes in the same commit.
