---
tags: [skill-creator]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

people pay our escrow address and then some of them just close the tab and never come back. the money sits there until somebody opens the page again. I want it to go back to the payer by itself once the deadline is over, nobody online. we can use the executor at https://executor.mutinynet.arkade.sh. the contract is escrow.artifact.json.

write what's needed and save template.json, plus delegation.json = the exact JSON body I POST for this one deposit:
- payer key 02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5
- refund goes to taproot program 79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
- merchant key 02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9
- deadline 1800000000
- exitDelay 4194308 (already the BIP68 value)

dont register anything on the live executor, I'll do that myself, a placeholder for the template id is fine. then tell me in a few lines what I still have to do.

Input files: escrow.artifact.json
