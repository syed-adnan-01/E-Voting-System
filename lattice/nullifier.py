"""
lattice/nullifier.py
====================
Quantum-safe nullifier computation for the QRZ-KPA proving track.

Classical track uses: nullifier = Poseidon(credentialSecret, electionId)
QRZ-KPA track uses:  nullifier = SHAKE-256(credentialSecret ∥ electionId)

Justification: SHAKE-256 is a NIST-standardised (FIPS 202) extendable-output
function based on Keccak. Unlike Poseidon (which relies on a specific
algebraic structure tied to SNARKs), SHAKE-256 is conjectured to be
quantum-safe — Grover's algorithm reduces its effective security by at most
a factor of 2, so 256-bit output achieves 128-bit post-quantum security.

Also computes the Merkle leaf commitment:
  leaf = SHA3-256(credentialSecret)
matching the lattice track's Merkle tree in merkle.py.
"""

import hashlib


def compute_nullifier(credential_secret: bytes, election_id: int) -> bytes:
    """
    Compute the voting nullifier for the QRZ-KPA track.

    The nullifier prevents double-voting: it uniquely identifies a (voter, election)
    pair without revealing which voter it belongs to.

    On-chain: the smart contract stores the nullifier hash and rejects duplicate submissions.

    Parameters
    ----------
    credential_secret : bytes
        The voter's locally-generated credential secret (never transmitted).
    election_id : int
        The integer election identifier (from the registrar service).

    Returns
    -------
    bytes : 32-byte nullifier (SHAKE-256 output)
    """
    payload = credential_secret + election_id.to_bytes(8, "big")
    return hashlib.shake_256(payload).digest(32)


def compute_leaf_commitment(credential_secret: bytes) -> bytes:
    """
    Compute the Merkle leaf commitment from the voter's credential secret.

    Classical track: Poseidon(credentialSecret)
    QRZ-KPA track:  SHA3-256(credentialSecret)

    This commitment is submitted at registration time. The registrar adds it
    as a leaf in the eligible-voters Merkle tree. The voter later proves
    they know the pre-image (their secret) by including it in the proof.

    Parameters
    ----------
    credential_secret : bytes

    Returns
    -------
    bytes : 32-byte leaf hash
    """
    return hashlib.sha3_256(credential_secret).digest()


def nullifier_to_bytes32(nullifier: bytes) -> bytes:
    """Return the nullifier as a zero-padded 32-byte value (for Solidity bytes32)."""
    return nullifier[:32].ljust(32, b"\x00")
