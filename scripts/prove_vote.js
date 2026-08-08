const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const { initPoseidon, generateLeaf, generateNullifier, MerkleTree } = require("../circuits/merkle");

async function proveVote({
    voteValue = 1,
    credentialSecret = "123456789",
    electionId = "1",
    numCandidates = 4,
    leafIndex = 0,
    depth = 10,
    proofOutputPath = path.join(__dirname, "../build/proof.json"),
    publicOutputPath = path.join(__dirname, "../build/public.json")
} = {}) {
    await initPoseidon();

    // Generate leaf and nullifier
    const leaf = generateLeaf(credentialSecret);
    const nullifierHash = generateNullifier(credentialSecret, electionId);

    // Build Merkle tree with voter's leaf
    const leaves = [];
    leaves[leafIndex] = leaf;
    const tree = new MerkleTree(depth, leaves);
    const proof = tree.getProof(leafIndex);

    const circuitInput = {
        electionId: electionId.toString(),
        merkleRoot: proof.root,
        nullifierHash: nullifierHash.toString(),
        numCandidates: numCandidates.toString(),
        voteValue: voteValue.toString(),
        credentialSecret: credentialSecret.toString(),
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices
    };

    const wasmPath = path.join(__dirname, "../build/vote_js/vote.wasm");
    const zkeyPath = path.join(__dirname, "../build/vote_final.zkey");

    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
        throw new Error("Build artifacts missing. Please run scripts/compile_circuit.sh first.");
    }

    const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        wasmPath,
        zkeyPath
    );

    if (proofOutputPath) {
        fs.mkdirSync(path.dirname(proofOutputPath), { recursive: true });
        fs.writeFileSync(proofOutputPath, JSON.stringify(zkProof, null, 2));
    }

    if (publicOutputPath) {
        fs.mkdirSync(path.dirname(publicOutputPath), { recursive: true });
        fs.writeFileSync(publicOutputPath, JSON.stringify(publicSignals, null, 2));
    }

    return { proof: zkProof, publicSignals, circuitInput };
}

// Allow CLI execution directly
if (require.main === module) {
    const args = process.argv.slice(2);
    const voteChoice = args[0] ? parseInt(args[0]) : 1;

    proveVote({ voteValue: voteChoice })
        .then(({ publicSignals }) => {
            console.log("=== Proof Generation Successful ===");
            console.log("Public Signals:", publicSignals);
            console.log("Proof saved to build/proof.json and build/public.json");
            process.exit(0);
        })
        .catch(err => {
            console.error("Proof Generation Failed:", err.message);
            process.exit(1);
        });
}

module.exports = { proveVote };
