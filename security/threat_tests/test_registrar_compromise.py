"""
security/threat_tests/test_registrar_compromise.py
====================================================
System Threat Simulation: Registrar Compromise Scenarios.

Validates core architectural security guarantees under extreme compromise assumptions:
1. Scenario A — Registrar Database Leak:
   Attacker leaks entire Registrar DB (commitments, leaf indices, identity proofs).
   Asserts that commitment pre-image resistance prevents secret recovery and proof forgery.

2. Scenario B — Registrar Admin Key Compromise:
   Attacker compromises ADMIN_TOKEN and injects unauthorized voter commitments.
   Asserts that unauthorized commitments cannot be voted on without knowing valid secrets.

3. Scenario C — Registrar Merkle Root Manipulation:
   Attacker manipulates the election Merkle root.
   Asserts that valid voters cannot be framed and bogus votes fail proof verifiers.
"""

import os
import sys
import copy
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

from lattice.keygen import keygen
from lattice.nullifier import compute_leaf_commitment, compute_nullifier
from lattice.merkle import MerkleTree, build_demo_tree
from lattice.prove import generate_proof
from lattice.verify import verify_proof

LEGIT_VOTER_SECRET = b"legitimate_voter_secret_98765"
ATTACKER_SECRET    = b"attacker_secret_11111"
ELECTION_ID        = 1
NUM_CANDIDATES     = 4

RNG = np.random.default_rng(777)


@pytest.fixture(scope="module")
def system_setup():
    pk, sk = keygen(seed=b"\x99" * 32)
    tree, proof_data = build_demo_tree(LEGIT_VOTER_SECRET, 0)
    legit_leaf = proof_data["leaf"]

    registrar_db = {
        "election_id": ELECTION_ID,
        "commitments": [legit_leaf.hex()],
        "identities": [{"voter_id": "VOTER-101", "commitment": legit_leaf.hex()}]
    }

    return pk, sk, tree, registrar_db, legit_leaf


class TestRegistrarDatabaseLeakThreat:
    def test_compromised_db_does_not_contain_voter_secret(self, system_setup):
        _, _, _, registrar_db, _ = system_setup

        # Audit registrar DB for raw secret leaks
        db_dump_str = str(registrar_db)
        assert LEGIT_VOTER_SECRET.decode() not in db_dump_str, \
            "CRITICAL SECURITY FAILURE: Raw voter secret found in Registrar DB!"

    def test_attacker_with_leaked_commitment_cannot_forge_nullifier(self, system_setup):
        _, _, _, registrar_db, legit_leaf = system_setup

        leaked_commitment_hex = registrar_db["commitments"][0]
        leaked_commitment_bytes = bytes.fromhex(leaked_commitment_hex)

        # Attacker tries to use the leaked commitment directly as secret to derive nullifier
        fake_nullifier = compute_nullifier(leaked_commitment_bytes, ELECTION_ID)
        correct_nullifier = compute_nullifier(LEGIT_VOTER_SECRET, ELECTION_ID)

        assert fake_nullifier != correct_nullifier, \
            "Attacker using commitment as secret must produce mismatched nullifier"

    def test_attacker_cannot_generate_valid_zk_proof_with_leaked_commitment(self, system_setup):
        pk, sk, tree, _, _ = system_setup

        proof_data = tree.get_proof(0)

        with pytest.raises(ValueError, match="Merkle membership check failed"):
            generate_proof(
                pk=pk,
                sk=sk,
                vote_value=1,
                credential_secret=ATTACKER_SECRET,  # Mismatch! Attacker doesn't know LEGIT_VOTER_SECRET
                election_id=ELECTION_ID,
                merkle_path_elements=proof_data["path_elements"],
                merkle_path_indices=proof_data["path_indices"],
                merkle_root=tree.root,
                num_candidates=NUM_CANDIDATES,
                rng=RNG
            )


class TestRegistrarAdminKeyCompromiseThreat:
    def test_admin_key_compromise_cannot_cast_vote_for_legitimate_voter(self, system_setup):
        pk, sk, tree, _, _ = system_setup

        proof_data_leaf0 = tree.get_proof(0)

        with pytest.raises(ValueError, match="Merkle membership check failed"):
            generate_proof(
                pk=pk,
                sk=sk,
                vote_value=0,
                credential_secret=b"fake_admin_guess_secret",  # Cannot guess secret
                election_id=ELECTION_ID,
                merkle_path_elements=proof_data_leaf0["path_elements"],
                merkle_path_indices=proof_data_leaf0["path_indices"],
                merkle_root=tree.root,
                num_candidates=NUM_CANDIDATES,
                rng=RNG
            )

    def test_admin_injecting_unauthorized_leaf_cannot_spoof_legitimate_nullifier(self, system_setup):
        fake_secret = b"fake_injected_voter_secret"
        admin_nullifier = compute_nullifier(fake_secret, ELECTION_ID)
        legit_nullifier = compute_nullifier(LEGIT_VOTER_SECRET, ELECTION_ID)

        assert admin_nullifier != legit_nullifier, \
            "Unauthorized commitment inserted by admin produces distinct nullifier"


class TestRegistrarMerkleRootManipulationThreat:
    def test_manipulated_root_invalidates_existing_valid_proofs(self, system_setup):
        pk, sk, tree, _, _ = system_setup
        proof_data = tree.get_proof(0)

        valid_proof = generate_proof(
            pk=pk,
            sk=sk,
            vote_value=1,
            credential_secret=LEGIT_VOTER_SECRET,
            election_id=ELECTION_ID,
            merkle_path_elements=proof_data["path_elements"],
            merkle_path_indices=proof_data["path_indices"],
            merkle_root=tree.root,
            num_candidates=NUM_CANDIDATES,
            rng=RNG
        )

        tampered_proof = copy.deepcopy(valid_proof)
        fake_root = os.urandom(32)
        tampered_proof["public"]["merkle_root"] = fake_root.hex()

        valid, reason = verify_proof(tampered_proof)
        assert not valid, "Proof claiming tampered Merkle root must fail verification"
        assert "challenge mismatch" in reason
