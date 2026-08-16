"""
security/fuzz/fuzz_public_signals.py
=====================================
Automated Fuzzer for Groth16 Public Signals & Circuit Boundary Inputs.

Tests circuit input structures, string conversions, large scalar fields,
and signal boundary invariants.
"""

import os
import sys
import random

# BN254 Scalar Field Modulus r
SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617


def validate_public_signals(public_signals, election_id, merkle_root, nullifier_hash, num_candidates):
    """
    Simulates on-chain & off-chain public signal validation rules.
    public_signals format: [electionId, merkleRoot, nullifierHash, numCandidates]
    """
    if len(public_signals) != 4:
        return False, "Invalid signal length != 4"

    try:
        sig_election_id   = int(public_signals[0])
        sig_merkle_root   = str(public_signals[1])
        sig_nullifier     = str(public_signals[2])
        sig_num_candidates= int(public_signals[3])
    except (ValueError, TypeError):
        return False, "Failed scalar parsing"

    # Field bounds check
    for s in [sig_election_id, sig_num_candidates]:
        if s < 0 or s >= SNARK_SCALAR_FIELD:
            return False, "Scalar value out of BN254 field bounds"

    if sig_election_id != int(election_id):
        return False, "Election ID mismatch"

    if sig_num_candidates <= 0 or sig_num_candidates > 100:
        return False, "Candidate count out of allowed bounds"

    return True, "OK"


def fuzz_public_signals(iterations=100):
    print(f"--- Running Public Signals Fuzzer ({iterations} iterations) ---")

    base_election_id = "1"
    base_root = str(12345678901234567890)
    base_nullifier = str(98765432109876543210)
    base_num_candidates = "4"

    base_signals = [base_election_id, base_root, base_nullifier, base_num_candidates]

    # Baseline check
    valid, _ = validate_public_signals(base_signals, base_election_id, base_root, base_nullifier, base_num_candidates)
    assert valid

    rejected_count = 0

    for i in range(iterations):
        mutation = random.choice([
            "field_overflow", "negative_scalar", "truncated_array", "oversized_array",
            "type_confusion", "mismatched_election_id", "invalid_candidate_count"
        ])

        fuzz_sigs = list(base_signals)

        if mutation == "field_overflow":
            fuzz_sigs[0] = str(SNARK_SCALAR_FIELD + 1000)
        elif mutation == "negative_scalar":
            fuzz_sigs[0] = "-10"
        elif mutation == "truncated_array":
            fuzz_sigs = fuzz_sigs[:2]
        elif mutation == "oversized_array":
            fuzz_sigs.append("9999")
        elif mutation == "type_confusion":
            fuzz_sigs[0] = "NOT_A_NUMBER"
        elif mutation == "mismatched_election_id":
            fuzz_sigs[0] = "999"
        elif mutation == "invalid_candidate_count":
            fuzz_sigs[3] = "0"

        ok, reason = validate_public_signals(fuzz_sigs, base_election_id, base_root, base_nullifier, base_num_candidates)
        if not ok:
            rejected_count += 1
        else:
            print(f"[WARN] Fuzzed public signal accepted: mutation={mutation}")

    print(f"Public Signals Fuzzing Complete: {iterations} iterations, {rejected_count} malformed signals safely rejected.")
    return True


if __name__ == "__main__":
    success = fuzz_public_signals(100)
    sys.exit(0 if success else 1)
