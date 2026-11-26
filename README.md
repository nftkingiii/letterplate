# Letterplate

Give any QoreChain account an address it can receive post-quantum sealed messages at, and check where to seal for any address.

Built for Build Before Q-Day, the QoreChain Developer Fest, in the Quantum Pass category.

## The problem

A message sealed with ML-KEM-1024 can only be opened by the holder of the recipient's key, so every encrypted app first has to answer one question: does this address have a key, and where is it? QoreChain has a native registry for these keys, but very few accounts are in it:

- On 21 November 2026, **0 of 8 mainnet and 0 of 4 testnet validators** had an encryption key registered.
- The real QoreX wallet refuses `MsgRegisterKEMKey` when a website asks for it ("managed by the wallet itself"), although QoreX's integration guide and its official wallet mock both allow it, and the extension has no setting of its own to register one. So a QoreX user cannot get a key today.

## What Letterplate does

**Check** (working): paste any `qor1…` address and Letterplate reads the chain to say whether it can receive sealed mail, and exactly where to seal:

| Status | Meaning |
|---|---|
| Can receive | The address has its own ML-KEM-1024 key in the registry |
| Can receive, through its sealing account | No key of its own, but it and a sealing account have each named the other on chain, and the sealing account has a key |
| Not yet: one-sided | The address named a sealing account that has not named it back, or that now names someone else |
| Not yet: no key | Both sides agree, but the sealing account has not published a key |
| Cannot receive | Neither |

**Validators** (working): the same check for every bonded validator on mainnet and testnet.

**Your address** (working): connect QoreX and get an address you can receive sealed mail at, one step at a time:

1. Create a sealing key in the browser. One 32-byte secret gives a small sealing account (secp256k1 + ML-DSA-87) and its ML-KEM-1024 key. You download a backup encrypted with your passphrase (PBKDF2-SHA-256, 600,000 rounds, then AES-256-GCM, bound to your address and the key). The secret is never stored or sent anywhere.
2. QoreX funds the sealing account with 0.3 test QOR.
3. The sealing account registers its ML-DSA-87 key, with a proof of possession.
4. It publishes its ML-KEM-1024 key and its half of the binding in one hybrid-signed transaction.
5. QoreX sends your half of the binding, hybrid-signed.

Steps 3 and 4 are signed in the browser and sent through the server's relay, because QoreChain's broadcast endpoint accepts no browser requests. The relay holds no keys and forwards only those two transaction shapes; anything else is refused before it reaches the chain ([`lib/relay.mjs`](lib/relay.mjs)). A lost backup can be replaced: make a new key and bind it, and the latest binding wins.

## The binding records

An account with no key of its own can point to a sealing account. The pointer counts only when both sides say so, each in a **hybrid-signed** transaction (secp256k1 + ML-DSA-87) that sends 1 uqor to itself:

```
letterplate/1 bind <sealing account>    from the owner
letterplate/1 sealer <owner>            from the sealing account
```

Self-addressed records stay with the account, so anyone can find them by listing the transfers an address received; there is no registry account to trust. The latest valid record of each kind wins, so an owner can rebind after losing a key, and a sealing account serves one owner at a time. A key of the address's own always wins over a binding. Records that are classical-only, sent to another account, bundled with other transfers, or that name their own sender are listed as refused, with the reason. The rules are in [`lib/resolve.mjs`](lib/resolve.mjs).

Public nodes prune old blocks (testnet keeps blocks from 8,790,799 onwards today). Letterplate reads newest first and, when it reaches the pruned part, says that older records could not be read instead of treating them as absent. A failed chain read is an error, never "cannot receive".

## Status

