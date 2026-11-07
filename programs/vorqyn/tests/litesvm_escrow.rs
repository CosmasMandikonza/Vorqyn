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
    accounts::{
        AssignTask, AuthorizeReassignment, CloseMission, CreateTask, FundMission,
        InitializeMission, InitializeVerifierRegistry, RegistryAdmin, VerifyAndClaim,
    },
    instruction, Mission, MissionStatus, Task, TaskKind, TaskPaid, TaskReassigned, TaskStatus,
    VerifierRegistry, MISSION_SEED, REGISTRY_SEED, TASK_SEED, VAULT_SEED,
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
    /// Kept as a keypair: verify_and_claim requires the verifier authority
    /// to CO-SIGN the claim transaction (VQ-06).
    verifier: Keypair,
    /// Registry admin (the "deploying party" in these tests): controls
    /// verifier registration and the policy version.
    admin: Keypair,
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
            registry: registry_pda(),
            mission,
            vault,
            system_program: system_program::ID,
            clock: CLOCK,
        }
        .to_account_metas(None),
    )
}

fn registry_pda() -> Pubkey {
    Pubkey::find_program_address(&[REGISTRY_SEED], &vorqyn::ID).0
}

fn registry_state(svm: &LiteSVM) -> VerifierRegistry {
    let account = svm.get_account(&registry_pda()).unwrap();
    let mut data: &[u8] = &account.data;
    VerifierRegistry::try_deserialize(&mut data).unwrap()
}

/// Deployment-controlled bootstrap: the FIRST signer becomes the registry
/// admin (in production the deploying party's wallet; here the test).
fn bootstrap_registry(svm: &mut LiteSVM, policy_version: u64) -> Keypair {
    let deployer = Keypair::new();
    svm.airdrop(&deployer.pubkey(), 10 * LAMPORTS).unwrap();
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::InitializeVerifierRegistry { policy_version }.data(),
        InitializeVerifierRegistry {
            payer: deployer.pubkey(),
            registry: registry_pda(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, &deployer, &[ix]).expect("registry bootstrap should succeed");
    deployer
}

fn register_verifier(svm: &mut LiteSVM, admin: &Keypair, verifier: Pubkey) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::RegisterVerifier { verifier }.data(),
        RegistryAdmin {
            admin: admin.pubkey(),
            registry: registry_pda(),
        }
        .to_account_metas(None),
    );
    send(svm, admin, &[ix])
}

fn revoke_verifier(svm: &mut LiteSVM, admin: &Keypair, verifier: Pubkey) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::RevokeVerifier { verifier }.data(),
        RegistryAdmin {
            admin: admin.pubkey(),
            registry: registry_pda(),
        }
        .to_account_metas(None),
    );
    send(svm, admin, &[ix])
}

fn set_policy_version(
    svm: &mut LiteSVM,
    admin: &Keypair,
    policy_version: u64,
) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::SetPolicyVersion { policy_version }.data(),
        RegistryAdmin {
            admin: admin.pubkey(),
            registry: registry_pda(),
        }
        .to_account_metas(None),
    );
    send(svm, admin, &[ix])
}

