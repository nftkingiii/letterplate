# Letterplate

Give any QoreChain account an address it can receive post-quantum sealed messages at, and check where to seal for any address.

Built for Build Before Q-Day, the QoreChain Developer Fest, in the Quantum Pass category.

## The problem

A message sealed with ML-KEM-1024 can only be opened by the holder of the recipient's key, so every encrypted app first has to answer one question: does this address have a key, and where is it? QoreChain has a native registry for these keys, but very few accounts are in it:

- On 21 November 2026, **0 of 8 mainnet and 0 of 4 testnet validators** had an encryption key registered.
- The real QoreX wallet refuses `MsgRegisterKEMKey` when a website asks for it ("managed by the wallet itself"), although QoreX's integration guide and its official wallet mock both allow it. So a QoreX user cannot get a key from a dApp today.

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

**Get an address** (in progress): connect QoreX, create a sealing key in the browser (backed up with your passphrase), publish its encryption key, and bind it to your QoreX account both ways.

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
| Scaffold | `npx create-qorechain-dapp letterplate --template fullstack-web` (0.14.0) | The first commit is the untouched template |
| Resolver rules | `npm test` | 18/18 on Node 22: every status, rebinding, a sealing account that cannot be borrowed, refused records, pruned history, failed reads, and the server's guard rails |
| Real addresses (testnet, 21 Nov 2026) | `GET /api/resolve` | Accounts with registry keys resolve to themselves with their key fingerprint; accounts without resolve to "cannot receive" |
| Real validators | `GET /api/validators` | Mainnet 0 of 8, testnet 0 of 4 can receive |

## Run it

```sh
npm install
npm run dev:server   # the read-only server on :8787 (the chain's REST API sends no CORS headers)
npm run dev:web      # Vite on :5173, proxies /api to the server
npm test
```

Production: `npm run build`, then `npm start` serves the API and the built app.

## Credits

- Scaffolded with [`create-qorechain-dapp`](https://www.npmjs.com/package/create-qorechain-dapp) 0.14.0 (`fullstack-web` template, Apache-2.0).
- [`@qorechain/sdk`](https://www.npmjs.com/package/@qorechain/sdk) 0.14.0.
- The sealing-account approach, its relay and the two-way binding come from the same builder's [Quorate](https://github.com/nftkingiii/quorate), built earlier in this fest.
- Schibsted Grotesk and JetBrains Mono (SIL Open Font License).

## Licence

Apache-2.0. See [LICENSE](LICENSE).
