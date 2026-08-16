# Zero-Trust Independent Election Verifier (`verifier/verify_election.py`)

The **Independent Election Verifier** is an external verification tool designed to audit elections **without trusting backend operators or database infrastructure**. Anyone (voters, election monitors, independent auditors, media) can query the public ledger, Registrar API, and Tallying service to re-evaluate the full mathematical integrity of an election.

---

## 🛡️ Verification Architecture & Invariants

```
                             ┌─────────────────────────────────┐
                             │  Independent Verifier CLI       │
                             │  verifier/verify_election.py    │
                             └────────────────┬────────────────┘
                                              │
       ┌──────────────────────────────┬───────┴──────────────┬──────────────────────────────┐
       │                              │                      │                              │
       ▼                              ▼                      ▼                              ▼
 ┌──────────────┐             ┌──────────────┐       ┌──────────────┐             ┌────────────────────┐
 │  Registrar   │             │  Tallying    │       │ Smart        │             │ Cryptographic      │
 │  API         │             │  API         │       │ Contract     │             │ Verifiers          │
 └──────────────┘             └──────────────┘       └──────────────┘             └────────────────────┘
```

The verifier enforces 6 critical security invariants:

| # | Verification Invariant | Execution Rule | Expected Result |
|---|------------------------|----------------|-----------------|
| **1** | **Merkle Root Consistency** | Compares Registrar Merkle root against event declaration & Smart Contract state. | `PASS` (Matches on-chain state) |
| **2** | **Nullifier Uniqueness** | Extracts all `nullifier_hash` records from audit log; checks for duplicates. | `PASS` (0 collisions allowed) |
| **3** | **ZK Proof Validity** | Verifies nullifier 32-byte hex bounds and cryptographic signature invariants. | `PASS` (100% valid proofs) |
| **4** | **Post-Close Vote Check** | Validates timestamp of every vote record against election closing time $T_{\text{close}}$. | `PASS` (0 post-closure votes) |
| **5** | **Tally Integrity** | Recalculates candidate counts from raw audit records; checks against published tally. | `PASS` (100% count match) |
| **6** | **Zero-PII Audit Ledger** | Inspects audit records for accidental inclusion of voter secrets or PII. | `PASS` (0 PII leaks) |

---

## ⚡ Usage & CLI Examples

### 1. Default Verification
Verifies Election ID `1` against local service endpoints:
```bash
python verifier/verify_election.py --election 1
```
*(or via npm)*:
```bash
npm run verify:election -- --election 1
```

### 2. Custom Endpoints & JSON Export
Export verification results to a JSON audit artifact:
```bash
python verifier/verify_election.py \
    --election 1 \
    --registrar-url http://localhost:4000 \
    --tally-url http://localhost:4002 \
    --export-json audit_report_election_1.json
```

---

## 📊 Sample Verifier Output

```
============================================================
              INDEPENDENT ELECTION VERIFIER                
============================================================
Target Election ID : 1
Registrar Service  : http://localhost:4000
Tallying Service   : http://localhost:4002
------------------------------------------------------------
Audit Item               Status     Details
------------------------------------------------------------
 Merkle Root Consistency ✓ PASS    Root: 0x1b7201da72494f1e28...
 Nullifier Uniqueness   ✓ PASS    0 duplicates among 100 votes
 Valid ZK Proofs        ✓ PASS    100 / 100 proofs verified
 Post-Close Votes       ✓ PASS    0 votes after closure
 Tally Integrity        ✓ PASS    100% count match (100 votes)
 Zero-PII Audit Ledger  ✓ PASS    0 PII leaks detected
------------------------------------------------------------
 Election Integrity: VERIFIED
============================================================
```

---

## 🧪 Unit Testing

Run the automated test suite for the verifier:
```bash
npm run test:verifier
```
*(Executes Pytest suite testing clean elections, duplicate nullifiers, tally discrepancies, and PII leak detection).*
