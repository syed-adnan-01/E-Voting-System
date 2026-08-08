# Project Overview: Hybrid Post-Quantum Zero-Knowledge E-Voting with Anomaly Detection

## 1. Title

**A Reproducible, Post-Quantum Zero-Knowledge Proof Framework for Blockchain E-Voting with Integrated ML-Based Anomaly Detection**

*(Working short title: PQ-ZKVote)*

---

## 2. Abstract

Blockchain-based e-voting has matured from theoretical proposal to real, working infrastructure — protocols like Semaphore and MACI now provide production-grade zero-knowledge voting primitives on Ethereum. However, this maturity has a blind spot: every widely-used implementation relies on elliptic-curve-based proof systems (Groth16/PLONK) that are not secure against quantum attacks, and none combine cryptographic vote verification with statistical anomaly detection to catch irregularities that a valid proof alone wouldn't reveal. This project builds a working e-voting prototype that closes both gaps — a lattice-based zero-knowledge proving pipeline wired into a full eligibility/nullifier/smart-contract architecture, paired with an Isolation Forest anomaly monitor, evaluated with reproducible benchmarks rather than asserted claims.

---

## 3. Problem Statement

Existing work in this space falls into two camps, each with a specific shortfall:

1. **Academic papers proposing "quantum-resistant" e-voting** (including the source paper this project builds on) describe cryptographic schemes without implementing real proof protocols, without security proofs, and without reproducible benchmarks — claims are asserted, not demonstrated.
2. **Production-grade ZK voting infrastructure** (Semaphore, MACI, ElectAnon, zkVoting) is real and well-engineered, but is built entirely on classical elliptic-curve cryptography — meaning the entire current generation of "working" ZK voting systems shares a single point of future failure: quantum attacks on the underlying curve assumptions. None of them layer statistical monitoring on top of cryptographic guarantees, either.

This project sits deliberately in the gap between these two camps: it aims for the rigor of a working, benchmarked implementation (like camp 2) while addressing the specific technical gap neither camp has closed (post-quantum security + anomaly monitoring, integrated together).

---

## 4. Objectives

**Objective 1 — Dual-layer defense: cryptographic verification + ML anomaly detection.**
Build a system where individual vote validity is guaranteed by a zero-knowledge proof, and population-level irregularities (timing patterns, submission clustering, credential misuse patterns) are separately flagged by an Isolation Forest model — a combination not present in any surveyed classical or research system.

**Objective 2 — A production-style post-quantum ZK proving pipeline.**
Implement a lattice-based (Ring-LWE) zero-knowledge proof scheme integrated into a full voting architecture — eligibility Merkle tree, nullifier registry, on-chain verification — mirroring how Semaphore/MACI are structured, but without their reliance on elliptic-curve assumptions.

**Objective 3 — A reproducible classical-vs-post-quantum benchmark suite.**
Produce an open, rerunnable benchmark comparing proof size, generation time, verification time, and gas cost between a classical Groth16 implementation and the lattice-based implementation under identical voting workloads — filling the absence of any such head-to-head comparison in current literature or tooling.

---

## 5. Positives Retained From the Source Research

