"""
test/test_lattice.py
====================
Pytest test suite for the QRZ-KPA post-quantum proving track.
"""

import copy
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lattice.params import N, Q, K, REJECTION_BOUND
from lattice.keygen import keygen
from lattice.encrypt import encrypt, decrypt, encode_vote, decode_vote, check_rejection_bound
from lattice.nullifier import compute_nullifier, compute_leaf_commitment
from lattice.merkle import MerkleTree, verify_merkle_proof, build_demo_tree, TREE_DEPTH
from lattice.prove import generate_proof
from lattice.verify import verify_proof, get_zkp_validity_flag
from lattice.ntt import ntt, intt, poly_add
from lattice.sampling import expand_A, sample_challenge

CREDENTIAL_SECRET = b"123456789"
ELECTION_ID       = 1
NUM_CANDIDATES    = 4
VOTE_VALUE        = 1
LEAF_INDEX        = 0

RNG = np.random.default_rng(42)


@pytest.fixture(scope="module")
def keys():
    pk, sk = keygen(seed=b"\x00" * 32)
    return pk, sk


@pytest.fixture(scope="module")
def merkle_setup():
    tree, proof_data = build_demo_tree(CREDENTIAL_SECRET, LEAF_INDEX)
    return tree, proof_data


@pytest.fixture(scope="module")
def valid_proof(keys, merkle_setup):
    pk, sk = keys
    tree, proof_data = merkle_setup
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
    return proof


class TestNTT:
    def test_ntt_roundtrip(self):
        rng = np.random.default_rng(0)
        f = [int(x) for x in rng.integers(0, Q, N)]
        assert intt(ntt(f)) == f

    def test_ntt_convolution(self):
        from lattice.ntt import poly_mul_ntt, intt, ntt
        a = [0] * N
        b = [0] * N
        a[0] = 2
        b[0] = 3
        result = intt(poly_mul_ntt(ntt(a), ntt(b)))
        assert result[0] == 6


class TestSampling:
    def test_expand_A_shape(self):
        A = expand_A(b"\xAB" * 32)
        assert len(A) == K
        for row in A:
            assert len(row) == K
            for poly in row:
                assert len(poly) == N

    def test_expand_A_uniform(self):
        A = expand_A(b"\xCD" * 32)
        coeffs = [c for row in A for poly in row for c in poly]
        assert all(0 <= c < Q for c in coeffs)

    def test_expand_A_deterministic(self):
        seed = b"\x42" * 32
        A1 = expand_A(seed)
        A2 = expand_A(seed)
        assert A1 == A2

    def test_challenge_is_sparse_ternary(self):
        from lattice.params import TAU
        c = sample_challenge(b"\x00" * 64)
        assert len(c) == N
        nonzero = [x for x in c if x != 0]
        assert len(nonzero) == TAU
        assert all(x in {1, Q - 1} for x in nonzero)


class TestKeygen:
    def test_keygen_shapes(self, keys):
        pk, sk = keys
        assert len(pk["rho"]) == 32
        assert len(pk["t"]) == K
        for poly in pk["t"]:
            assert len(poly) == N

    def test_keygen_deterministic(self):
        pk1, sk1 = keygen(seed=b"\x11" * 32)
        pk2, sk2 = keygen(seed=b"\x11" * 32)
        assert pk1["rho"] == pk2["rho"]
        assert pk1["t"] == pk2["t"]


class TestEncrypt:
    def test_encrypt_shapes(self, keys):
        pk, sk = keys
        C, r, e1, e2 = encrypt(pk, VOTE_VALUE, NUM_CANDIDATES)
        assert len(C["u"]) == K
        for poly in C["u"]:
            assert len(poly) == N
        assert len(C["v"]) == N

    def test_vote_range_constraint(self, keys):
        pk, sk = keys
        with pytest.raises(ValueError, match="out of range"):
            encrypt(pk, NUM_CANDIDATES, NUM_CANDIDATES)
        with pytest.raises(ValueError, match="out of range"):
            encrypt(pk, -1, NUM_CANDIDATES)

    def test_encode_decode_roundtrip(self):
        for v in range(NUM_CANDIDATES):
            m = encode_vote(v, NUM_CANDIDATES)
            recovered = decode_vote(m, NUM_CANDIDATES)
            assert recovered == v, f"Vote {v} decoded as {recovered}"

    def test_encrypt_decrypt_roundtrip(self, keys):
        pk, sk = keys
        for v in range(NUM_CANDIDATES):
            C, _, _, _ = encrypt(pk, v, NUM_CANDIDATES)
            decrypted = decrypt(sk, C, NUM_CANDIDATES)
            assert decrypted == v, f"Decrypted {decrypted} != expected {v}"

    def test_encrypt_different_ciphertexts(self, keys):
        pk, sk = keys
        rng1 = np.random.default_rng(1)
        rng2 = np.random.default_rng(2)
        C1, _, _, _ = encrypt(pk, VOTE_VALUE, NUM_CANDIDATES, rng=rng1)
        C2, _, _, _ = encrypt(pk, VOTE_VALUE, NUM_CANDIDATES, rng=rng2)
        assert C1 != C2


