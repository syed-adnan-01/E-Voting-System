"""
security/threat_tests/test_offchain_tampering.py
==================================================
System Threat Simulation: Off-Chain Payload & Network Tampering.

Simulates adversary capabilities in intercepting, modifying, or replaying off-chain vote payloads:
1. Ciphertext Bit Flipping & Truncation ($C = (u, v)$)
2. Network Payload Interception & Cross-Election Replay
3. Vote Encryption Decryption Tampering
"""

import copy
import os
import sys
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from lattice.params import N, Q, K
from lattice.keygen import keygen
from lattice.nullifier import compute_leaf_commitment
from lattice.merkle import MerkleTree
from lattice.prove import generate_proof
from lattice.verify import verify_proof

CREDENTIAL_SECRET_1 = b"offchain_tamper_secret_456"
CREDENTIAL_SECRET_2 = b"offchain_tamper_secret_789"
ELECTION_ID         = 1
NUM_CANDIDATES      = 4
VOTE_VALUE          = 3

RNG = np.random.default_rng(2025)


@pytest.fixture(scope="module")
def setup_offchain():
    pk, sk = keygen(seed=b"\x77" * 32)
    leaf1 = compute_leaf_commitment(CREDENTIAL_SECRET_1)
    leaf2 = compute_leaf_commitment(CREDENTIAL_SECRET_2)

    tree = MerkleTree(10, {0: leaf1, 1: leaf2})

    proof_data_0 = tree.get_proof(0)
    proof_data_1 = tree.get_proof(1)

    proof1 = generate_proof(
        pk=pk,
        sk=sk,
        vote_value=VOTE_VALUE,
        credential_secret=CREDENTIAL_SECRET_1,
        election_id=ELECTION_ID,
        merkle_path_elements=proof_data_0["path_elements"],
        merkle_path_indices=proof_data_0["path_indices"],
        merkle_root=tree.root,
        num_candidates=NUM_CANDIDATES,
        rng=RNG,
    )

    proof2 = generate_proof(
        pk=pk,
        sk=sk,
        vote_value=0,
        credential_secret=CREDENTIAL_SECRET_2,
        election_id=ELECTION_ID,
        merkle_path_elements=proof_data_1["path_elements"],
        merkle_path_indices=proof_data_1["path_indices"],
        merkle_root=tree.root,
        num_candidates=NUM_CANDIDATES,
        rng=RNG,
    )

    return pk, sk, tree, proof1, proof2


class TestCiphertextTamperingThreat:
    def test_bit_flip_in_u_vector_invalidates_proof(self, setup_offchain):
        _, _, _, proof1, _ = setup_offchain
        tampered_proof = copy.deepcopy(proof1)
        tampered_proof["C"]["u"][0][0] = (tampered_proof["C"]["u"][0][0] + 1) % Q

        valid, reason = verify_proof(tampered_proof)
        assert not valid, "Altered ciphertext u component must fail proof verification"

    def test_bit_flip_in_v_vector_invalidates_proof(self, setup_offchain):
        _, _, _, proof1, _ = setup_offchain
        tampered_proof = copy.deepcopy(proof1)
        tampered_proof["C"]["v"][10] = (tampered_proof["C"]["v"][10] + 50) % Q

        valid, reason = verify_proof(tampered_proof)
        assert not valid, "Altered ciphertext v component must fail proof verification"

    def test_truncated_ciphertext_causes_deserialization_error(self, setup_offchain):
        _, _, _, proof1, _ = setup_offchain
        truncated_proof = copy.deepcopy(proof1)
        truncated_proof["C"]["u"] = []

        valid, reason = verify_proof(truncated_proof)
        assert not valid, "Truncated ciphertext u vector must fail verification"


class TestOffchainReplayThreat:
    def test_replaying_offchain_payload_in_another_election(self, setup_offchain):
        _, _, _, proof1, _ = setup_offchain
        replayed_payload = copy.deepcopy(proof1)
        replayed_payload["public"]["election_id"] = 99

        valid, reason = verify_proof(replayed_payload)
        assert not valid, "Cross-election payload replay must fail verifier challenge check"
        assert "challenge mismatch" in reason

    def test_swapping_vote_ciphertext_between_proofs_fails(self, setup_offchain):
        _, _, _, proof1, proof2 = setup_offchain

        swapped_proof = copy.deepcopy(proof1)
        swapped_proof["C"] = proof2["C"]

        valid, reason = verify_proof(swapped_proof)
        assert not valid, "Swapping ciphertext between proofs must fail verification"
        assert "challenge mismatch" in reason
