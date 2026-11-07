# VORQYN judge release runbook

The executable release workflow and submission materials live in [docs/release/README.md](release/README.md). This replaces the earlier aspirational end-to-end storyboard: current main at release base `b8f819ada84e0378deaa58ebe105b0464387c1fe` has an interactive **static** port world, metadata fallback, browser-local drafts and a separate world-aligned synthetic kernel. It does not have integrated dynamic browser playback, authenticated organizations, verifier/AI recovery or demonstrated Solana settlement.

1. Run [the isolated preflight](release/README.md) on the exact committed candidate. It records PASS, FAIL, BLOCKED and NOT RUN and returns nonzero for failed or incomplete gates.
2. Inspect the genuine screenshots and [release findings](evidence/release/README.md), including the measured 320px overflow and UW/INSPECT discoverability concern. Do not certify every viewport merely because PNG dimensions validate.
3. Record the currently enabled [shot list](release/RECORDING_PLAN.md) with [devnet-unavailable narration](release/narration-contingency.txt). It begins with the hackathon name and is budgeted below two minutes. No recorded media is supplied by this PR.
4. Only enable [integrated-synthetic narration](release/narration-integrated-synthetic.txt) after #32/#33 merge and the **actual** integration checks pass. No mocks, skipped endpoint tests or static-anchor motion claims.
5. Follow the [founder submission desk](release/SUBMISSION.md) and adapt the concrete [submission copy](release/SUBMISSION_COPY.md). Public deployment/video, real chain proof and an accepted portal receipt remain unverified human/integration gates.

On Sunday November 8, the operating cutoffs are **9:00 AM CST initial** and **10:45 AM CST final/hacking ends** (10:00/11:45 AM Eastern). The public portal's later 1:00 PM EST closure does not override the [organizer schedule](https://events.mlh.com/events/15200-solana-hackathon). The authenticated [submission form](https://www.mlh.com/events/solana-hackathon/submissions/new) requires founder sign-in; its fields and actual receipt have not been inspected.

Solana's eventual escrow/assignment/claim rules belong to Lane 1's real program and proof. A synthetic sensor value, source hash, wallet popup or nice render is not a transaction, verifier decision or physical-truth guarantee. Parent #17 remains pending until reviewed code, public artifacts and an actual accepted submission are verified. No deployment, video or receipt is claimed here.
