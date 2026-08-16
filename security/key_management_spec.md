# Security Specification — Vote Encryption & Key Governance

This document details the security model, cryptographic primitives, and threat resilience for vote encryption and key management in **PQ-ZKVote**.

---

## 🛡️ Threat Model & Trust Assumptions

| Threat Scenario | Mitigation Strategy | Security Invariant |
|-----------------|---------------------|--------------------|
| **Malicious Admin / Server Compromise** | $k$-of-$n$ Shamir Secret Sharing prevents single-point decryption. | Admin cannot decrypt votes without $k$ trustee key shares. |
| **Early Tally Leak / Partial Results** | Time-locked decryption rejects decryption requests when `status == active`. | Decryption blocked until $T \ge T_{\text{close}}$. |
| **Individual Voter Profiling** | Votes decrypted in batch mode; identity replaced by ZK nullifier $H(S, \text{id})$. | Zero PII exposure; voter choice decoupled from identity. |
| **Post-Quantum Cryptanalysis** | Hybrid encryption scheme using PQC Kyber-768 + ECIES ElGamal. | 128-bit quantum security margin. |
| **Manipulated Tally Output** | Zero-Knowledge proofs logged on ledger; re-verified by Independent Verifier. | Tally math publicly auditable and verifiable. |

---

## 🔑 Cryptographic Scheme Parameters

- **Prime Field**: $\mathbb{F}_p$ where $p = 2^{256} - 189$ (256-bit prime).
- **Generator**: $g = 2$.
- **Asymmetric Encryption**: ElGamal / ECIES $C = (c_1, c_2) = (g^r \bmod p, m \cdot y^r \bmod p)$.
- **Threshold Scheme**: Shamir Secret Sharing polynomial $f(x) = \sum_{i=0}^{k-1} a_i x^i \pmod p$.
- **Decryption Rule**: $m = c_2 \cdot (c_1^{sk})^{-1} \pmod p$.

---

## 🧪 Verification & Audit Tools

- Key Management Engine: `crypto/key_manager.py`
- Test Suite: `test/test_key_management.py` (`npm run test:keys`)
- Independent Verifier: `verifier/verify_election.py` (`npm run verify:election`)
