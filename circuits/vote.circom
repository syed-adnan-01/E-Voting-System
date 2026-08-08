pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// Merkle tree inclusion verification helper
template MerkleTreeInclusionProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component hashers[levels];
    signal selectors[levels][2];

    signal hashes[levels + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // Enforce pathIndices[i] is strictly binary (0 or 1)
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Select left and right inputs based on pathIndices[i]
        // If pathIndices[i] == 0: left = hashes[i], right = pathElements[i]
        // If pathIndices[i] == 1: left = pathElements[i], right = hashes[i]
        selectors[i][0] <== (pathElements[i] - hashes[i]) * pathIndices[i] + hashes[i];
        selectors[i][1] <== (hashes[i] - pathElements[i]) * pathIndices[i] + pathElements[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== selectors[i][0];
        hashers[i].inputs[1] <== selectors[i][1];

        hashes[i + 1] <== hashers[i].out;
    }

    root <== hashes[levels];
}

// Main PQ-ZKVote Classical Proving Template
template Vote(levels) {
    // Public inputs
    signal input electionId;
    signal input merkleRoot;
    signal input nullifierHash;
    signal input numCandidates;

    // Private inputs
    signal input voteValue;
    signal input credentialSecret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // 1. Vote Range Check: 0 <= voteValue < numCandidates
    component rangeCheck = LessThan(32);
    rangeCheck.in[0] <== voteValue;
    rangeCheck.in[1] <== numCandidates;
    rangeCheck.out === 1;

    // 2. Nullifier Derivation: nullifierHash === Poseidon([credentialSecret, electionId])
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== credentialSecret;
    nullifierHasher.inputs[1] <== electionId;
    nullifierHasher.out === nullifierHash;

    // 3. Merkle Membership Proof
    // Identity Leaf = Poseidon([credentialSecret])
    component leafHasher = Poseidon(1);
    leafHasher.inputs[0] <== credentialSecret;

    component merkleProof = MerkleTreeInclusionProof(levels);
    merkleProof.leaf <== leafHasher.out;
    for (var i = 0; i < levels; i++) {
        merkleProof.pathElements[i] <== pathElements[i];
        merkleProof.pathIndices[i] <== pathIndices[i];
    }

    // Enforce computed Merkle root equals public merkleRoot
    merkleProof.root === merkleRoot;
}

// Instantiate main circuit with TREE_DEPTH = 10
component main {public [electionId, merkleRoot, nullifierHash, numCandidates]} = Vote(10);
