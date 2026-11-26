# How AI was used to build Letterplate

Letterplate was built by one person working with an AI coding agent: Claude Code (Anthropic), running the Claude Opus 5.5 model in the Claude desktop app on Windows. This file describes the workflow, what the AI produced, what the human decided and did, and how the work was checked. It is written from the actual build of 21–22 November 2026, and it says where the AI was wrong.

## The short version

- **The AI wrote almost all of the code and prose** in this repository: the resolver, the server and its relay, the web app, the tests, the README and this file.
- **The human chose the project and held every gate:** which idea, which name, every push, every deploy, and every wallet action.
- **Nothing is claimed without evidence from the chain.** The README's results come from commands that were run and transactions that were read back.

## How the idea was chosen

After finishing [Quorate](https://github.com/nftkingiii/quorate) for this fest, the human asked for a second project. The agent read the fest's live rules, prizes and kits pages and the list of 119 existing projects, then compared four directions: an ML-KEM address tool (Quantum Pass), a delegated-budget AI agent (AI Agents), a node cryptography inventory (Quantum Pass) and a Cross-VM app (prize not announced). It recommended the address tool. The gap was already proven during Quorate's build: real QoreX refuses `MsgRegisterKEMKey` from websites, and the human then checked that the extension has no setting for it either. The time risk was also low. The human chose it. The agent's first name, "Keyring", was dropped after a check found it taken several times over (a 1,500-star GitHub project, an npm package, and a crypto compliance company); "Letterplate" was free on npm, GitHub and the fest.

## Workflow

| Step | What happened |
|---|---|
| Scaffold | The agent ran `create-qorechain-dapp` 0.14.0 (`fullstack-web`) on a separate Linux VM and committed the template untouched, so its provenance is visible |
| Proof first | The checker and resolver came first and were tested against real addresses and the real validator sets before any wallet code was written |
| Reuse | The sealing account, key backup, relay and QoreX code were adapted from Quorate, with Letterplate's own derivation labels and backup format so keys from the two apps never mix |
| Verify | Tests, typecheck, audit and the production build run on the VM, not the laptop the code was written on. The end-to-end flow was run on testnet with the official QoreX wallet mock in a browser pane, and every transaction was read back from the chain (code, `PQCHybridSignature` extension, `pqc_hybrid_verify` event, registry state) |

## What the human did

- Chose Letterplate over the other candidates, approved the name, and asked to build it.
- Checked the real QoreX extension for a way to register an encryption key (there is none). That turned a hypothesis into a finding.
- Created the fest project page, and approved every push and the deploy.
- Approved the demo video's script, and uploaded the film.
- Ran the flow with the real QoreX extension on the live site and recorded it. The agent read the addresses from the recording and verified every transaction on chain.

## What the AI generated

| Area | Files |
|---|---|
| Rules | `lib/records.mjs` (memo formats), `lib/resolve.mjs` (who can receive, and why), `lib/chain.mjs` (chain reads, pruned history) |
| Server | `server/index.mjs` (resolve, validators, account and tx reads, the relay), `lib/relay.mjs`, `lib/accounts.mjs` |
| Web app | `src/*`: the Check, Your address and Validators tabs, the QoreX wallet calls, the sealing key and its backup |
| Tests | `test/*.test.mjs`: 24 tests |
| Writing | `README.md`, this file, the commit messages, and the text for the fest project page |
| Demo video | The script (approved by the builder before any build), every scene, rendered frame by frame from code over captures of the live site and the builder's own screen recording. The narration is a synthetic voice (Kokoro, run offline). The recording's passphrase entry is cut and a browser password prompt showing the builder's email is covered, both labelled on screen |

The agent wrote no cryptography. Keys, encryption and hybrid signing come from the official QoreChain kits and the browser's Web Crypto API.

## Where the AI was wrong, and how it was caught

| Mistake | How it was caught | Fix |
|---|---|---|
| Read an account's transfers oldest first. The public testnet node has pruned blocks below 8,790,799, so the read failed for a validator with older history | The validator list for testnet returned an error during the first check on the VM; the agent traced it to the node's "height is not available" answer | Read newest first, stop at the pruned part, and say that older records could not be read instead of treating them as absent. Tests cover both cases |
| The top bar said "Testnet" while the Validators tab showed mainnet, and mainnet rows linked to a check that only reads testnet | Reviewing screenshots of the built app before committing | Removed the label; only testnet rows link to the check |
| The copied backup code used byte-array types that a newer TypeScript (5.9) rejects | The typecheck on the VM | Declared the buffers as ArrayBuffer-backed, which they always are at runtime |
| A cleanup command on the VM (`pkill -f`) matched its own shell and killed it before packing the screenshots | The archive was missing | Packed the screenshots in a separate command |
| Mistyped the sealing account's address in a read-back script, which made the chain look empty | The address did not match the one on screen | Re-ran with the right address; no claim was made from the wrong read |

## Safety rules the agent followed

- **No secrets in the repository or the conversation.** The test wallet's recovery phrase and the test backup passphrase live in `.keys/`, which git ignores; the agent checked that nothing sensitive is tracked before each commit.
- **No action without a yes.** Pushes, the deploy and the project page waited for the human. Everything ran on testnet with valueless tokens.
- **Honest labels.** The first end-to-end run used the official QoreX wallet mock, and the README and the app say so. The builder then ran the same flow with the real QoreX extension on the live site; the README lists both runs separately.

## What remains human work

Whether encrypted-app builders and QoreX users want this.
