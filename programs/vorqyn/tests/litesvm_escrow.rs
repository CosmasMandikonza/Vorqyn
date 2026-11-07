//! VQ-04 integration tests — real LiteSVM execution of the compiled BPF
//! program (target/deploy/vorqyn.so via `cargo build-sbf`).
//!
//! Positive cases assert EXACT balance deltas and ledger invariants; the
//! negative cases are the issue's required attack set: unauthorized
//! signers, incorrect PDAs, duplicate tasks, insufficient funds, overflow
//! boundaries and invalid IDs. These are local simulated-execution tests —
//! they make NO claim about devnet or any live cluster.

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, AccountSerialize, AnchorSerialize, Discriminator, InstructionData,
        ToAccountMetas,
    },
    base64::{engine::general_purpose::STANDARD as BASE64, Engine as _},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

use vorqyn::{
    accounts::{AssignTask, AuthorizeReassignment, CreateTask, FundMission, InitializeMission},
    instruction, Mission, MissionStatus, Task, TaskKind, TaskReassigned, TaskStatus, MISSION_SEED,
    TASK_SEED, VAULT_SEED,
};

const LAMPORTS: u64 = 1_000_000_000; // 1 SOL
/// Transaction fee LiteSVM charges the fee payer per transaction.
const LITE_TX_FEE: u64 = 5_000;
const EXPIRY_FAR_FUTURE: i64 = 4_102_444_800; // 2100-01-01
/// Clock sysvar address (fixed on all clusters; canonical form).
const CLOCK: Pubkey = Pubkey::from_str_const("SysvarC1ock11111111111111111111111111111111");

struct TestEnv {
    svm: LiteSVM,
    owner: Keypair,
    operator: Keypair,
    verifier: Pubkey,
    mission: Pubkey,
    vault: Pubkey,
}

/// Send a tx; Ok(()) on success, Err(debug-string) on failure so callers
/// can assert and read the reason without depending on litesvm error types.
fn send(svm: &mut LiteSVM, payer: &Keypair, ixs: &[Instruction]) -> Result<(), String> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|err| format!("{err:?}"))
}

fn assert_tx_fails(svm: &mut LiteSVM, tx: VersionedTransaction, needle: &str) {
    match svm.send_transaction(tx) {
        Ok(_meta) => panic!("transaction was expected to fail (looking for {needle:?})"),
        Err(err) => {
            let text = format!("{err:?}").to_lowercase();
            assert!(
                text.contains(&needle.to_lowercase()),
                "expected failure containing {needle:?}, got: {text}"
            );
        }
    }
}

fn signed_tx(svm: &mut LiteSVM, signer: &Keypair, ix: Instruction) -> VersionedTransaction {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &blockhash);
    VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap()
}

fn mission_pda(owner: &Pubkey, mission_id: &str) -> Pubkey {
    Pubkey::find_program_address(
        &[MISSION_SEED, owner.as_ref(), mission_id.as_bytes()],
        &vorqyn::ID,
    )
    .0
}

fn vault_pda(mission: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VAULT_SEED, mission.as_ref()], &vorqyn::ID).0
}

fn task_pda(mission: &Pubkey, task_id: &str) -> Pubkey {
    Pubkey::find_program_address(
        &[TASK_SEED, mission.as_ref(), task_id.as_bytes()],
        &vorqyn::ID,
    )
    .0
}

/// Wall-clock the tests run under (LiteSVM's default clock is genesis,
/// which would make historical-expiry assertions meaningless).
const TEST_NOW: i64 = 1_762_000_000; // 2025-11-01 era; exact value irrelevant

fn load_program() -> LiteSVM {
    let mut svm = LiteSVM::new();
    svm.set_sysvar(&anchor_lang::prelude::Clock {
        slot: 0,
        epoch_start_timestamp: TEST_NOW,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: TEST_NOW,
    });
    // The .so is produced by `cargo build-sbf` before `cargo test` runs
    // (see CI and ACCOUNTS.md for the exact commands).
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/vorqyn.so"));
    svm.add_program(vorqyn::ID, bytes).unwrap();
    svm
}

fn init_mission_ix(
    owner: &Keypair,
    mission_id: &str,
    verifier: Pubkey,
    expiry: i64,
) -> Instruction {
    let mission = mission_pda(&owner.pubkey(), mission_id);
    let vault = vault_pda(&mission);
    Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::InitializeMission {
            mission_id: mission_id.to_string(),
            verifier_authority: verifier,
            expiry,
        }
        .data(),
        InitializeMission {
            owner: owner.pubkey(),
            mission,
            vault,
            system_program: system_program::ID,
            clock: CLOCK,
        }
        .to_account_metas(None),
    )
}

