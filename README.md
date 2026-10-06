# Arkade skills

Install these skills into a fresh project, then follow them in order. They are already published.

```bash
npx skills add arkade-os/skills -y
```

## What to do

1. **Compile the contract.** Clone [arkade-os/compiler](https://github.com/arkade-os/compiler) and run `arkadec`. Commit the `.ark` file and the artifact. Leave the compiler checkout untracked.

2. **Spend it.** Follow `arkade-contract`. It clones `arkade-os/ts-sdk` into `vendor/ts-sdk` and runs `pnpm add @arkade-os/sdk`. Load the artifact with `programFromArtifact` and spend the functions it declares. `ContractManager` is the only writer of contract and VTXO rows. Leave `vendor/` untracked.

3. **Build the screen.** Follow `arkade-product-ui`. It reads [emilkowalski/skills](https://github.com/emilkowalski/skills) and [Impeccable](https://github.com/pbakaus/impeccable). The screen offers the constructor, the funding step, and the spend functions the artifact has.

4. **Prove it.** Follow `arkade-regtest`. It clones [ArkLabsHQ/arkade-regtest](https://github.com/ArkLabsHQ/arkade-regtest) and starts the stack:

   ```bash
   node regtest/regtest.mjs start --env .env.regtest --profile ark --profile emulator
   ```

   Write one functional end-to-end test. Put helpers at the end of that file. Leave `regtest/` untracked.