| What | Where | Result |
|---|---|---|
| Scaffold | `npx create-qorechain-dapp letterplate --template fullstack-web --network testnet` (0.14.0) | The first commit, [c875545](https://github.com/nftkingiii/letterplate/commit/c875545), is the untouched template. A scaffolder is not left in the dependencies, so the fest checks this kit by hand |
| Tests | `npm test` | 24/24 on Node 22: every resolver status, rebinding, a sealing account that cannot be borrowed, refused records, pruned history, failed reads, the relay's gate and rate limit, and the server's guard rails |
| Real addresses (testnet, 21 Nov 2026) | `GET /api/resolve` | Accounts with registry keys resolve to themselves with their key fingerprint; accounts without resolve to "cannot receive" |
| Real validators | `GET /api/validators` | Mainnet 0 of 8, testnet 0 of 4 can receive |
| Your address, end to end (22 Nov 2026) | Driven by the official QoreX wallet mock, a test double that signs for real on testnet | A new wallet went from "cannot receive" to "can receive, through its sealing account" (table below) |
| Your address, real QoreX on the live site (23 Nov 2026) | The builder's own QoreX extension on https://letterplate.up.railway.app | The same flow with the real wallet: four transactions, all code 0, and the live resolver answers "bound" (table below) |

### QoreX wallet-mock run (22 November 2026)

Test wallet `qor1hhcs5cvcyl2sqrcfgaydla57fqyxl5z7yl336l` (labelled "test wallet" in the app), sealing account `qor1qm2kezvalkcnyc2a3ue3gpwyncgl2udlqcdnul`.

| Step | Signed by | Tx hash | Block | Hybrid |
|---|---|---|---|---|
| Fund the sealing account | QoreX mock | `A1B1C98AD6C6461A84DEE90AEE89D31B5270C9D6D8F8D0F6A68C7D3BB43D7994` | 10532024 | yes |
| Register its ML-DSA-87 key (proof of possession) | browser, via relay | `4BFA487403126F2B5941B0C198E73883B5B8916396EC6B052C9A07D8166B4D89` | 10532037 | classical only, as the chain requires for this first transaction |
| Publish its ML-KEM-1024 key and `letterplate/1 sealer <owner>` | browser, via relay | `FF49FF108FFE9B81D699C335A3E91F7CF714703F60C4D89788E2836CD954ED63` | 10532054 | yes |
| `letterplate/1 bind <sealing account>` | QoreX mock | `80193FE70B911D1253CF6C58BD4B8E90B3E3D30131F4566619E7AE214ECFB3F8` | 10532098 | yes |

All code 0. Read back from the chain: the sealing account's encryption key is in the registry and its signing key is `hybrid` with `possession_proven: true`. `GET /api/resolve` for the test wallet answers `bound`, sealing to `qor1qm2kez…cdnul` (key SHA3-256 `742e8fe1…`), with no refused records.

### Real QoreX wallet on the live site (23 November 2026)

The builder's own QoreX extension, on the deployed site. Owner `qor12cjvg5ruayj4npett85pl82x567rj8c8fyj9nk`, sealing account `qor10jjugjayusta0vfqqz5wrlkdlwudjlqm0eslcr`.

| Step | Signed by | Tx hash | Block | Hybrid |
|---|---|---|---|---|
| Fund the sealing account (0.3 QOR) | QoreX | `E3551E08E2AA716497F86E242C2A7462D55496A8B5EB1BDA9EFE4B806B6375B4` | 10621458 | yes |
| Register its ML-DSA-87 key (proof of possession) | browser, via relay | `43C85D71BD69A8C76E4E672751C5140E6DF567730578E5723F396F096194AE79` | 10621464 | classical only, as the chain requires for this first transaction |
| Publish its ML-KEM-1024 key and `letterplate/1 sealer <owner>` | browser, via relay | `59D5B80C3E912B7CB1035E7CD85C1A06D7987FA552484B24B79297AB83B0B156` | 10621469 | yes |
| `letterplate/1 bind <sealing account>` | QoreX | `2AF3ACFB0C0707BF5732B0380FEF4FC617E06AF06639A5AC706FAA5602746E4A` | 10621484 | yes |

All code 0, the whole flow in under a minute (15:20:47 to 15:21:25 UTC). Read back from the chain: the sealing account's encryption key is in the registry, and its signing key is `hybrid` with `possession_proven: true`. `GET https://letterplate.up.railway.app/api/resolve?address=qor12cjvg…fyj9nk` answers `bound`, sealing to `qor10jjug…eslcr` (key SHA3-256 `da02385b…`), with no refused records.

## Run it

```sh
npm install
npm run dev:server   # the read-only server on :8787 (the chain's REST API sends no CORS headers)
npm run dev:web      # Vite on :5173, proxies /api to the server (and, in development only, /qore-rest for the QoreX wallet mock)
npm test
```

Production: `npm run build`, then `npm start` serves the API and the built app.

## How it was built

With an AI coding agent (Claude Code). What the AI wrote, what the builder decided, how each claim was checked and where the AI got things wrong are in [AI_USAGE.md](AI_USAGE.md).

## Credits

- Scaffolded with [`create-qorechain-dapp`](https://www.npmjs.com/package/create-qorechain-dapp) 0.14.0 (`fullstack-web` template, Apache-2.0).
- [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk) 0.14.0.
- [`@qorechain/qoreseal`](https://github.com/qorechain/qoreseal) 0.1.0 (ML-KEM-1024 keys, `MsgRegisterKEMKey`), [`@qorechain/qorex-types`](https://github.com/qorechain/qorex-integrations) 0.1.0 (QoreX detection and `signAndBroadcast`), and `@qorechain/qorex-wallet-mock` 0.1.0 for the end-to-end test. Apache-2.0.
- `@cosmjs/proto-signing`, `cosmjs-types`, [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) and `buffer`.
- The sealing account, its key backup, the relay and the QoreX wallet code are adapted from the same builder's [Quorate](https://github.com/nftkingiii/quorate), built earlier in this fest. Letterplate uses its own derivation labels and backup format, so keys from the two apps never mix.
- Schibsted Grotesk and JetBrains Mono (SIL Open Font License).

## Licence

Apache-2.0. See [LICENSE](LICENSE).