fn setup() -> TestEnv {
    let mut svm = load_program();
    let owner = Keypair::new();
    let operator = Keypair::new();
    let verifier = Keypair::new().pubkey();
    svm.airdrop(&owner.pubkey(), 100 * LAMPORTS).unwrap();
    svm.airdrop(&operator.pubkey(), LAMPORTS).unwrap();

    let ix = init_mission_ix(&owner, "port-001", verifier, EXPIRY_FAR_FUTURE);
    send(&mut svm, &owner, &[ix]).expect("initialize_mission should succeed");

    let mission = mission_pda(&owner.pubkey(), "port-001");
    let vault = vault_pda(&mission);
    TestEnv {
        svm,
        owner,
        operator,
        verifier,
        mission,
        vault,
    }
}

fn fund(
    svm: &mut LiteSVM,
    signer: &Keypair,
    mission: Pubkey,
    vault: Pubkey,
    amount: u64,
) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::FundMission { amount }.data(),
        FundMission {
            owner: signer.pubkey(),
            mission,
            vault,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, signer, &[ix])
}

fn create_task(
    svm: &mut LiteSVM,
    signer: &Keypair,
    mission: Pubkey,
    task_id: &str,
    budget: u64,
) -> Result<(), String> {
    let task = task_pda(&mission, task_id);
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::CreateTask {
            task_id: task_id.to_string(),
            task_kind: TaskKind::Sea,
            budget_lamports: budget,
        }
        .data(),
        CreateTask {
            owner: signer.pubkey(),
            mission,
            task,
            system_program: system_program::ID,
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    send(svm, signer, &[ix])
}

fn assign_task(
    svm: &mut LiteSVM,
    signer: &Keypair,
    mission: Pubkey,
    task_id: &str,
    operator: Pubkey,
    reward: u64,
) -> Result<(), String> {
    let task = task_pda(&mission, task_id);
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::AssignTask {
            task_id: task_id.to_string(),
            operator,
            reward_lamports: reward,
        }
        .data(),
        AssignTask {
            owner: signer.pubkey(),
            mission,
            task,
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    send(svm, signer, &[ix])
}

fn mission_state(svm: &LiteSVM, mission: &Pubkey) -> Mission {
    let account = svm.get_account(mission).unwrap();
    let mut data: &[u8] = &account.data;
    Mission::try_deserialize(&mut data).unwrap()
}

fn task_state(svm: &LiteSVM, mission: &Pubkey, task_id: &str) -> Task {
    let account = svm.get_account(&task_pda(mission, task_id)).unwrap();
    let mut data: &[u8] = &account.data;
    Task::try_deserialize(&mut data).unwrap()
}

fn lamports(svm: &LiteSVM, address: &Pubkey) -> u64 {
    svm.get_account(address).unwrap().lamports
}

// ---------------------------------------------------------------------------
// initialize_mission
// ---------------------------------------------------------------------------

#[test]
fn initialize_mission_creates_pda_and_vault_with_exact_costs() {
    let TestEnv {
        svm,
        owner,
        verifier,
        mission,
        vault,
        ..
    } = setup();
    let state = mission_state(&svm, &mission);
    assert_eq!(state.owner, owner.pubkey());
    assert_eq!(state.verifier_authority, verifier);
    assert_eq!(state.mission_id, "port-001");
    assert_eq!(
        (
            state.funded_lamports,
            state.remaining_lamports,
            state.reserved_lamports
        ),
        (0, 0, 0)
    );
    assert_eq!(state.status, MissionStatus::Active);
    assert_eq!(state.expiry, EXPIRY_FAR_FUTURE);

    // Vault PDA exists, PROGRAM-owned (Anchor init assigns ownership — the
    // standard escrow pattern so only program instructions move funds),
    // empty data; both accounts' rent came from the owner alone.
    let vault_account = svm.get_account(&vault).unwrap();
    assert_eq!(vault_account.owner, vorqyn::ID);
    assert!(vault_account.data.is_empty());
    let mission_account = svm.get_account(&mission).unwrap();
    let owner_paid = 100 * LAMPORTS - lamports(&svm, &owner.pubkey());
    assert_eq!(
        owner_paid,
        mission_account.lamports + vault_account.lamports + LITE_TX_FEE
    );
}

#[test]
fn initialize_rejects_invalid_mission_ids() {
    let mut svm = load_program();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 100 * LAMPORTS).unwrap();

    for bad_id in ["A-upper", "a1", "-lead", "bad_id"] {
        let ix = init_mission_ix(&owner, bad_id, Keypair::new().pubkey(), EXPIRY_FAR_FUTURE);
        let tx = signed_tx(&mut svm, &owner, ix);
        assert_tx_fails(&mut svm, tx, "InvalidId");
    }

    // IDs longer than 32 bytes are structurally impossible: they cannot be
    // PDA seeds at all (the non-panicking lookup returns None), so no
    // mission account can ever be derived for them.
    let too_long = "way-too-long-identifier-over-32-chars";
    assert!(too_long.len() > 32);
    assert_eq!(
        Pubkey::try_find_program_address(
            &[MISSION_SEED, owner.pubkey().as_ref(), too_long.as_bytes()],
            &vorqyn::ID
        ),
        None
    );
}

#[test]
fn initialize_rejects_past_expiry() {
    let mut svm = load_program();
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 100 * LAMPORTS).unwrap();
    let ix = init_mission_ix(&owner, "expired-001", Keypair::new().pubkey(), 1);
    let tx = signed_tx(&mut svm, &owner, ix);
    assert_tx_fails(&mut svm, tx, "MissionExpired");
}

