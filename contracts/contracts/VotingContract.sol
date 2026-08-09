// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Verifier.sol";
import "./LatticeVerifier.sol";

/**
 * @title VotingContract
 * @dev On-chain ledger for PQ-ZKVote system enforcing nullifier uniqueness, Merkle root validity,
 * and Groth16 zero-knowledge proof verification.
 */
contract VotingContract {
    // -----------------------------------------------------------------------
    // Proof type constants (architecture.md §5 — submitVote proofType flag)
    // -----------------------------------------------------------------------
    uint8 public constant PROOF_TYPE_GROTH16  = 0;   // Classical ZK (Phase 1)
    uint8 public constant PROOF_TYPE_LATTICE  = 1;   // QRZ-KPA post-quantum (Phase 5)

    address public admin;
    Groth16Verifier  public verifier;        // Groth16 verifier (Phase 2)
    LatticeVerifier  public latticeVerifier; // QRZ-KPA verifier (Phase 5)

    bytes32 public merkleRoot;
    uint256 public electionId;
    uint256 public totalVotes;
    bool public electionOpen;

    mapping(bytes32 => bool) public nullifiers;

    event VoteRecorded(
        bytes32 indexed nullifierHash,
        bytes   encryptedVote,
        uint256 timestamp,
        uint8   proofType   // 0 = Groth16, 1 = QRZ-KPA lattice
    );
    event ElectionClosed(uint256 timestamp);
    event ElectionOpened(uint256 timestamp);
    event MerkleRootUpdated(bytes32 newMerkleRoot);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    constructor(
        address _verifierAddress,
        address _latticeVerifierAddress,
        bytes32 _initialMerkleRoot,
        uint256 _electionId
    ) {
        require(_verifierAddress        != address(0), "Invalid Groth16 verifier");
        require(_latticeVerifierAddress != address(0), "Invalid lattice verifier");
        admin           = msg.sender;
        verifier        = Groth16Verifier(_verifierAddress);
        latticeVerifier = LatticeVerifier(_latticeVerifierAddress);
        merkleRoot      = _initialMerkleRoot;
        electionId      = _electionId;
        electionOpen    = true;
    }

    /**
     * @notice Submits a vote using a Groth16 ZK proof
     * @param a Proof parameter A (uint[2])
     * @param b Proof parameter B (uint[2][2])
     * @param c Proof parameter C (uint[2])
     * @param publicSignals Public signals from circuit [electionId, merkleRoot, nullifierHash, numCandidates]
     * @param nullifierHash Unique nullifier hash to prevent double voting
     * @param encryptedVote Off-chain encrypted vote payload
     */
    // -----------------------------------------------------------------------
    // Classical Groth16 track (Phase 1 / Phase 2)
    // proofType = PROOF_TYPE_GROTH16 (0)
    // -----------------------------------------------------------------------
    /**
     * @notice Submit a vote using a Groth16 ZK proof (classical track).
     * @param a Proof parameter A (uint[2])
     * @param b Proof parameter B (uint[2][2])
     * @param c Proof parameter C (uint[2])
     * @param publicSignals Circuit public signals [electionId, merkleRoot, nullifierHash, numCandidates]
     * @param nullifierHash Unique nullifier to prevent double voting
     * @param encryptedVote Off-chain encrypted vote payload
     */
    function submitVote(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[4] calldata publicSignals,
        bytes32 nullifierHash,
        bytes calldata encryptedVote
    ) external {
        require(electionOpen, "closed");
        require(!nullifiers[nullifierHash], "double vote");

        require(bytes32(publicSignals[2]) == nullifierHash, "nullifier mismatch");
        require(bytes32(publicSignals[1]) == merkleRoot,    "merkle root mismatch");
        require(publicSignals[0] == electionId,             "election id mismatch");

        require(verifier.verifyProof(a, b, c, publicSignals), "invalid Groth16 proof");

        nullifiers[nullifierHash] = true;
        totalVotes++;

        emit VoteRecorded(nullifierHash, encryptedVote, block.timestamp, PROOF_TYPE_GROTH16);
    }

    // -----------------------------------------------------------------------
    // QRZ-KPA lattice track (Phase 5)
    // proofType = PROOF_TYPE_LATTICE (1)
    // Source: QRZ-KPA paper ICCC 2025, DOI: 10.1109/ICCC64910.2025.11077181
    // -----------------------------------------------------------------------
    /**
     * @notice Submit a vote using a QRZ-KPA lattice-based ZK proof (post-quantum track).
     *
     * On-chain checks (see docs/pqc_scheme.md §7 for gas cost discussion):
     *   1. Nullifier uniqueness  — prevents double voting
     *   2. Merkle root match     — proves eligible-voter set membership
     *   3. Non-empty proof hash  — basic sanity check
     *
     * Off-chain check (by tallying service, architecture.md §4.3):
     *   - Ring equation A·z = w + c·t  (NTT-domain polynomial verification)
     *
     * @param proofHash     SHA3-256 hash of the serialised (C, w, c, z) proof
     * @param nullifierHash SHAKE-256(credentialSecret || electionId) — 32 bytes
     * @param claimedRoot   SHA3-256 Merkle root the prover claims membership in
     * @param numCandidates Number of candidates (for range reference)
     * @param encryptedVote Serialised ciphertext C (logged for tallying service)
     */
    function submitLatticeVote(
        bytes32 proofHash,
        bytes32 nullifierHash,
        bytes32 claimedRoot,
        uint256 numCandidates,
        bytes calldata encryptedVote
    ) external {
        require(electionOpen,                 "closed");
        require(!nullifiers[nullifierHash],   "double vote");
        require(nullifierHash != bytes32(0),  "invalid nullifier");

        // Route to LatticeVerifier for on-chain checks
        require(
            latticeVerifier.verifyLatticeProof(
                proofHash,
                nullifierHash,
                claimedRoot,
                merkleRoot,
                numCandidates
            ),
            "invalid lattice proof (on-chain checks)"
        );

        nullifiers[nullifierHash] = true;
        totalVotes++;

        emit VoteRecorded(nullifierHash, encryptedVote, block.timestamp, PROOF_TYPE_LATTICE);
    }

    /**
     * @notice Updates the eligible voter Merkle root
     * @param _newMerkleRoot New Merkle root hash
     */
    function setMerkleRoot(bytes32 _newMerkleRoot) external onlyAdmin {
        merkleRoot = _newMerkleRoot;
        emit MerkleRootUpdated(_newMerkleRoot);
    }

    /**
     * @notice Closes the active election
     */
    function closeElection() external onlyAdmin {
        require(electionOpen, "already closed");
        electionOpen = false;
        emit ElectionClosed(block.timestamp);
    }

    /**
     * @notice Re-opens the election
     */
    function openElection() external onlyAdmin {
        require(!electionOpen, "already open");
        electionOpen = true;
        emit ElectionOpened(block.timestamp);
    }
}