fn setup() -> TestEnv {
    let mut svm = load_program();
    let admin = bootstrap_registry(&mut svm, 1);
    let owner = Keypair::new();
    let operator = Keypair::new();
    let verifier = Keypair::new();
    svm.airdrop(&owner.pubkey(), 100 * LAMPORTS).unwrap();
    svm.airdrop(&operator.pubkey(), LAMPORTS).unwrap();
    register_verifier(&mut svm, &admin, verifier.pubkey())
        .expect("verifier registration should succeed");

    let ix = init_mission_ix(&owner, "port-001", verifier.pubkey(), EXPIRY_FAR_FUTURE);
    send(&mut svm, &owner, &[ix]).expect("initialize_mission should succeed");

    let mission = mission_pda(&owner.pubkey(), "port-001");
    let vault = vault_pda(&mission);
    TestEnv {
        svm,
        owner,
        operator,
        verifier,
        admin,
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
    assert_eq!(state.verifier_authority, verifier.pubkey());
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
    bootstrap_registry(&mut svm, 1);
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
    bootstrap_registry(&mut svm, 1);
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
    let ix = init_mission_ix(&owner, "port-001", verifier.pubkey(), 0);
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
        verifier,
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
    let ix2 = init_mission_ix(&owner, "port-002", verifier.pubkey(), EXPIRY_FAR_FUTURE);
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

// Mission expiry (mid-life) — every mutating path must reject
// ---------------------------------------------------------------------------

/// Regression for the issue #5 edge case "expired mission": a mission that
/// was live at init/fund/create time must refuse fund_mission, create_task
/// AND assign_task once the Clock passes its expiry. initialize_mission's
/// own past-expiry check is covered above; this pins the shared
/// `require_active_not_expired` guard in the other three instructions.
/// Boundary semantics: the mission expires AT the expiry timestamp
/// (`now < expiry` is false when `now == expiry`).
#[test]
fn expired_mission_rejects_fund_create_assign_and_changes_nothing() {
    let mut svm = load_program();
    let admin = bootstrap_registry(&mut svm, 1);
    let owner = Keypair::new();
    let operator = Keypair::new();
    svm.airdrop(&owner.pubkey(), 100 * LAMPORTS).unwrap();
    let verifier = Keypair::new();
    register_verifier(&mut svm, &admin, verifier.pubkey()).unwrap();

    // Live phase: init with a near-future expiry, fund, create one task.
    let expiry = TEST_NOW + 60_000;
    let ix = init_mission_ix(&owner, "port-exp", verifier.pubkey(), expiry);
    send(&mut svm, &owner, &[ix]).expect("initialize before expiry should succeed");
    let mission = mission_pda(&owner.pubkey(), "port-exp");
    let vault = vault_pda(&mission);
    fund(&mut svm, &owner, mission, vault, 2 * LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-exp", LAMPORTS).unwrap();

    // Snapshot everything the rejected instructions must leave untouched.
    let ledger_before = {
        let s = mission_state(&svm, &mission);
        (s.funded_lamports, s.remaining_lamports, s.reserved_lamports)
    };
    let vault_before = lamports(&svm, &vault);
    let owner_before = lamports(&svm, &owner.pubkey());

    // Advance the wall clock to exactly the expiry instant.
    svm.set_sysvar(&anchor_lang::prelude::Clock {
        slot: 1,
        epoch_start_timestamp: TEST_NOW,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: expiry,
    });

    // fund_mission -> MissionExpired.
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::FundMission { amount: LAMPORTS }.data(),
        FundMission {
            owner: owner.pubkey(),
            mission,
            vault,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let tx = signed_tx(&mut svm, &owner, ix);
    assert_tx_fails(&mut svm, tx, "MissionExpired");

    // create_task -> MissionExpired, and no task account may come to exist.
    let task_new = task_pda(&mission, "task-post-exp");
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::CreateTask {
            task_id: "task-post-exp".to_string(),
            task_kind: TaskKind::Air,
            budget_lamports: LAMPORTS,
        }
        .data(),
        CreateTask {
            owner: owner.pubkey(),
            mission,
            task: task_new,
            system_program: system_program::ID,
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    let tx = signed_tx(&mut svm, &owner, ix);
    assert_tx_fails(&mut svm, tx, "MissionExpired");
    assert!(
        svm.get_account(&task_new).is_none(),
        "no task account may be created after expiry"
    );

    // assign_task -> MissionExpired.
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::AssignTask {
            task_id: "task-exp".to_string(),
            operator: operator.pubkey(),
            reward_lamports: LAMPORTS / 2,
        }
        .data(),
        AssignTask {
            owner: owner.pubkey(),
            mission,
            task: task_pda(&mission, "task-exp"),
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    let tx = signed_tx(&mut svm, &owner, ix);
    assert_tx_fails(&mut svm, tx, "MissionExpired");

    // Nothing moved: ledger identical, vault identical, pre-expiry task
    // untouched, and the owner paid only the three failed-transaction fees.
    let s = mission_state(&svm, &mission);
    assert_eq!(
        (s.funded_lamports, s.remaining_lamports, s.reserved_lamports),
        ledger_before
    );
    assert_eq!(lamports(&svm, &vault), vault_before);
    let task = task_state(&svm, &mission, "task-exp");
    assert_eq!(task.status, TaskStatus::Unassigned);
    assert_eq!(task.current_assignment_version, 0);
    assert_eq!(task.current_operator, None);
    assert_eq!(
        owner_before - lamports(&svm, &owner.pubkey()),
        3 * LITE_TX_FEE,
        "rejected transactions may only cost the fee payer the fees"
    );
}

// ---------------------------------------------------------------------------
// verify_and_claim + close_mission (VQ-06 / issue #7)
// ---------------------------------------------------------------------------

/// Non-zero fixture digest — the real digests come from VQ-10's off-chain
/// deterministic verifier; here they are an explicitly typed fixture.
const DIGEST: [u8; 32] = [0x5au8; 32];

/// Submit a claim signed by `payer` (fees) and `verifier` (authority).
/// Returns the transaction logs for event-byte assertions.
#[allow(clippy::too_many_arguments)] // wire-shape helper: one arg per instruction field
fn claim_capture_logs(
    svm: &mut LiteSVM,
    payer: &Keypair,
    verifier: &Keypair,
    owner_pk: &Pubkey,
    mission: Pubkey,
    task_id: &str,
    expected_version: u64,
    digest: [u8; 32],
    payout_wallet: Pubkey,
) -> Result<Vec<String>, String> {
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::VerifyAndClaim {
            task_id: task_id.to_string(),
            expected_assignment_version: expected_version,
            evidence_digest: digest,
            policy_version: 1,
            attestation_expiry: EXPIRY_FAR_FUTURE,
        }
        .data(),
        VerifyAndClaim {
            payer: payer.pubkey(),
            verifier: verifier.pubkey(),
            owner: *owner_pk,
            mission,
            registry: registry_pda(),
            task: task_pda(&mission, task_id),
            vault: vault_pda(&mission),
            payout_wallet,
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer, verifier]).unwrap();
    svm.send_transaction(tx)
        .map(|meta| meta.logs)
        .map_err(|err| format!("{err:?}"))
}

#[allow(clippy::too_many_arguments)]
fn claim(
    svm: &mut LiteSVM,
    payer: &Keypair,
    verifier: &Keypair,
    owner_pk: &Pubkey,
    mission: Pubkey,
    task_id: &str,
    expected_version: u64,
    payout_wallet: Pubkey,
) -> Result<(), String> {
    claim_capture_logs(
        svm,
        payer,
        verifier,
        owner_pk,
        mission,
        task_id,
        expected_version,
        DIGEST,
        payout_wallet,
    )
    .map(|_| ())
}

fn close(svm: &mut LiteSVM, owner: &Keypair, mission: Pubkey) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::CloseMission {}.data(),
        CloseMission {
            owner: owner.pubkey(),
            mission,
            vault: vault_pda(&mission),
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    send(svm, owner, &[ix])
}

#[test]
fn claim_pays_current_operator_exactly_once() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        mission,
        vault,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let operator_pk = operator.pubkey();
    let vault_before = lamports(&svm, &vault);
    let operator_before = lamports(&svm, &operator_pk);
    let owner_before = lamports(&svm, &owner.pubkey());

    let logs = claim_capture_logs(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        DIGEST,
        operator_pk,
    )
    .expect("verifier-authorized claim should succeed");

    // EXACT money movement: vault -reward, assigned operator +reward; the
    // fee payer paid only the fee.
    assert_eq!(lamports(&svm, &vault), vault_before - 400_000_000);
    assert_eq!(lamports(&svm, &operator_pk), operator_before + 400_000_000);
    // Claim transactions carry TWO signatures (payer + verifier).
    assert_eq!(
        owner_before - lamports(&svm, &owner.pubkey()),
        2 * LITE_TX_FEE
    );

    // Terminal task state, one-time markers, stored digest.
    let task = task_state(&svm, &mission, "task-rs");
    assert_eq!(task.status, TaskStatus::Paid);
    assert_eq!(task.paid_version, Some(1));
    assert_eq!(task.accepted_version, Some(1));
    assert_eq!(task.evidence_digest, Some(DIGEST));
    assert_eq!(
        task.current_assignment_version, 1,
        "claim never bumps version"
    );

    // Ledger: funded and reserved shrank together; invariant preserved.
    let state = mission_state(&svm, &mission);
    assert_eq!(state.reserved_lamports, 0);
    assert_eq!(state.funded_lamports, 3 * LAMPORTS - 400_000_000);
    assert_eq!(state.remaining_lamports, 3 * LAMPORTS - 400_000_000);
    assert_eq!(
        state.reserved_lamports + state.remaining_lamports,
        state.funded_lamports
    );

    // Deterministic event (CHAIN_SEAM Q5 payout answer): recipientWallet +
    // the Finding-D bindings, byte-exact against the program log.
    let expected_event = TaskPaid {
        mission_id: "port-001".to_string(),
        task_id: "task-rs".to_string(),
        assignment_version: 1,
        recipient_wallet: operator_pk,
        amount_lamports: 400_000_000,
        vault_balance_lamports: vault_before - 400_000_000,
        evidence_digest: DIGEST,
        policy_version: 1,
    };
    let mut expected = TaskPaid::DISCRIMINATOR.to_vec();
    expected_event
        .serialize(&mut expected)
        .expect("borsh-serializing the expected event cannot fail");
    let encoded = BASE64.encode(&expected);
    assert!(
        logs.iter()
            .any(|line| line == &format!("Program data: {encoded}")),
        "TaskPaid must be emitted byte-for-byte, logs were: {logs:?}"
    );
}

#[test]
fn fund_reassign_claim_full_flow_pays_only_the_new_operator() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let old_operator = operator.pubkey();
    let replacement = Keypair::new();
    svm.airdrop(&replacement.pubkey(), LAMPORTS).unwrap();
    let old_operator_before = lamports(&svm, &old_operator);
    let replacement_before = lamports(&svm, &replacement.pubkey());

    // The flagship scenario: evidence failure -> reassignment -> verified
    // delivery -> payout lands on the replacement wallet only.
    reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        replacement.pubkey(),
        700_000_000,
    )
    .unwrap();
    claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        2,
        replacement.pubkey(),
    )
    .expect("claim for version 2 should pay the replacement");

    assert_eq!(
        lamports(&svm, &old_operator),
        old_operator_before,
        "old operator must receive nothing"
    );
    assert_eq!(
        lamports(&svm, &replacement.pubkey()),
        replacement_before + 700_000_000
    );
    let task = task_state(&svm, &mission, "task-rs");
    assert_eq!(task.paid_version, Some(2));
    assert_eq!(task.current_assignment_version, 2);
    let state = mission_state(&svm, &mission);
    assert_eq!(state.reserved_lamports, 0);
    assert_eq!(state.funded_lamports, 3 * LAMPORTS - 700_000_000);
}

#[test]
fn repeat_claim_transfers_nothing() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        mission,
        vault,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let operator_pk = operator.pubkey();
    claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        operator_pk,
    )
    .unwrap();
    let vault_after = lamports(&svm, &vault);
    let operator_after = lamports(&svm, &operator_pk);

    // RPC-timeout-style retry with the same arguments: no second payment.
    // (LiteSVM dedupes byte-identical transactions, so rotate the
    // blockhash to make this a genuine second submission.)
    svm.expire_blockhash();
    let err = claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        operator_pk,
    )
    .expect_err("duplicate claim must be rejected");
    assert!(
        err.to_lowercase().contains("taskalreadypaid"),
        "expected TaskAlreadyPaid, got: {err}"
    );
    assert_eq!(lamports(&svm, &vault), vault_after);
    assert_eq!(lamports(&svm, &operator_pk), operator_after);
}