#[test]
fn initialize_rejects_replay_of_existing_mission_pda() {
    let TestEnv {
        mut svm,
        owner,
        verifier,
        mission: _mission,
        ..
    } = setup();
    // Re-initializing the same mission PDA (different expiry arg) must
    // fail: the account already exists.
    let ix = init_mission_ix(&owner, "port-001", verifier, 0);
    let tx = signed_tx(&mut svm, &owner, ix);
    assert_tx_fails(&mut svm, tx, "already in use");
}

// ---------------------------------------------------------------------------
// fund_mission
// ---------------------------------------------------------------------------

#[test]
fn fund_accounts_exactly_and_verifies_vault_delta() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        vault,
        ..
    } = setup();
    let vault_before = lamports(&svm, &vault);
    let owner_before = lamports(&svm, &owner.pubkey());

    fund(&mut svm, &owner, mission, vault, 3 * LAMPORTS).expect("fund should succeed");

    // EXACT deltas: vault +amount, owner -amount, ledger updated once.
    assert_eq!(lamports(&svm, &vault) - vault_before, 3 * LAMPORTS);
    assert_eq!(
        owner_before - lamports(&svm, &owner.pubkey()),
        3 * LAMPORTS + LITE_TX_FEE
    );
    let state = mission_state(&svm, &mission);
    assert_eq!(state.funded_lamports, 3 * LAMPORTS);
    assert_eq!(state.remaining_lamports, 3 * LAMPORTS);
    assert_eq!(state.reserved_lamports, 0);

    // Second funding is accounted cumulatively, never duplicated or lost.
    fund(&mut svm, &owner, mission, vault, LAMPORTS / 2).expect("second fund should succeed");
    let state = mission_state(&svm, &mission);
    assert_eq!(state.funded_lamports, 3 * LAMPORTS + LAMPORTS / 2);
    assert_eq!(
        lamports(&svm, &vault),
        vault_before + 3 * LAMPORTS + LAMPORTS / 2
    );
}

#[test]
fn fund_rejects_non_owner_signer_and_zero_amount() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        vault,
        ..
    } = setup();
    let vault_before = lamports(&svm, &vault);

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), LAMPORTS).unwrap();
    // Attacker signs and pays, but the mission PDA derives from the real
    // owner key — the seeds/has_one constraints must reject the mismatch.
    assert!(
        fund(&mut svm, &attacker, mission, vault, LAMPORTS).is_err(),
        "non-owner must not fund"
    );
    assert_eq!(lamports(&svm, &vault), vault_before);
    assert_eq!(mission_state(&svm, &mission).funded_lamports, 0);

    assert!(
        fund(&mut svm, &owner, mission, vault, 0).is_err(),
        "zero funding must be rejected"
    );
    assert_eq!(mission_state(&svm, &mission).funded_lamports, 0);
}

// ---------------------------------------------------------------------------
// create_task
// ---------------------------------------------------------------------------

#[test]
fn create_task_reserves_budget_with_exact_accounting() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup();
    fund(&mut svm, &owner, mission, vault_pda(&mission), 3 * LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-sea-survey", LAMPORTS)
        .expect("create_task should succeed");

    let state = mission_state(&svm, &mission);
    assert_eq!(state.reserved_lamports, LAMPORTS);
    assert_eq!(state.remaining_lamports, 2 * LAMPORTS);
    assert_eq!(state.funded_lamports, 3 * LAMPORTS);
    // Core ledger invariant from the very first reservation on.
    assert_eq!(
        state.reserved_lamports + state.remaining_lamports,
        state.funded_lamports
    );

    let task = task_state(&svm, &mission, "task-sea-survey");
    assert_eq!(task.mission, mission);
    assert_eq!(task.task_id, "task-sea-survey");
    assert_eq!(task.task_kind, TaskKind::Sea);
    assert_eq!(task.budget_lamports, LAMPORTS);
    assert_eq!(task.current_assignment_version, 0);
    assert_eq!(task.current_operator, None);
    assert_eq!(task.status, TaskStatus::Unassigned);
}

