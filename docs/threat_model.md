# Threat Model & Security Architecture

## 1. Overview & Trust Model

**PQ-ZKVote** is designed to provide end-to-end verifiable, privacy-preserving e-voting anchored on an immutable blockchain ledger, with dual classical and post-quantum zero-knowledge proving tracks and machine-learning anomaly detection.

This document formalizes the system's adversary model, security properties, trust assumptions, and explicit security boundaries based on the system architecture.

---

## 2. Trust Assumptions

| Entity / Component | Trust Level | Security Rationale |
|---|---|---|
| **Voter Device (Client)** | Untrusted | Generates secret `credential_secret` locally. Computes ZK proof locally; raw votes and credential secrets never leave the voter's device in plaintext. |
| **Admin Panel** | Semi-trusted (Identity verification layer) | Manages election event lifecycle and approves voter registration requests. Approves identity-to-commitment mapping, never identity-to-secret mapping. |
| **Registrar Service** | Semi-trusted (Honest-but-curious) | Maintains the eligible-voters Merkle tree. Trusted to insert commitments only upon admin approval; **never sees voter secrets or vote choices**. |
| **Smart Contract / Ledger** | Untrusted execution environment | Publicly readable, code enforced by EVM consensus. Enforces nullifier uniqueness and proof validity. |
| **Zero-Knowledge Circuit** | Cryptographically trusted | R1CS/Groth16 (classical) and Ring-LWE Σ-protocol (post-quantum) guarantee zero-knowledge privacy and cryptographic soundness. |
| **Anomaly Monitor** | Non-critical security layer | Advisory only; flags suspicious submission patterns without auto-rejecting votes to prevent denial-of-service/disenfranchisement. |

---

## 3. Adversary Models

### A1. Passive Eavesdropper
- **Capabilities**: Monitors network traffic between client, admin panel, registrar, and blockchain node. Can read the public blockchain ledger and event logs.
- **Goal**: De-anonymize voters, deduce candidate choices, or link nullifier hashes to voter identities.
- **Mitigation**: Zero-knowledge proofs conceal vote choice and voter secret; nullifiers are computationally un-linkable to voter commitments (`Poseidon([credential_secret])`).

### A2. Malicious Voter (Insider Attack)
- **Capabilities**: Valid registered voter or attacker attempting to forge credentials, double vote, submit invalid candidate indices, or replay past proofs.
- **Goal**: Cast multiple votes, alter candidate counts, or disrupt election integrity.
- **Mitigation**:
  - Nullifier registry on-chain prevents double voting (`mapping(bytes32 => bool)`).
  - In-circuit vote range check (`vote_value ∈ {0, 1, ..., num_candidates-1}`).
  - In-circuit Merkle path verification proves valid registration.

### A3. Corrupt or Compromised Registrar / Admin
- **Capabilities**: Can inspect registration logs or attempt to alter the Merkle tree.
- **Goal**: Link voter identities to cast votes or inflate voter roll.
- **Mitigation**:
  - Voter secret `credential_secret` is generated strictly client-side and never transmitted. The registrar receives only `commitment = Poseidon([credential_secret])`.
  - Identity verification links a real identity to a public commitment, not a secret. Even if the registrar DB is compromised, de-anonymizing cast votes is cryptographically impossible.

### A4. Quantum-Capable Adversary (Q-Day Scenario)
- **Capabilities**: Possesses a quantum computer capable of running Shor's algorithm (breaking ECDSA and pairing-based cryptography like BN254/Groth16).
- **Goal**: Reconstruct private keys, forge Groth16 proofs, or decrypt past vote payloads.
- **Mitigation**:
  - The post-quantum proving track utilizes lattice-based cryptography (Ring-LWE Σ-protocols) which is quantum-safe.

### A5. Malicious Network / Botnet Operator
- **Capabilities**: Controls multiple nodes/accounts to flood the voting contract, manipulate gas prices, or simulate rapid-fire voting.
- **Goal**: Sybil attack, network congestion, or automated pattern manipulation.
- **Mitigation**:
  - Real-time IsolationForest ML anomaly pipeline monitors submission metadata (latency, gas price, submission intervals) and alerts administrators.

---

## 4. Security Architecture Matrix

| Security Threat | Attack Vector | System Defense | Responsible Layer |
|---|---|---|---|
| **Double Voting** | Submitting multiple proofs with same credential | Unique `nullifierHash` spending lock on-chain | Smart Contract |
| **Identity Disclosure** | Intercepting submission transactions | ZK-SNARK / ZK-STARK proof zero-knowledge property | ZK Proving Layer |
| **Ineligible Voting** | Submitting arbitrary inputs without registration | In-circuit Merkle membership proof | ZK Circuit & Registrar |
| **Invalid Vote Option** | Voting for out-of-range candidate index | Range-check constraints in Circom / Lattice circuit | ZK Circuit |
| **Quantum Proof Forgery** | Shor's algorithm breaking Groth16 pairings | Lattice-based Ring-LWE post-quantum track | PQC Proving Track |
| **Automated Bot Swarms** | Rapid burst submissions | Real-time IsolationForest anomaly detection | Anomaly Monitor |
| **Vote Tampering / Deletion** | Altering recorded vote count | Immutable blockchain ledger execution | Smart Contract |
| **Coercion / Vote Buying** | Voter showing receipt to buyer | **Out of scope** (acknowledged limitation) | N/A |

---

## 5. Scope Boundaries & Non-Goals

1. **Coercion / Vote-Buying Resistance**: The voter client displays a receipt hash for inclusion verification; receipt-freeness (such as MACI state tree key re-registration) is not enforced.
2. **Endpoint Compromise**: Malware or keyloggers controlling the voter's physical machine/browser before proof generation.
3. **PKI Identity Federation**: Real-world government ID verification is simulated via pre-seeded eligibility rosters and admin approval in the admin panel.
