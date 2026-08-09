"""
lattice/merkle.py
=================
SHA3-256 Merkle tree for the QRZ-KPA lattice proving track.

Classical track uses: Poseidon hash (SNARK-friendly, circom-native)
QRZ-KPA track uses:  SHA3-256 (NIST FIPS 202, quantum-safe, standard)

The tree structure and logic are identical to `circuits/merkle.js` —
leaves, path elements, and path indices have the same semantics.
Only the hash function changes.

Tree depth matches Phase 1: TREE_DEPTH = 10 (supports up to 2^10 = 1024 voters).
"""

import hashlib
from lattice.nullifier import compute_leaf_commitment

TREE_DEPTH = 10
ZERO_VALUE = b"\x00" * 32   # empty leaf sentinel


def _sha3_pair(left: bytes, right: bytes) -> bytes:
    """Hash two 32-byte nodes together with SHA3-256."""
    return hashlib.sha3_256(left + right).digest()


def _zero_hashes() -> list[bytes]:
    """
    Precompute the hash of an empty sub-tree at each level.
    zero_hashes[0] = hash of empty leaf
    zero_hashes[i] = hash(zero_hashes[i-1], zero_hashes[i-1])
    """
    zeros = [ZERO_VALUE]
    for _ in range(TREE_DEPTH):
        prev = zeros[-1]
        zeros.append(_sha3_pair(prev, prev))
    return zeros

_ZERO_HASHES = _zero_hashes()


class MerkleTree:
    """
    Sparse binary Merkle tree with SHA3-256 hashing.
    Empty positions use precomputed zero-hashes (matching circuits/merkle.js).
    """

    def __init__(self, depth: int = TREE_DEPTH, leaves: dict[int, bytes] | None = None):
        """
        Parameters
        ----------
        depth : int
            Tree depth (number of levels above the leaves).
        leaves : dict[int, bytes] or None
            Mapping {leaf_index: leaf_hash_bytes}. Empty positions are zero-filled.
        """
        self.depth = depth
        self.size = 2 ** depth
        # Store layers: layer[0] = leaves, layer[depth] = root
        self._layers: list[list[bytes]] = [
            [_ZERO_HASHES[0]] * self.size
        ]
        if leaves:
            for idx, leaf in leaves.items():
                self._layers[0][idx] = leaf
        self._build()

    def _build(self) -> None:
        """Build all tree layers bottom-up."""
        for level in range(1, self.depth + 1):
            prev = self._layers[level - 1]
            current = []
            for i in range(0, len(prev), 2):
                current.append(_sha3_pair(prev[i], prev[i + 1]))
            self._layers.append(current)

    @property
    def root(self) -> bytes:
        """32-byte Merkle root."""
        return self._layers[self.depth][0]

    def insert(self, index: int, leaf_hash: bytes) -> None:
        """Insert or update a leaf and recompute affected nodes."""
        self._layers[0][index] = leaf_hash
        i = index
        for level in range(1, self.depth + 1):
            parent_i = i >> 1
            left = self._layers[level - 1][i & ~1]
            right = self._layers[level - 1][i | 1]
            self._layers[level][parent_i] = _sha3_pair(left, right)
            i = parent_i

    def get_proof(self, index: int) -> dict:
        """
        Return the Merkle proof for leaf at `index`.

        Returns
        -------
        dict with keys:
            root         : bytes — the Merkle root
            leaf         : bytes — the leaf hash
            path_elements: list[bytes] — sibling hashes from leaf to root
            path_indices : list[int]  — 0 = left sibling, 1 = right sibling
        """
        path_elements = []
        path_indices = []
        i = index
        for level in range(self.depth):
            if i % 2 == 0:
                sibling = self._layers[level][i + 1]
                path_indices.append(0)   # we are the left child
            else:
                sibling = self._layers[level][i - 1]
                path_indices.append(1)   # we are the right child
            path_elements.append(sibling)
            i //= 2
        return {
            "root": self.root,
            "leaf": self._layers[0][index],
            "path_elements": path_elements,
            "path_indices": path_indices,
        }


def verify_merkle_proof(
    leaf: bytes,
    path_elements: list[bytes],
    path_indices: list[int],
    expected_root: bytes,
) -> bool:
    """
    Verify a Merkle inclusion proof.

    Parameters
    ----------
    leaf           : 32-byte leaf hash
    path_elements  : sibling hashes from leaf level to root level (exclusive)
    path_indices   : 0 = leaf is left child, 1 = leaf is right child
    expected_root  : the trusted Merkle root to check against

    Returns
    -------
    bool — True if the leaf is included in the tree with the given root
    """
    current = leaf
    for sibling, index in zip(path_elements, path_indices):
        if index == 0:
            # we are the left child
            current = _sha3_pair(current, sibling)
        else:
            # we are the right child
            current = _sha3_pair(sibling, current)
    return current == expected_root


def build_demo_tree(credential_secret: bytes, leaf_index: int = 0) -> tuple["MerkleTree", dict]:
    """
    Build a minimal demo tree containing one registered voter.
    Used by the CLI prove script for testing.
    """
    leaf = compute_leaf_commitment(credential_secret)
    tree = MerkleTree(TREE_DEPTH, {leaf_index: leaf})
    proof = tree.get_proof(leaf_index)
    return tree, proof
