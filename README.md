# PQ-ZKVote: Intelligent Post-Quantum Zero-Knowledge E-Voting System

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero-Knowledge](https://img.shields.io/badge/ZK-Groth16%20%2B%20QRZ--KPA%20Lattice-purple)](#architecture)
[![Anomaly Detection](https://img.shields.io/badge/AI-IsolationForest-green)](#anomaly-detection)

**PQ-ZKVote** is a dual-track zero-knowledge e-voting framework combining classical Groth16 zk-SNARKs and lattice-based Post-Quantum Cryptography (PQC) with an unsupervised Isolation Forest AI anomaly detection pipeline.

---

## 🏛️ System Architecture Overview

```
                                  ┌───────────────────────────┐
                                  │      Admin Panel          │
                                  │   (Event & Tree Mgmt)     │
                                  └─────────────┬─────────────┘
                                                │
┌──────────────────────────┐      ┌─────────────▼─────────────┐      ┌──────────────────────────┐
│      Voter Client        │─────►│     Registrar Service     │      │   Ethereum Ledger        │
│  (Secret Gen & Prover)   │      │ (Merkle Tree & Commitments)│      │  (VotingContract.sol)    │
└────────────┬─────────────┘      └───────────────────────────┘      └────────────┬─────────────┘
             │                                                                    │
             │   1. Groth16 / QRZ-KPA Proof Submission                            │
             └────────────────────────────────────────────────────────────────────┼────────────────┐
                                                                                  │                │
                                                                                  ▼                ▼
                                                                        ┌──────────────────┐ ┌─────────────┐
                                                                        │ Tallying Service │ │ Live AI     │
                                                                        │ (Aggregation)    │ │ Anomaly     │
                                                                        └────────┬─────────┘ │ Monitor     │
                                                                                 │           └──────┬──────┘
                                                                                 ▼                  ▼
                                                                        ┌──────────────────────────────────┐
                                                                        │    Live Election Dashboard       │
                                                                        │  (Tally, Alerts & Audit Log)     │
                                                                        └──────────────────────────────────┘
```

---

## 🚀 Key Features

1. **Dual-Track Zero-Knowledge Proving System**:
   - **Classical Track**: Groth16 zk-SNARKs (`circuits/vote.circom`) proving Merkle tree membership, vote range validity, and nullifier uniqueness in ~12ms proving time.
   - **Post-Quantum Track**: QRZ-KPA Ring-LWE lattice-based ZK protocol (`lattice/`) providing quantum resistance against Shor's algorithm (NIST Security Level 1).
2. **On-Chain Ledger & Verifiers**:
   - Hardhat-managed Solidity smart contract (`contracts/VotingContract.sol`) enforcing nullifier uniqueness and proof verification on Ethereum Virtual Machine.
3. **Privacy-Preserving Registrar**:
   - Voters register anonymously using `Poseidon(secret)` commitments. **Raw voter secrets never leave the client device**.
4. **AI-Powered Anomaly Detection**:
   - Real-time `IsolationForest` ML pipeline (`anomaly/server.py`) evaluating vote submission telemetry (latency, gas price, submission intervals) to surface potential attacks without auto-rejecting valid votes.
5. **Real-Time Live Dashboard**:
   - High-aesthetic dark-mode dashboard (`dashboard/`) showing live vote tallies, proof system breakdown, real-time anomaly alert feed, and zero-PII audit logs.

---

## 💻 Prerequisites & Setup

### Requirements
- **Node.js**: v18.0+
- **Python**: 3.10+
- **Circom & SnarkJS**: `npm install -g circom snarkjs`

### Installation

1. Clone repository:
   ```bash
   git clone https://github.com/syed-adnan-01/E-Voting-System.git
   cd E-Voting-System
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

3. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

---

## 🏃 Running the Services

Launch each core component in separate terminal windows or as background services:

| Component | Command | Endpoint | Description |
| :--- | :--- | :--- | :--- |
| **Registrar Service** | `npm run start:registrar` | `http://localhost:4000` | Handles commitment registration & Merkle path queries |
| **Tallying Service** | `npm run start:tally` | `http://localhost:4002` | Vote aggregation & public zero-PII audit log |
| **Live Anomaly AI Monitor** | `npm run start:anomaly` | `http://localhost:8000` | Real-time IsolationForest anomaly detection API |
| **Live Dashboard** | `npm run start:dashboard` | `http://localhost:5000` | Real-time web UI dashboard |
| **Admin Panel** | Open `admin/index.html` in browser | `file:///.../admin/index.html` | Election creation & voter registration approval |
| **Voter Client** | Open `client/index.html` in browser | `file:///.../client/index.html` | Voter local secret generation, ballot & proof creation |

---

## 🧪 Testing & Verification

Execute the test suites for each phase:

```bash
# Test classical Circom ZK circuits
npm run test:circuits

# Test Hardhat smart contracts (Groth16 & Lattice verifiers)
npm run test:contracts

# Test Phase 3 Registrar & Voter client integration
npm run test:phase3

# Test Phase 7 Tallying service & audit log
npm run test:phase7

# Test Phase 7 Python live anomaly detection API
pytest test/test_phase7_anomaly.py

# Test QRZ-KPA Lattice PQC proving system
pytest test/test_lattice.py

# Test Anomaly IsolationForest ML training & evaluation
pytest test/test_anomaly.py
```

---

## 📊 Classical vs. PQC Benchmarks

Run the comparative benchmarking suite to measure proof generation time, verification latency, proof size, and gas costs:

```bash
# Run quick benchmark suite (5 iterations per track)
npm run benchmark:quick

# Run full benchmark suite (100 iterations per track)
npm run benchmark
```

*Benchmark results are exported to `benchmarks/results.csv` and documented in `benchmarks/report.md`.*

---

## 📄 Documentation

- [Architecture Specification](architecture.md)
- [Implementation Plan](PQ_ZKVote_Implementation_Plan.md)
- [Post-Quantum Scheme Specification](docs/pqc_scheme.md)
- [Threat Model & Security Assumptions](docs/threat_model.md)
- [Anomaly Detection Methodology](docs/anomaly_methodology.md)
- [System Limitations & Coercion Resistance](docs/limitations.md)

---

## 📜 License

MIT License. See [LICENSE](LICENSE) for details.
