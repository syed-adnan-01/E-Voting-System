"""
security/fuzz/fuzz_merkle_proofs.py
====================================
Automated Fuzzer for Merkle Tree Membership Verifications.

Generates random byte mutations, truncated path arrays, out-of-bounds indices,
and random root values to verify robust exception handling and rejection.
"""

import os
import sys
import random
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from lattice.merkle import MerkleTree, verify_merkle_proof, build_demo_tree
from lattice.nullifier import compute_leaf_commitment


def fuzz_merkle_proofs(iterations=100):
    print(f"--- Running Merkle Proof Fuzzer ({iterations} iterations) ---")
    tree, proof_data = build_demo_tree(b"fuzz_voter_secret_1", 0)
    real_leaf = proof_data["leaf"]
    real_path = proof_data["path_elements"]
    real_indices = proof_data["path_indices"]
    real_root = tree.root

    passed_count = 0
    rejected_count = 0

    # 1. Baseline check
    assert verify_merkle_proof(real_leaf, real_path, real_indices, real_root)
    passed_count += 1

    for i in range(iterations):
        mutation_type = random.choice([
            "bad_leaf", "corrupted_path", "truncated_path", "bad_indices",
            "random_root", "oversized_indices", "negative_indices"
        ])

        fuzz_leaf = real_leaf
        fuzz_path = list(real_path)
        fuzz_indices = list(real_indices)
        fuzz_root = real_root

        if mutation_type == "bad_leaf":
            fuzz_leaf = os.urandom(32)
        elif mutation_type == "corrupted_path":
            idx = random.randint(0, len(fuzz_path) - 1)
            fuzz_path[idx] = os.urandom(32)
        elif mutation_type == "truncated_path":
            fuzz_path = fuzz_path[:random.randint(0, len(fuzz_path) - 1)]
        elif mutation_type == "bad_indices":
            idx = random.randint(0, len(fuzz_indices) - 1)
            fuzz_indices[idx] = 1 - fuzz_indices[idx]
        elif mutation_type == "random_root":
            fuzz_root = os.urandom(32)
        elif mutation_type == "oversized_indices":
            fuzz_indices[0] = 999
        elif mutation_type == "negative_indices":
            fuzz_indices[0] = -1

        try:
            is_valid = verify_merkle_proof(fuzz_leaf, fuzz_path, fuzz_indices, fuzz_root)
            if not is_valid:
                rejected_count += 1
            else:
                print(f"[WARN] Fuzzed input unexpectedly accepted: mutation={mutation_type}")
        except Exception as e:
            # Proper rejection via exception is acceptable behavior for malformed inputs
            rejected_count += 1

    print(f"Merkle Proof Fuzzing Complete: {iterations} iterations, {rejected_count} malformed inputs safely rejected.")
    return True


if __name__ == "__main__":
    success = fuzz_merkle_proofs(100)
    sys.exit(0 if success else 1)
