/**
 * DEMO-02 delivery notes (see docs/evidence/vq-07-dynamic/ for proof set).
 *
 * REAL end-to-end verified at commit time (PR #38): 14 genuine
 * POST /api/demo/simulation requests drove the world (sim clock 9000 ms,
 * 18 steps); real fault command dropped ROV optical q to 0.086 with sonar
 * independent (0.612); real replay returned identical snapshots.
 *
 * FIXTURE transport is opt-in only (?fixture=1) and double-badged in UI.
 */
