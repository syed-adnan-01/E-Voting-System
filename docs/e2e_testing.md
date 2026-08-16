# Automated End-to-End (E2E) Election Testing & One-Command Demo

**System**: PQ-ZKVote — Post-Quantum Zero-Knowledge E-Voting System  
**Execution Time**: ~8–12 seconds  
**Test Volume**: 100 Voters (50 Groth16 ZK + 50 QRZ-KPA Lattice ZK)  

---

## Overview

The automated end-to-end test suite (`npm run test:e2e` or `./run_demo.sh`) simulates a complete, real-world national election workflow in a single command. It exercises all 10 stages of the PQ-ZKVote pipeline with **zero manual intervention**.

---

## 🔄 End-to-End Workflow Pipeline

```
 ┌───────────────────────────┐
 │ 1. Create Election Event  │  Registrar API POST /events
 └─────────────┬─────────────┘
               │
 ┌─────────────▼─────────────┐
 │ 2. Register 100 Voters    │  Poseidon Commitments (Secrets isolated off-chain)
 └─────────────┬─────────────┘
               │
 ┌─────────────▼─────────────┐
 │ 3. Approve 100 Voters     │  Admin Token Authorization
 └─────────────┬─────────────┘
               │
 ┌─────────────▼─────────────┐
 │ 4. Build Merkle Tree      │  Depth = 10, Root set on VotingContract.sol
 └─────────────┬─────────────┘
               │
 ┌─────────────▼─────────────┐
 │ 5. Cast 100 Dual-Track    │  50 Groth16 (Classical) + 50 QRZ-KPA (Lattice)
 │    Zero-Knowledge Votes   │  Off-chain & On-Chain Proof Verifications
 └─────────────┬─────────────┘
               │
 ┌─────────────▼─────────────┐
 │ 6. Record On-Chain &      │  VotingContract.sol Nullifiers & TotalVotes
 │    Stream Anomaly Metrics │  Tally API POST /record-vote -> Anomaly Server
 └─────────────┬─────────────┘
               │
 ┌─────────────▼─────────────┐
 │ 7. Close Election         │  Registrar API & Smart Contract State Mutation
 └─────────────┬─────────────┘
               │
 ┌─────────────▼─────────────┐
 │ 8. Generate Tally &       │  Tally GET /tally & Audit Log GET /audit-log
 │    Independent Audit      │  Verify 100% Tally Math & Zero-PII Audit Ledger
 └───────────────────────────┘
```

---

## ⚡ Quick Start / Commands

### Execute E2E Test Suite via npm:
```bash
npm run test:e2e
```

### Execute One-Command Demo Shell Script:
```bash
./run_demo.sh
```

---

## 📊 Verification & Audit Metrics

The E2E test script asserts the following mathematical and architectural invariants:
1. **Total Voters**: 100 distinct voters registered and approved.
2. **On-Chain Nullifier Ledger**: 100 unique nullifiers recorded on `VotingContract.sol` with 0 collisions or double-votes.
3. **Dual-Track Proof Distribution**: Exactly 50 Groth16 classical proofs + 50 QRZ-KPA post-quantum lattice proofs verified on-chain.
4. **Tally Accuracy**: 100% vote accumulation across candidates (25 votes for each candidate out of 4).
5. **Zero-PII Compliance**: Audit log contains 100 records with cryptographic nullifiers and transaction hashes, with zero credential secrets or identity metadata.
