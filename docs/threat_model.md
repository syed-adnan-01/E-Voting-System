# Threat Model & Security Architecture

## 1. Overview & Trust Model

**PQ-ZKVote** is designed to provide end-to-end verifiable, privacy-preserving e-voting anchored on an immutable blockchain ledger, with dual classical and post-quantum zero-knowledge proving tracks and machine-learning anomaly detection.

This document formalizes the system's adversary model, security properties, trust assumptions, and explicit security boundaries.

---

## 2. Trust Assumptions

| Entity / Component | Trust Level | Security Rationale |
|---|---|---|
| **Voter Device (Client)** | Untrusted | Proof generation occurs locally; raw votes and credentials never leave the voter's device in plaintext. |
| **Registrar Service** | Semi-trusted (Honest-but-curious) | Trusted to issue credentials only to eligible voters; **not trusted** with vote secrecy or linking cast votes to voter identities. |
| **Smart Contract / Ledger** | Untrusted execution environment | Publicly readable, code enforced by consensus. Assumed to execute EVM byte-code deterministically. |
| **Zero-Knowledge Circuit** | Cryptographically trusted | Underpinning mathematics (R1CS/Groth16 for classical, Ring-LWE Σ-protocol for lattice) ensure zero-knowledge and soundness. |
| **Anomaly Monitor** | Non-critical security layer | Advisory only; flags suspicious patterns without auto-rejecting votes to prevent denial-of-service/disenfranchisement attacks. |

---

## 3. Adversary Models

### A1. Passive Eavesdropper
- **Capabilities**: Monitors all network traffic between voter client, registrar, and blockchain node. Can read the public blockchain ledger and all event logs.
- **Goal**: De-anonymize voters, deduce specific candidate choices, or link nullifier hashes to voter identities.
- **Mitigation**: Zero-knowledge proofs conceal vote value and secret credential; encrypted votes hide raw choice; nullifiers are computationally un-linkable to voter commitments.

### A2. Malicious Voter (Insider Attack)
- **Capabilities**: Valid registered voter or attacker attempting to forge credentials, double vote, submit invalid vote values (outside range), or replay past proofs.
- **Goal**: Cast multiple votes, alter candidate counts, or disrupt election integrity.
- **Mitigation**:
  - Nullifier registry on-chain prevents double voting (`mapping(bytes32 => bool)`).
  - In-circuit vote range check (`vote_value ∈ {0, 1, ..., num_candidates-1}`).
  - In-circuit Merkle path verification proves valid registration.

### A3. Corrupt or Compromised Registrar
- **Capabilities**: Can issue valid voter credentials to non-eligible entities or inspect registration logs.
- **Goal**: Link voter identities to cast votes or inflate voter roll.
- **Mitigation**:
  - Credentials contain only a public commitment (`Poseidon(credential_secret)`). The secret key is generated client-side.
  - The registrar never sees `credential_secret` or `nullifier`, rendering identity-to-vote linking mathematically impossible even for a fully compromised registrar.

### A4. Quantum-Capable Adversary (Q-Day Scenario)
- **Capabilities**: Possesses a fault-tolerant quantum computer capable of running Shor's algorithm (breaking ECDSA, pairing-based cryptography like BN254/Groth16).
- **Goal**: Reconstruct private keys, forge Groth16 proofs, or decrypt past vote payloads.
- **Mitigation**:
  - The post-quantum proving track utilizes lattice-based cryptography (Ring-LWE Σ-protocols) which is resistant to Shor's and Grover's algorithms.

### A5. Malicious Network / Botnet Operator
- **Capabilities**: Controls multiple nodes/accounts to flood the voting contract, manipulate gas prices, or simulate rapid-fire voting.
- **Goal**: Sybil attack, network congestion, or automated pattern manipulation.
- **Mitigation**:
  - IsolationForest ML anomaly pipeline streams submission metadata (latency, gas price, submission intervals) and alerts election administrators.

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

The following threats are explicitly **out of scope** for this prototype architecture:
1. **Coercion / Vote-Buying Resistance**: The voter client displays a receipt hash for inclusion verification; receipt-freeness (such as coercion-resistant MACI state trees) is not enforced.
2. **Endpoint Compromise**: Keyloggers or malware directly controlling the voter's physical machine/browser before proof generation.
3. **PKI Identity Federation**: Real-world government ID verification is simulated via pre-seeded eligibility lists for prototype testing.
