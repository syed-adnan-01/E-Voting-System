# Adversarial Test Cases & Security Boundary Inventory

This inventory documents all 15 security threat scenarios evaluated within the **PQ-ZKVote** post-quantum zero-knowledge e-voting system test suite.

---

## Security Boundary Matrix

| ID | Attack Scenario | Component | Security Boundary | Defense Mechanism | Test Location |
|:---|:---|:---|:---|:---|:---|
| **ADV-01** | Double Voting (Groth16) | Smart Contract | Nullifier Ledger | `nullifiers[nullifierHash] == true` check reverts with `"double vote"` | `security/attack_tests/test_contract_attacks.js` |
| **ADV-02** | Double Voting (PQC Lattice) | Smart Contract / Tally | Nullifier Ledger | On-chain mapping check & off-chain tally audit rejection | `security/attack_tests/test_contract_attacks.js`, `test_service_attacks.js` |
| **ADV-03** | Invalid Merkle Proofs | Circuit / Lattice | Merkle Tree Verifier | Poseidon / SHA3 root mismatch reverts witness generation / verifier | `security/attack_tests/test_protocol_attacks.py`, `fuzz_merkle_proofs.py` |
| **ADV-04** | Forged / Nullifier Proofs | Circuit / Lattice | Nullifier Derivation | `publicSignals[2] == nullifierHash` enforcement; secret pre-image check | `security/attack_tests/test_contract_attacks.js`, `test_protocol_attacks.py` |
| **ADV-05** | Tampered Public Signals | Smart Contract | Public Signal Binding | `publicSignals[0..3]` equality checks against contract state variables | `security/attack_tests/test_contract_attacks.js`, `fuzz_public_signals.py` |
| **ADV-06** | Tampered Encrypted Votes | Cryptography / Tally | Ciphertext Integrity | Ring equation $A^T \cdot z_r + z_{e1} == w_u + c \cdot u$ check fails | `security/threat_tests/test_offchain_tampering.py`, `fuzz_lattice_proofs.py` |
| **ADV-07** | Replay of Old Valid Proof | Smart Contract | Election ID & Nullifier | Election ID binding `publicSignals[0] == electionId` and unique nullifier | `security/attack_tests/test_contract_attacks.js`, `test_protocol_attacks.py` |
| **ADV-08** | Wrong Election ID | Smart Contract | State Verification | Reverts with `"election id mismatch"` on contract submission | `security/attack_tests/test_contract_attacks.js` |
| **ADV-09** | Voting After Election Closure | Smart Contract / Service | Election Lifecycle | `require(electionOpen, "closed")` check reverts post-closure | `security/attack_tests/test_contract_attacks.js`, `test_service_attacks.js` |
| **ADV-10** | Unauthorized Admin Operations | Smart Contract / API | Access Control | `onlyAdmin` modifier on-chain; `x-admin-token` middleware on Express API | `security/attack_tests/test_contract_attacks.js`, `test_service_attacks.js` |
| **ADV-11** | Malicious Registration / Approval | Registrar Service | Input Validation | Admin token authentication & schema validation reject illegal commitments | `security/attack_tests/test_service_attacks.js` |
| **ADV-12** | Manipulated Merkle Root | Smart Contract | Admin Authorization | `setMerkleRoot` restricted to `onlyAdmin`; verifier checks root equality | `security/attack_tests/test_contract_attacks.js`, `test_protocol_attacks.py` |
| **ADV-13** | Malformed PQC Proofs | Lattice Verifier | Rejection Sampling | Rejection bounds $\|z\| \le B$ and challenge $c == \text{sample\_challenge}(H(...))$ | `security/attack_tests/test_protocol_attacks.py`, `fuzz_lattice_proofs.py` |
| **ADV-14** | PQC Proof Replay | Smart Contract / Tally | Proof Hash & Nullifier | On-chain `submitLatticeVote` checks proofHash and nullifier uniqueness | `security/attack_tests/test_contract_attacks.js`, `test_protocol_attacks.py` |
| **ADV-15** | Contract Reentrancy & Access | Smart Contract | Solidity Safety | Checks-Effects-Interactions pattern; zero-address constructor guards | `security/attack_tests/test_contract_attacks.js` |
| **ADV-16** | Registrar Compromise Scenario | System / Registrar | Secret Zero-Knowledge | Registrar never holds voter secret $s_v$; DB leak yields zero vote forging capability | `security/threat_tests/test_registrar_compromise.py` |

