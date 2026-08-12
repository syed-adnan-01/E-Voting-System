# Project Limitations & Scope Constraints

## 1. Living Document Purpose

This document tracks known architectural, security, performance, and operational limitations of **PQ-ZKVote**. It is updated throughout each phase of development to maintain an honest account of trade-offs and design boundaries.

---

## 2. Security & Cryptographic Boundaries

### 2.1 Coercion Resistance & Receipt-Freeness (Out of Scope)
- **Constraint**: The voter client generates a submission receipt hash (`keccak256(proof_payload)`), allowing voters to independently verify inclusion on the ledger.
- **Limitation**: Because voters can demonstrate proof of submission, the system is **not coercion-resistant**. A vote-buyer or coercer can demand to observe the submission or receipt.
- **Rationale**: Implementing MACI-style key re-registration adds significant coordinator overhead and complexity that distracts from the core PQC comparison goal.

### 2.2 Classical Track Quantum Vulnerability
- **Constraint**: The classical ZK track uses Groth16 over the `BN254` (alt_bn128) elliptic curve.
- **Limitation**: A quantum adversary operating Shor's algorithm can break the discrete logarithm problem over BN254, forge Groth16 proofs, and break Poseidon hash pre-image properties if quantum security levels are exceeded.
- **Mitigation**: The lattice-based PQC track is provided as an alternative.

---

## 3. System & Infrastructure Limitations

### 3.1 Prototype Registrar & Identity Layer
- **Constraint**: Registration relies on a simplified FastAPI/Express service managing a local Merkle tree.
- **Limitation**: Real-world government e-ID integration (e.g., eIDAS, WebAuthn, passport chip validation) is simulated via pre-seeded eligibility lists and signed authorization tokens.
- **Impact**: Registration security relies entirely on the prototype registrar process.

### 3.2 Post-Quantum On-Chain Verification Gas Costs
- **Constraint**: Lattice-based proofs (Ring-LWE Σ-protocols) require larger vectors, polynomial operations, and matrix multiplications compared to 128-byte Groth16 proofs.
- **Limitation**: Verifying lattice ZK proofs directly inside the EVM incurs substantially higher gas costs, potentially exceeding block gas limits without specialized precompiles or recursive rollup verification.
- **Impact**: Measured and documented in Phase 6 benchmarks.

### 3.3 Anomaly Monitor Advisory Status
- **Constraint**: The IsolationForest anomaly detection model streams submission metrics (timestamps, gas price, latency).
- **Limitation**: Flagged anomalies generate alerts on the admin dashboard but **do not automatically reject votes**.
- **Rationale**: Automatic rejection of anomalous votes introduces a denial-of-service vector where attackers flood suspicious transactions to disenfranchise valid voters.

---

## 4. Benchmarking Limitations (Phase 6)

### 4.1 Cross-Runtime Comparison
- **Constraint**: The classical (Groth16) track is benchmarked in Node.js/WASM, while the lattice (QRZ-KPA) track is benchmarked in pure Python.
- **Limitation**: Timing comparisons between tracks reflect both algorithmic cost and runtime/interpreter overhead differences. A production comparison would implement both tracks in the same language.
- **Mitigation**: The benchmark report explicitly notes this methodology difference and does not claim direct algorithmic equivalence from the raw timing numbers.

### 4.2 Memory Measurement Methodology
- **Constraint**: Classical memory is measured via Node.js `process.memoryUsage().rss` (whole-process RSS), while lattice memory uses Python `tracemalloc` (allocator-level peak).
- **Limitation**: These are not directly comparable — RSS includes runtime overhead, shared libraries, and memory-mapped files. The report marks memory comparisons as reference-only.

### 4.3 Lattice Gas Cost Context
- **Constraint**: The lattice track's on-chain gas cost is lower than Groth16 because the full ring-equation verification (A·z = w + c·t) is performed off-chain by the tallying service.
- **Limitation**: The on-chain lattice contract only checks nullifier uniqueness, Merkle root match, and proof-hash non-emptiness — a weaker on-chain guarantee than Groth16's full pairing-based verification.
- **Impact**: Documented honestly in `benchmarks/report.md` and `contracts/contracts/LatticeVerifier.sol`.

### 4.4 Benchmark Reproducibility
- **Constraint**: All benchmark numbers are produced by `benchmarks/run_benchmarks.py` — no manually entered values.
- **Limitation**: Results will vary across hardware, OS load, and runtime versions. The report includes system information to contextualise results.

---

## 5. Operational & Deployment Scope

- **Network Scope**: Designed for local Hardhat node execution and Sepolia testnet demonstration. **Mainnet deployment is explicitly non-goal.**
- **Scale Horizon**: Evaluated for election sizes up to $N = 10,000$ voters in prototype testing.
