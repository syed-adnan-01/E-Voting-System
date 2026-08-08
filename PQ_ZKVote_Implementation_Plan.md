# PQ-ZKVote — Complete Implementation Plan

This is the build-level companion to the architecture and roadmap docs: concrete setup steps, file structure, commands, and acceptance criteria for every phase. Follow it top to bottom.

---

## Phase 0 — Environment Setup & Grounding (Week 1)

### 0.1 Repository structure
```
pq-zkvote/
├── circuits/           # circom circuits (classical track)
├── lattice/            # lattice-based PQC proving track
├── contracts/          # Solidity smart contracts
├── registrar/          # registrar service
├── admin/               # admin panel (event creation, registration approval)
├── tally/               # tallying service
├── anomaly/             # ML anomaly detection pipeline
├── client/               # voter-facing React app
├── dashboard/           # admin/live dashboard
├── benchmarks/           # benchmarking scripts (Phase 6)
├── docs/                 # threat model, related work, limitations
└── test/                 # cross-cutting integration tests
```

### 0.2 Tooling install checklist
- [ ] Node.js (v18+), npm
- [ ] `npm install -g circom snarkjs`
- [ ] `npx hardhat` (init inside `contracts/`)
- [ ] Python 3.10+, `pip install scikit-learn pandas fastapi uvicorn`
- [ ] Rust or Python for the lattice track (decide now — Rust gives better performance for benchmarking; Python is faster to prototype. Recommendation: Python first, port to Rust only if benchmarking numbers demand it)

