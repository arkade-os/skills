# Arkade contract skills

Skills for an Arkade smart contract: compile it with arkadec, spend it with `@arkade-os/sdk`, build the product UI, and prove it on Arkade regtest.

Install them into a fresh project with the [skills CLI](https://skills.sh), then follow them in order.

```bash
npx skills add arkade-os/skills
```

## What to do

1. **Write the contract.** Follow `writing-arkade-contracts`. It clones [arkade-os/compiler](https://github.com/arkade-os/compiler) and runs `arkadec`. Commit the `.ark` file and the artifact. Leave `compiler/` untracked.

2. **Spend it.** Follow `arkade-contract`. It clones `arkade-os/ts-sdk` into `vendor/ts-sdk` and installs `@arkade-os/sdk`. Load the artifact with `programFromArtifact` and spend the functions it declares. `ContractManager` is the only writer of contract and VTXO rows. Leave `vendor/` untracked.

3. **Build the screen.** Follow `arkade-product-ui`. It reads [emilkowalski/skills](https://github.com/emilkowalski/skills) and [Impeccable](https://github.com/pbakaus/impeccable). The screen offers the constructor, the funding step, and the spend functions the artifact has.

4. **Prove it.** Follow `arkade-regtest`. It clones [ArkLabsHQ/arkade-regtest](https://github.com/ArkLabsHQ/arkade-regtest) and starts the stack:

   ```bash
   node regtest/regtest.mjs start --env .env.regtest --profile ark --profile emulator
   ```

   Write one functional end-to-end test. Put helpers at the end of that file. Leave `regtest/` untracked.