#[test]
fn create_task_rejects_duplicate_task_id_without_double_reservation() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup();
    fund(&mut svm, &owner, mission, vault_pda(&mission), 3 * LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-dup", LAMPORTS).unwrap();
    assert!(create_task(&mut svm, &owner, mission, "task-dup", LAMPORTS).is_err());
    assert_eq!(
        mission_state(&svm, &mission).reserved_lamports,
        LAMPORTS,
        "reservation must not double-count"
    );
}

#[test]
fn create_task_rejects_budget_over_unreserved_funds() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup();
    fund(&mut svm, &owner, mission, vault_pda(&mission), LAMPORTS).unwrap();
    assert!(create_task(&mut svm, &owner, mission, "task-greedy", 2 * LAMPORTS).is_err());
    let state = mission_state(&svm, &mission);
    assert_eq!(state.reserved_lamports, 0);
    assert_eq!(state.remaining_lamports, LAMPORTS);
}

#[test]
fn create_task_rejects_non_owner_signer_and_invalid_id() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup();
    fund(&mut svm, &owner, mission, vault_pda(&mission), 3 * LAMPORTS).unwrap();

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), LAMPORTS).unwrap();
    assert!(create_task(&mut svm, &attacker, mission, "task-evil", LAMPORTS).is_err());
    assert_eq!(mission_state(&svm, &mission).reserved_lamports, 0);

    assert!(create_task(&mut svm, &owner, mission, "Bad_Task!", LAMPORTS).is_err());
    assert_eq!(mission_state(&svm, &mission).reserved_lamports, 0);
}

// ---------------------------------------------------------------------------
// assign_task
// ---------------------------------------------------------------------------

#[test]
fn assign_task_sets_version_one_and_releases_excess_reservation() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        mission,
        ..
    } = setup();
    let operator_pk = operator.pubkey();
    fund(&mut svm, &owner, mission, vault_pda(&mission), 3 * LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-sea-survey", LAMPORTS).unwrap();

    assign_task(
        &mut svm,
        &owner,
        mission,
        "task-sea-survey",
        operator_pk,
        900_000_000,
    )
    .expect("assign should succeed");

    let task = task_state(&svm, &mission, "task-sea-survey");
    assert_eq!(
        task.current_assignment_version, 1,
        "first assignment is version 1 (CHAIN_SEAM §1)"
    );
    assert_eq!(task.current_operator, Some(operator_pk));
    assert_eq!(task.reward_lamports, 900_000_000);
    assert_eq!(task.status, TaskStatus::Assigned);

    let state = mission_state(&svm, &mission);
    assert_eq!(
        state.reserved_lamports, 900_000_000,
        "only the agreed reward stays reserved"
    );
    assert_eq!(state.remaining_lamports, 3 * LAMPORTS - 900_000_000);
    assert_eq!(
        state.reserved_lamports + state.remaining_lamports,
        state.funded_lamports
    );
}

#[test]
fn assign_task_rejects_reward_over_task_budget() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        mission,
        ..
    } = setup();
    fund(&mut svm, &owner, mission, vault_pda(&mission), 3 * LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-cap", LAMPORTS).unwrap();
    assert!(assign_task(
        &mut svm,
        &owner,
        mission,
        "task-cap",
        operator.pubkey(),
        LAMPORTS + 1
    )
    .is_err());
    let task = task_state(&svm, &mission, "task-cap");
    assert_eq!(task.status, TaskStatus::Unassigned);
    assert_eq!(mission_state(&svm, &mission).reserved_lamports, LAMPORTS);
}

#[test]
fn assign_task_rejects_double_assignment_and_non_owner() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        mission,
        ..
    } = setup();
    let operator_pk = operator.pubkey();
    fund(&mut svm, &owner, mission, vault_pda(&mission), 3 * LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-once", LAMPORTS).unwrap();
    assign_task(
        &mut svm,
        &owner,
        mission,
        "task-once",
        operator_pk,
        LAMPORTS / 2,
    )
    .unwrap();

    // Reassignment is VQ-05 scope: assigning again must fail.
    assert!(assign_task(
        &mut svm,
        &owner,
        mission,
        "task-once",
        operator_pk,
        LAMPORTS / 2
    )
    .is_err());
    assert_eq!(
        task_state(&svm, &mission, "task-once").current_assignment_version,
        1
    );

    // Non-owner cannot assign either.
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-guarded", LAMPORTS / 2).unwrap();
    assert!(assign_task(
        &mut svm,
        &attacker,
        mission,
        "task-guarded",
        operator_pk,
        LAMPORTS / 4
    )
    .is_err());
    assert_eq!(
        task_state(&svm, &mission, "task-guarded").current_assignment_version,
        0
    );
}

