# Product Requirements Document (PRD)

## PQ-ZKVote: Post-Quantum Zero-Knowledge E-Voting with Anomaly Detection

| Field | Value |
|---|---|
| Document owner | You (project author) |
| Status | Draft |
| Version | 1.0 |
| Last updated | August 2026 |

---

## 1. Summary

PQ-ZKVote is a prototype blockchain-based e-voting system that lets a voter prove they are eligible and cast a valid vote without revealing their identity or their vote's content, using a real, working zero-knowledge proof system. It supports two proving tracks — a classical elliptic-curve-based scheme (Groth16) and a lattice-based post-quantum scheme — and layers a machine-learning anomaly monitor on top of cryptographic verification to flag irregular voting patterns for human review.

---

## 2. Problem Statement

Two gaps currently exist in this space:

1. **Academic proposals** (including the source paper motivating this project) describe cryptographic e-voting schemes without implementing them, without security proofs, and without reproducible performance evaluation — claims are asserted rather than demonstrated.
2. **Production-grade ZK voting infrastructure** that does exist (Semaphore, MACI, ElectAnon, zkVoting) is real and well-built, but relies entirely on classical elliptic-curve cryptography, which is not secure against quantum attacks, and none of it combines cryptographic guarantees with statistical anomaly monitoring.

There is no existing project — academic or production — that does both: a working, benchmarked post-quantum proving pipeline **and** an integrated anomaly-detection layer, built to the same architectural standard as real deployed systems.

---

## 3. Goals

| Goal | Description |
|---|---|
| G1 | Build a working zero-knowledge proof pipeline (classical) that verifiably proves vote validity and voter eligibility without revealing either |
| G2 | Build a working lattice-based post-quantum proof pipeline, integrated into the same architecture, not developed in isolation |
| G3 | Layer an ML-based anomaly detection system on top of cryptographic verification to catch irregularities a valid proof wouldn't reveal |
| G4 | Produce reproducible, scripted benchmarks comparing classical vs. post-quantum proving — no subjective or unverifiable performance claims |
| G5 | Ship a working end-to-end demo (registration → vote → tally → dashboard) that a stranger can run from a README in under 15 minutes |

## 4. Non-Goals (Explicitly Out of Scope)

- Production-grade identity verification / full PKI system for voter registration
- Coercion-resistance and receipt-freeness (acknowledged as unsolved; MACI is the reference project that targets this specifically)
- Mainnet deployment or handling of real elections
- Formal third-party security audit
- Solving scalability for national-election-sized voter rolls (thousands of test votes, not millions)

---

## 5. Users / Personas

| Persona | Need |
|---|---|
| **Voter** | Cast a vote quickly, be confident it's private and counted correctly, get a verifiable receipt |
| **Election admin/registrar** | Onboard eligible voters, open/close the election, view results and flagged anomalies |
| **Auditor/reviewer** (e.g., an instructor, evaluator, or curious third party) | Independently verify the tally and re-run the benchmark suite without trusting the author's claims |
| **Anomaly reviewer** | See flagged (not auto-rejected) suspicious votes and decide whether to investigate further |

---

## 6. Functional Requirements

### 6.1 Voter Registration
- FR1.1: System shall allow a registrar to add an eligible voter's identity commitment to a Merkle tree of eligible voters.
- FR1.2: System shall issue the voter a signed credential usable for exactly one election.
- FR1.3: System shall expose the current Merkle root and the voter's Merkle path for proof generation.

### 6.2 Vote Casting
- FR2.1: Voter client shall generate a zero-knowledge proof, client-side, demonstrating: (a) valid credential membership, (b) vote value within the valid candidate range, (c) correctly derived nullifier — without revealing the credential secret or the vote value.
- FR2.2: System shall support two interchangeable proof types: classical (Groth16) and lattice-based (post-quantum), selected via a proof-type flag.
- FR2.3: Smart contract shall verify the submitted proof and reject invalid proofs.
- FR2.4: Smart contract shall reject any vote whose nullifier has already been used (double-vote prevention).
- FR2.5: Voter shall receive a receipt hash confirming submission, without revealing their vote choice in that receipt.

### 6.3 Tallying
- FR3.1: System shall aggregate all valid recorded votes into a final per-candidate count after the election is closed by an admin.
- FR3.2: Tally results shall be independently re-verifiable against the public on-chain record.

### 6.4 Anomaly Detection
- FR4.1: System shall extract a feature vector per vote submission (timestamp, verification latency, gas price, submission interval, etc.).
- FR4.2: System shall score each vote's feature vector using a trained Isolation Forest model.
- FR4.3: Flagged (anomalous) votes shall be surfaced for human review, never automatically rejected.
- FR4.4: Anomaly detection performance shall be evaluated on a held-out test set with documented methodology (precision, recall, F1, ROC-AUC).

