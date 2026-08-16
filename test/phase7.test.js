const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");

describe("Phase 7 Integration Test — Tallying Service & Audit Log", function () {
    this.timeout(60000);

    let tallyApp;
    let server;
    const PORT = 4007;
    const BASE_URL = `http://localhost:${PORT}`;
    const DB_FILE = path.join(__dirname, "../tally/tally_db.json");

    before(async function () {
        // Clean up test DB file
        if (fs.existsSync(DB_FILE)) {
            fs.unlinkSync(DB_FILE);
        }

        process.env.PORT = PORT;
        tallyApp = require("../tally/server");
        server = http.createServer(tallyApp);
        await new Promise((resolve) => server.listen(PORT, resolve));
    });

    after(function (done) {
        if (server) {
            server.close(done);
        } else {
            done();
        }
        // Clean up DB after test
        if (fs.existsSync(DB_FILE)) {
            fs.unlinkSync(DB_FILE);
        }
    });

    it("1. GET /health returns service status ok", async function () {
        const res = await fetch(`${BASE_URL}/health`);
        const data = await res.json();

        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.status, "ok");
        assert.strictEqual(data.service, "tallying-service");
    });

    it("2. POST /record-vote aggregates classical Groth16 votes correctly", async function () {
        const votePayload = {
            election_id: "701",
            nullifier_hash: "0xnullifier_groth16_1",
            candidate_index: 0,
            proof_type: 0, // Groth16
            tx_hash: "0xtx_groth16_1",
            timestamp: Date.now()
        };

        const res = await fetch(`${BASE_URL}/record-vote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(votePayload)
        });

        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.tally.total_votes, 1);
        assert.strictEqual(data.tally.candidate_totals["0"], 1);
        assert.strictEqual(data.tally.proof_types.groth16, 1);
    });

    it("3. POST /record-vote aggregates QRZ-KPA Lattice PQC votes correctly", async function () {
        const votePayload = {
            election_id: "701",
            nullifier_hash: "0xnullifier_lattice_1",
            candidate_index: 1,
            proof_type: 1, // Lattice
            tx_hash: "0xtx_lattice_1",
            timestamp: Date.now()
        };

        const res = await fetch(`${BASE_URL}/record-vote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(votePayload)
        });

        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.tally.total_votes, 2);
        assert.strictEqual(data.tally.candidate_totals["1"], 1);
        assert.strictEqual(data.tally.proof_types.lattice, 1);
    });

    it("4. Prevents duplicate nullifier recording in tallying service", async function () {
        const duplicatePayload = {
            election_id: "701",
            nullifier_hash: "0xnullifier_groth16_1", // Reused nullifier
            candidate_index: 0,
            proof_type: 0,
            tx_hash: "0xtx_dup"
        };

        const res = await fetch(`${BASE_URL}/record-vote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(duplicatePayload)
        });

        const data = await res.json();
        assert.strictEqual(res.status, 400);
        assert.strictEqual(data.error.includes("already been tallied"), true);
    });

    it("5. GET /tally/701 retrieves correct aggregated per-candidate counts", async function () {
        const res = await fetch(`${BASE_URL}/tally/701`);
        const data = await res.json();

        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.total_votes, 2);
        assert.strictEqual(data.candidate_totals["0"], 1);
        assert.strictEqual(data.candidate_totals["1"], 1);
        assert.strictEqual(data.proof_types.groth16, 1);
        assert.strictEqual(data.proof_types.lattice, 1);
    });

    it("6. GET /audit-log/701 returns public non-PII audit ledger", async function () {
        const res = await fetch(`${BASE_URL}/audit-log/701`);
        const data = await res.json();

        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.total_records, 2);
        assert.strictEqual(data.audit_log.length, 2);

        // Ensure zero voter identity PII present in audit log
        const logItem = data.audit_log[0];
        assert.ok(logItem.nullifier_hash);
        assert.ok(logItem.proof_type);
        assert.ok(logItem.tx_hash);
        assert.strictEqual(logItem.voter_secret, undefined);
        assert.strictEqual(logItem.identity_proof, undefined);
    });
});