#[test]
fn assign_task_rejects_wrong_task_pda() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        mission,
        ..
    } = setup();
    fund(&mut svm, &owner, mission, vault_pda(&mission), 3 * LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-real", LAMPORTS).unwrap();

    // Pass the PDA of a DIFFERENT task id while the instruction argument
    // claims task-real: the seeds constraint must reject the mismatch.
    let wrong_task = task_pda(&mission, "task-other");
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::AssignTask {
            task_id: "task-real".to_string(),
            operator: operator.pubkey(),
            reward_lamports: LAMPORTS / 2,
        }
        .data(),
        AssignTask {
            owner: owner.pubkey(),
            mission,
            task: wrong_task,
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    assert!(
        send(&mut svm, &owner, &[ix]).is_err(),
        "wrong task PDA must be rejected"
    );
    assert_eq!(
        task_state(&svm, &mission, "task-real").status,
        TaskStatus::Unassigned
    );
}

// ---------------------------------------------------------------------------
// authorize_reassignment (VQ-05 / issue #6)
// ---------------------------------------------------------------------------

fn reassign(
    svm: &mut LiteSVM,
    signer: &Keypair,
    mission: Pubkey,
    task_id: &str,
    expected_version: u64,
    new_operator: Pubkey,
    reward: u64,
) -> Result<(), String> {
    reassign_capture_logs(
        svm,
        signer,
        mission,
        task_id,
        expected_version,
        new_operator,
        reward,
    )
    .map(|_| ())
}

/// `reassign` returning the transaction logs (for event-byte assertions).
fn reassign_capture_logs(
    svm: &mut LiteSVM,
    signer: &Keypair,
    mission: Pubkey,
    task_id: &str,
    expected_version: u64,
    new_operator: Pubkey,
    reward: u64,
) -> Result<Vec<String>, String> {
    let task = task_pda(&mission, task_id);
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::AuthorizeReassignment {
            task_id: task_id.to_string(),
            expected_assignment_version: expected_version,
            new_operator,
            reward_lamports: reward,
        }
        .data(),
        AuthorizeReassignment {
            owner: signer.pubkey(),
            mission,
            task,
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    svm.send_transaction(tx)
        .map(|meta| meta.logs)
        .map_err(|err| format!("{err:?}"))
}

// The expected-event discriminator comes straight from the macro: the
// `#[event]` derive exposes sha256("event:TaskReassigned")[..8] as
// `TaskReassigned::DISCRIMINATOR`, so the byte-exact log assertion below
// needs no hand-rolled hashing.

/// Minimal legal reassignment fixture: port-001 funded with 3 SOL and one
/// `Assigned` task (version 1) with the given budget and agreed reward.
fn setup_assigned(budget: u64, agreed: u64) -> TestEnv {
    let mut env = setup();
    fund(
        &mut env.svm,
        &env.owner,
        env.mission,
        env.vault,
        3 * LAMPORTS,
    )
    .unwrap();
    create_task(&mut env.svm, &env.owner, env.mission, "task-rs", budget).unwrap();
    assign_task(
        &mut env.svm,
        &env.owner,
        env.mission,
        "task-rs",
        env.operator.pubkey(),
        agreed,
    )
    .unwrap();
    env
}

#[test]
fn reassignment_succeeds_with_exact_ledger_and_deterministic_event() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let replacement = Keypair::new().pubkey();

    let logs = reassign_capture_logs(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        replacement,
        900_000_000,
    )
    .expect("owner-authorized reassignment should succeed");

    // Task: version 1 -> 2, operator swapped, reward re-quoted, prior proof
    // eligibility invalidated (fields cleared).
    let task = task_state(&svm, &mission, "task-rs");
    assert_eq!(task.current_assignment_version, 2);
    assert_eq!(task.current_operator, Some(replacement));
    assert_eq!(task.reward_lamports, 900_000_000);
    assert_eq!(task.status, TaskStatus::Assigned);
    assert_eq!(task.evidence_digest, None);
    assert_eq!(task.accepted_version, None);

    // Mission: raise topped up from remaining; ledger invariant preserved.
    let state = mission_state(&svm, &mission);
    assert_eq!(state.reserved_lamports, 900_000_000);
    assert_eq!(state.remaining_lamports, 3 * LAMPORTS - 900_000_000);
    assert_eq!(
        state.reserved_lamports + state.remaining_lamports,
        state.funded_lamports
    );

    // Deterministic event (CHAIN_SEAM §6/§8-Q5): the exact bytes a TS
    // client binds receipts to must appear verbatim in the tx logs.
    let expected_event = TaskReassigned {
        mission_id: "port-001".to_string(),
        task_id: "task-rs".to_string(),
        expected_assignment_version: 1,
        assignment_version: 2,
        previous_operator: operator.pubkey(),
        new_payout_wallet: replacement,
        reward_lamports: 900_000_000,
        reserved_lamports: 900_000_000,
    };
    let mut expected = TaskReassigned::DISCRIMINATOR.to_vec();
    expected_event
        .serialize(&mut expected)
        .expect("borsh-serializing the expected event cannot fail");
    let encoded = BASE64.encode(&expected);
    assert!(
        logs.iter()
            .any(|line| line == &format!("Program data: {encoded}")),
        "TaskReassigned must be emitted byte-for-byte, logs were: {logs:?}"
    );
}

#[test]
fn reassignment_reward_cut_releases_reservation_back() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 900_000_000);
    let replacement = Keypair::new().pubkey();

    reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        replacement,
        400_000_000,
    )
    .expect("reward cut should succeed");

    let task = task_state(&svm, &mission, "task-rs");
    assert_eq!(task.current_assignment_version, 2);
    assert_eq!(task.reward_lamports, 400_000_000);
    let state = mission_state(&svm, &mission);
    assert_eq!(state.reserved_lamports, 400_000_000);
    assert_eq!(state.remaining_lamports, 3 * LAMPORTS - 400_000_000);
    assert_eq!(
        state.reserved_lamports + state.remaining_lamports,
        state.funded_lamports
    );
}

