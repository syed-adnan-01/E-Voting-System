const assert = require("assert");
const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const { initPoseidon, generateLeaf, generateNullifier, MerkleTree } = require("../circuits/merkle");
const { proveVote } = require("../scripts/prove_vote");
const { verifyVote } = require("../scripts/verify_vote");

describe("Classical ZK Voting Circuit (vote.circom)", function () {
    this.timeout(60000);

    const vkeyPath = path.join(__dirname, "../build/verification_key.json");
    const wasmPath = path.join(__dirname, "../build/vote_js/vote.wasm");
    const zkeyPath = path.join(__dirname, "../build/vote_final.zkey");

    before(async function () {
        await initPoseidon();
        assert.ok(fs.existsSync(vkeyPath), "Verification key exists");
        assert.ok(fs.existsSync(wasmPath), "Circuit WASM exists");
        assert.ok(fs.existsSync(zkeyPath), "ZKey file exists");
    });

    it("1. POSITIVE: Valid vote, secret, and Merkle path generates a valid proof", async function () {
        const credentialSecret = "987654321";
        const electionId = "1";
        const voteValue = 2; // Valid candidate index out of 4
        const numCandidates = 4;

        const { proof, publicSignals } = await proveVote({
            voteValue,
            credentialSecret,
            electionId,
            numCandidates,
            leafIndex: 3,
            proofOutputPath: null,
            publicOutputPath: null
        });

        assert.ok(proof, "Proof should be generated");
        assert.equal(publicSignals.length, 4, "Should have 4 public signals");
        assert.equal(publicSignals[0], electionId, "Public signal 0 is electionId");
        assert.equal(publicSignals[3], numCandidates.toString(), "Public signal 3 is numCandidates");

        const isValid = await verifyVote({
            proofObj: proof,
            publicObj: publicSignals,
            vkeyPath
        });

        assert.strictEqual(isValid, true, "Valid proof must pass verification");
    });

    it("2. NEGATIVE: Out-of-range candidate choice (voteValue >= numCandidates) fails witness generation", async function () {
        const invalidVoteValue = 5; // numCandidates is 4 (indices 0..3 allowed)
        const credentialSecret = "123456789";
        const electionId = "1";

        try {
            await proveVote({
                voteValue: invalidVoteValue,
                credentialSecret,
                electionId,
                numCandidates: 4,
                proofOutputPath: null,
                publicOutputPath: null
            });
            assert.fail("Proving should fail for out-of-range vote value");
        } catch (err) {
            assert.ok(
                err.message.includes("Error: Assert Failed") ||
                err.message.includes("Assert Failed") ||
                err.message.includes("witness") ||
                err.message.includes("LessThan"),
                `Expected constraint failure, got: ${err.message}`
            );
        }
    });

    it("3. NEGATIVE: Tampered nullifier hash in public signals fails verification", async function () {
        const { proof, publicSignals } = await proveVote({
            voteValue: 0,
            credentialSecret: "111222333",
            electionId: "1",
            proofOutputPath: null,
            publicOutputPath: null
        });

        // Copy and tamper with public nullifier hash (publicSignals[2])
        const tamperedPublicSignals = [...publicSignals];
        tamperedPublicSignals[2] = "99999999999999999999999999999999";

        const isValid = await verifyVote({
            proofObj: proof,
            publicObj: tamperedPublicSignals,
            vkeyPath
        });

        assert.strictEqual(isValid, false, "Tampered nullifier hash must be rejected");
    });

    it("4. NEGATIVE: Invalid Merkle path / fake secret fails witness generation", async function () {
        const realSecret = "55555";
        const fakeSecret = "99999";
        const electionId = "1";

        const realLeaf = generateLeaf(realSecret);
        const tree = new MerkleTree(10, [realLeaf]);
        const proofPath = tree.getProof(0);
        const nullifierHash = generateNullifier(fakeSecret, electionId);

        // Feed fakeSecret with path corresponding to realSecret
        const invalidInput = {
            electionId,
            merkleRoot: proofPath.root,
            nullifierHash: nullifierHash.toString(),
            numCandidates: "4",
            voteValue: "1",
            credentialSecret: fakeSecret, // Mismatch!
            pathElements: proofPath.pathElements,
            pathIndices: proofPath.pathIndices
        };

        try {
            await snarkjs.groth16.fullProve(invalidInput, wasmPath, zkeyPath);
            assert.fail("Proving should fail when secret does not match Merkle root");
        } catch (err) {
            assert.ok(
                err.message.includes("Assert Failed") || err.message.includes("witness"),
                `Expected Merkle root mismatch failure, got: ${err.message}`
            );
        }
    });

    it("5. NEGATIVE: Tampered proof payload fails verification", async function () {
        const { proof, publicSignals } = await proveVote({
            voteValue: 1,
            credentialSecret: "7777777",
            proofOutputPath: null,
            publicOutputPath: null
        });

        // Tamper with proof point pi_a
        const tamperedProof = JSON.parse(JSON.stringify(proof));
        tamperedProof.pi_a[0] = "12345678901234567890";

        const isValid = await verifyVote({
            proofObj: tamperedProof,
            publicObj: publicSignals,
            vkeyPath
        });

        assert.strictEqual(isValid, false, "Tampered proof points must fail verification");
    });
});
