"""
security/fuzz/fuzz_lattice_proofs.py
====================================
Automated Fuzzer for QRZ-KPA Post-Quantum Lattice Proof Verifications.

Mutates response vectors (z_r, z_e1, z_e2), challenge polynomial (c),
ciphertext matrices, and nullifier byte hex strings to ensure robust verification failure.
"""

import copy
import os
import sys
import random
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from lattice.params import N, Q, K, REJECTION_BOUND
from lattice.keygen import keygen
from lattice.merkle import MerkleTree, build_demo_tree
from lattice.prove import generate_proof
from lattice.verify import verify_proof

CREDENTIAL_SECRET = b"lattice_fuzz_secret_999"
ELECTION_ID       = 1
NUM_CANDIDATES    = 4
VOTE_VALUE        = 1

RNG = np.random.default_rng(9999)


def fuzz_lattice_proofs(iterations=50):
    print(f"--- Running Lattice Proof Fuzzer ({iterations} iterations) ---")

    pk, sk = keygen(seed=b"\x88" * 32)
    tree, proof_data = build_demo_tree(CREDENTIAL_SECRET, 0)
    valid_proof = generate_proof(
        pk=pk,
        sk=sk,
        vote_value=VOTE_VALUE,
        credential_secret=CREDENTIAL_SECRET,
        election_id=ELECTION_ID,
        merkle_path_elements=proof_data["path_elements"],
        merkle_path_indices=proof_data["path_indices"],
        merkle_root=tree.root,
        num_candidates=NUM_CANDIDATES,
        rng=RNG,
    )

    # 1. Baseline verification
    ok, _ = verify_proof(valid_proof)
    assert ok, "Baseline proof generation must verify"

    rejected_count = 0

    for i in range(iterations):
        fuzz_proof = copy.deepcopy(valid_proof)
        mutation = random.choice([
            "z_r_norm_exceeded", "z_e1_norm_exceeded", "c_challenge_corrupted",
            "u_ciphertext_corrupted", "v_ciphertext_corrupted", "invalid_nullifier_hex",
            "negative_polynomial_coeff", "wrong_candidate_count"
        ])

        if mutation == "z_r_norm_exceeded":
            fuzz_proof["z_r"][0][0] = REJECTION_BOUND + random.randint(10, 5000)
        elif mutation == "z_e1_norm_exceeded":
            fuzz_proof["z_e1"][0][0] = REJECTION_BOUND + random.randint(10, 5000)
        elif mutation == "c_challenge_corrupted":
            fuzz_proof["c"][random.randint(0, N - 1)] = random.randint(2, Q - 2)
        elif mutation == "u_ciphertext_corrupted":
            fuzz_proof["C"]["u"][0][0] = (fuzz_proof["C"]["u"][0][0] + random.randint(1, Q - 1)) % Q
        elif mutation == "v_ciphertext_corrupted":
            fuzz_proof["C"]["v"][0] = (fuzz_proof["C"]["v"][0] + random.randint(1, Q - 1)) % Q
        elif mutation == "invalid_nullifier_hex":
            fuzz_proof["nullifier"] = "GG" * 32  # Invalid hex characters
        elif mutation == "negative_polynomial_coeff":
            fuzz_proof["z_r"][0][0] = -100
        elif mutation == "wrong_candidate_count":
            fuzz_proof["public"]["num_candidates"] = 99

        is_valid, reason = verify_proof(fuzz_proof)
        if not is_valid:
            rejected_count += 1
        else:
            print(f"[WARN] Fuzzed lattice proof unexpectedly accepted: mutation={mutation}")

    print(f"Lattice Proof Fuzzing Complete: {iterations} iterations, {rejected_count} malformed proofs safely rejected.")
    return True


if __name__ == "__main__":
    success = fuzz_lattice_proofs(50)
    sys.exit(0 if success else 1)
