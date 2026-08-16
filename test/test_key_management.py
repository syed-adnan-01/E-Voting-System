"""
test/test_key_management.py
============================
Pytest suite for Vote Encryption & Key Management Engine (crypto/key_manager.py).
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from crypto.key_manager import KeyManager, PRIME


def test_generate_keypair():
    pk, sk = KeyManager.generate_election_keypair()
    assert "g" in pk
    assert "p" in pk
    assert "y" in pk
    assert 1 <= sk < PRIME
    assert pow(int(pk["g"]), sk, PRIME) == int(pk["y"])


def test_shamir_threshold_sharing_and_reconstruction():
    pk, sk = KeyManager.generate_election_keypair()
    k = 3
    n = 5

    # Split secret into 5 trustee shares
    shares = KeyManager.split_secret_threshold(sk, k, n)
    assert len(shares) == n

    # Reconstruction with exactly k=3 shares
    reconstructed_3 = KeyManager.reconstruct_secret_threshold(shares[:3], k)
    assert reconstructed_3 == sk

    # Reconstruction with 4 shares
    reconstructed_4 = KeyManager.reconstruct_secret_threshold(shares[1:5], k)
    assert reconstructed_4 == sk

    # Attempt reconstruction with k-1=2 shares (MUST FAIL / NOT MATCH)
    with pytest.raises(ValueError, match="Insufficient key shares"):
        KeyManager.reconstruct_secret_threshold(shares[:2], k)

    # If we manually pass 2 shares to a 2-threshold call, it reconstructs a DIFFERENT value
    wrong_secret = KeyManager.reconstruct_secret_threshold(shares[:2], 2)
    assert wrong_secret != sk


def test_encrypt_and_decrypt_vote():
    pk, sk = KeyManager.generate_election_keypair()
    shares = KeyManager.split_secret_threshold(sk, k=2, n=3)

    vote_choice = 2  # Candidate Index 2
    ciphertext = KeyManager.encrypt_vote_payload(vote_choice, pk)

    assert "c1" in ciphertext
    assert "c2" in ciphertext

    # Time-locked decryption after election closure
    tally = KeyManager.decrypt_tally_batch([ciphertext], shares[:2], k=2, election_status="closed")
    assert tally.get("2") == 1


def test_time_locked_decryption_pre_closure_rejection():
    pk, sk = KeyManager.generate_election_keypair()
    shares = KeyManager.split_secret_threshold(sk, k=2, n=3)
    ciphertext = KeyManager.encrypt_vote_payload(0, pk)

    # Pre-closure decryption attempt MUST be rejected with PermissionError
    with pytest.raises(PermissionError, match="Decryption locked"):
        KeyManager.decrypt_tally_batch([ciphertext], shares[:2], k=2, election_status="active")


def test_batch_tally_aggregation_correctness():
    pk, sk = KeyManager.generate_election_keypair()
    shares = KeyManager.split_secret_threshold(sk, k=3, n=5)

    # 10 votes: 4 for Alice (0), 3 for Bob (1), 2 for Charlie (2), 1 for Diana (3)
    choices = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3]
    ciphertexts = [KeyManager.encrypt_vote_payload(c, pk) for c in choices]

    tally = KeyManager.decrypt_tally_batch(ciphertexts, shares[:3], k=3, election_status="closed")

    assert tally.get("0") == 4
    assert tally.get("1") == 3
    assert tally.get("2") == 2
    assert tally.get("3") == 1
    assert sum(tally.values()) == 10
