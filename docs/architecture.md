# Architecture

## PQ-ZKVote: Post-Quantum Zero-Knowledge E-Voting with Anomaly Detection

This document describes the system architecture: components, data flow, data model, API surface, deployment topology, and the security model each part is responsible for. It's meant to live at `docs/architecture.md` in the project repository.

---

## 1. Overview

PQ-ZKVote lets a voter prove they are eligible and that their vote is well-formed — without revealing their identity or their vote's content — using a zero-knowledge proof. It supports two interchangeable proving tracks (classical elliptic-curve and lattice-based post-quantum), anchors votes on a blockchain ledger for tamper-evidence, and layers a machine-learning anomaly monitor on top for statistical irregularities that cryptographic verification alone wouldn't catch.

---

## 2. Component Overview

| Component | Responsibility | Key Technology |
|---|---|---|
| Voter client | Generates secret + commitment locally, collects vote choice, builds ZK proof, submits to chain | React + snarkjs (browser) or CLI |
| Admin panel | Lets a registrar/admin create voting events, review and approve pending registrations, open/close elections, view results and anomaly flags | React, admin-only auth (e.g. simple login for the admin, separate from voter flow) |
| Registrar service | Verifies voter eligibility, approves voter commitments, manages the Merkle tree of eligible voters — never generates or sees voter secrets | Python/FastAPI or Node/Express |
| ZK proving — classical track | Defines and proves the "valid vote + valid credential" constraint system | circom + snarkjs (Groth16) |
| ZK proving — post-quantum track | Same constraint system, proved via a lattice-based (Ring-LWE) Σ-protocol | Custom implementation, Python/Rust |
| Smart contract / ledger | On-chain proof verification, vote storage, nullifier registry | Solidity on Hardhat (local/testnet) |
| Tallying service | Aggregates verified votes into a final count | Python/Node script reading contract events |
| Anomaly monitor | Streams vote metadata, flags irregular patterns | Python, scikit-learn IsolationForest |
| Dashboard | Live tally, anomaly alerts, public audit log | React |

---

## 3. System Diagram (Component Flow)

```
                        ┌────────────────┐        ┌────────────────┐
                        │  Voter client   │        │  Admin panel    │
                        │ Generates secret,│        │ Creates events, │
                        │ builds & submits │        │ approves voters │
                        │     proof        │        └────────┬────────┘
                        └────────┬────────┘                 │
                                 │  commitment only          │
                                 └─────────────┬─────────────┘
                                                │
                        ┌───────────────────────▼────────┐
                        │        Registrar service         │
                        │ Approves commitments, builds     │
                        │   the eligible-voters tree        │
                        │  (never sees a voter's secret)    │
                        └────────────────┬─────────────────┘
                                          │
                        ┌────────▼────────┐
                        │  Smart contract  │
                        │ Verifies proof,  │
                        │  logs vote       │
                        └───┬─────────┬───┘
                            │         │
              ┌─────────────▼─┐   ┌───▼───────────────┐
              │ Tallying service│   │  Anomaly monitor   │
              │ Aggregates      │   │  Flags irregular    │
              │ final results   │   │  vote patterns      │
              └─────────┬───────┘   └─────────┬──────────┘
                        │                      │
                        └──────────┬───────────┘
                                   │
                          ┌────────▼────────┐
                          │    Dashboard     │
                          │ Live tally &     │
                          │    alerts        │
                          └─────────────────┘
```

**Color/zone convention** (used in the rendered diagram version): user-facing components (voter client, dashboard) are visually distinct from the backend trust layer (registrar, smart contract, tallying, anomaly monitor) — everything in the trust layer is where the actual verification and security work happens.

---

## 4. Data Flow

### 4.1 Pre-voting phase

**Admin side (once per election):**
1. Admin logs into the admin panel and creates a voting event: name, candidate list, open/close dates.
2. Admin uploads or defines the eligible-voter roster (out of scope: how real-world identity is verified — assume a pre-vetted list, e.g. student/employee IDs).
3. Election event is created in a "pending registration" state.

**Voter side (once per election, before voting opens):**
1. Voter's device generates a random secret **locally** — this never leaves the device.
2. Device computes `commitment = hash(secret)` and sends **only the commitment**, plus their out-of-scope identity proof, to the registrar. The secret itself is never transmitted.
3. Admin reviews the pending registration in the admin panel and approves it (confirming the person is on the eligible roster).
4. On approval, the registrar adds `commitment` as a leaf in the eligible-voters Merkle tree for that election.
5. Voter's device retains the secret locally for use at voting time — it is the only thing needed to vote, and nobody else (not the admin, not the registrar) ever has a copy of it.