- The two-layer defense concept (cryptography + anomaly detection) — kept and actually implemented, not just described.
- The phased pipeline (pre-voting → voting → tallying) — kept as the backbone of the architecture.
- The quantum-threat framing (ECDSA/SHA-256 vulnerability to Shor's algorithm) — kept, but grounded in a specific, implemented mitigation rather than an assertion.
- The accessibility angle (offline queuing, low-connectivity support) — kept as a stretch goal.

## 6. Gaps This Project Closes (vs. the Source Paper)

| Gap in Source Paper | How This Project Closes It |
|---|---|
| Undefined `generate_zkp_proof()` stub | Real circuit (circom/snarkjs) + real lattice-based Σ-protocol, both implemented and tested |
| No security proof or hardness reduction | Explicit reduction to Ring-LWE hardness, cited from published literature |
| Subjective 1–10 comparison charts | Measured benchmarks: time, memory, proof size, gas cost |
| Unexplained anomaly-detection dataset/metrics | Documented synthetic dataset generation, train/test split, full metric reporting |
| No implementation | Full working repository, README, reproducible eval scripts |
| "Quantum-resistant" asserted without scope | Precisely scoped: only the lattice-based proving track carries that claim |

## 7. Gaps This Project Closes (vs. Real-World Systems)

| Gap in Semaphore / MACI / ElectAnon / zkVoting | How This Project Closes It |
|---|---|
| All rely on elliptic-curve ZK-SNARKs (Groth16/PLONK) — not post-quantum secure | Lattice-based proving pipeline built to the same architectural standard |
| No integration of ML-based anomaly detection | Isolation Forest monitor added as a second, independent defense layer |
| No published classical-vs-PQC benchmark for voting workloads | Open, reproducible benchmark suite comparing both under identical conditions |

---

## 8. System Architecture (Summary)

```
Voter Client → Registrar Service → Smart Contract / Ledger
                                          │
                          ┌───────────────┴───────────────┐
                    Tallying Service              Anomaly Monitor
                          │                                │
                          └───────────────┬───────────────┘
                                     Dashboard
```

- **Voter client**: builds ZK proof locally, submits proof + nullifier + encrypted vote.
- **Registrar service**: issues signed eligibility credentials (prototype-grade, not a full PKI).
- **Smart contract**: verifies proof on-chain, enforces nullifier uniqueness, records votes immutably.
- **Tallying service**: aggregates verified votes into a final, publicly auditable count.
- **Anomaly monitor**: scores vote metadata with Isolation Forest, flags irregularities for human review (never auto-rejects — prevents false positives from disenfranchising voters).
- **Dashboard**: live tally, anomaly feed, public audit log.

*(Colour convention used in the architecture diagram: gray = user-facing components, purple = backend trust layer where verification, aggregation, and monitoring happen.)*

---

## 9. Tech Stack

| Layer | Tools |
|---|---|
| ZK proving (classical track) | circom + snarkjs (Groth16) |
| ZK proving (PQC track) | Custom Ring-LWE Σ-protocol (Python/Rust) |
| Blockchain | Solidity + Hardhat (local/testnet) |
| Backend services | Python/FastAPI or Node/Express |
| Anomaly detection | scikit-learn (IsolationForest), pandas |
| Frontend | React |
| Benchmarking | Scripted timing/memory harness, no manual measurement |

---

## 10. Roadmap (Condensed)

| Phase | Focus | Duration |
|---|---|---|
| 0 | Literature grounding, threat model | Week 1 |
| 1 | Classical ZK circuit (circom/snarkjs) | Weeks 2–4 |
| 2 | Smart contract + nullifier registry | Weeks 4–5 |
| 3 | Registrar + voter client | Weeks 5–6 |
| 4 | Anomaly detection pipeline | Weeks 6–7 |
| 5 | Lattice-based PQC proving track | Weeks 7–9 |
| 6 | Classical-vs-PQC benchmark suite | Week 9 |
| 7 | Integration, dashboard, documentation | Weeks 10–11 |
| 8 (stretch) | Public testnet demo, offline sync, writeup | Week 12+ |

*(Note: this adds a dedicated PQC track — Phase 5 — as its own phase, since it's now a core objective rather than an optional stretch goal.)*

---

## 11. Evaluation Plan

- **Correctness**: valid proofs verify, tampered proofs are rejected, double-voting is provably blocked — demonstrated with passing test suites.
- **Anomaly detection**: precision, recall, F1, ROC-AUC on a held-out synthetic test set, with documented anomaly-injection methodology.
- **Benchmarks**: proof generation time, verification time, proof size, gas cost — classical vs. lattice-based, same hardware, same workload, scripted and rerunnable.

---

## 12. Cost

Fully buildable at **$0** using free, open-source tooling (circom, snarkjs, Hardhat, scikit-learn, React). Optional polish (custom domain, public testnet deployment, SMS demo feature) adds roughly $10–20 total. No mainnet deployment required or recommended.

---

## 13. Limitations (Stated Upfront, Not Discovered Later)

- Registrar is a prototype-grade credential issuer, not a production identity/PKI system.
- Coercion-resistance and receipt-freeness are out of scope (note: MACI specifically targets this — worth citing as future-work direction rather than re-solving it here).
- "Post-quantum secure" applies specifically to the lattice-based proving track — the classical track, included for benchmarking comparison, is not.
- No formal third-party security audit — appropriate to disclose for a prototype/academic project.
- Novelty claims are scoped to "this specific combination of techniques," not "first ZK voting system" — the space is active and real prior art exists (Semaphore, MACI, ElectAnon, zkVoting, and multiple academic prototypes).

---

## 14. Expected Contribution

A working, benchmarked, open-source prototype demonstrating that post-quantum zero-knowledge proving and ML-based anomaly detection can be integrated into a single voting architecture — with reproducible evidence for every claim made, addressing both the rigor gaps in prior academic proposals and the quantum-security gap in current production-grade ZK voting infrastructure.
