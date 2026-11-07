//! VORQYN mission escrow program — VQ-04 (issue #5) + VQ-05 (issue #6).
//!
//! Scope of THIS crate version: mission initialization, escrow funding,
//! task creation with bounded reward reservation, initial operator
//! assignment, and owner-authorized task reassignment with
//! compare-and-set assignment versioning. Payout (verify_and_claim),
//! delegated AI authority, operator registry and refunds are deliberately
//! NOT implemented here — they land in VQ-06+ per docs/SOLANA_PROTOCOL.md
//! §4.
//!
//! Interface alignment: packages/contracts/CHAIN_SEAM.md (draft agreement
//! with the VQ-01 contracts owner):
//! - §1/§2 mission/task IDs are ASCII `^[a-z0-9][a-z0-9-]{2,31}$` so
//!   UTF-8 bytes == seed bytes (3..=32).
//! - §3 on-chain authority is the operator PAYOUT WALLET Pubkey; the
//!   lowercase `operatorId` string never appears on chain.
//! - §4 PDAs: ["vorqyn:mission", owner, mission_id],
//!   ["vorqyn:task", mission_pda, task_id], ["vorqyn:vault", mission_pda].
//! - §1 assignment versions: 0 = unassigned, 1 on first assignment, +1 per
//!   authorized reassignment (identical to the contracts reducer).
//! - §5 reassignment is a compare-and-set on `expected_assignment_version`
//!   and emits the enacted payout wallet (`new_payout_wallet`, IDL
//!   `newPayoutWallet`) so off-chain receipts are self-verifying
//!   (CHAIN_SEAM §8 open question 5 — answered YES for reassignment).
//! - §7 money is integer lamports (u64) with checked arithmetic only.

use anchor_lang::prelude::*;

// Throwaway placeholder program id (no keypair exists or is committed);
// replaced via `anchor keys sync` at devnet deployment time.
declare_id!("AHXUZz3HsnPjtUGdeg1VB4uyHN2WtVpkrQ2ZKgzX49dc");

// ---------------------------------------------------------------------------
// Seeds (CHAIN_SEAM.md §4)
// ---------------------------------------------------------------------------

pub const MISSION_SEED: &[u8] = b"vorqyn:mission";
pub const TASK_SEED: &[u8] = b"vorqyn:task";
pub const VAULT_SEED: &[u8] = b"vorqyn:vault";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Mission lifecycle on chain. Closing/refunding is a documented policy
/// (ACCOUNTS.md) implemented in a later issue; only Active accounts accept
/// funding and task activity.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MissionStatus {
    Active,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TaskKind {
    Air,
    Land,
    Sea,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TaskStatus {
    Unassigned,
    Assigned,
}

/// Escrow-holding mission aggregate (PDA: [MISSION_SEED, owner, mission_id]).
#[account]
#[derive(InitSpace)]
pub struct Mission {
    /// Mission customer: the only signer allowed to fund/create/assign.
    pub owner: Pubkey,
    /// Independent verifier authority (SOLANA_PROTOCOL.md §3). Stored at
    /// init so later verify_and_claim instructions never need a migration;
    /// no instruction in VQ-04 consumes it yet.
    pub verifier_authority: Pubkey,
    /// CHAIN_SEAM §1/§2 ID: ASCII, 3..=32 bytes, [a-z0-9-].
    #[max_len(32)]
    pub mission_id: String,
    /// Total lamports ever credited by confirmed fund_mission transfers.
    pub funded_lamports: u64,
    /// funded - reserved; lamports available for new task reservations.
    pub remaining_lamports: u64,
    /// Lamports locked by task budgets (full budget at creation; the agreed
    /// reward after assignment releases the difference back to remaining).
    pub reserved_lamports: u64,
    pub status: MissionStatus,
    /// Unix timestamp; 0 = no expiry.
    pub expiry: i64,
    pub bump: u8,
}

/// Task account (PDA: [TASK_SEED, mission_pda, task_id]).
#[account]
#[derive(InitSpace)]
pub struct Task {
    pub mission: Pubkey,
    /// CHAIN_SEAM §1/§2 ID: ASCII, 3..=32 bytes, [a-z0-9-].
    #[max_len(32)]
    pub task_id: String,
    pub task_kind: TaskKind,
    /// Maximum reward ever reservable for this task.
    pub budget_lamports: u64,
    /// 0 while unassigned; 1 on first assignment (CHAIN_SEAM §1). Later
    /// reassignments (VQ-05) increment under a compare-and-set.
    pub current_assignment_version: u64,
    /// Payout wallet of the assigned operator (CHAIN_SEAM §3). None until
    /// the first assign_task.
    pub current_operator: Option<Pubkey>,
    /// Agreed reward for the CURRENT assignment version (0 while unassigned).
    pub reward_lamports: u64,
    pub status: TaskStatus,
    /// Fields reserved for VQ-05/VQ-06 (kept zero-valued here so account
    /// layouts never migrate): accepted evidence digest, accepted version
    /// and paid version for one-time payout protection.
    pub evidence_digest: Option<[u8; 32]>,
    pub accepted_version: Option<u64>,
    pub paid_version: Option<u64>,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum VorqynError {
    #[msg("IDs must be 3..=32 bytes of [a-z0-9-], starting with [a-z0-9] (CHAIN_SEAM §2)")]
    InvalidId,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("expiry must be zero (none) or a unix timestamp in the future")]
    InvalidExpiry,
    #[msg("task reward exceeds the task budget")]
    RewardExceedsTaskBudget,
    #[msg("task budget exceeds the mission's unreserved (remaining) funds")]
    RewardExceedsUnreservedFunds,
    #[msg("integer overflow in lamport accounting")]
    Overflow,
    #[msg("task is not unassigned")]
    TaskNotUnassigned,
    #[msg("mission has expired")]
    MissionExpired,
    #[msg(
        "expected assignment version does not match the current version (compare-and-set failed)"
    )]
    StaleAssignmentVersion,
    #[msg("task is not in a reassignable state (must be Assigned and unpaid)")]
    TaskNotReassignable,
    #[msg("replacement operator payout wallet is invalid (default pubkey)")]
    InvalidOperatorWallet,
    #[msg("vault balance change does not match the funded amount")]
    VaultBalanceMismatch,
    #[msg("signer does not own this mission")]
    InvalidOwner,
    #[msg("task account does not belong to this mission")]
    InvalidTaskAccount,
}