This is the important design choice: **the admin approves an identity↔eligibility check, never an identity↔secret mapping.** Nothing server-side ever links a real name to a voting secret, which is what makes the anonymity guarantee hold even if the registrar's database were later compromised.

### 4.2 Voting phase
1. Voter selects a candidate in the client.
2. Client computes a **nullifier**: `hash(credential_secret, election_id)` — this prevents double voting without linking the vote to an identity.
3. Client selects a proving track (classical or post-quantum) and runs the corresponding proof generation locally: proves "I hold a valid credential for this election AND my vote is a valid choice" without revealing the credential secret or the vote value.
4. Client submits `{proof, public_signals, nullifier, encrypted_vote, proof_type}` to the smart contract.
5. Contract verifies the proof using the verifier matching `proof_type`, checks the nullifier hasn't been used, records the vote, and marks the nullifier spent.

### 4.3 Tallying phase
1. Tallying service listens for `VoteRecorded` contract events.
2. Once voting closes, it aggregates all valid votes into per-candidate totals.
3. Final tally is published on-chain (or signed and posted to the dashboard).
4. Anyone can independently re-verify the tally against the public ledger of proofs and events.

---

## 5. Component Details

### Voter client
- Generates the voter's secret locally, on first registration — this value never leaves the device.
- Loads proving artifacts (WASM + zkey for classical; parameter files for lattice-based) client-side.
- Never sends the raw vote or secret over the network — only the commitment (at registration) and the proof + public signals (at voting time) leave the device.
- Displays a receipt hash (of the submission, not the vote choice) so the voter can later verify inclusion.
- **Credential UI** (local key management, not a login flow):
  - Registration screen: collects identity proof, generates secret + commitment locally
  - Status screen: `pending` / `approved` / `rejected`
  - Backup/recovery prompt: mandatory one-time screen (downloadable keyfile or recovery phrase) — a lost secret cannot be reissued by anyone, since no server ever holds a copy; this is a deliberate tradeoff to document, not a bug
  - Post-vote receipt screen: receipt hash + inclusion lookup against the public ledger

