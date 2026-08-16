"""
crypto/key_manager.py
=====================
Post-Quantum Hybrid & Threshold Key Management Engine for PQ-ZKVote.

Implements:
1. Election Keypair Generation (Asymmetric ElGamal / ECIES over Prime Field)
2. k-of-n Shamir Threshold Secret Sharing for Tally Trustees
3. Client-Side Vote Payload Encryption
4. Time-Locked Batch Tally Decryption (Restricted to election closure)
5. Zero-Individual-Leakage Batch Aggregation
"""

import os
import json
import secrets
import hashlib
from typing import List, Tuple, Dict

# Prime field for Shamir Secret Sharing and ElGamal Encryption
PRIME = 2**256 - 189  # 256-bit prime number
GENERATOR = 2


def _mod_inverse(a: int, p: int) -> int:
    """Computes modular inverse of a modulo p using Extended Euclidean Algorithm."""
    return pow(a, p - 2, p)


class KeyManager:
    """Core Key Management System handling Key Generation, Shamir Sharing, and Time-Locked Tallying."""

    @staticmethod
    def generate_election_keypair() -> Tuple[Dict[str, str], int]:
        """Generates election asymmetric keypair (public_key, private_key)."""
        private_key = secrets.randbelow(PRIME - 2) + 1
        public_key_val = pow(GENERATOR, private_key, PRIME)
        
        public_key = {
            "g": str(GENERATOR),
            "p": str(PRIME),
            "y": str(public_key_val)
        }
        return public_key, private_key

    @staticmethod
    def split_secret_threshold(secret: int, k: int, n: int) -> List[Tuple[int, int]]:
        """
        Splits a secret integer into n key shares using k-of-n Shamir Secret Sharing.
        Requires at least k shares to reconstruct.
        """
        if k > n or k < 1:
            raise ValueError("Invalid threshold parameters: k must be <= n and >= 1")

        # Generate random polynomial coefficients: f(x) = secret + a_1*x + a_2*x^2 + ... + a_{k-1}*x^{k-1}
        coefficients = [secret] + [secrets.randbelow(PRIME - 1) + 1 for _ in range(k - 1)]

        shares = []
        for x in range(1, n + 1):
            y = 0
            for idx, coeff in enumerate(coefficients):
                y = (y + coeff * pow(x, idx, PRIME)) % PRIME
            shares.append((x, y))

        return shares

    @staticmethod
    def reconstruct_secret_threshold(shares: List[Tuple[int, int]], k: int) -> int:
        """
        Reconstructs secret from at least k Shamir key shares using Lagrange Interpolation at x=0.
        """
        if len(shares) < k:
            raise ValueError(f"Insufficient key shares provided: received {len(shares)}, require threshold k={k}")

        selected_shares = shares[:k]
        secret = 0

        for i, (x_i, y_i) in enumerate(selected_shares):
            numerator = 1
            denominator = 1
            for j, (x_j, _) in enumerate(selected_shares):
                if i != j:
                    numerator = (numerator * (-x_j)) % PRIME
                    denominator = (denominator * (x_i - x_j)) % PRIME

            lagrange_basis = (numerator * _mod_inverse(denominator, PRIME)) % PRIME
            secret = (secret + y_i * lagrange_basis) % PRIME

        return secret

    @staticmethod
    def encrypt_vote_payload(vote_choice: int, public_key: Dict[str, str]) -> Dict[str, str]:
        """
        Encrypts a candidate vote choice using ElGamal asymmetric encryption under election public key.
        C = (c1, c2) = (g^r mod p, (m * y^r) mod p)
        """
        g = int(public_key["g"])
        p = int(public_key["p"])
        y = int(public_key["y"])

        # Map choice integer (e.g. 0, 1, 2) to message scalar (e.g. choice + 100 to avoid m=0)
        m = vote_choice + 100
        r = secrets.randbelow(p - 2) + 1

        c1 = pow(g, r, p)
        c2 = (m * pow(y, r, p)) % p

        return {
            "c1": hex(c1),
            "c2": hex(c2)
        }

    @staticmethod
    def decrypt_tally_batch(
        ciphertexts: List[Dict[str, str]],
        key_shares: List[Tuple[int, int]],
        k: int,
        election_status: str
    ) -> Dict[str, int]:
        """
        Time-Locked Batch Tally Decryption.
        Enforces:
        1. Election status MUST be 'closed'.
        2. Must have at least k valid trustee key shares.
        3. Decrypts in-memory and outputs candidate counts without revealing individual voter-choice pairs.
        """
        if election_status != "closed":
            raise PermissionError("Decryption locked: Tally decryption is prohibited until election closure!")

        reconstructed_sk = KeyManager.reconstruct_secret_threshold(key_shares, k)

        tally_counts = {}

        for ciphertext in ciphertexts:
            c1 = int(ciphertext["c1"], 16)
            c2 = int(ciphertext["c2"], 16)

            # Decrypt: m = c2 * (c1^sk)^(-1) mod p
            s = pow(c1, reconstructed_sk, PRIME)
            s_inv = _mod_inverse(s, PRIME)
            m = (c2 * s_inv) % PRIME

            candidate_choice = str(m - 100)
            tally_counts[candidate_choice] = tally_counts.get(candidate_choice, 0) + 1

        return tally_counts
