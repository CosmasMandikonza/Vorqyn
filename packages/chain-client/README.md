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

- Program id = shared placeholder; devnet deployment is the release gate.
- Wallet/settlement UI integration is Lane 2 (apps/web) — this package is
  the Lane 1 client surface they consume.