// ---------------------------------------------------------------------------
// Events (consumable by the TS client via IDL; mirror CHAIN_SEAM §6 fields)
// ---------------------------------------------------------------------------

#[event]
pub struct MissionInitialized {
    pub mission_id: String,
    pub owner: Pubkey,
    pub verifier_authority: Pubkey,
    pub expiry: i64,
    pub vault: Pubkey,
}

#[event]
pub struct MissionFunded {
    pub mission_id: String,
    pub amount_lamports: u64,
    pub funded_lamports: u64,
    pub vault_balance_lamports: u64,
}

#[event]
pub struct TaskCreated {
    pub mission_id: String,
    pub task_id: String,
    pub task_kind: TaskKind,
    pub budget_lamports: u64,
    pub reserved_lamports: u64,
}

#[event]
pub struct TaskAssigned {
    pub mission_id: String,
    pub task_id: String,
    pub assignment_version: u64,
    pub operator: Pubkey,
    pub reward_lamports: u64,
    pub reserved_lamports: u64,
}

/// Emitted by `authorize_reassignment`. Field names mirror the CHAIN_SEAM
/// §6 reassignment receipt: `task_id` + `assignment_version` (the NEW
/// version) + `reward_lamports` (the quote == receipt amountLamports) are
/// the Finding-D required bindings, and `new_payout_wallet` (IDL
/// `newPayoutWallet`) answers CHAIN_SEAM §8 Q5 so receipts can verify the
/// operator the program actually enacted.
#[event]
pub struct TaskReassigned {
    pub mission_id: String,
    pub task_id: String,
    /// The version that was replaced (always >= 1: reassignment requires
    /// an existing assignment).
    pub expected_assignment_version: u64,
    /// The newly enacted version (expected + 1) — the value receipts bind to.
    pub assignment_version: u64,
    pub previous_operator: Pubkey,
    pub new_payout_wallet: Pubkey,
    pub reward_lamports: u64,
    pub reserved_lamports: u64,
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

#[program]
pub mod vorqyn {
    use super::*;

