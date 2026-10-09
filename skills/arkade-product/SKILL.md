---
name: arkade-product
description: >
  Decide the Arkade product before writing a contract. Use when a coin, a
  balance, a deposit, a split, a countdown, or an operator-down screen is
  still unnamed. Run before writing-arkade-contracts. Do not use for arkadec,
  the SDK, or regtest.
---

# Decide the product

Run this before `writing-arkade-contracts`. The `.ark` file records choices already made. A screen that lists every function is the form this skill exists to prevent.

## A coin is not a balance

A coin on a script is one output. A direct send creates a second coin beside the mint. Only a spend that continues the mint changes the pot. The screen must say which of those two the user just did.

## A require is not a secret

A covenant with no tapscript is the server plus the tweaked emulator. Anyone who can build the transaction can pass it. Burning tokens is not bearer authorization.

## The holder signs by spending

The holder's key is on the script they named when they received the tokens, as in `compiler/examples/option/option_intent.ark` (`OptionIntent`). Spending those coins is the signature. A standing address can accept sats and name where the tokens go. A backend may submit that spend. It may not choose the outputs.

## Pin the split in the address

If the split is a function argument of the guardian's spend, the guardian can pay themselves. Pin the split in the address the winner funds. The guardian can only approve those outputs, or send the sats and the tokens back.

## Product clocks are app state

Product clocks are not `checkTime`. `checkTime` is the emulator, and the operator can open it early. A join window and a veto are app state, with a visible countdown. Say what each number does. Do not label it "minutes."

## Operator down

If the operator is down, say so. Tokens already on the user's script stay theirs. The mint does not move. Do not offer another deposit or a settlement.

Then write the contract, spend the artifact, build the one next action, and prove it on regtest. When the contract changes, the app README changes in the same commit.