#[test]
fn wrong_verifier_cannot_sign_claims() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier: _real_verifier,
        mission,
        vault,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let operator_pk = operator.pubkey();
    let forged = Keypair::new();
    let vault_before = lamports(&svm, &vault);

    let err = claim(
        &mut svm,
        &owner,
        &forged,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        operator_pk,
    )
    .expect_err("forged verifier must be rejected");
    assert!(
        err.to_lowercase().contains("invalidverifier"),
        "expected InvalidVerifier, got: {err}"
    );
    assert_eq!(lamports(&svm, &vault), vault_before, "nothing paid");
    assert_eq!(
        task_state(&svm, &mission, "task-rs").status,
        TaskStatus::Assigned
    );
}

#[test]
fn stale_proof_version_rejected_after_reassignment() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let old_operator = operator.pubkey();
    let replacement = Keypair::new();
    svm.airdrop(&replacement.pubkey(), LAMPORTS).unwrap();

    // SOLANA_PROTOCOL §6: "Stale ROV A proof after reassignment to ROV B".
    // The verifier's approval for version 1 cannot pay once version 2 is
    // enacted, even if the verifier re-signs it.
    reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        replacement.pubkey(),
        400_000_000,
    )
    .unwrap();
    let err = claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        old_operator,
    )
    .expect_err("claim bound to the replaced version must fail");
    assert!(
        err.to_lowercase().contains("staleassignmentversion"),
        "expected StaleAssignmentVersion, got: {err}"
    );
    assert_eq!(
        lamports(&svm, &old_operator),
        LAMPORTS,
        "old operator wallet untouched"
    );
    assert_eq!(
        task_state(&svm, &mission, "task-rs").paid_version,
        None,
        "task stays unpaid"
    );
}

