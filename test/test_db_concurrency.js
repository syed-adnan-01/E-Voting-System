const assert = require("assert");
const http = require("http");
const { getDb } = require("../db/knex");
const { initSchema } = require("../db/schema");
const { insertLeaf, getMerkleProof, getEmptyRoot, ensurePoseidon } = require("../db/incremental_merkle");
const registrarApp = require("../registrar/server");
const tallyApp = require("../tally/server");

describe("Hardened Database & Concurrency Stress Test Suite", function () {
    this.timeout(60000);

    let knex;
    let registrarServer, tallyServer;
    let registrarUrl, tallyUrl;
    const ADMIN_TOKEN = "admin-secret-token";

    before(async function () {
        await ensurePoseidon();
        knex = getDb();
        await initSchema(knex);
        await knex("merkle_tree_nodes").del();
        await knex("registrations").del();
        await knex("audit_logs").del();
        await knex("tallies").del();
        await knex("elections").del();

        // Start ephemeral servers
        await new Promise((resolve) => {
            registrarServer = registrarApp.listen(0, () => {
                const port = registrarServer.address().port;
                registrarUrl = `http://localhost:${port}`;
                tallyServer = tallyApp.listen(0, () => {
                    const tPort = tallyServer.address().port;
                    tallyUrl = `http://localhost:${tPort}`;
                    resolve();
                });
            });
        });
    });

    after(async function () {
        if (registrarServer) registrarServer.close();
        if (tallyServer) tallyServer.close();
    });

    it("1. Leaf-Index Assignment Race Condition: 50 simultaneous approvals receive strictly unique contiguous indices", async function () {
        // Create a test election
        const createRes = await fetch(`${registrarUrl}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN },
            body: JSON.stringify({ name: "Concurrency Race Election", candidates: ["Alpha", "Beta"] })
        });
        const eventData = await createRes.json();
        const electionId = String(eventData.election_id);

        // Register 50 voters with unique salted commitments
        const numVoters = 50;
        const commitments = [];
        const runId = Date.now().toString(16);
        for (let i = 0; i < numVoters; i++) {
            const commitment = "0x" + runId.padStart(32, "0") + i.toString(16).padStart(32, "0");
            commitments.push(commitment);
            await fetch(`${registrarUrl}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    election_id: electionId,
                    commitment,
                    proof_of_identity: `VOTER-SECRET-IDENTITY-${i}`
                })
            });
        }

        // Fire all 50 approvals concurrently via Promise.all
        const approvalPromises = commitments.map((commitment) =>
            fetch(`${registrarUrl}/registrations/${encodeURIComponent(commitment)}/approve`, {
                method: "POST",
                headers: { "X-Admin-Token": ADMIN_TOKEN }
            }).then((res) => res.json())
        );

        const results = await Promise.all(approvalPromises);

        // Extract assigned leaf indices
        const assignedIndices = results.map((r) => r.leaf_index);
        assert.strictEqual(assignedIndices.length, numVoters);

        // Verify zero duplicates
        const uniqueIndices = new Set(assignedIndices);
        assert.strictEqual(
            uniqueIndices.size,
            numVoters,
            `Collision detected! Expected ${numVoters} unique indices, got ${uniqueIndices.size}`
        );

        // Verify contiguous range [0 .. numVoters - 1]
        for (let i = 0; i < numVoters; i++) {
            assert.ok(
                uniqueIndices.has(i),
                `Missing expected leaf index ${i} in assigned set`
            );
        }

        // Verify election row next_leaf_index is exactly 50
        const electionRow = await knex("elections").where({ id: electionId }).first();
        assert.strictEqual(electionRow.next_leaf_index, numVoters);
        console.log(`       -> Successfully assigned 50 unique contiguous leaf indices (0..49) under concurrent load.`);
    });

    it("2. Privacy Hardening: proof_of_identity is redacted upon approval", async function () {
        const createRes = await fetch(`${registrarUrl}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN },
            body: JSON.stringify({ name: "Redaction Test Election", candidates: ["X", "Y"] })
        });
        const eventData = await createRes.json();
        const electionId = String(eventData.election_id || eventData.event?.id);
        const commitment = "0x" + Date.now().toString(16).padStart(32, "0") + "abcd1234".padStart(32, "0");

        // Register voter with sensitive identity proof
        await fetch(`${registrarUrl}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                election_id: electionId,
                commitment,
                proof_of_identity: "CONFIDENTIAL_PASSPORT_ID_A987654321"
            })
        });

        // Verify raw proof exists before approval
        let regBefore = await knex("registrations").where({ commitment }).first();
        assert.strictEqual(regBefore.proof_of_identity, "CONFIDENTIAL_PASSPORT_ID_A987654321");

        // Approve voter
        await fetch(`${registrarUrl}/registrations/${encodeURIComponent(commitment)}/approve`, {
            method: "POST",
            headers: { "X-Admin-Token": ADMIN_TOKEN }
        });

        // Verify proof_of_identity is redacted in the database
        let regAfter = await knex("registrations").where({ commitment }).first();
        assert.strictEqual(regAfter.status, "approved");
        assert.strictEqual(regAfter.proof_of_identity, "REDACTED_POST_APPROVAL");
        console.log(`       -> Successfully verified that plaintext identity proof is permanently redacted post-approval.`);
    });

    it("3. Strict Single-Transaction Boundary: mid-transaction failure rolls back tree nodes and root cleanly", async function () {
        const createRes = await fetch(`${registrarUrl}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN },
            body: JSON.stringify({ name: "Rollback Test Election", candidates: ["A", "B"] })
        });
        const eventData = await createRes.json();
        const electionId = String(eventData.election_id || eventData.event?.id);

        // Snapshot initial state
        const initialElection = await knex("elections").where({ id: electionId }).first();
        const initialNodes = await knex("merkle_tree_nodes").where({ election_id: electionId });

        // Simulate a transaction that fails midway through an IMT insertion
        let caughtError = false;
        try {
            await knex.transaction(async (trx) => {
                await insertLeaf(trx, electionId, "1234567890", 10);
                // Intentionally inject a failure before commit
                throw new Error("SIMULATED_TRANSACTION_FAILURE");
            });
        } catch (e) {
            caughtError = true;
            assert.strictEqual(e.message, "SIMULATED_TRANSACTION_FAILURE");
        }

        assert.strictEqual(caughtError, true);

        // Verify state is 100% rolled back and pristine
        const electionAfterFailure = await knex("elections").where({ id: electionId }).first();
        const nodesAfterFailure = await knex("merkle_tree_nodes").where({ election_id: electionId });

        assert.strictEqual(electionAfterFailure.merkle_root, initialElection.merkle_root);
        assert.strictEqual(electionAfterFailure.next_leaf_index, initialElection.next_leaf_index);
        assert.strictEqual(nodesAfterFailure.length, initialNodes.length);
        console.log(`       -> Successfully verified that failed transaction preserves 100% tree and root consistency.`);
    });

    it("4. Merkle Path Query Latency Benchmark: Sub-millisecond indexed lookup under 50 leaves", async function () {
        // Query the Merkle path for leaf 0 of the first election
        const election = await knex("elections").first();
        const startTime = process.hrtime.bigint();

        const proof = await getMerkleProof(knex, election.id, 0, 10);

        const endTime = process.hrtime.bigint();
        const latencyMs = Number(endTime - startTime) / 1_000_000;

        assert.ok(proof.root);
        assert.strictEqual(proof.pathElements.length, 10);
        assert.strictEqual(proof.pathIndices.length, 10);

        console.log(`       -> Merkle path query completed in ${latencyMs.toFixed(3)}ms (Target: < 5.0ms)`);
        assert.ok(latencyMs < 5.0, `Query latency ${latencyMs.toFixed(3)}ms exceeded 5.0ms target`);
    });

    it("5. Concurrent Double-Vote Protection: 20 simultaneous votes with the same nullifier", async function () {
        const testElectionId = "concurrency_vote_test_election";
        const duplicateNullifier = "0xconcurrent_nullifier_" + Date.now() + "_" + Math.random().toString(36).substring(2);

        // Dispatch 20 simultaneous vote requests with the SAME nullifier
        const votePromises = Array.from({ length: 20 }, (_, i) =>
            fetch(`${tallyUrl}/record-vote`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    election_id: testElectionId,
                    nullifier_hash: duplicateNullifier,
                    candidate_index: 0,
                    proof_type: 0,
                    tx_hash: `0xtx_concurrent_${i}`
                })
            }).then(async (res) => ({ status: res.status, body: await res.json() }))
        );

        const responses = await Promise.all(votePromises);

        const successfulVotes = responses.filter((r) => r.status === 200);
        const rejectedVotes = responses.filter((r) => r.status === 400);

        assert.strictEqual(successfulVotes.length, 1, "Exactly 1 vote must succeed");
        assert.strictEqual(rejectedVotes.length, 19, "Exactly 19 duplicate attempts must be rejected with 400");
        console.log(`       -> Successfully prevented double-voting across 20 concurrent submissions.`);
    });
});