---

## Detailed Scenario Breakdown

### ADV-01 & ADV-02: Double Voting Protection
- **Threat**: An attacker or honest voter attempts to cast multiple votes using the same credential or valid proof.
- **Defense**: The smart contract records `nullifiers[nullifierHash] = true` upon first valid submission. Subsequent attempts with the same nullifier revert with `"double vote"`. The tallying service independently enforces nullifier uniqueness.

### ADV-03: Invalid Merkle Proofs
- **Threat**: An unauthorized voter presents a fabricated Merkle path to claim membership in the eligible voter list.
- **Defense**: Poseidon hash (Groth16 track) and SHA3-256 (QRZ-KPA track) verify that the leaf commitment computed from `secret` strictly matches the root. Altered path elements produce root mismatches and fail proof verification.

### ADV-04 & ADV-05: Tampered Public Signals & Forged Nullifiers
- **Threat**: An attacker intercepts a valid proof and modifies `publicSignals` (e.g. changing candidate selection or nullifier hash).
- **Defense**: Groth16 cryptographic verification equation fails if any public signal is modified post-proving. `VotingContract` strictly verifies `bytes32(publicSignals[2]) == nullifierHash` and `publicSignals[1] == merkleRoot`.

### ADV-06 & ADV-13: Malformed & Tampered PQC Proofs
- **Threat**: An attacker attempts to exploit lattice noise vectors or inject invalid response vectors $z_r, z_{e1}, z_{e2}$ that violate rejection bounds.
- **Defense**: `check_rejection_bound()` verifies that all coefficients satisfy $\|z\| \le \text{REJECTION\_BOUND}$. Challenge integrity verification re-computes $c = \text{sample\_challenge}(H(w_u, w_v, C, \text{nullifier}, \dots))$ to prevent polynomial forgery.

### ADV-07 & ADV-08: Cross-Election Proof Replay
- **Threat**: A valid proof from Election A is resubmitted to Election B.
- **Defense**: Nullifiers are computed as `compute_nullifier(credentialSecret, electionId)` and circuit/lattice proofs bind `electionId` into the challenge hash. Replaying across elections causes nullifier and challenge mismatches.

### ADV-09: Post-Closure Voting
- **Threat**: Votes are submitted after an election has officially closed.
- **Defense**: The `VotingContract` checks `require(electionOpen, "closed")` on every vote submission method (`submitVote` and `submitLatticeVote`).

### ADV-10 & ADV-11: Unauthorized Admin & Malicious Registration
- **Threat**: An unauthenticated user attempts to trigger admin endpoints (approving registrations, closing elections, setting Merkle roots).
- **Defense**: Smart contracts enforce `onlyAdmin` modifier (`msg.sender == admin`). Node.js services require valid HTTP header `x-admin-token`.

### ADV-16: Registrar Compromise & Secret Zero-Knowledge
- **Threat**: A hacker leaks the complete Registrar database (`db.json`) containing voter identity records and commitments, or compromises the Registrar `ADMIN_TOKEN`.
- **Defense**: **Core Security Guarantee**: Voters compute commitments locally (`commitment = Poseidon(secret)` / `SHA3-256(secret)`) and send ONLY the commitment hash to the Registrar. The Registrar never holds or stores raw credential secrets. Even with total DB compromise, pre-image resistance prevents secret recovery, and without secrets, the adversary cannot forge Groth16 or QRZ-KPA zero-knowledge proofs.