#[test]
fn payout_destination_is_program_controlled() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let operator_pk = operator.pubkey();

    // Wrong destination account: rejected.
    let thief = Keypair::new();
    svm.airdrop(&thief.pubkey(), LAMPORTS).unwrap();
    let err = claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        thief.pubkey(),
    )
    .expect_err("caller-supplied destination must be rejected");
    assert!(
        err.to_lowercase().contains("wrongpayoutwallet"),
        "expected WrongPayoutWallet, got: {err}"
    );

    // Anyone may RELAY a legitimate claim (here the old-operator-to-be
    // pays the fees): funds still land on the assigned wallet.
    let relay = Keypair::new();
    svm.airdrop(&relay.pubkey(), LAMPORTS).unwrap();
    claim(
        &mut svm,
        &relay,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        operator_pk,
    )
    .expect("relayed claim for the assigned wallet must succeed");
    assert_eq!(
        lamports(&svm, &operator_pk),
        LAMPORTS + 400_000_000,
        "assigned operator received the reward"
    );
}

#[test]
fn claim_rejects_zero_digest_and_stale_attestation() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let operator_pk = operator.pubkey();

    let err = claim_capture_logs(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        [0u8; 32],
        operator_pk,
    )
    .expect_err("all-zero digest must be rejected");
    assert!(
        err.to_lowercase().contains("invalidevidencedigest"),
        "expected InvalidEvidenceDigest, got: {err}"
    );

    // P1 freshness: there is no "never expires" bypass — attestation
    // expiry 0 (previously accepted as "no window") is now rejected.
    let err =
        claim_with_attestation_expiry(&mut svm, &owner, &verifier, &owner.pubkey(), mission, 0)
            .expect_err("zero attestation expiry must be rejected");
    assert!(
        err.to_lowercase().contains("attestationexpired"),
        "expected AttestationExpired for expiry=0, got: {err}"
    );
    svm.expire_blockhash();

    // Attestation whose validity window has already passed (the program
    // reads the same Clock the test controls).
    svm.set_sysvar(&anchor_lang::prelude::Clock {
        slot: 2,
        epoch_start_timestamp: TEST_NOW,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: TEST_NOW + 10_000,
    });
    let err = claim_with_attestation_expiry(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        TEST_NOW + 5_000,
    )
    .expect_err("expired attestation window must be rejected");
    assert!(
        err.to_lowercase().contains("attestationexpired"),
        "expected AttestationExpired, got: {err}"
    );
}