#[test]
fn reassignment_rejects_wrong_signer_and_changes_nothing() {
    let TestEnv {
        mut svm,
        operator,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let replacement = Keypair::new().pubkey();

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), LAMPORTS).unwrap();
    assert!(
        reassign(
            &mut svm,
            &attacker,
            mission,
            "task-rs",
            1,
            replacement,
            500_000_000
        )
        .is_err(),
        "non-owner must not reassign"
    );
    let task = task_state(&svm, &mission, "task-rs");
    assert_eq!(task.current_assignment_version, 1);
    assert_eq!(task.current_operator, Some(operator.pubkey()));
    let state = mission_state(&svm, &mission);
    assert_eq!(
        (state.reserved_lamports, state.remaining_lamports),
        (400_000_000, 3 * LAMPORTS - 400_000_000)
    );
}

#[test]
fn reassignment_rejects_stale_expected_versions() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let replacement = Keypair::new().pubkey();

    // Version 0 (never assigned state), 2 and 7 (future) all mismatch the
    // current version 1 — every compare-and-set must fail.
    for stale in [0u64, 2, 7] {
        let err = reassign(
            &mut svm,
            &owner,
            mission,
            "task-rs",
            stale,
            replacement,
            500_000_000,
        )
        .expect_err("stale expected version must be rejected");
        assert!(
            err.to_lowercase().contains("staleassignmentversion"),
            "expected StaleAssignmentVersion for expected={stale}, got: {err}"
        );
    }
    assert_eq!(
        task_state(&svm, &mission, "task-rs").current_assignment_version,
        1
    );
    assert_eq!(mission_state(&svm, &mission).reserved_lamports, 400_000_000);
}

#[test]
fn reassignment_cas_lets_only_one_of_two_competing_txs_win() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let operator_a = Keypair::new().pubkey();
    let operator_b = Keypair::new().pubkey();

    // Both transactions claim expected version 1. LiteSVM executes them
    // sequentially, exactly like a validator's serialized account writes:
    // the first applies version 1 -> 2, the second's CAS must fail.
    reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        operator_a,
        500_000_000,
    )
    .expect("first competing reassignment should win");
    let err = reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        operator_b,
        600_000_000,
    )
    .expect_err("second competing reassignment must lose the CAS");
    assert!(
        err.to_lowercase().contains("staleassignmentversion"),
        "expected StaleAssignmentVersion, got: {err}"
    );

    let task = task_state(&svm, &mission, "task-rs");
    assert_eq!(
        task.current_assignment_version, 2,
        "version must be exactly 2"
    );
    assert_eq!(task.current_operator, Some(operator_a));
    let state = mission_state(&svm, &mission);
    assert_eq!(state.reserved_lamports, 500_000_000);
    assert_eq!(
        state.reserved_lamports + state.remaining_lamports,
        state.funded_lamports
    );
}

#[test]
fn reassignment_rejects_quote_over_task_budget() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let replacement = Keypair::new().pubkey();

    let err = reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        replacement,
        LAMPORTS + 1,
    )
    .expect_err("quote above the task budget must be rejected");
    assert!(
        err.to_lowercase().contains("rewardexceedstaskbudget"),
        "expected RewardExceedsTaskBudget, got: {err}"
    );
    assert_eq!(
        task_state(&svm, &mission, "task-rs").current_assignment_version,
        1
    );
    assert_eq!(mission_state(&svm, &mission).reserved_lamports, 400_000_000);
}

