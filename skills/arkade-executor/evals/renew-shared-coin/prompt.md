---
tags: [skill-creator]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

our savings pool coins all sit at one shared address, each coin's state is in packet 70 of the transaction that made it. they expire after a few weeks and people lose track. make them renew on their own through the executor (https://executor.mutinynet.arkade.sh), a day before they expire, with the fee capped at 500 sats.

heads up: some pool coins come out of transactions that also carry a packet 34 (a price note) that the pool doesn't care about.

contract is savings_pool.artifact.json. exit key is the unspendable one, 0250929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0, exitDelay 4194308 (already the BIP68 value).

save template.json and delegation.json (the exact JSON body I POST). dont register anything on the live executor, i'll do that, a placeholder for the template id is fine. tell me in a few lines what I should watch out for.

Input files: savings_pool.artifact.json