/// claim_capture_logs with an explicit attestation expiry argument.
fn claim_with_attestation_expiry(
    svm: &mut LiteSVM,
    payer: &Keypair,
    verifier: &Keypair,
    owner_pk: &Pubkey,
    mission: Pubkey,
    attestation_expiry: i64,
) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::VerifyAndClaim {
            task_id: "task-rs".to_string(),
            expected_assignment_version: 1,
            evidence_digest: DIGEST,
            policy_version: 1,
            attestation_expiry,
        }
        .data(),
        VerifyAndClaim {
            payer: payer.pubkey(),
            verifier: verifier.pubkey(),
            owner: *owner_pk,
            mission,
            registry: registry_pda(),
            task: task_pda(&mission, "task-rs"),
            vault: vault_pda(&mission),
            payout_wallet: task_state(svm, &mission, "task-rs")
                .current_operator
                .expect("assigned fixture"),
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer, verifier]).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|err| format!("{err:?}"))
}

#[test]
fn claim_rejected_after_mission_expiry_and_after_close() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let operator_pk = operator.pubkey();

    // Expired mission: claims are rejected (SOLANA_PROTOCOL §6); close
    // after expiry is the release path instead.
    svm.set_sysvar(&anchor_lang::prelude::Clock {
        slot: 3,
        epoch_start_timestamp: TEST_NOW,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: EXPIRY_FAR_FUTURE,
    });
    let err = claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        operator_pk,
    )
    .expect_err("claim after mission expiry must be rejected");
    assert!(
        err.to_lowercase().contains("missionexpired"),
        "expected MissionExpired, got: {err}"
    );

    // Un-expire the clock (back to the fixture time), settle the task, and
    // close the mission; a claim against the Closed mission must reject.
    svm.set_sysvar(&anchor_lang::prelude::Clock {
        slot: 3,
        epoch_start_timestamp: TEST_NOW,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: TEST_NOW,
    });
    svm.expire_blockhash(); // the rejected claim above had identical bytes
    claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        operator_pk,
    )
    .unwrap();
    close(&mut svm, &owner, mission).unwrap();
    svm.expire_blockhash();
    let err = claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        operator_pk,
    )
    .expect_err("claim after close must be rejected");
    assert!(
        err.to_lowercase().contains("missionalreadyclosed"),
        "expected MissionAlreadyClosed, got: {err}"
    );
}

#[test]
fn close_blocked_while_reservations_outstanding() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        vault,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let owner_before = lamports(&svm, &owner.pubkey());
    let vault_before = lamports(&svm, &vault);

    let err = close(&mut svm, &owner, mission)
        .expect_err("close with an outstanding reservation must be rejected");
    assert!(
        err.to_lowercase().contains("missionnotclosable"),
        "expected MissionNotClosable, got: {err}"
    );
    assert_eq!(lamports(&svm, &vault), vault_before);
    assert_eq!(
        lamports(&svm, &owner.pubkey()),
        owner_before - LITE_TX_FEE,
        "only the fee was paid"
    );
    assert_eq!(mission_state(&svm, &mission).status, MissionStatus::Active);
}

#[test]
fn close_refunds_unused_balance_exactly_once() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        mission,
        vault,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let operator_pk = operator.pubkey();
    claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        operator_pk,
    )
    .unwrap();

    let vault_total = lamports(&svm, &vault);
    let owner_before = lamports(&svm, &owner.pubkey());
    close(&mut svm, &owner, mission).expect("close with no obligations should succeed");

    // Full vault remainder (including the original rent seed) to the
    // owner, vault fully drained, mission terminal.
    assert_eq!(
        lamports(&svm, &owner.pubkey()),
        owner_before + vault_total - LITE_TX_FEE
    );
    // Fully-drained zero-lamport accounts are garbage collected: the
    // vault no longer exists at all.
    assert!(svm.get_account(&vault).is_none());
    let state = mission_state(&svm, &mission);
    assert_eq!(state.status, MissionStatus::Closed);
    assert_eq!(
        (
            state.funded_lamports,
            state.remaining_lamports,
            state.reserved_lamports
        ),
        (0, 0, 0)
    );

    // Second close is rejected (explicit repeat policy), and every
    // mutating mission instruction fails closed afterwards. Rotate the
    // blockhash so this is a genuine second close attempt, not a LiteSVM
    // signature-dedup artifact.
    svm.expire_blockhash();
    let err = close(&mut svm, &owner, mission).expect_err("double close must be rejected");
    assert!(
        err.to_lowercase().contains("missionalreadyclosed"),
        "expected MissionAlreadyClosed, got: {err}"
    );
    assert!(
        fund(&mut svm, &owner, mission, vault, LAMPORTS / 2).is_err(),
        "funding a closed mission must fail"
    );
    assert!(
        create_task(&mut svm, &owner, mission, "task-late", 100_000).is_err(),
        "creating tasks on a closed mission must fail"
    );
}

