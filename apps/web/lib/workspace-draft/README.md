# Browser-local mission planning boundary

This folder is private to the web experience for Issue #28. Its `DraftInput` and `LocalDraft` are not VQ-01 contracts, mission state, task events, organization records, authorization, escrow or a simulation reducer. No data is sent to an API.

## Input and persistence

- The only template is the actual fictional `PORT-001` world. `metadata.ts` reads the checked-in `assets/port-world/world.json` without changing assets or importing a viewer/simulator. Zone IDs, labels, kinds, heights and damaged flags come from that file.
- The metadata does not define sensors. The camera/route-mapping/optical/sonar choices are explicitly labeled, product-derived planning requirements. They do not claim available equipment, approved fleets or registered operators.
- The namespace is `vorqyn.local-mission-drafts`, with envelope `{ version: 1, drafts: [...] }`. IDs use browser cryptographic UUIDs; the template ID never substitutes for a distinct draft ID.
- Storage is bounded to 20 records and 128 KiB conservatively measured as UTF-16 code units × 2. Unknown keys, malformed fields, unsupported zones/sensors, inconsistent lamports, duplicate IDs, oversized records and unsupported versions are blocked before rendering or writing.
- Partial progress can contain unfinished form values; shape/bounds/privacy guards apply to all writes. `complete: true` additionally requires full planning validation. It means reviewed/saved local brief, not an approved, funded or launched mission.
- SOL parsing uses a strict decimal grammar and BigInt multiplication/addition. The persisted amount is an integer lamport **string**, never an IEEE floating-point amount. Up to 9 decimals, at least 1 lamport, at most 1,000,000 SOL. This is a frontend planning ceiling, not a claim about chain policy.
- Autosave is debounced by 450ms and persists step position. The status distinguishes pending inputs from saved browser data. Before-unload, anchor navigation and browser-back guards warn about unsaved changes. User-confirmed discard, forced browser termination, cleared/evicted storage and browser bugs can still lose pending edits; this is not a durable server store.

## Concurrency and recovery

All repository mutations use the same origin-wide Web Lock around fresh read → expected per-draft revision comparison → write. This avoids a misleading promise that localStorage alone provides atomic compare-and-set. Independent A/B records merge under that lock; stale edits and deletes reject. Repeated identical saves do not add a record or revision.

Storage events refresh the list and pause saving on a conflicting active revision or deletion. The UI preserves the open input and offers loading the browser copy or keeping the input under a new UUID. It never silently restores a deleted ID. Browsers without Web Locks cannot save; they show the limitation and permit memory-only planning where cryptographic UUID support is available. HTTPS or localhost and a current browser are required.

Corrupt JSON and unsupported schema versions remain untouched. Reset requires an explicit browser confirmation and removes only this namespace; theme settings and unrelated storage remain intact. Reset refuses a now-readable collection. Storage read/write/quota failures are visible, never reported as saved. Retry does not bypass schema validation or stale-write checks.

Only whitelisted planning fields are persisted. Title length is bounded and obvious secret patterns / mnemonic-length text are blocked before writes. There are no wallet, credential, freeform customer-notes or organization fields. These heuristics are not a guarantee that arbitrary text is non-sensitive. Storage is unencrypted, not tenant-isolated, and readable by scripts on the origin; use fictional names and never enter private or customer data. React escapes titles as text, including markup-looking titles.

## Eventual canonical adapter

After Lane 1 merges the reviewed VQ-01 contracts and Issue #4 provides authenticated organizations, a separate reviewed adapter must validate/map template and zone versions, objectives, required capabilities, acceptance policy and exact lamports into those canonical inputs. It must obtain the real authenticated organization/owner, enforce server validation and tenant isolation, establish canonical IDs/idempotency and receive authoritative persistence/financial state.

Do not add guessed organization IDs, forge events, treat this storage as secure company data, or promote a local `complete` flag into launch/funding/verification status. No adapter, backend write or canonical state migration is implemented here. Parent #4 remains open.