    /// Create the mission PDA and its escrow vault. The vault starts empty;
    /// funding happens exclusively through `fund_mission` so every lamport
    /// in the vault is accounted for in `funded_lamports`.
    pub fn initialize_mission(
        ctx: Context<InitializeMission>,
        mission_id: String,
        verifier_authority: Pubkey,
        expiry: i64,
    ) -> Result<()> {
        validate_vorqyn_id(&mission_id)?;
        require!(expiry >= 0, VorqynError::InvalidExpiry);
        let now = Clock::get()?.unix_timestamp;
        require!(expiry == 0 || expiry > now, VorqynError::MissionExpired);

        let mission = &mut ctx.accounts.mission;
        mission.owner = ctx.accounts.owner.key();
        mission.verifier_authority = verifier_authority;
        mission.mission_id = mission_id.clone();
        mission.funded_lamports = 0;
        mission.remaining_lamports = 0;
        mission.reserved_lamports = 0;
        mission.status = MissionStatus::Active;
        mission.expiry = expiry;
        mission.bump = ctx.bumps.mission;

        emit!(MissionInitialized {
            mission_id,
            owner: mission.owner,
            verifier_authority,
            expiry,
            vault: ctx.accounts.vault.key(),
        });
        Ok(())
    }

    /// Transfer lamports from the mission owner into the escrow vault and
    /// account for them exactly once, verifying the vault balance delta.
    pub fn fund_mission(ctx: Context<FundMission>, amount: u64) -> Result<()> {
        require!(amount > 0, VorqynError::ZeroAmount);
        let mission = &mut ctx.accounts.mission;
        require_active_not_expired(mission.expiry)?;

        let vault_info = ctx.accounts.vault.to_account_info();
        let pre_lamports = vault_info.lamports();

        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: vault_info.clone(),
            },
        );
        anchor_lang::system_program::transfer(cpi_ctx, amount)?;

        // Defense in depth: the stored ledger must equal the real vault.
        let post_lamports = vault_info.lamports();
        let delta = post_lamports
            .checked_sub(pre_lamports)
            .ok_or(VorqynError::Overflow)?;
        require!(delta == amount, VorqynError::VaultBalanceMismatch);

        let (funded, remaining) =
            credit_funding(mission.funded_lamports, mission.remaining_lamports, amount)?;
        mission.funded_lamports = funded;
        mission.remaining_lamports = remaining;