class TestNullifier:
    def test_nullifier_length(self):
        n = compute_nullifier(CREDENTIAL_SECRET, ELECTION_ID)
        assert len(n) == 32

    def test_nullifier_deterministic(self):
        n1 = compute_nullifier(CREDENTIAL_SECRET, ELECTION_ID)
        n2 = compute_nullifier(CREDENTIAL_SECRET, ELECTION_ID)
        assert n1 == n2

    def test_nullifier_different_elections(self):
        n1 = compute_nullifier(CREDENTIAL_SECRET, election_id=1)
        n2 = compute_nullifier(CREDENTIAL_SECRET, election_id=2)
        assert n1 != n2

    def test_nullifier_different_secrets(self):
        n1 = compute_nullifier(b"secretA", ELECTION_ID)
        n2 = compute_nullifier(b"secretB", ELECTION_ID)
        assert n1 != n2


class TestMerkle:
    def test_merkle_membership_valid(self):
        tree, proof_data = build_demo_tree(CREDENTIAL_SECRET, LEAF_INDEX)
        valid = verify_merkle_proof(
            proof_data["leaf"],
            proof_data["path_elements"],
            proof_data["path_indices"],
            tree.root,
        )
        assert valid

    def test_merkle_membership_wrong_leaf(self):
        tree, proof_data = build_demo_tree(CREDENTIAL_SECRET, LEAF_INDEX)
        wrong_leaf = compute_leaf_commitment(b"impostorsecret")
        valid = verify_merkle_proof(
            wrong_leaf,
            proof_data["path_elements"],
            proof_data["path_indices"],
            tree.root,
        )
        assert not valid

    def test_merkle_root_changes_on_insert(self):
        tree, _ = build_demo_tree(CREDENTIAL_SECRET, 0)
        root_before = tree.root
        leaf2 = compute_leaf_commitment(b"voter2secret")
        tree.insert(1, leaf2)
        assert tree.root != root_before


class TestValidProof:
    def test_valid_proof_verifies(self, valid_proof):
        valid, reason = verify_proof(valid_proof)
        assert valid, f"Expected VALID proof but got FAIL: {reason}"

    def test_zkp_validity_flag_is_1(self, valid_proof):
        flag = get_zkp_validity_flag(valid_proof)
        assert flag == 1


class TestTamperedProofs:
    def test_tampered_ciphertext_fails(self, valid_proof):
        bad_proof = copy.deepcopy(valid_proof)
        bad_proof["C"]["u"][0][0] = (bad_proof["C"]["u"][0][0] + 1000) % Q
        valid, reason = verify_proof(bad_proof)
        assert not valid, "Tampered ciphertext should fail verification"

    def test_tampered_z_fails(self, valid_proof):
        bad_proof = copy.deepcopy(valid_proof)
        bad_proof["z_r"][0][0] = (bad_proof["z_r"][0][0] + 500) % Q
        valid, reason = verify_proof(bad_proof)
        assert not valid, "Tampered z_r should fail ring equation check"

    def test_tampered_nullifier_fails(self, valid_proof):
        bad_proof = copy.deepcopy(valid_proof)
        orig = bytes.fromhex(bad_proof["nullifier"])
        bad_proof["nullifier"] = bytes(b ^ 0xFF for b in orig).hex()
        valid, reason = verify_proof(bad_proof)
        assert not valid, "Forged nullifier should fail"

    def test_wrong_vote_value_rejected_by_encrypt(self, keys):
        pk, sk = keys
        with pytest.raises(ValueError, match="out of range"):
            encrypt(pk, NUM_CANDIDATES, NUM_CANDIDATES)

    def test_tampered_challenge_fails(self, valid_proof):
        bad_proof = copy.deepcopy(valid_proof)
        bad_proof["c"][0] = (bad_proof["c"][0] + 1) % Q
        valid, reason = verify_proof(bad_proof)
        assert not valid, "Tampered challenge c should fail"
        assert "challenge mismatch" in reason

    def test_oversized_z_fails_rejection_bound(self):
        from lattice.verify import check_rejection_bound
        bad_z = [[7000] + [0] * (N - 1) for _ in range(K)]
        assert not check_rejection_bound(bad_z)

    def test_zkp_validity_flag_is_0_on_bad_proof(self, valid_proof):
        bad_proof = copy.deepcopy(valid_proof)
        bad_proof["C"]["u"][0][0] = (bad_proof["C"]["u"][0][0] + 1000) % Q
        flag = get_zkp_validity_flag(bad_proof)
        assert flag == 0


class TestRejectionSampling:
    def test_rejection_bound_fires_on_large_z(self):
        from lattice.verify import check_rejection_bound
        large_z = [[Q // 2] * N for _ in range(K)]
        assert not check_rejection_bound(large_z)

    def test_rejection_bound_passes_on_small_z(self):
        from lattice.verify import check_rejection_bound
        small_z = [[1] * N for _ in range(K)]
        assert check_rejection_bound(small_z)