#[test]
fn reassignment_rejects_topup_over_unreserved_funds() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup();
    fund(&mut svm, &owner, mission, vault_pda(&mission), LAMPORTS).unwrap();
    // task-rs: budget 0.8 SOL reserved at creation; assign at only 0.1 SOL,
    // releasing 0.7 SOL back to remaining…
    create_task(&mut svm, &owner, mission, "task-rs", 800_000_000).unwrap();
    assign_task(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        Keypair::new().pubkey(),
        100_000_000,
    )
    .unwrap();
    // …then a second task consumes that 0.7 SOL, so raising task-rs back to
    // its full budget has no unreserved funds to draw from.
    create_task(&mut svm, &owner, mission, "task-other", 700_000_000).unwrap();
    let state = mission_state(&svm, &mission);
    assert_eq!(
        (state.reserved_lamports, state.remaining_lamports),
        (800_000_000, 200_000_000)
    );

    let err = reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        Keypair::new().pubkey(),
        800_000_000,
    )
    .expect_err("top-up beyond remaining funds must be rejected");
    assert!(
        err.to_lowercase().contains("rewardexceedsunreservedfunds"),
        "expected RewardExceedsUnreservedFunds, got: {err}"
    );
    let state = mission_state(&svm, &mission);
    assert_eq!(
        (state.reserved_lamports, state.remaining_lamports),
        (800_000_000, 200_000_000),
        "rejected reassignment must not move the ledger"
    );
    assert_eq!(
        task_state(&svm, &mission, "task-rs").reward_lamports,
        100_000_000
    );
}

#[test]
fn reassignment_rejects_expired_mission_and_changes_nothing() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let ledger_before = {
        let s = mission_state(&svm, &mission);
        (s.reserved_lamports, s.remaining_lamports)
    };

    // Advance the wall clock to the mission's expiry instant (the default
    // fixture uses EXPIRY_FAR_FUTURE).
    svm.set_sysvar(&anchor_lang::prelude::Clock {
        slot: 1,
        epoch_start_timestamp: TEST_NOW,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: EXPIRY_FAR_FUTURE,
    });

    let err = reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        Keypair::new().pubkey(),
        500_000_000,
    )
    .expect_err("reassignment on an expired mission must be rejected");
    assert!(
        err.to_lowercase().contains("missionexpired"),
        "expected MissionExpired, got: {err}"
    );
    assert_eq!(
        task_state(&svm, &mission, "task-rs").current_assignment_version,
        1
    );
    let s = mission_state(&svm, &mission);
    assert_eq!((s.reserved_lamports, s.remaining_lamports), ledger_before);
}

#[test]
fn reassignment_rejects_unassigned_task_wrong_pda_and_foreign_mission_task() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup();
    fund(&mut svm, &owner, mission, vault_pda(&mission), LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-open", 500_000_000).unwrap();

    // Unassigned (version 0) is not reassignable — the chain's subset of
    // the reducer's recoverable-state gating.
    let err = reassign(
        &mut svm,
        &owner,
        mission,
        "task-open",
        0,
        Keypair::new().pubkey(),
        100_000_000,
    )
    .expect_err("unassigned task must not be reassignable");
    assert!(
        err.to_lowercase().contains("tasknotreassignable"),
        "expected TaskNotReassignable, got: {err}"
    );

    // Wrong task PDA: the decoy account must EXIST (an existing-but-
    // different task) so the failure is the seeds mismatch itself, not
    // AccountNotInitialized.
    create_task(&mut svm, &owner, mission, "task-other", 100_000_000).unwrap();
    let wrong_task = task_pda(&mission, "task-other");
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::AuthorizeReassignment {
            task_id: "task-open".to_string(),
            expected_assignment_version: 0,
            new_operator: Keypair::new().pubkey(),
            reward_lamports: 100_000_000,
        }
        .data(),
        AuthorizeReassignment {
            owner: owner.pubkey(),
            mission,
            task: wrong_task,
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    let tx = signed_tx(&mut svm, &owner, ix);
    assert_tx_fails(&mut svm, tx, "ConstraintSeeds");

    // Foreign mission's task: mission and task do not belong together —
    // the task PDA derived from THIS mission cannot match the other
    // mission's real task account (seeds or has_one must fire).
    let ix2 = init_mission_ix(
        &owner,
        "port-002",
        Keypair::new().pubkey(),
        EXPIRY_FAR_FUTURE,
    );
    send(&mut svm, &owner, &[ix2]).unwrap();
    let mission2 = mission_pda(&owner.pubkey(), "port-002");
    fund(
        &mut svm,
        &owner,
        mission2,
        vault_pda(&mission2),
        500_000_000,
    )
    .unwrap();
    create_task(&mut svm, &owner, mission2, "task-m2", 200_000_000).unwrap();
    let foreign_task = task_pda(&mission2, "task-m2");
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::AuthorizeReassignment {
            task_id: "task-m2".to_string(),
            expected_assignment_version: 0,
            new_operator: Keypair::new().pubkey(),
            reward_lamports: 100_000_000,
        }
        .data(),
        AuthorizeReassignment {
            owner: owner.pubkey(),
            mission,            // mission 1 …
            task: foreign_task, // … with mission 2's task
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    let tx = signed_tx(&mut svm, &owner, ix);
    assert_tx_fails(&mut svm, tx, "onstraint"); // ConstraintSeeds / ConstraintHasOne
    assert_eq!(
        task_state(&svm, &mission2, "task-m2").current_assignment_version,
        0
    );
}

#[test]
fn reassignment_rejects_default_operator_wallet() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);

    let err = reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        Pubkey::default(),
        500_000_000,
    )
    .expect_err("default (zero) operator wallet must be rejected");
    assert!(
        err.to_lowercase().contains("invalidoperatorwallet"),
        "expected InvalidOperatorWallet, got: {err}"
    );
    assert_eq!(
        task_state(&svm, &mission, "task-rs").current_assignment_version,
        1
    );
}

