# Related Work & Theoretical Grounding

## 1. Introduction

Electronic voting (e-voting) systems require balancing two fundamentally opposing properties: **voter privacy** (no one can determine how an individual voted) and **universal verifiability** (anyone can verify that all votes were counted correctly and no invalid votes were included).

Zero-knowledge proofs (ZKPs) and blockchain ledgers have emerged as the leading paradigm to resolve this tension. **PQ-ZKVote** builds upon key insights from classical ZK voting protocols while addressing their critical vulnerability: reliance on quantum-vulnerable pairing cryptography.

---

## 2. Comparative Analysis of Existing Frameworks

| System | ZK Proof Paradigm | Privacy Mechanism | Post-Quantum Security | Anomaly Detection | Primary Limitations |
|---|---|---|---|---|---|
| **Semaphore** | Classical Groth16 / Plonk (BN254) | Merkle Tree membership + Nullifiers | ❌ No (Elliptic Curve Discrete Log) | ❌ None | Relies on trusted setup per circuit; vulnerable to quantum forgery. |
| **MACI** | Classical Groth16 / Plonk | State tree + Coordinator key re-keying | ❌ No (Pairing-based ZK) | ❌ None | High coordinator trust assumption; heavy state tree update gas costs. |
| **ElectAnon** | Linkable Ring Signatures | Ring signature nullifiers | ❌ No (RSA/ECC signatures) | ❌ None | Ring sizes scale linearly with voter anonymity set, limiting efficiency. |
| **zkVoting** | Bulletproofs / Groth16 | Pedersen Commitments | ❌ No (ECC assumptions) | ❌ None | Verification gas costs on EVM scale poorly without SNARK wrappers. |
| **PQ-ZKVote** | Dual Track: Groth16 (Classical) + Ring-LWE (Lattice PQC) | Merkle Tree membership + Poseidon / Lattice Nullifiers | ✅ Yes (Post-Quantum Track) | ✅ Yes (IsolationForest ML) | Larger proof sizes and higher gas costs on the post-quantum track. |

---

## 3. Detailed Literature Review

### 3.1 Semaphore Protocol
**Overview**: Semaphore is a zero-knowledge privacy layer built on Ethereum using Circom and Groth16. Users prove membership in a Merkle tree of identity commitments without revealing which identity belongs to them. A unique nullifier hash is derived per signal/election to prevent double signaling.
**Relevance to PQ-ZKVote**: PQ-ZKVote's classical proving track adopts Semaphore's core structural logic (Merkle membership + Poseidon nullifier derivation), providing a mature benchmark baseline.

### 3.2 MACI (Minimum Anti-Collusion Infrastructure)
**Overview**: Developed by the Ethereum Foundation, MACI adds coercion resistance to zero-knowledge voting. Voters submit encrypted vote choices to a central coordinator. If coerced, a voter can issue a command to change their public key, rendering previously bought votes invalid.
**Relevance to PQ-ZKVote**: MACI illustrates the tradeoff between anti-coercion and system complexity. PQ-ZKVote intentionally scopes out coercion resistance to focus on post-quantum proof comparison and anomaly detection.

### 3.3 Post-Quantum Zero-Knowledge Proofs (Lattice Cryptography)
**Overview**: Recent cryptographic advances (e.g., Stern's protocol, lattice Σ-protocols over Ring-LWE / Module-LWE like Dilithium-like ZK variants) allow proving knowledge of secrets satisfying linear and range constraints without elliptic curves.
**Relevance to PQ-ZKVote**: PQ-ZKVote implements a Ring-LWE-based proving track to demonstrate post-quantum resistance for voter eligibility and vote validity.

---

## 4. Paper Claims vs. Implementation Gaps

Existing academic proposals for post-quantum e-voting often present theoretical constructions without full implementation artifacts. Below is a summary of claims versus gaps addressed by PQ-ZKVote:

| Theoretical Claim | Typical Academic Gap | PQ-ZKVote Implementation Solution |
|---|---|---|
| *"Lattice ZKPs enable quantum-safe e-voting"* | Lacks concrete EVM smart contract verifier or gas analysis | Implements concrete lattice verifier scripts & Hardhat gas reporting suite |
| *"Machine learning detects voting anomalies"* | Tested on static offline CSVs without real-time streaming pipelines | Implements an IsolationForest model integrated with streaming vote metadata |
| *"Classical ZK is fast while PQC is secure"* | Rarely evaluated side-by-side on identical hardware and election parameters | Provides a unified benchmark suite measuring proof time, verification time, size, and gas side-by-side |