#[test]
fn close_after_expiry_releases_reserved_to_owner() {
    let TestEnv {
        mut svm,
        owner,
        mission,
        vault,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let owner_before = lamports(&svm, &owner.pubkey());
    let vault_total = lamports(&svm, &vault);

    // Expired missions owe nothing further (documented expiry/cancellation
    // policy): close refunds EVERYTHING, including the reserved reward.
    svm.set_sysvar(&anchor_lang::prelude::Clock {
        slot: 4,
        epoch_start_timestamp: TEST_NOW,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: EXPIRY_FAR_FUTURE,
    });
    close(&mut svm, &owner, mission).expect("close after expiry should release reserved funds");
    assert_eq!(
        lamports(&svm, &owner.pubkey()),
        owner_before + vault_total - LITE_TX_FEE
    );
    assert!(
        svm.get_account(&vault).is_none(),
        "drained vault must be garbage collected"
    );
    assert_eq!(mission_state(&svm, &mission).status, MissionStatus::Closed);
}

#[test]
fn paid_task_cannot_be_reassigned() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let operator_pk = operator.pubkey();
    claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        operator_pk,
    )
    .unwrap();

    // The VQ-05 forged-account guard, now end-to-end with a REAL paid task.
    let err = reassign(
        &mut svm,
        &owner,
        mission,
        "task-rs",
        1,
        Keypair::new().pubkey(),
        500_000_000,
    )
    .expect_err("paid task must not be reassignable");
    assert!(
        err.to_lowercase().contains("tasknotreassignable"),
        "expected TaskNotReassignable, got: {err}"
    );
    assert_eq!(
        task_state(&svm, &mission, "task-rs").current_assignment_version,
        1
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

// ---------------------------------------------------------------------------
// SECURITY (independent verifier authority) — failing-first for PR #48
// ---------------------------------------------------------------------------

/// P0 REPRODUCTION (fails against the pre-fix program): `initialize_mission`
/// accepts any caller-supplied verifier_authority, so a mission owner can
/// appoint a verifier key they control and later self-authorize payout by
/// co-signing their own claim. The fix (verifier registry) must make this
/// initialization FAIL with VerifierNotRegistered.
#[test]
fn mission_owner_cannot_appoint_an_unregistered_verifier() {
    let mut svm = load_program();
    bootstrap_registry(&mut svm, 1); // honest deployer initializes the registry
    let owner = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10 * LAMPORTS).unwrap();

    // Verifier key generated and controlled BY THE OWNER (never registered
    // through any independent registry). Registration is admin-only, so
    // the owner cannot add it either (proven in the admin tests below).
    let owner_controlled_verifier = Keypair::new();

    let ix = init_mission_ix(
        &owner,
        "port-selfauth",
        owner_controlled_verifier.pubkey(),
        EXPIRY_FAR_FUTURE,
    );
    let tx = signed_tx(&mut svm, &owner, ix);
    assert_tx_fails(&mut svm, tx, "VerifierNotRegistered");

    // The flaw's full chain, for the record: with the pre-fix program this
    // init SUCCEEDS and the owner-controlled key can later sign claims.
    // (Reproduced on the pre-fix build: this test failed at the line above
    // because the initialization went through.)
}

#[test]
fn only_registry_admin_registers_revokes_and_rotates_policy() {
    let mut svm = load_program();
    let admin = bootstrap_registry(&mut svm, 1);
    let owner = Keypair::new();
    let operator = Keypair::new();
    let attacker = Keypair::new();
    for kp in [&owner, &operator, &attacker] {
        svm.airdrop(&kp.pubkey(), LAMPORTS).unwrap();
    }
    let v_new = Keypair::new().pubkey();

    // Non-admins (mission owner, operator, arbitrary attacker) cannot
    // register verifiers — has_one = admin rejects them all.
    for kp in [&owner, &operator, &attacker] {
        let err = register_verifier(&mut svm, kp, v_new)
            .expect_err("non-admin must not register verifiers");
        assert!(
            err.to_lowercase().contains("notregistryadmin"),
            "expected NotRegistryAdmin, got: {err}"
        );
    }

    // Admin validation rules: default key invalid, duplicates rejected.
    let err = register_verifier(&mut svm, &admin, Pubkey::default())
        .expect_err("default key must not be registrable");
    assert!(
        err.to_lowercase().contains("invalidverifierkey"),
        "got: {err}"
    );
    register_verifier(&mut svm, &admin, v_new).unwrap();
    svm.expire_blockhash(); // genuine second submission, not a dedup artifact
    let err = register_verifier(&mut svm, &admin, v_new)
        .expect_err("duplicate registration must be rejected");
    assert!(
        err.to_lowercase().contains("verifieralreadyregistered"),
        "got: {err}"
    );
    assert!(registry_state(&svm).verifiers.contains(&v_new));

    // Revocation of a non-member fails; admin revoke works.
    let err = revoke_verifier(&mut svm, &admin, Keypair::new().pubkey())
        .expect_err("revoking a non-registered key must fail");
    assert!(
        err.to_lowercase().contains("verifiernotregistered"),
        "got: {err}"
    );
    revoke_verifier(&mut svm, &admin, v_new).unwrap();
    assert!(!registry_state(&svm).verifiers.contains(&v_new));

    // Policy rotation is admin-only.
    let err = set_policy_version(&mut svm, &owner, 2)
        .expect_err("non-admin must not rotate the policy version");
    assert!(
        err.to_lowercase().contains("notregistryadmin"),
        "got: {err}"
    );
    set_policy_version(&mut svm, &admin, 2).unwrap();
    assert_eq!(registry_state(&svm).policy_version, 2);
}