        emit!(MissionFunded {
            mission_id: mission.mission_id.clone(),
            amount_lamports: amount,
            funded_lamports: mission.funded_lamports,
            vault_balance_lamports: post_lamports,
        });
        Ok(())
    }

    /// Create a task and reserve its full budget. Reserved amounts can
    /// never exceed funded amounts (checked arithmetic), and the task PDA's
    /// uniqueness makes duplicate task IDs impossible on the same mission.
    pub fn create_task(
        ctx: Context<CreateTask>,
        task_id: String,
        task_kind: TaskKind,
        budget_lamports: u64,
    ) -> Result<()> {
        validate_vorqyn_id(&task_id)?;
        require!(budget_lamports > 0, VorqynError::ZeroAmount);

        let mission = &mut ctx.accounts.mission;
        require_active_not_expired(mission.expiry)?;
        require!(
            budget_lamports <= mission.remaining_lamports,
            VorqynError::RewardExceedsUnreservedFunds
        );

        let task = &mut ctx.accounts.task;
        task.mission = mission.key();
        task.task_id = task_id.clone();
        task.task_kind = task_kind;
        task.budget_lamports = budget_lamports;
        task.current_assignment_version = 0;
        task.current_operator = None;
        task.reward_lamports = 0;
        task.status = TaskStatus::Unassigned;
        task.evidence_digest = None;
        task.accepted_version = None;
        task.paid_version = None;
        task.bump = ctx.bumps.task;

        mission.reserved_lamports = mission
            .reserved_lamports
            .checked_add(budget_lamports)
            .ok_or(VorqynError::Overflow)?;
        mission.remaining_lamports = mission
            .remaining_lamports
            .checked_sub(budget_lamports)
            .ok_or(VorqynError::Overflow)?;

        emit!(TaskCreated {
            mission_id: mission.mission_id.clone(),
            task_id,
            task_kind,
            budget_lamports,
            reserved_lamports: mission.reserved_lamports,
        });
        Ok(())
    }

    /// Initially assign a task to an operator's payout wallet. The agreed
    /// reward must not exceed the task budget; the difference is released
    /// from reservation back to remaining. Reassignment of an already
    /// assigned task is rejected here (TaskNotUnassigned) and handled
    /// exclusively by `authorize_reassignment` with a compare-and-set.
    pub fn assign_task(
        ctx: Context<AssignTask>,
        task_id: String,
        operator: Pubkey,
        reward_lamports: u64,
    ) -> Result<()> {
        // task_id is validated at creation; the PDA seeds constraint below
        // guarantees the account matches the passed id byte-for-byte.
        let _ = task_id;
        require!(reward_lamports > 0, VorqynError::ZeroAmount);

        let mission = &mut ctx.accounts.mission;
        require_active_not_expired(mission.expiry)?;

        let task = &mut ctx.accounts.task;
        require!(
            task.status == TaskStatus::Unassigned,
            VorqynError::TaskNotUnassigned
        );
        require!(
            reward_lamports <= task.budget_lamports,
            VorqynError::RewardExceedsTaskBudget
        );

        // Release the un-needed part of the reservation (checked).
        let release = task
            .budget_lamports
            .checked_sub(reward_lamports)
            .ok_or(VorqynError::Overflow)?;
        mission.reserved_lamports = mission
            .reserved_lamports
            .checked_sub(release)
            .ok_or(VorqynError::Overflow)?;
        mission.remaining_lamports = mission
            .remaining_lamports
            .checked_add(release)
            .ok_or(VorqynError::Overflow)?;

        task.current_assignment_version = task
            .current_assignment_version
            .checked_add(1)
            .ok_or(VorqynError::Overflow)?;
        task.current_operator = Some(operator);
        task.reward_lamports = reward_lamports;
        task.status = TaskStatus::Assigned;

        emit!(TaskAssigned {
            mission_id: mission.mission_id.clone(),
            task_id: task.task_id.clone(),
            assignment_version: task.current_assignment_version,
            operator,
            reward_lamports,
            reserved_lamports: mission.reserved_lamports,
        });
        Ok(())
    }

    /// Owner-authorized reassignment of an unfinished task
    /// (SOLANA_PROTOCOL.md §4.4; CHAIN_SEAM §5). Requires the caller to
    /// state the assignment version they believe is current
    /// (`expected_assignment_version`) — the on-chain compare-and-set: two
    /// competing reassignments from the same version cannot both succeed.
    ///
    /// Eligibility: the task must be `Assigned` (version >= 1) and not yet
    /// paid (`paid_version` is None). Workflow-level recoverability
    /// (evidence_insufficient / recovery_pending in the contracts reducer)
    /// is an off-chain policy layer — the chain enforces the authority and
    /// money subset, the reducer enforces the mission-flow subset.
    ///
    /// Budget: `reward_lamports` (the quote) must not exceed the task
    /// budget; a raise is topped up from the mission's unreserved
    /// remaining funds, a cut is released back. The ledger invariant
    /// `reserved + remaining == funded` holds before and after.
    ///
    /// Invalidation: any previously accepted proof eligibility for the old
    /// version is cleared (`evidence_digest`/`accepted_version`), so VQ-06
    /// payout can never pay the old operator for this task again.
    pub fn authorize_reassignment(
        ctx: Context<AuthorizeReassignment>,
        task_id: String,
        expected_assignment_version: u64,
        new_operator: Pubkey,
        reward_lamports: u64,
    ) -> Result<()> {
        // task_id is validated at creation; the PDA seeds constraint below
        // guarantees the account matches the passed id byte-for-byte.
        let _ = task_id;
        require!(reward_lamports > 0, VorqynError::ZeroAmount);

        let mission = &mut ctx.accounts.mission;
        require_active_not_expired(mission.expiry)?;

        let task = &mut ctx.accounts.task;
        // Only one explicit allowlist of reassignable states: Assigned and
        // unpaid. When VQ-06 adds evidence/payout task states, this is the
        // single line that must be revisited (see ACCOUNTS.md §4).
        require!(
            task.status == TaskStatus::Assigned,
            VorqynError::TaskNotReassignable
        );
        require!(
            task.paid_version.is_none(),
            VorqynError::TaskNotReassignable
        );
        require!(
            expected_assignment_version == task.current_assignment_version,
            VorqynError::StaleAssignmentVersion
        );
        require!(
            new_operator != Pubkey::default(),
            VorqynError::InvalidOperatorWallet
        );
        require!(
            reward_lamports <= task.budget_lamports,
            VorqynError::RewardExceedsTaskBudget
        );

        // Reservation transition (checked). A raise is topped up from
        // remaining; a cut is released back. Either way the funded ledger
        // invariant is preserved exactly.
        let old_reward = task.reward_lamports;
        if reward_lamports > old_reward {
            let top_up = reward_lamports
                .checked_sub(old_reward)
                .ok_or(VorqynError::Overflow)?;
            require!(
                top_up <= mission.remaining_lamports,
                VorqynError::RewardExceedsUnreservedFunds
            );
            mission.reserved_lamports = mission
                .reserved_lamports
                .checked_add(top_up)
                .ok_or(VorqynError::Overflow)?;
            mission.remaining_lamports = mission
                .remaining_lamports
                .checked_sub(top_up)
                .ok_or(VorqynError::Overflow)?;
        } else if reward_lamports < old_reward {
            let release = old_reward
                .checked_sub(reward_lamports)
                .ok_or(VorqynError::Overflow)?;
            mission.reserved_lamports = mission
                .reserved_lamports
                .checked_sub(release)
                .ok_or(VorqynError::Overflow)?;
            mission.remaining_lamports = mission
                .remaining_lamports
                .checked_add(release)
                .ok_or(VorqynError::Overflow)?;
        }

        // Atomic swap + version increment: the old operator and any proof
        // eligibility they held die with the old version.
        task.current_assignment_version = task
            .current_assignment_version
            .checked_add(1)
            .ok_or(VorqynError::Overflow)?;
        let previous_operator = task.current_operator.unwrap_or_default();
        task.current_operator = Some(new_operator);
        task.reward_lamports = reward_lamports;
        task.evidence_digest = None;
        task.accepted_version = None;

        emit!(TaskReassigned {
            mission_id: mission.mission_id.clone(),
            task_id: task.task_id.clone(),
            expected_assignment_version,
            assignment_version: task.current_assignment_version,
            previous_operator,
            new_payout_wallet: new_operator,
            reward_lamports,
            reserved_lamports: mission.reserved_lamports,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

/// CHAIN_SEAM §1/§2 ID rule: 3..=32 bytes, [a-z0-9-], first byte [a-z0-9].
pub fn validate_vorqyn_id(id: &str) -> Result<()> {
    let bytes = id.as_bytes();
    if bytes.len() < 3 || bytes.len() > 32 {
        return err!(VorqynError::InvalidId);
    }
    let first_ok = bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit();
    if !first_ok {
        return err!(VorqynError::InvalidId);
    }
    if !bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
    {
        return err!(VorqynError::InvalidId);
    }
    Ok(())
}

/// Pure funding-ledger transition (checked arithmetic). Extracted so the
/// u64 overflow boundary is unit-testable without cluster balances — LiteSVM
/// cannot provision accounts near u64::MAX lamports.
pub fn credit_funding(
    funded: u64,
    remaining: u64,
    amount: u64,
) -> std::result::Result<(u64, u64), VorqynError> {
    let funded = funded.checked_add(amount).ok_or(VorqynError::Overflow)?;
    let remaining = remaining.checked_add(amount).ok_or(VorqynError::Overflow)?;
    Ok((funded, remaining))
}

fn require_active_not_expired(expiry: i64) -> Result<()> {
    if expiry != 0 {
        let now = Clock::get()?.unix_timestamp;
        require!(now < expiry, VorqynError::MissionExpired);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(mission_id: String)]
pub struct InitializeMission<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        seeds = [MISSION_SEED, owner.key().as_ref(), mission_id.as_bytes()],
        bump,
        payer = owner,
        space = 8 + Mission::INIT_SPACE
    )]
    pub mission: Account<'info, Mission>,

    /// Escrow vault created as a raw system-owned PDA (zero data). Anchor
    /// cannot `init` a `SystemAccount` type, so the creation uses
    /// `AccountInfo` here; later instructions require it as `SystemAccount`.
    #[account(
        init,
        seeds = [VAULT_SEED, mission.key().as_ref()],
        bump,
        payer = owner,
        space = 0
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct FundMission<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MISSION_SEED, owner.key().as_ref(), mission.mission_id.as_bytes()],
        bump,
        has_one = owner @ VorqynError::InvalidOwner,
    )]
    pub mission: Account<'info, Mission>,

    /// Escrow vault: a program-owned PDA created by `initialize_mission`
    /// (Anchor's `init` assigns it to this program — the standard escrow
    /// pattern; only program instructions can move funds out). Declared as
    /// AccountInfo because `SystemAccount` would demand system ownership.
    #[account(mut, seeds = [VAULT_SEED, mission.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(task_id: String)]