### Admin panel
- Admin-only interface (separate auth from the voter flow — a simple login is acceptable for a prototype since the admin isn't part of the anonymity guarantee).
- Creates voting events (name, candidates, open/close dates) and defines the eligible-voter roster.
- Shows a queue of pending voter registrations (commitment + identity proof, never a secret) for the admin to approve or reject.
- Triggers `closeElection()` on the smart contract.
- Displays live results and surfaces anomaly flags for review.

### Registrar service
- Receives voter commitments (never secrets) plus out-of-scope identity proof, holds them pending admin approval.
- On admin approval, adds the commitment as a leaf in the eligible-voters Merkle tree and exposes root/path lookups.
- Explicitly a prototype component, not a production identity system — documented as such in the project's limitations. Its key security property, by design, is that it never has the information needed to de-anonymize a vote, even if compromised.

### ZK proving — classical track
- Circuit constraints: vote-range check, nullifier derivation correctness, Merkle membership proof.
- Groth16 via circom/snarkjs — fast proving, small proof size, mature tooling, but **not** post-quantum secure (relies on elliptic-curve pairing assumptions).

### ZK proving — post-quantum track
- Same three logical constraints, proved via a Fiat-Shamir-transformed Σ-protocol over a Ring-LWE hardness assumption.
- Larger proofs and slower proving/verification than the classical track — this tradeoff is measured, not hidden (see the benchmark suite).

### Smart contract / ledger
- `submitVote(proof, publicSignals, nullifierHash, encryptedVote, proofType)`: routes to the correct verifier, checks nullifier uniqueness, emits `VoteRecorded`.
- `closeElection()`: admin-gated, stops accepting new votes.
- View functions expose the Merkle root and total vote count.

### Tallying service
- Reads `VoteRecorded` events, independently re-verifies each proof rather than trusting the event alone (defense in depth), aggregates results.

### Anomaly monitor
- Consumes a feature vector per vote (timestamp, proof verification latency, submission interval, gas price paid).
- Session/identity-adjacent metadata is hashed or bucketed before use, to avoid the monitor itself becoming a privacy leak.
- IsolationForest flags outliers; flagged votes are **surfaced for review, never auto-rejected** — auto-rejection would let an attacker manufacture false positives to disenfranchise legitimate voters.

### Dashboard
- Live tally, vote count, anomaly alert feed, and a public audit log (transaction hashes and timestamps only — no voter-identifying data).

---

## 6. Data Model

| Entity | Fields | Notes |
|---|---|---|
| `VotingEvent` | `election_id`, `name`, `candidates`, `open_at`, `close_at`, `status` | Created by admin, stored by registrar |
| `RegistrationRequest` | `commitment`, `identity_proof_ref`, `status` (pending/approved/rejected) | Never contains a voter secret; reviewed in the admin panel |
| `Credential` | `voter_commitment`, `election_id`, `registrar_signature` | Held client-side only |
| `Nullifier` | `nullifier_hash`, `used` (bool), `block_number` | Stored on-chain |
| `VoteRecord` | `nullifier_hash`, `encrypted_vote`, `proof_hash`, `proof_type`, `timestamp` | Stored on-chain, publicly readable |
| `AnomalyFlag` | `vote_record_ref`, `anomaly_score`, `feature_snapshot`, `reviewed` (bool) | Stored off-chain in the monitor's database |
| `TallyResult` | `election_id`, `candidate_totals`, `total_votes`, `published_signature` | Published at election close |

No entity in this model links a `VoteRecord` back to a specific voter identity — that property is the point of the whole design.

---

## 7. API Surface

**Registrar service**
```
POST /events                             { name, candidates, open_at, close_at } → { election_id }   [admin-only]
POST /register                           { election_id, commitment, proof_of_identity } → { status: "pending" }
GET  /registrations/:election_id         → [ { commitment, status } ]                                  [admin-only]
POST /registrations/:commitment/approve  → { status: "approved" }                                      [admin-only]
POST /registrations/:commitment/reject   → { status: "rejected" }                                      [admin-only]
GET  /merkle-root/:election_id           → { root }
GET  /merkle-path/:commitment            → { path }
```

Note what's absent: there is no endpoint that accepts or returns a voter's secret — only commitments ever cross the network.

**Smart contract (Solidity)**
```solidity
function submitVote(bytes calldata proof, uint256[] calldata publicSignals,
                     bytes32 nullifierHash, bytes calldata encryptedVote,
                     uint8 proofType) external;
function closeElection() external onlyAdmin;
function getMerkleRoot() external view returns (bytes32);
function getTotalVotes() external view returns (uint256);
```

**Tallying service**
```
GET /tally/:election_id            → { candidate_totals, total_votes, published_at }
```

**Anomaly monitor**
```
GET  /anomalies/:election_id       → [ { vote_ref, score, timestamp, reviewed } ]
POST /anomalies/:id/review         → { reviewed: true }
```

The dashboard consumes the tallying and anomaly-monitor APIs directly — no separate backend layer needed for a prototype.

---

## 8. Deployment Topology

| Environment | Purpose | Setup |
|---|---|---|
| Local dev | Day-to-day development | Hardhat local node, all services on localhost |
| Local integration | End-to-end testing | Docker Compose running registrar + tally + monitor + local chain together |
| Public demo (optional) | Shareable link for presentation/portfolio | Contract on Sepolia testnet, frontend on Vercel/Netlify free tier, services on a free-tier host |

Mainnet deployment is intentionally excluded — there is no reason for a prototype to spend real gas or invite production-level scrutiny it isn't built for.

---

## 9. Security Model

| Threat | Mitigation | Responsible Component |
|---|---|---|
| Double voting | Nullifier uniqueness check | Smart contract |
| Vote content exposure | ZK proof reveals nothing beyond validity; vote value encrypted | Voter client, ZK proving layer |
| Ineligible voter casting a vote | Merkle-tree membership proof, verified in-circuit | ZK proving layer, registrar |
| Tampering with recorded votes | Immutable, publicly verifiable ledger | Smart contract |
| Automated/bot manipulation | Anomaly scoring on submission patterns | Anomaly monitor |
| Classical proof broken by a quantum computer | Post-quantum proving track available as an alternative — explicitly scoped, not claimed for the classical track | ZK proving layer (track selection) |
| Coercion / vote buying | **Out of scope** — named explicitly rather than silently omitted | N/A |
| Compromised or malicious registrar/admin de-anonymizing voters | Admin only ever handles commitments (hashes), never secrets — there is no server-side record capable of linking an identity to a vote, even under full compromise | Voter client (secret generation), registrar |
| Admin account takeover used to approve fraudulent registrations | Admin auth is separate from the voter flow; approved-but-fraudulent commitments are still bound by one-nullifier-per-election, limiting damage to one extra vote per approval, not systemic de-anonymization | Admin panel |

---

## 10. Explicit Non-Goals

- Production-grade identity/PKI system for registration
- Coercion-resistance / receipt-freeness
- Mainnet deployment or real-election use
- Formal third-party security audit
- National-election-scale voter rolls (this architecture is validated at prototype/test scale)

These are documented here — not discovered by a reviewer — deliberately.