#[test]
fn revoked_verifier_blocks_new_missions_and_existing_claims() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        admin,
        mission,
        ..
    } = setup_assigned(LAMPORTS, 400_000_000);
    let operator_pk = operator.pubkey();

    // Admin revokes the mission's verifier AFTER the mission exists…
    revoke_verifier(&mut svm, &admin, verifier.pubkey()).unwrap();

    // …existing claims signed by the revoked key are dead immediately.
    let err = claim(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-rs",
        1,
        operator_pk,
    )
    .expect_err("revoked verifier must not authorize payouts");
    assert!(
        err.to_lowercase().contains("verifiernotregistered"),
        "expected VerifierNotRegistered, got: {err}"
    );
    assert_eq!(
        task_state(&svm, &mission, "task-rs").paid_version,
        None,
        "task stays unpaid"
    );

    // …and NEW missions cannot appoint the revoked key either.
    svm.airdrop(&owner.pubkey(), LAMPORTS).unwrap();
    let ix = init_mission_ix(&owner, "port-next", verifier.pubkey(), EXPIRY_FAR_FUTURE);
    let tx = signed_tx(&mut svm, &owner, ix);
    assert_tx_fails(&mut svm, tx, "VerifierNotRegistered");
}

#[test]
fn policy_version_must_match_the_registry_and_rotation_takes_effect() {
    let TestEnv {
        mut svm,
        owner,
        operator,
        verifier,
        admin,
        mission,
        ..
    } = setup();
    fund(&mut svm, &owner, mission, vault_pda(&mission), 3 * LAMPORTS).unwrap();
    create_task(&mut svm, &owner, mission, "task-a", LAMPORTS / 2).unwrap();
    create_task(&mut svm, &owner, mission, "task-b", LAMPORTS / 2).unwrap();
    let operator_pk = operator.pubkey();
    assign_task(
        &mut svm,
        &owner,
        mission,
        "task-a",
        operator_pk,
        300_000_000,
    )
    .unwrap();
    assign_task(
        &mut svm,
        &owner,
        mission,
        "task-b",
        operator_pk,
        300_000_000,
    )
    .unwrap();

    // Claim quoting a policy version the registry does not accept: reject.
    let err = claim_full(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-a",
        1,
        2, // registry accepts 1
        EXPIRY_FAR_FUTURE,
        operator_pk,
    )
    .expect_err("wrong policy version must be rejected");
    assert!(
        err.to_lowercase().contains("policyversionmismatch"),
        "expected PolicyVersionMismatch, got: {err}"
    );
    assert_eq!(task_state(&svm, &mission, "task-a").paid_version, None);

    // Correct version pays.
    claim_full(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-a",
        1,
        1,
        EXPIRY_FAR_FUTURE,
        operator_pk,
    )
    .expect("matching policy version should pay");

    // After admin rotation to 2, the old version is dead and 2 works.
    set_policy_version(&mut svm, &admin, 2).unwrap();
    svm.expire_blockhash();
    let err = claim_full(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-b",
        1,
        1,
        EXPIRY_FAR_FUTURE,
        operator_pk,
    )
    .expect_err("pre-rotation policy version must now be rejected");
    assert!(
        err.to_lowercase().contains("policyversionmismatch"),
        "got: {err}"
    );
    svm.expire_blockhash();
    claim_full(
        &mut svm,
        &owner,
        &verifier,
        &owner.pubkey(),
        mission,
        "task-b",
        1,
        2,
        EXPIRY_FAR_FUTURE,
        operator_pk,
    )
    .expect("post-rotation policy version should pay");
}

/// Fully-parameterized claim (policy + attestation) for the security tests.
#[allow(clippy::too_many_arguments)]
fn claim_full(
    svm: &mut LiteSVM,
    payer: &Keypair,
    verifier: &Keypair,
    owner_pk: &Pubkey,
    mission: Pubkey,
    task_id: &str,
    expected_version: u64,
    policy_version: u64,
    attestation_expiry: i64,
    payout_wallet: Pubkey,
) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        vorqyn::ID,
        &instruction::VerifyAndClaim {
            task_id: task_id.to_string(),
            expected_assignment_version: expected_version,
            evidence_digest: DIGEST,
            policy_version,
            attestation_expiry,
        }
        .data(),
        VerifyAndClaim {
            payer: payer.pubkey(),
            verifier: verifier.pubkey(),
            owner: *owner_pk,
            mission,
            registry: registry_pda(),
            task: task_pda(&mission, task_id),
            vault: vault_pda(&mission),
            payout_wallet,
            clock: CLOCK,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer, verifier]).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|err| format!("{err:?}"))
}
