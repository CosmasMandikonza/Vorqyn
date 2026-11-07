//! VORQYN mission escrow program - VQ-00 skeleton.
//!
//! This crate intentionally contains **no mission/payment logic**.
//! `initialize_mission`, `fund_mission`, `create_task`/`assign_task`,
//! `authorize_reassignment`, `verify_and_claim` and `close/refund` are
//! specified in `docs/SOLANA_PROTOCOL.md` and land in VQ-04..VQ-06.
//! The single no-op instruction below only proves the Anchor macro
//! pipeline compiles under `cargo check` in CI.

use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

#[program]
pub mod vorqyn {
    use super::*;

    /// No-op placeholder replaced by real instructions in VQ-04 (#5).
    pub fn scaffolding_placeholder(_ctx: Context<ScaffoldingPlaceholder>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ScaffoldingPlaceholder {}
