/**
 * benchmarks/bench_classical.js
 * =============================
 * Benchmarks the Groth16 (classical) ZK proving track.
 *
 * Measures:
 *   1. Proof generation time (wall clock, N runs)
 *   2. Verification time (N runs)
 *   3. Proof size in bytes (JSON-serialised)
 *   4. Peak memory usage (process RSS)
 *
 * Outputs a JSON object to stdout for the Python orchestrator to parse.
 *
 * Usage:
 *   node benchmarks/bench_classical.js [--runs N]
 */

const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const { initPoseidon, generateLeaf, generateNullifier, MerkleTree } = require("../circuits/merkle");

const BUILD_DIR = path.join(__dirname, "..", "build");
const WASM_PATH = path.join(BUILD_DIR, "vote_js", "vote.wasm");
const ZKEY_PATH = path.join(BUILD_DIR, "vote_final.zkey");
const VKEY_PATH = path.join(BUILD_DIR, "verification_key.json");

// Test parameters (same as prove_vote.js defaults for fair comparison)
const DEFAULT_SECRET = "123456789";
const DEFAULT_ELECTION_ID = "1";
const DEFAULT_NUM_CANDIDATES = 4;
const DEFAULT_LEAF_INDEX = 0;
const DEFAULT_DEPTH = 10;

function parseArgs() {
    const args = process.argv.slice(2);
    let runs = 100;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--runs" && args[i + 1]) {
            runs = parseInt(args[i + 1]);
        }
    }
    return { runs };
}

async function buildCircuitInput(voteValue) {
    await initPoseidon();

    const leaf = generateLeaf(DEFAULT_SECRET);
    const nullifierHash = generateNullifier(DEFAULT_SECRET, DEFAULT_ELECTION_ID);

    const leaves = [];
    leaves[DEFAULT_LEAF_INDEX] = leaf;
    const tree = new MerkleTree(DEFAULT_DEPTH, leaves);
    const proof = tree.getProof(DEFAULT_LEAF_INDEX);

    return {
        electionId: DEFAULT_ELECTION_ID,
        merkleRoot: proof.root,
        nullifierHash: nullifierHash.toString(),
        numCandidates: DEFAULT_NUM_CANDIDATES.toString(),
        voteValue: voteValue.toString(),
        credentialSecret: DEFAULT_SECRET,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices
    };
}

function hrTimeMs(hrtime) {
    return hrtime[0] * 1000 + hrtime[1] / 1e6;
}

async function main() {
    const { runs } = parseArgs();

    // Validate build artifacts exist
    if (!fs.existsSync(WASM_PATH) || !fs.existsSync(ZKEY_PATH)) {
        console.error(JSON.stringify({
            error: "Build artifacts missing. Run scripts/compile_circuit.sh first."
        }));
        process.exit(1);
    }

    const vKey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));

    // Prepare circuit input (done once, outside the timed loop)
    const circuitInput = await buildCircuitInput(1);

    // -------------------------------------------------------------------------
    // 1. Proof generation benchmark
    // -------------------------------------------------------------------------
    const proveTimes = [];
    let lastProof = null;
    let lastPublicSignals = null;
    let peakRssProve = 0;

    // Warm-up run (not counted)
    process.stderr.write(`[bench_classical] Warm-up run...\n`);
    const warmup = await snarkjs.groth16.fullProve(circuitInput, WASM_PATH, ZKEY_PATH);

    process.stderr.write(`[bench_classical] Running ${runs} proof generation iterations...\n`);
    for (let i = 0; i < runs; i++) {
        const rss0 = process.memoryUsage().rss;
        const t0 = process.hrtime();
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            circuitInput, WASM_PATH, ZKEY_PATH
        );
        const elapsed = process.hrtime(t0);
        const rss1 = process.memoryUsage().rss;

        proveTimes.push(hrTimeMs(elapsed));
        lastProof = proof;
        lastPublicSignals = publicSignals;
        peakRssProve = Math.max(peakRssProve, rss1);

        if ((i + 1) % 10 === 0) {
            process.stderr.write(`  [prove] ${i + 1}/${runs}\n`);
        }
    }

    // -------------------------------------------------------------------------
    // 2. Verification benchmark
    // -------------------------------------------------------------------------
    const verifyTimes = [];

    process.stderr.write(`[bench_classical] Running ${runs} verification iterations...\n`);
    for (let i = 0; i < runs; i++) {
        const t0 = process.hrtime();
        await snarkjs.groth16.verify(vKey, lastPublicSignals, lastProof);
        const elapsed = process.hrtime(t0);
        verifyTimes.push(hrTimeMs(elapsed));

        if ((i + 1) % 10 === 0) {
            process.stderr.write(`  [verify] ${i + 1}/${runs}\n`);
        }
    }

    // -------------------------------------------------------------------------
    // 3. Proof size
    // -------------------------------------------------------------------------
    const proofSizeBytes = Buffer.byteLength(JSON.stringify(lastProof), "utf8");

    // -------------------------------------------------------------------------
    // Output
    // -------------------------------------------------------------------------
    const result = {
        prove_times_ms: proveTimes,
        verify_times_ms: verifyTimes,
        proof_size_bytes: proofSizeBytes,
        peak_memory_bytes: peakRssProve,
        runs: runs
    };

    process.stdout.write(JSON.stringify(result));
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
    });
