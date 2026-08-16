"""
security/attack_tests/test_protocol_attacks.py
================================================
Pytest adversarial test suite targeting cryptographic protocol security boundaries:
- Merkle membership forgery & root manipulation
- Nullifier derivation & cross-election replay
- QRZ-KPA lattice proof vector bounds and challenge integrity
- Out-of-bounds candidate ciphertext injection
"""

import copy
import os
import sys
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from lattice.params import N, Q, K, REJECTION_BOUND
from lattice.keygen import keygen
from lattice.nullifier import compute_nullifier, compute_leaf_commitment
from lattice.merkle import verify_merkle_proof, build_demo_tree
from lattice.prove import generate_proof
from lattice.verify import verify_proof

CREDENTIAL_SECRET = b"protocol_attack_secret_123"
ELECTION_ID       = 1
NUM_CANDIDATES    = 4
VOTE_VALUE        = 2
LEAF_INDEX        = 0

RNG = np.random.default_rng(1337)


@pytest.fixture(scope="module")
def setup_protocol():
    pk, sk = keygen(seed=b"\x55" * 32)
    tree, proof_data = build_demo_tree(CREDENTIAL_SECRET, LEAF_INDEX)
    proof = generate_proof(
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
    return pk, sk, tree, proof_data, proof


class TestMerkleProofAttacks:
    def test_corrupted_path_element_fails(self, setup_protocol):
        _, _, tree, proof_data, _ = setup_protocol
        corrupted_path = copy.deepcopy(proof_data["path_elements"])
        corrupted_path[0] = os.urandom(32)

        valid = verify_merkle_proof(
            proof_data["leaf"],
            corrupted_path,
            proof_data["path_indices"],
            tree.root,
        )
        assert not valid, "Corrupted Merkle path element must fail verification"

    def test_flipped_path_indices_fails(self, setup_protocol):
        _, _, tree, proof_data, _ = setup_protocol
        flipped_indices = [1 - idx for idx in proof_data["path_indices"]]

        valid = verify_merkle_proof(
            proof_data["leaf"],
            proof_data["path_elements"],
            flipped_indices,
            tree.root,
        )
        assert not valid, "Flipped Merkle path indices must fail verification"

    def test_unapproved_leaf_fails_against_root(self, setup_protocol):
        _, _, tree, proof_data, _ = setup_protocol
        unapproved_leaf = compute_leaf_commitment(b"unauthorized_voter_secret")

        valid = verify_merkle_proof(
            unapproved_leaf,
            proof_data["path_elements"],
            proof_data["path_indices"],
            tree.root,
        )
        assert not valid, "Unapproved commitment leaf must fail Merkle verification"


class TestNullifierAttacks:
    def test_nullifier_forgery_fails_proof_verification(self, setup_protocol):
        _, _, _, _, proof = setup_protocol
        forged_proof = copy.deepcopy(proof)
        fake_nullifier = compute_nullifier(b"fake_voter_secret", ELECTION_ID)
        forged_proof["nullifier"] = fake_nullifier.hex()

        valid, reason = verify_proof(forged_proof)
        assert not valid, "Forged nullifier must fail proof verification"

    def test_short_nullifier_length_rejected(self, setup_protocol):
        _, _, _, _, proof = setup_protocol
        short_proof = copy.deepcopy(proof)
        short_proof["nullifier"] = "ab" * 16  # 16 bytes instead of 32 bytes

        valid, reason = verify_proof(short_proof)
        assert not valid, "16-byte nullifier must fail verification"

    def test_cross_election_nullifier_mismatch(self):
        n_elec1 = compute_nullifier(CREDENTIAL_SECRET, election_id=1)
        n_elec2 = compute_nullifier(CREDENTIAL_SECRET, election_id=2)
        assert n_elec1 != n_elec2, "Nullifier must be bound strictly to election ID"


class TestPQCProofAttacks:
    def test_z_vector_exceeding_rejection_bound_fails(self, setup_protocol):
        _, _, _, _, proof = setup_protocol
        bound_proof = copy.deepcopy(proof)
        bound_proof["z_r"][0][0] = REJECTION_BOUND + 100

        valid, reason = verify_proof(bound_proof)
        assert not valid, "Proof exceeding z_r rejection bound must fail"
        assert "rejection bound violated" in reason

    def test_z_e1_exceeding_rejection_bound_fails(self, setup_protocol):
        _, _, _, _, proof = setup_protocol
        bound_proof = copy.deepcopy(proof)
        bound_proof["z_e1"][0][0] = REJECTION_BOUND + 500

        valid, reason = verify_proof(bound_proof)
        assert not valid, "Proof exceeding z_e1 rejection bound must fail"
        assert "rejection bound violated" in reason

    def test_z_e2_exceeding_rejection_bound_fails(self, setup_protocol):
        _, _, _, _, proof = setup_protocol
        bound_proof = copy.deepcopy(proof)
        bound_proof["z_e2"][0] = REJECTION_BOUND + 1000

        valid, reason = verify_proof(bound_proof)
        assert not valid, "Proof exceeding z_e2 rejection bound must fail"
        assert "rejection bound violated" in reason

    def test_tampered_challenge_polynomial_fails(self, setup_protocol):
        _, _, _, _, proof = setup_protocol
        tampered = copy.deepcopy(proof)
        tampered["c"][0] = (tampered["c"][0] + 1) % Q

        valid, reason = verify_proof(tampered)
        assert not valid, "Tampered challenge polynomial must fail"
        assert "challenge mismatch" in reason

    def test_out_of_range_candidate_ciphertext_fails(self, setup_protocol):
        _, _, _, _, proof = setup_protocol
        shift_proof = copy.deepcopy(proof)
        shift_proof["C"]["v"] = [(x + 500) % Q for x in shift_proof["C"]["v"]]

        valid, reason = verify_proof(shift_proof)
        assert not valid, "Tampered ciphertext with no valid candidate match must fail"


class TestProofReplayCrossElection:
    def test_replaying_proof_with_different_election_id_fails(self, setup_protocol):
        _, _, _, _, proof = setup_protocol
        replayed = copy.deepcopy(proof)
        replayed["public"]["election_id"] = 2

        valid, reason = verify_proof(replayed)
        assert not valid, "Replayed proof in another election must fail challenge verification"
        assert "challenge mismatch" in reason

    def test_replaying_proof_with_different_num_candidates_fails(self, setup_protocol):
        _, _, _, _, proof = setup_protocol
        replayed = copy.deepcopy(proof)
        replayed["public"]["num_candidates"] = 2

        valid, reason = verify_proof(replayed)
        assert not valid, "Replayed proof with different candidate count must fail"
        assert "challenge mismatch" in reason
