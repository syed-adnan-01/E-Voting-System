/**
 * benchmarks/bench_gas.js
 * =======================
 * Hardhat script that measures on-chain gas costs for both proving tracks.
 *
 * Deploys fresh contracts, submits one vote via each track, and reports
 * the gas consumed by each submitVote / submitLatticeVote transaction.
 *
 * Usage (from contracts/ directory):
 *   npx hardhat run ../benchmarks/bench_gas.js --network hardhat
 *
 * Outputs JSON to stdout: { groth16_gas: int, lattice_gas: int }
 */

const fs = require("fs");
const path = require("path");

// Resolve paths relative to the project root (parent of contracts/)
const PROJECT_ROOT = path.resolve(__dirname, "..");

// We need to add the project root to the module search path so that
// require() calls in prove_vote.js and our snarkjs require work correctly.
const Module = require("module");
const originalResolveLookupPaths = Module._resolveLookupPaths;

async function main() {
    // When run via `npx hardhat run`, hardhat is available globally in the process
    const hre = require("hardhat");

    // snarkjs is installed in the project root's node_modules
    const snarkjs = require(path.join(PROJECT_ROOT, "node_modules", "snarkjs"));
    const [admin, voter] = await hre.ethers.getSigners();

    // -------------------------------------------------------------------------
    // 1. Generate a Groth16 proof
    // -------------------------------------------------------------------------
    process.stderr.write("[bench_gas] Generating Groth16 proof...\n");

    // Import proveVote dynamically to handle path resolution
    const { proveVote } = require(path.join(PROJECT_ROOT, "scripts", "prove_vote"));

    const proofData = await proveVote({
        voteValue: 1,
        credentialSecret: "123456789",
        electionId: "1",
        numCandidates: 4,
        leafIndex: 0,
        depth: 10,
        proofOutputPath: null,
        publicOutputPath: null
    });

    const calldataStr = await snarkjs.groth16.exportSolidityCallData(
        proofData.proof,
        proofData.publicSignals
    );
    const parsedCalldata = JSON.parse(`[${calldataStr}]`);
    const [formattedA, formattedB, formattedC, formattedPublicSignals] = parsedCalldata;

    const merkleRootBytes32 = "0x" + BigInt(proofData.publicSignals[1]).toString(16).padStart(64, "0");
    const nullifierHashBytes32 = "0x" + BigInt(proofData.publicSignals[2]).toString(16).padStart(64, "0");

    // -------------------------------------------------------------------------
    // 2. Deploy contracts
    // -------------------------------------------------------------------------
    process.stderr.write("[bench_gas] Deploying contracts...\n");

    const VerifierFactory = await hre.ethers.getContractFactory("Groth16Verifier");
    const verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();

    const LatticeVerifierFactory = await hre.ethers.getContractFactory("LatticeVerifier");
    const latticeVerifier = await LatticeVerifierFactory.deploy();
    await latticeVerifier.waitForDeployment();

    const VotingContractFactory = await hre.ethers.getContractFactory("VotingContract");
    const votingContract = await VotingContractFactory.deploy(
        await verifier.getAddress(),
        await latticeVerifier.getAddress(),
        merkleRootBytes32,
        1
    );
    await votingContract.waitForDeployment();

    // -------------------------------------------------------------------------
    // 3. Submit Groth16 vote and measure gas
    // -------------------------------------------------------------------------
    process.stderr.write("[bench_gas] Submitting Groth16 vote...\n");

    const encryptedVote = hre.ethers.toUtf8Bytes("benchmark_encrypted_vote");

    const groth16Tx = await votingContract.connect(voter).submitVote(
        formattedA,
        formattedB,
        formattedC,
        formattedPublicSignals,
        nullifierHashBytes32,
        encryptedVote
    );
    const groth16Receipt = await groth16Tx.wait();
    const groth16Gas = Number(groth16Receipt.gasUsed);

    // -------------------------------------------------------------------------
    // 4. Submit lattice vote and measure gas
    // -------------------------------------------------------------------------
    process.stderr.write("[bench_gas] Submitting lattice vote...\n");

    // Generate a distinct nullifier for the lattice vote to avoid "double vote"
    const latticeNullifier = "0x" + "ab".repeat(32);
    const latticeProofHash = "0x" + "cd".repeat(32);

    const latticeTx = await votingContract.connect(voter).submitLatticeVote(
        latticeProofHash,
        latticeNullifier,
        merkleRootBytes32,   // claimed root must match contract's stored root
        4,                   // num_candidates
        encryptedVote
    );
    const latticeReceipt = await latticeTx.wait();
    const latticeGas = Number(latticeReceipt.gasUsed);

    // -------------------------------------------------------------------------
    // 5. Output
    // -------------------------------------------------------------------------
    const result = {
        groth16_gas: groth16Gas,
        lattice_gas: latticeGas
    };

    process.stdout.write(JSON.stringify(result));
    process.stderr.write(`[bench_gas] Groth16 gas: ${groth16Gas}, Lattice gas: ${latticeGas}\n`);
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        process.stderr.write(`[bench_gas] Error: ${err.message}\n`);
        process.stderr.write(err.stack + "\n");
        // Output error as JSON so the orchestrator can detect it
        process.stdout.write(JSON.stringify({ error: err.message }));
        process.exit(1);
    });