### 0.3 Documentation tasks
- [ ] `docs/threat_model.md` — adversary model, what's in/out of scope (use the security architecture table from the overview doc as a base)
- [ ] `docs/related_work.md` — summarize Semaphore, MACI, ElectAnon, zkVoting, and the source paper's claims vs. gaps
- [ ] `docs/limitations.md` — start this now, add to it every phase (don't write it all at the end)

**Acceptance criteria**: `circom --version`, `snarkjs --version`, `npx hardhat --version` all run without error; repo skeleton committed to Git.

---

## Phase 1 — Classical ZK Circuit (Weeks 2–4)

### 1.1 Learn the tooling
- [ ] Complete the official circom "HelloWorld" tutorial circuit before writing your own
- [ ] Complete a Merkle-tree-membership example circuit (many public examples exist for Semaphore-style circuits — read, don't copy verbatim, understand each constraint)

### 1.2 Build `circuits/vote.circom`
Constraints to implement, in order of complexity:
1. **Vote range check**: prove `vote_value ∈ {0, 1, ..., num_candidates-1}`
2. **Nullifier derivation**: `nullifier = Poseidon(credential_secret, election_id)`, prove correct computation
3. **Merkle membership**: prove `Poseidon(credential_secret)` is a leaf in the eligible-voters Merkle tree, given a Merkle path as private input

```
# Example compile commands
circom circuits/vote.circom --r1cs --wasm --sym -o build/
snarkjs groth16 setup build/vote.r1cs pot_final.ptau build/vote_0000.zkey
snarkjs zkey contribute build/vote_0000.zkey build/vote_final.zkey
snarkjs zkey export verificationkey build/vote_final.zkey build/verification_key.json
```

### 1.3 Solidity verifier generation
```
snarkjs zkey export solidityverifier build/vote_final.zkey contracts/Verifier.sol
```

### 1.4 CLI proving script
- [ ] `scripts/prove_vote.js` — takes a candidate choice + credential secret + Merkle path, outputs `proof.json` + `public.json`
- [ ] `scripts/verify_vote.js` — verifies a proof locally via snarkjs (before touching the chain)
- [ ] Negative test: feed a tampered proof, confirm rejection

**Acceptance criteria**: a valid vote proof verifies locally; a proof with a wrong vote value, wrong nullifier, or invalid Merkle path all fail verification — demonstrated with a script, not manually.

---

## Phase 2 — Smart Contract & Ledger (Weeks 4–5)

### 2.1 `contracts/VotingContract.sol`
Core state:
```solidity
mapping(bytes32 => bool) public nullifiers;
bytes32 public merkleRoot;
uint256 public totalVotes;
bool public electionOpen;
```

Core functions:
```solidity
function submitVote(
    uint256[8] calldata proof,
    uint256[] calldata publicSignals,
    bytes32 nullifierHash,
    bytes calldata encryptedVote
) external {
    require(electionOpen, "closed");
    require(!nullifiers[nullifierHash], "double vote");
    require(verifier.verifyProof(proof, publicSignals), "invalid proof");
    nullifiers[nullifierHash] = true;
    totalVotes++;
    emit VoteRecorded(nullifierHash, encryptedVote, block.timestamp);
}

function closeElection() external onlyAdmin { electionOpen = false; }
```

### 2.2 Hardhat test suite (`test/VotingContract.test.js`)
- [ ] Valid proof + unused nullifier → vote accepted, event emitted
- [ ] Valid proof + reused nullifier → reverts
- [ ] Tampered proof → reverts
- [ ] Vote after `closeElection()` → reverts
- [ ] Non-admin calling `closeElection()` → reverts

```
npx hardhat test
```

**Acceptance criteria**: full test suite green; contract deployable to local Hardhat node via `npx hardhat run scripts/deploy.js`.

---

## Phase 3 — Registrar, Admin Panel & Voter Client (Weeks 5–6)

*Design rule for this phase: the admin panel and registrar only ever handle commitments (hashes) from voters, never secrets. If you find yourself building an endpoint that accepts a raw secret from the network, stop — that's the wrong design (see architecture.md §4.1).*

### 3.1 Registrar service (`registrar/`)
- [ ] `POST /events` (admin-only) — creates a voting event: `{name, candidates, open_at, close_at}` → `{election_id}`
- [ ] `POST /register` — accepts `{election_id, commitment, proof_of_identity}` from the voter client, stores it as `status: "pending"`
- [ ] `GET /registrations/:election_id` (admin-only) — lists pending/approved/rejected registrations
- [ ] `POST /registrations/:commitment/approve` (admin-only) — adds the commitment as a leaf in the Merkle tree, marks approved
- [ ] `POST /registrations/:commitment/reject` (admin-only)
- [ ] `GET /merkle-root/:election_id` — returns current root for the client to fetch
- [ ] `GET /merkle-path/:commitment` — returns the Merkle path needed for proof generation (only for approved commitments)
- [ ] Store events, registrations, and the tree in a simple local DB (SQLite is enough for a prototype)
- [ ] Admin-only endpoints gated by simple auth (a shared admin token/login is enough for a prototype — separate from anything in the voter flow)

### 3.2 Admin panel (`admin/`)
- [ ] Login screen for the admin (simple auth, prototype-grade)
- [ ] "Create event" form → calls `POST /events`
- [ ] Pending registrations queue → approve/reject buttons calling the registrar's admin endpoints
- [ ] "Close election" button → calls the registrar, which in turn calls the contract's `closeElection()`
- [ ] Results view + anomaly flag list (can reuse components from the Phase 7 dashboard once anomaly monitor exists — build the layout now, wire live data later)

### 3.3 Voter client (`client/`)
- [ ] On first use: generate a random secret locally (`crypto.getRandomValues` in-browser or equivalent), store it in local storage/IndexedDB — **never send this to any server**
- [ ] Compute `commitment = hash(secret)`, submit `{election_id, commitment, proof_of_identity}` to `POST /register`
- [ ] Registration status screen: `pending` / `approved` / `rejected`, polling or refreshing from the registrar
- [ ] Backup/recovery screen: shown once, right after secret generation — offer a downloadable encrypted keyfile or a written recovery phrase, with a clear warning that a lost secret cannot be recovered or reissued
- [ ] Candidate selection screen (available once registration shows `approved`)
- [ ] On submit: fetch Merkle path from registrar → generate proof client-side (snarkjs.js in-browser, using the WASM witness calculator and zkey) → submit `{proof, publicSignals, nullifierHash, encryptedVote}` to the contract via ethers.js/web3.js
- [ ] Post-vote receipt screen: show a receipt hash (hash of their submission — not their choice) plus a lookup against the public ledger to confirm inclusion

**Acceptance criteria**: an admin can create an event from the admin panel; a voter can register (commitment only, verified by inspecting network traffic that no secret ever left the browser), get approved by the admin, and cast one full vote from the UI — confirmed on-chain via Hardhat console or a block explorer.

---

## Phase 4 — Anomaly Detection Pipeline (Weeks 6–7)

### 4.1 Synthetic dataset generator (`anomaly/generate_dataset.py`)
- [ ] Generate N "normal" vote records: timestamp, proof-verification latency, gas price, submission interval
- [ ] Inject documented anomaly types (write this logic explicitly, don't hide it in a black box):
  - Rapid-fire submissions from the same session window
  - Abnormally high/low gas price outliers
  - Impossible timestamp sequences
- [ ] Label each record `normal` / `anomalous` for evaluation purposes (the model itself trains unsupervised, but you need ground truth to measure it)

### 4.2 Model training (`anomaly/train_model.py`)
```python
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split

train, test = train_test_split(features, test_size=0.2, random_state=42)
model = IsolationForest(contamination=0.05, random_state=42)
model.fit(train)
```

### 4.3 Evaluation (`anomaly/evaluate.py`)
- [ ] Report precision, recall, F1, ROC-AUC on the **held-out test set only**
- [ ] Confusion matrix plotted and saved
- [ ] Document the exact contamination rate chosen and why

**Acceptance criteria**: metrics computed on data the model never saw during training; injection logic and hyperparameters both documented in `docs/anomaly_methodology.md`.

---

## Phase 5 — Post-Quantum Proving Track (Weeks 7–9)

*This is the phase that delivers Objective 2 — treat it as a first-class phase, not a stretch goal.*

### 5.1 Choose and cite a concrete construction
- [ ] Pick a published Ring-LWE-based Σ-protocol or lattice-based ZK scheme from the literature (don't invent new cryptography — implement a peer-reviewed one correctly)
- [ ] Document the hardness assumption and parameter set (target a NIST PQC security level, e.g., Level 1) in `docs/pqc_scheme.md`

### 5.2 Implementation (`lattice/`)
- [ ] Key generation: sample matrix `A`, secret `s`, error `e`
- [ ] Commitment/proof generation: Fiat-Shamir-transformed Σ-protocol proving vote validity + credential knowledge, mirroring the constraints from `vote.circom` (range check, nullifier correctness, membership)
- [ ] Verifier: standalone script that checks a proof against public parameters

### 5.3 Integration
- [ ] Adapter layer so the voter client and smart contract can accept either proof type (classical or lattice-based) via a proof-type flag — this is what makes Phase 6's benchmark comparison possible under identical conditions
- [ ] On-chain verification for the lattice proof (this is the hard part — lattice verifiers are more expensive on-chain; document the gas cost honestly rather than optimizing it away)

**Acceptance criteria**: same negative/positive test pattern as Phase 1 — valid lattice proof verifies, tampered one doesn't — run against the same test vote data used in Phase 1 for a fair comparison.

---

## Phase 6 — Classical vs. PQC Benchmark Suite (Week 9)

### 6.1 `benchmarks/run_benchmarks.py`
For both proving systems, measure:
- [ ] Proof generation time (wall clock, N=100 runs, report mean + stddev)
- [ ] Verification time (same methodology)
- [ ] Proof size in bytes
- [ ] On-chain gas cost (from Hardhat gas reporter)
- [ ] Peak memory usage during proving (`memory_profiler` or equivalent)

### 6.2 Output
- [ ] `benchmarks/results.csv` — raw data
- [ ] `benchmarks/report.md` — summary table + honest discussion (expect the lattice track to be slower/larger — that's the real finding, not a flaw to hide)
- [ ] Script must be rerunnable by anyone cloning the repo: `python benchmarks/run_benchmarks.py`

**Acceptance criteria**: a stranger can run the benchmark script and reproduce numbers within reasonable variance — no numbers in your report that didn't come from this script.

---

## Phase 7 — Integration, Dashboard, Documentation (Weeks 10–11)

### 7.1 Tallying service (`tally/`)
- [ ] Listen for `VoteRecorded` events
- [ ] Aggregate at election close, publish `{candidate_totals, total_votes}`
- [ ] `GET /tally/:election_id` endpoint

### 7.2 Anomaly monitor live integration
- [ ] Stream real vote submissions into the trained model (not just the synthetic test set)
- [ ] `GET /anomalies/:election_id` endpoint, flagged items surfaced (not auto-rejected)

### 7.3 Dashboard (`dashboard/`)
- [ ] Live tally view
- [ ] Anomaly alert feed
- [ ] Public audit log (transaction hashes, timestamps — no voter-identifying data)

### 7.4 Documentation
- [ ] `README.md` — setup instructions, architecture diagram, how to run the full demo end-to-end
- [ ] `docs/limitations.md` — finalize (coercion-resistance, PKI scope, audit status — from the overview doc)
- [ ] Record a short demo walkthrough (screen recording) — makes the project far easier to present or submit

**Acceptance criteria**: a stranger can clone the repo and get a full demo running (registrar → vote → tally → dashboard) in under 15 minutes, following only the README.

---

## Phase 8 — Stretch Goals (Week 12+, optional)

- [ ] Offline vote queuing with sync-on-reconnect
- [ ] SMS confirmation via Twilio sandbox
- [ ] Public testnet deployment (Sepolia) with a shareable demo link
- [ ] Formal writeup for course submission or workshop paper, using the benchmark suite as your results section

---

## Cross-Phase Checklist (revisit at the end of every phase)

- [ ] Does `docs/limitations.md` need a new entry from what you just built?
- [ ] Are all new claims backed by a script/test, not just described in a comment?
- [ ] Did scope creep happen? (Check against the "out of scope" list in the threat model before adding anything not already planned.)

---

## Summary Timeline

| Phase | Weeks | Core Deliverable |
|---|---|---|
| 0 | 1 | Repo + docs skeleton |
| 1 | 2–4 | Working classical ZK circuit |
| 2 | 4–5 | Smart contract + tests |
| 3 | 5–6 | Registrar + admin panel + voter client, first end-to-end vote |
| 4 | 6–7 | Evaluated anomaly detection model |
| 5 | 7–9 | Working lattice-based PQC proving track |
| 6 | 9 | Reproducible classical-vs-PQC benchmark suite |
| 7 | 10–11 | Full integration, dashboard, documentation |
| 8 | 12+ | Stretch goals / writeup |

Total: **~11 weeks core build, part-time pace** (compressible to ~6 weeks full-time).
