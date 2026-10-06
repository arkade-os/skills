# Arkade skills

Three skills for a fresh project. They clone what they need. They do not assume the working tree is the SDK or the regtest stack. Installing them does not add the compiler, the SDK, or regtest.

```bash
pnpm dlx skills add arkade-os/skills
```

| Skill | What it does |
| --- | --- |
| `arkade-contract` | Clones `arkade-os/ts-sdk` into `vendor/ts-sdk` and depends on `@arkade-os/sdk`. Loads any artifact with `programFromArtifact` and spends the functions that artifact declares. `ContractManager` is the only writer of contract and VTXO rows. |
| `arkade-product-ui` | Reads [emilkowalski/skills](https://github.com/emilkowalski/skills) and [Impeccable](https://github.com/pbakaus/impeccable). A screen offers the constructor, the funding step, and the spend functions the artifact has. |
| `arkade-regtest` | Clones [ArkLabsHQ/arkade-regtest](https://github.com/ArkLabsHQ/arkade-regtest) and starts it with `node regtest/regtest.mjs start --profile ark --profile emulator`. One functional end-to-end test against that stack. Helpers go at the end of the file. |

`arkadec` comes from a clone of [arkade-os/compiler](https://github.com/arkade-os/compiler). Commit artifacts and `.ark` files. Ignore `vendor/` and `regtest/`.