pub struct CreateTask<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MISSION_SEED, owner.key().as_ref(), mission.mission_id.as_bytes()],
        bump,
        has_one = owner @ VorqynError::InvalidOwner,
    )]
    pub mission: Account<'info, Mission>,

    #[account(
        init,
        seeds = [TASK_SEED, mission.key().as_ref(), task_id.as_bytes()],
        bump,
        payer = owner,
        space = 8 + Task::INIT_SPACE
    )]
    pub task: Account<'info, Task>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
#[instruction(task_id: String)]
pub struct AssignTask<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MISSION_SEED, owner.key().as_ref(), mission.mission_id.as_bytes()],
        bump,
        has_one = owner @ VorqynError::InvalidOwner,
    )]
    pub mission: Account<'info, Mission>,

    #[account(
        mut,
        seeds = [TASK_SEED, mission.key().as_ref(), task_id.as_bytes()],
        bump,
        has_one = mission @ VorqynError::InvalidTaskAccount,
    )]
    pub task: Account<'info, Task>,

    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
#[instruction(task_id: String)]
pub struct AuthorizeReassignment<'info> {
    /// Only the mission owner may reassign (owner-signed path, P0 per
    /// issue #6). The optional mission-scoped delegate is deliberately
    /// NOT implemented — see ACCOUNTS.md §4.
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MISSION_SEED, owner.key().as_ref(), mission.mission_id.as_bytes()],
        bump,
        has_one = owner @ VorqynError::InvalidOwner,
    )]
    pub mission: Account<'info, Mission>,

    #[account(
        mut,
        seeds = [TASK_SEED, mission.key().as_ref(), task_id.as_bytes()],
        bump,
        has_one = mission @ VorqynError::InvalidTaskAccount,
    )]
    pub task: Account<'info, Task>,

    pub clock: Sysvar<'info, Clock>,
}

