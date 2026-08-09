# QRZ-KPA: Post-Quantum Proving Track — Scheme Documentation

## 1. Source Paper

> Angel Barakka J, G L K Niharika, Arutchelvi Jayaraj  
> **"The Intelligent Quantum-Resistant Zero-Knowledge Proof Algorithm (QRZ-KPA) for E-Voting Blockchain-Based Systems"**  
> 2025 6th International Conference on Control, Communication and Computing (ICCC)  
> DOI: [10.1109/ICCC64910.2025.11077181](https://doi.org/10.1109/ICCC64910.2025.11077181)

This document describes how the QRZ-KPA algorithm from the paper is implemented in the `lattice/` package of this project, alongside the design decisions required to make it a complete, testable ZKP system.

---

## 2. Hardness Assumption

**Module Learning With Errors (M-LWE)**

The scheme's security relies on the computational hardness of M-LWE:  
given a matrix `A` and vector `b = A·s + e` (where `s` is a short secret and `e` is a small error), it is computationally infeasible to recover `s` — even for a quantum computer.

- **Classical hardness**: No polynomial-time classical algorithm is known.
- **Quantum hardness**: Shor's algorithm (which breaks ECDSA/RSA) does not apply to LWE. The best known quantum attack (BKZ/BKZ2) provides at best a square-root speedup, leaving the scheme secure at the same parameter level.

This is the same assumption underlying **CRYSTALS-Kyber (FIPS 203)** and **CRYSTALS-Dilithium (FIPS 204)**, both adopted as NIST PQC standards in 2024.

---

## 3. Algorithm: QRZ-KPA (Paper §II Methodology)

The paper specifies the following construction:

### 3.1 Key Generation

```
pk = (ρ, t₁)     where:
  ρ       ← random 32-byte seed (public)
  A       = NTT(ρ)              — matrix expanded from ρ in NTT domain
  s       ← χ_σ^k              — short secret vector
  e       ← χ_σ^k              — short error vector
  t       = A·s + e             — public key vector
  sk = s
```

### 3.2 Vote Encryption (Paper's Core Formula)

```
"The cipher text C is then computed using the following formula:
 C = A · s' + e' + vote_value"
                                     — Paper §II, verbatim
```

Implementation:
```
s'      ← χ_σ^k                  — fresh randomness per vote
e'      ← χ_σ^k
m_poly  = encode_vote(vote_value) — scaled into ring element
C       = A·s' + e' + m_poly     — ciphertext vector
```

### 3.3 ZKP (Fiat-Shamir Σ-protocol around the encryption)

The paper states: "the ZKP ensures the validity of the encryption by verifying the correctness of the computation … without revealing the vote itself."

To make this a concrete, checkable proof, we apply the standard **Fiat-Shamir transform** (Lyubashevsky 2012) to the encryption:

```
COMMIT:    y ← χ_σ^k,  w = A·y
CHALLENGE: c = SHAKE-256(w ∥ C ∥ nullifier ∥ merkle_root ∥ election_id ∥ num_candidates)
RESPONSE:  z = y + c·s'   [with rejection sampling: restart if ||z||_∞ ≥ B]

VERIFY:    A·z ≡ w + c·(A·s')   (mod q)
           ⟺  A·z ≡ w + c·(C - e' - m)   (mod q)
```

The verifier checks `A·z = w + c·t` (using the public key `t = A·s + e ≈ A·s`) and the Fiat-Shamir challenge consistency.

### 3.4 Three Vote-Validity Constraints (mirrors vote.circom)

| # | Constraint | Classical Track (circom) | QRZ-KPA Track |
|---|---|---|---|
| 1 | Vote range | `LessThan(32)` gadget | `0 ≤ vote_value < numCandidates` checked at encrypt time |
| 2 | Nullifier | `Poseidon(secret, electionId)` | `SHAKE-256(secret ∥ electionId)` — NIST FIPS 202 |
| 3 | Merkle membership | Poseidon-hashed path | SHA3-256-hashed path — NIST FIPS 202 |

---

## 4. Parameter Set

| Parameter | Value | Justification |
|---|---|---|
| `n` (ring dimension) | 256 | Power of 2, required for NTT; matches Kyber-512 |
| `q` (prime modulus) | 3329 | `q ≡ 1 (mod 512)` required for NTT; Kyber-512 standard value |
| `k` (module rank) | 2 | Kyber-512 / NIST Level 1 |
| `σ` (Gaussian std dev) | 1.0 | Within Kyber-512 security margin (≈ centered binomial η=3) |
| `τ` (challenge weight) | 39 | Dilithium-style sparse ternary challenge |
| **Security level** | **NIST Level 1** | **≥ 128-bit quantum security** |

---

## 5. Why SHA3/SHAKE-256 Instead of Poseidon

| Property | Poseidon | SHA3-256 / SHAKE-256 |
|---|---|---|
| SNARK-friendly | ✓ Yes (designed for this) | ✗ No |
| Quantum-safe | ✓ Conjectured (no known attack) | ✓ NIST-standardised (FIPS 202) |
| Standardised | ✗ Academic paper only | ✓ NIST FIPS 202 (2015) |
| Used in classical track | ✓ Required by circom/snarkjs | N/A — not needed in lattice track |
| Used in NTT expansion | N/A | ✓ SHAKE-128 (Kyber XOF, matches paper) |

The lattice track does not use circom/snarkjs and therefore does not need Poseidon's algebraic properties. Using SHA3/SHAKE-256 is strictly more conservative (standardised, peer-reviewed, quantum-safe).

---

## 6. NTT (Number Theoretic Transform)

The paper explicitly specifies:  
> "a matrix (A) is generated in the **Number Theoretic Transform (NTT) domain**"

NTT is the finite-field analogue of the FFT. For polynomials in `Z_q[x]/(x^n+1)`:
- Naive multiplication: O(n²) — too slow for n=256
- NTT multiplication: O(n log n) — the speed advantage of the scheme

Implementation in `lattice/ntt.py` follows FIPS 203 Algorithm 9 (NTT) and Algorithm 10 (NTTInv), using the primitive 512th root of unity `ζ = 17 mod 3329`.

---

## 7. Gas Cost Analysis (On-Chain Verification)

The architecture requires honest documentation of on-chain costs (architecture.md §5, implementation plan §5.3).

### What the `LatticeVerifier.sol` contract does on-chain:
- Checks **nullifier uniqueness** (same as classical track) — cheap O(1)
- Checks **Merkle root match** — cheap O(1)
- Checks **proof type routing** — cheap O(1)

### What it does NOT do on-chain:
- Full NTT-domain polynomial verification (`A·z = w + c·t`)

**Why**: Full NTT on Solidity for n=256, k=2 requires ≈ 512 polynomial multiplications, each costing ~300 gas per multiply → estimated **>5 million gas** per verification, far exceeding practical limits.

### Design: Attested Off-Chain Verification

The polynomial ring equation is verified off-chain by the tallying service (which re-verifies every proof, matching architecture.md §4.3: "re-verifies each proof rather than trusting the event alone"). The on-chain contract enforces the nullifier uniqueness and Merkle root constraints — the two properties that directly prevent double-voting and ineligible voting.

This is an **honest, documented limitation**, not a hidden weakness. Classical Groth16 achieves cheap on-chain verification because pairings are a special structure — lattice schemes do not have an equivalent compact verifier. This is one of the real-world tradeoffs the benchmark suite (Phase 6) measures.

---

## 8. Anomaly Detection Integration

The paper (§II) specifies this feature vector for each vote submission:
```
{ hashed_voter_id, encrypted_vote, validity_of_ZKP,
  timestamp, voting_token, public_key, recomputed_vote_value }
```

In this implementation:
- `hashed_voter_id` → `SHA3-256(nullifier)[:16]` — privacy-preserving ID
- `encrypted_vote`  → `SHA3-256(serialised C)` — hash of ciphertext for anomaly features
- `validity_of_ZKP` → `get_zkp_validity_flag(proof)` from `lattice/verify.py` (1=valid, 0=invalid)
- `timestamp`       → Unix timestamp at submission
- `voting_token`    → `nullifier[:8]` hex — anonymous session token
- `public_key`      → `SHA3-256(pk['rho'])[:8]` — election key fingerprint
- `recomputed_vote_value` → verifier's decoded vote range (not the raw value — privacy preserved)

---

## 9. Explicit Limitations

1. **On-chain polynomial verification is not implemented** — documented above.
2. **Proof size is larger** than Groth16: a lattice proof contains two k-vectors of N-polynomials (w, z) plus a challenge polynomial (≈ 256×2×2×2 + 256×2 bytes ≈ 2.5 KB vs. Groth16's ≈ 256 bytes). Measured in Phase 6.
3. **Proving time** is slower than Groth16 on a CPU (no hardware acceleration). Measured in Phase 6.
4. **The hash functions used (SHA3/SHAKE-256) differ from the classical track (Poseidon)** — the nullifier and Merkle root values are NOT interchangeable between tracks. This is the correct design for two independently verified systems benchmarked head-to-head.
