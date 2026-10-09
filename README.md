# Arkade contract skills

Skills for an Arkade product: decide it, write the contract, draw the coins, spend the artifact, show one next action, and prove it on regtest.

Install them into a fresh project with the [skills CLI](https://skills.sh), then follow them in this order.

```bash
npx skills add arkade-os/skills
```

## What to do

1. **Product.** Follow `arkade-product`. A coin is not a balance. A `require` is not authorization. Pin the outputs in the address that gets funded. A standing order completes later without the funder. A token burn is the right, in place of `checkSig`.

2. **Write the contract.** Follow `writing-arkade-contracts`. It clones [arkade-os/compiler](https://github.com/arkade-os/compiler) and runs `arkadec`. Commit the `.ark` file and the artifact with the picture from the next step. Leave `compiler/` untracked.

3. **covenant-viz.** Follow `covenant-viz`. Regenerate the short README story in mermaid in that same commit. The pictures, in order, are the coin the person sends, the plain send beside the mint, the rejected transaction, and who signs versus who can build a server-plus-emulator leaf. A `require` is not a secret.

4. **Spend.** Follow `arkade-contract`. Mutinynet is the default session: `https://mutinynet.arkade.sh`, `https://emulator.mutinynet.arkade.sh`, `https://mempool.mutinynet.arkade.sh/api`. The page subscribes. `ContractManager` writes. The screen reads the repository after `vtxo_received` and `vtxo_spent`. Leave `vendor/` untracked.

5. **Screen.** Follow `arkade-product-ui`. The screen follows that picture and shows one next action. It does not invent a second protocol.

6. **Regtest.** Follow `arkade-regtest`. It clones [ArkLabsHQ/arkade-regtest](https://github.com/ArkLabsHQ/arkade-regtest) and starts the stack:

   ```bash
   node regtest/regtest.mjs start --env .env.regtest --profile ark --profile emulator
   ```

   Inside that one end-to-end file, a direct send of sats must not count as the contract's position. Helpers go at the end of the file. Leave `regtest/` untracked.