#[test]
fn reassignment_rejects_already_paid_task() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);

    // No instruction sets paid_version yet (VQ-06 scope), so forge the
    // future end-state directly through LiteSVM's set_account: an Account
    // with paid_version = Some(1) is what verify_and_claim will leave
    // behind, and SOLANA_PROTOCOL §5 forbids reassigning it.
    let task_addr = task_pda(&mission, "task-rs");
    let mut account = svm.get_account(&task_addr).unwrap();
    let mut data: &[u8] = &account.data;
    let mut task = Task::try_deserialize(&mut data).unwrap();
    task.paid_version = Some(1);
    let mut serialized = Vec::new();
    task.try_serialize(&mut serialized).unwrap();
    // Anchor accounts are allocated at the fixed max size (8 + INIT_SPACE);
    // re-serializing the current (shorter) state must be zero-padded back
    // to the original length, exactly like a real realloc leaves slack.
    assert!(
        serialized.len() <= account.data.len(),
        "re-serialized task must fit the allocated account space"
    );
    serialized.resize(account.data.len(), 0);
    account.data = serialized;
    svm.set_account(task_addr, account).unwrap();

    let err = reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        Keypair::new().pubkey(),
        500_000_000,
    )
    .expect_err("already-paid task must not be reassignable");
    assert!(
        err.to_lowercase().contains("tasknotreassignable"),
        "expected TaskNotReassignable, got: {err}"
    );
    // The forged paid marker itself is untouched by the rejection.
    let mut data: &[u8] = &svm.get_account(&task_addr).unwrap().data;
    assert_eq!(
        Task::try_deserialize(&mut data).unwrap().paid_version,
        Some(1)
    );
}

// ---------------------------------------------------------------------------
// Cross-cutting accounting invariants
// ---------------------------------------------------------------------------

#[test]
fn full_flow_preserves_exact_ledger_invariant() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        mission,
        ..
    } = setup();
    let operator_pk = operator.pubkey();
    fund(&mut svm, &owner, mission, vault_pda(&mission), 5 * LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-air", LAMPORTS / 2).unwrap();
    create_task(&mut svm, &owner, mission, "task-sea", 2 * LAMPORTS).unwrap();
    assign_task(
        &mut svm,
        &owner,
        mission,
        "task-sea",
        operator_pk,
        1_800_000_000,
    )
    .unwrap();
    assign_task(
        &mut svm,
        &owner,
        mission,
        "task-air",
        operator_pk,
        400_000_000,
    )
    .unwrap();

    let state = mission_state(&svm, &mission);
    assert_eq!(state.funded_lamports, 5 * LAMPORTS);
    assert_eq!(state.reserved_lamports, 1_800_000_000 + 400_000_000);
    assert_eq!(state.remaining_lamports, 5 * LAMPORTS - 2_200_000_000);
    assert_eq!(
        state.reserved_lamports + state.remaining_lamports,
        state.funded_lamports
    );
    // The vault physically holds every funded lamport (plus any rent).
    assert!(lamports(&svm, &vault_pda(&mission)) >= state.funded_lamports);
}

// NOTE (overflow boundary): u64::MAX-scale funding cannot be exercised in
// LiteSVM — its airdrops will not provision accounts near u64::MAX lamports
// (observed: `insufficient lamports` deep below the requested airdrop).
// The overflow boundary is therefore covered by the pure-ledger unit test
// `funding_ledger_overflows_are_rejected` in src/lib.rs, which drives the
// exact checked arithmetic `fund_mission` uses (3/4-of-MAX ledger + the
// one-lamport-over fund).
