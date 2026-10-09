# Arkade contract skills

Skills for an Arkade product: decide it, write the contract, spend the artifact, show one next action, and prove it on regtest.

Install them into a fresh project with the [skills CLI](https://skills.sh), then follow them in this order.

```bash
npx skills add arkade-os/skills
```

## What to do

1. **Decide the contract.** Follow `arkade-product`. A coin is not a balance. A `require` is not authorization. Pin the outputs in the address that gets funded. A standing order completes later without the funder. A token burn is the right, in place of `checkSig`.

2. **Write the contract.** Follow `writing-arkade-contracts`. It clones [arkade-os/compiler](https://github.com/arkade-os/compiler) and runs `arkadec`. Commit the `.ark` file and the artifact. Leave `compiler/` untracked. When the contract changes, the app README changes in the same commit.

3. **Spend it.** Follow `arkade-contract`. Mutinynet is the default session: `https://mutinynet.arkade.sh`, `https://emulator.mutinynet.arkade.sh`, `https://mempool.mutinynet.arkade.sh/api`. The page subscribes. `ContractManager` writes. The screen reads the repository after `vtxo_received` and `vtxo_spent`. Leave `vendor/` untracked.

4. **Build the screen.** Follow `arkade-product-ui`. The screen offers one next action. Hide a function the user cannot satisfy.

5. **Prove it.** Follow `arkade-regtest`. It clones [ArkLabsHQ/arkade-regtest](https://github.com/ArkLabsHQ/arkade-regtest) and starts the stack:

   ```bash
   node regtest/regtest.mjs start --env .env.regtest --profile ark --profile emulator
   ```

   One test fails if a direct send of sats is counted as the contract's position. Helpers go at the end of that file. Leave `regtest/` untracked.
