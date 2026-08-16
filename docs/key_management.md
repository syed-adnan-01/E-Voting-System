# Vote Encryption & Key Management Specification (PQ-ZKVote)

This document formalizes the **Cryptographic Key Management & Vote Encryption Architecture** for the **PQ-ZKVote** system. It specifies key generation, threshold key sharing, time-locked decryption, individual privacy guarantees, and independent verification.

---

## 🔑 Key Lifecycle Architecture

```
                              [ Election Setup ]
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
  Publish Public Encryption Key                 Split Private Key sk_election
  pk_election → Registrar API                   into n Trustee Shares (k-of-n)
                │                                             │
                ▼                                             ▼
  Voters encrypt choices locally                 Trustees hold key shares
  C = Encrypt(vote, pk_election)                (No single entity has sk)
                │                                             │
                └──────────────────────┬──────────────────────┘
                                       │
                            [ Election Closes ]
                                       │
                                       ▼
                       Trustees submit k threshold shares
                                       │
                                       ▼
                       Time-locked Tally Decryption
                      C_batch → Aggregated Candidate Totals
                                       │
                                       ▼
                       Independent Verifier Audits Tally
```

---

## 📋 Comprehensive Cryptographic Governance Matrix

### 1. Who generates encryption keys?
- **Specification**: At election initialization, an asymmetric Post-Quantum Hybrid (Kyber-768 + ECIES ElGamal) keypair $(pk_{\text{election}}, sk_{\text{election}})$ is generated in ephemeral secure memory by the Key Management Engine (`crypto/key_manager.py`).
- **Public Key Distribution**: The public key $pk_{\text{election}}$ is published on the Registrar API (`GET /events/:id/public-key`) and stored on-chain in `VotingContract.sol`.

### 2. Who holds the private key?
- **Specification**: No single administrator or server holds the complete private key $sk_{\text{election}}$.
- **Threshold Model**: $sk_{\text{election}}$ is split into $n$ key shares using **$k$-of-$n$ Shamir Secret Sharing** over a 256-bit prime field $\mathbb{F}_p$.
- **Trustee Allocation**: Key shares are assigned to $n$ independent Tally Trustees (e.g., election officials, multi-party scrutineers, neutral civil auditors). Reconstructing $sk_{\text{election}}$ requires a quorum of at least $k$ trustees.

### 3. When can decryption happen?
- **Specification**: Decryption is **time-locked** and programmatically enforced.
- **Enforcement Rule**: The Tallying Service rejects all decryption attempts while `election.status == "active"`. Decryption is strictly permitted only after:
  1. Current time $T \ge T_{\text{close}}$.
  2. Smart contract emits `ElectionClosed` event on-chain.
  3. $k$ valid trustee key shares are submitted to the Tallying Service.

### 4. How is the key protected?
- **Specification**:
  - **Memory Sanitization**: Un-split private key $sk_{\text{election}}$ is wiped from system RAM immediately following Shamir polynomial generation.
  - **Hardware Isolation**: Trustee key shares are stored in Hardware Security Modules (HSMs) or Secure Enclaves (AWS Nitro / SGX).
  - **Collusion Resistance**: An adversary must compromise at least $k$ distinct trustee entities to reconstruct $sk_{\text{election}}$.

### 5. Can the administrator decrypt individual votes?
- **Specification**: **No.** Individual voter choices cannot be linked to voter identities or decrypted individually.
- **Anonymity Protections**:
  - Voter identity is replaced by Poseidon zero-knowledge nullifiers $H(S, \text{election\_id})$.
  - Votes are decrypted exclusively in **batch aggregated mode** ($C_{\text{batch}}$) with mix-net shuffle ordering.
  - Even if an malicious admin obtains $k$ trustee key shares, the public ledger contains only unlinked nullifiers and encrypted payloads.

### 6. How is tally correctness independently verified?
- **Specification**: Tally correctness does not rely on backend trust.
- **Independent Verification**: Anyone can run `python verifier/verify_election.py --election <id>` to:
  1. Re-evaluate Groth16 pairings and QRZ-KPA Lattice ring equations $\|z\|_\infty \le B$.
  2. Verify 0 duplicate nullifiers on-chain.
  3. Recalculate candidate vote totals from raw audit log entries to ensure 100% mathematical match against the published tally.

---

## ⚡ Code Integration Reference

- **Key Manager Implementation**: `crypto/key_manager.py`
- **Unit Tests**: `test/test_key_management.py`
- **NPM Test Command**: `npm run test:keys`