// ---------------------------------------------------------------------------
// Unit tests for pure validation helpers
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_chain_seam_ids() {
        for id in [
            "port-001",
            "task-sea-survey",
            "a1b",
            "org-9x",
            "x".repeat(32).as_str(),
        ] {
            assert!(validate_vorqyn_id(id).is_ok(), "should accept {id}");
        }
    }

    #[test]
    fn rejects_invalid_ids() {
        for id in [
            "",
            "a1",
            "A-upper",
            "bad_underscore",
            "-leading",
            "way-too-long-identifier-string-over-32-chars",
            "sp ace",
        ] {
            assert!(validate_vorqyn_id(id).is_err(), "should reject {id:?}");
        }

        // NOTE: a trailing hyphen IS valid — the frozen CHAIN_SEAM §2 rule
        // (`^[a-z0-9][a-z0-9-]{2,31}$`) constrains length, charset and the
        // first byte only, identical to the TS contracts ID_PATTERN.
        assert!(validate_vorqyn_id("trailing-").is_ok());
    }

    #[test]
    fn funding_ledger_overflows_are_rejected() {
        let big = u64::MAX / 4;
        let (funded, remaining) = credit_funding(0, 0, big).unwrap();
        assert_eq!((funded, remaining), (big, big));
        let (funded, remaining) = credit_funding(big, big, big).unwrap();
        assert_eq!((funded, remaining), (2 * big, 2 * big));
        let (funded, remaining) = credit_funding(2 * big, 2 * big, big).unwrap();
        assert_eq!((funded, remaining), (3 * big, 3 * big));
        // funded + amount would exceed u64::MAX -> Overflow, no wraparound.
        let final_amount = u64::MAX - 3 * big + 1;
        assert!(credit_funding(3 * big, 3 * big, final_amount).is_err());
        assert_eq!(
            credit_funding(3 * big, 3 * big, u64::MAX - 3 * big)
                .unwrap()
                .0,
            u64::MAX
        );
    }
}
