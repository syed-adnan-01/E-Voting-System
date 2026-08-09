// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Verifier.sol";

/**
 * @title VotingContract
 * @dev On-chain ledger for PQ-ZKVote system enforcing nullifier uniqueness, Merkle root validity,
 * and Groth16 zero-knowledge proof verification.
 */
contract VotingContract {
    address public admin;
    Groth16Verifier public verifier;

    bytes32 public merkleRoot;
    uint256 public electionId;
    uint256 public totalVotes;
    bool public electionOpen;

    mapping(bytes32 => bool) public nullifiers;

    event VoteRecorded(bytes32 indexed nullifierHash, bytes encryptedVote, uint256 timestamp);
    event ElectionClosed(uint256 timestamp);
    event ElectionOpened(uint256 timestamp);
    event MerkleRootUpdated(bytes32 newMerkleRoot);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    constructor(address _verifierAddress, bytes32 _initialMerkleRoot, uint256 _electionId) {
        require(_verifierAddress != address(0), "Invalid verifier");
        admin = msg.sender;
        verifier = Groth16Verifier(_verifierAddress);
        merkleRoot = _initialMerkleRoot;
        electionId = _electionId;
        electionOpen = true;
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

        // Validate public signals match contract state & parameters
        require(bytes32(publicSignals[2]) == nullifierHash, "nullifier mismatch");
        require(bytes32(publicSignals[1]) == merkleRoot, "merkle root mismatch");
        require(publicSignals[0] == electionId, "election id mismatch");

        // Verify Groth16 zk-SNARK proof via Verifier contract
        require(verifier.verifyProof(a, b, c, publicSignals), "invalid proof");

        // Record nullifier and increment total votes
        nullifiers[nullifierHash] = true;
        totalVotes++;

        emit VoteRecorded(nullifierHash, encryptedVote, block.timestamp);
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