### 6.5 Benchmarking
- FR5.1: System shall include a scripted benchmark suite measuring proof generation time, verification time, proof size, and gas cost for both proving tracks.
- FR5.2: Benchmark results shall be reproducible by re-running a single script, with no manually-entered numbers in the final report.

### 6.6 Dashboard
- FR6.1: Dashboard shall display live tally counts, total votes cast, and anomaly alerts.
- FR6.2: Dashboard shall display a public audit log of on-chain transactions (hashes, timestamps) with no voter-identifying information.

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Security | No component shall store or transmit a voter's raw credential secret or plaintext vote choice off the client device |
| Privacy | Anomaly-detection features shall be hashed or bucketed where they could otherwise identify a voter (e.g., session metadata) |
| Reproducibility | Every performance or accuracy claim in the final report must trace to a script in the repository |
| Usability | A new user shall be able to run the full demo end-to-end from the README within 15 minutes |
| Cost | Entire system shall be buildable and runnable at $0 using free/open-source tooling and local/testnet deployment only |
| Auditability | All votes and tally results shall be publicly verifiable on-chain without trusting a central authority's word |

---

## 8. Technical Requirements / Stack

| Layer | Requirement |
|---|---|
| ZK proving (classical) | circom + snarkjs, Groth16 |
| ZK proving (PQC) | Lattice-based (Ring-LWE) Σ-protocol, Fiat-Shamir transformed, based on a published construction |
| Blockchain | Solidity smart contracts on Hardhat (local) / Sepolia (optional demo) |
| Backend services | Python (FastAPI) or Node (Express) for registrar, tally, anomaly services |
| ML | scikit-learn IsolationForest |
| Frontend | React (voter client + dashboard) |
| Testing | Hardhat test suite, pytest/Jest for services, circom positive/negative proof tests |

---

## 9. Success Metrics

| Metric | Target |
|---|---|
| Proof correctness | 100% of tampered proofs rejected across both proving tracks, in automated tests |
| Double-vote prevention | 100% of reused-nullifier attempts rejected, in automated tests |
| Anomaly detection | Reported precision/recall/F1 on held-out test set (no fixed target — the requirement is that it's measured and documented, not a specific number) |
| Benchmark reproducibility | Benchmark script re-run by a third party produces results within expected variance |
| Setup time | New user completes full demo setup and one full vote cycle in <15 minutes from README |
| Cost | $0 core build cost achieved |

---

## 10. Milestones

| Milestone | Target Week | Exit Criteria |
|---|---|---|
| M1 — Classical ZK circuit working | Week 4 | Valid/invalid proofs correctly verified locally |
| M2 — Smart contract + tests passing | Week 5 | Full Hardhat test suite green |
| M3 — First end-to-end vote cast | Week 6 | One vote from UI to chain, confirmed |
| M4 — Anomaly model evaluated | Week 7 | Metrics on held-out test set, documented |
| M5 — PQC proving track working | Week 9 | Same pos/neg proof tests passing on lattice track |
| M6 — Benchmark suite complete | Week 9 | Reproducible classical-vs-PQC report generated |
| M7 — Full system integrated | Week 11 | Dashboard, tally, anomaly monitor all live and connected |
| M8 — Documentation complete | Week 11 | README enables <15-minute stranger setup |

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| circom/lattice cryptography learning curve stalls timeline | High | Budget extra time in Phases 1 and 5 specifically; complete tutorials before custom circuits |
| On-chain lattice proof verification is prohibitively expensive in gas | Medium | Document honestly as a benchmark finding rather than hiding or over-optimizing under time pressure |
| Anomaly model overfits synthetic data | Medium | Strict train/test separation, no tuning against test metrics |
| Scope creep toward solving coercion-resistance / full PKI | High | Revisit Non-Goals list at the end of every phase |
| Benchmark numbers not independently reproducible | Medium | All numbers generated by committed scripts, never hand-recorded |

---

## 12. Open Questions

- Which specific published lattice-based Σ-protocol will be adapted for the PQC track? (Decide in Phase 0/5 during literature review.)
- Rust or Python for the lattice implementation — decide based on early benchmarking needs, not upfront preference.
- Will a public testnet demo (Sepolia) be included, or is local-only sufficient for the intended audience (course submission, portfolio, etc.)?

---

## 13. Appendix — Explicit Limitations Statement

To be included verbatim (or adapted) in the final project documentation:

> This is a prototype system. The registrar is a simplified credential issuer, not a production identity/PKI system. Coercion-resistance and receipt-freeness are not addressed. "Post-quantum secure" applies specifically to the lattice-based proving track; the classical track, included for benchmarking comparison, is not post-quantum secure. No formal third-party security audit has been performed. This project's novelty claim is scoped to combining post-quantum ZK proving with ML-based anomaly detection in a single integrated architecture — not to being the first zero-knowledge e-voting system, as real prior art (Semaphore, MACI, ElectAnon, zkVoting) exists and is cited accordingly.
