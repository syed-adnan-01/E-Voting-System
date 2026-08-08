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

## 4. Operational & Deployment Scope

- **Network Scope**: Designed for local Hardhat node execution and Sepolia testnet demonstration. **Mainnet deployment is explicitly non-goal.**
- **Scale Horizon**: Evaluated for election sizes up to $N = 10,000$ voters in prototype testing.
