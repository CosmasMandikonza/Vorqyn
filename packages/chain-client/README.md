# @vorqyn/chain-client (VQ-12 / #13)

Typed Solana client for the VORQYN mission escrow program: PDA derivation,
borsh account decoding, typed instruction builders and a **truthful
transaction-lifecycle state machine**.

- **PDAs** cross-verified against Rust-generated fixtures
  (`src/fixtures-chain.json`, produced by `find_program_address` +
  `AnchorSerialize` in the program's test environment).
- **Codecs** decode Mission/Task/VerifierRegistry byte-for-byte (borsh:
  u32 string/vec lengths, LE integers, 8-byte Anchor discriminators).
- **Lifecycle** (`src/lifecycle.ts`): awaiting_signature → submitted →
  processed → confirmed → finalized | rejected | expired | **unknown**.
  Nothing is ever confirmed without an RPC status that says so; reconcile
  queries the chain before any retry; terminal states freeze history.
- **Chain boundary**: `toChainAttestationExpirySeconds` is the single
  ms→s conversion (mirrors the verifier service).

## Local validator E2E (issue #13 DoD evidence)

`scripts/local-validator-e2e.test.ts` — skipped unless
`E2E_VALIDATOR=1` + `VORQYN_TEST_REGISTRY_ADMIN_KEYPAIR` are set. Runs the
full registry→mission→reassign→claim→close flow against a deployed `.so`
with real signatures and account read-backs. See the PR description for
the recorded run (LOCALNET — no devnet claim until deployment happens).

## Status

- **Instruction definitions are HANDWRITTEN, not generated from an Anchor
  IDL** (no avm/anchor CLI in this environment — nothing about IDL
  generation is claimed or invented). Their consistency with the deployed
  program artifact is verified two ways that do not depend on an IDL:
  (a) account codecs are pinned byte-for-byte by Rust `try_serialize`
  fixtures, and (b) the local-validator E2E executes every instruction
  against the actual compiled `.so` — a wrong discriminator or account
  order fails on-chain. When the team generates the official IDL at
  deployment, this package's internals can swap without changing its
  public surface.
- The browser entrypoint is bundling-verified: `pnpm test` includes an
  esbuild browser-platform bundle check that fails on any `node:` builtin
  (sha256 comes from `@noble/hashes`, audited and browser-safe).
- Program id = shared placeholder; devnet deployment is the release gate.
- Wallet/settlement UI integration is Lane 2 (apps/web) — this package is
  the Lane 1 client surface they consume.
