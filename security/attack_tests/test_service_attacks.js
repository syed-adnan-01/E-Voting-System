const assert = require("assert");
const http = require("http");

// Import service Express apps
const registrarApp = require("../../registrar/server");
const tallyApp = require("../../tally/server");

describe("Security Attack Tests — Service APIs (Registrar & Tally)", function () {
    this.timeout(10000);

    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin-secret-token";
    const INVALID_TOKEN = "hacker-invalid-token";

    let registrarServer;
    let registrarUrl;
    let tallyServer;
    let tallyUrl;

    before(function (done) {
        registrarServer = registrarApp.listen(0, () => {
            const port = registrarServer.address().port;
            registrarUrl = `http://localhost:${port}`;

            tallyServer = tallyApp.listen(0, () => {
                const tPort = tallyServer.address().port;
                tallyUrl = `http://localhost:${tPort}`;
                done();
            });
        });
    });

    after(function (done) {
        if (registrarServer) registrarServer.close();
        if (tallyServer) tallyServer.close();
        done();
    });

    describe("1. Registrar Service Access Control & Authentication Attacks", function () {
        it("Rejects GET /registrations/:election_id without admin token (401)", async function () {
            const res = await fetch(`${registrarUrl}/registrations/1`);
            const data = await res.json();

            assert.strictEqual(res.status, 401);
            assert.strictEqual(data.error, "Unauthorized: Invalid admin token");
        });

        it("Rejects GET /registrations/:election_id with invalid admin token (401)", async function () {
            const res = await fetch(`${registrarUrl}/registrations/1`, {
                headers: { "x-admin-token": INVALID_TOKEN }
            });
            const data = await res.json();

            assert.strictEqual(res.status, 401);
            assert.strictEqual(data.error, "Unauthorized: Invalid admin token");
        });

        it("Rejects POST /events (Create Election) without admin token (401)", async function () {
            const res = await fetch(`${registrarUrl}/events`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Malicious Election", candidates: ["A", "B"] })
            });

            assert.strictEqual(res.status, 401);
        });

        it("Rejects POST /registrations/:commitment/approve without admin token (401)", async function () {
            const res = await fetch(`${registrarUrl}/registrations/0x12345/approve`, {
                method: "POST"
            });

            assert.strictEqual(res.status, 401);
        });

        it("Rejects POST /events/:election_id/close without admin token (401)", async function () {
            const res = await fetch(`${registrarUrl}/events/1/close`, {
                method: "POST"
            });

            assert.strictEqual(res.status, 401);
        });
    });

    describe("2. Registrar Service Registration & Validation Attacks", function () {
        it("Rejects registration for non-existent election (404)", async function () {
            const res = await fetch(`${registrarUrl}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    election_id: "999999",
                    commitment: "0x1111222233334444555566667777888899990000"
                })
            });
            const data = await res.json();

            assert.strictEqual(res.status, 404);
            assert.strictEqual(data.error, "Election event not found");
        });

        it("Rejects registration missing election_id or commitment (400)", async function () {
            const res = await fetch(`${registrarUrl}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    commitment: "0x1111222233334444555566667777888899990000"
                })
            });
            const data = await res.json();

            assert.strictEqual(res.status, 400);
            assert.strictEqual(data.error, "Missing election_id or commitment");
        });

        it("Security Invariant: Registrar never stores or accepts raw voter secrets", async function () {
            const validCommitment = "0x" + "a".repeat(64);
            const res = await fetch(`${registrarUrl}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    election_id: "1",
                    commitment: validCommitment,
                    proof_of_identity: { passport: "ID-999" }
                })
            });
            const data = await res.json();

            assert.ok([200, 400].includes(res.status));
            assert.strictEqual(data.credential_secret, undefined);
            assert.strictEqual(data.secret, undefined);
        });
    });

    describe("3. Tallying Service Security Attacks", function () {
        const testElectionId = "sec_test_election_" + Date.now();
        const testNullifier = "0x" + Math.random().toString(16).substring(2).padStart(64, "0");

        it("Rejects POST /record-vote with missing required parameters (400)", async function () {
            const res = await fetch(`${tallyUrl}/record-vote`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    election_id: testElectionId
                })
            });
            const data = await res.json();

            assert.strictEqual(res.status, 400);
            assert.ok(data.error.includes("Missing required vote parameters"));
        });

        it("Accepts valid vote recording on initial request", async function () {
            const res = await fetch(`${tallyUrl}/record-vote`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    election_id: testElectionId,
                    nullifier_hash: testNullifier,
                    candidate_index: 0,
                    proof_type: 0,
                    encrypted_vote: "0x1234"
                })
            });
            const data = await res.json();

            assert.strictEqual(res.status, 200);
            assert.strictEqual(data.success, true);
            assert.strictEqual(data.record.nullifier_hash, testNullifier);
        });

        it("Rejects duplicate nullifier recording in tally DB (400)", async function () {
            const res = await fetch(`${tallyUrl}/record-vote`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    election_id: testElectionId,
                    nullifier_hash: testNullifier, // Reused nullifier
                    candidate_index: 1,
                    proof_type: 0,
                    encrypted_vote: "0x5678"
                })
            });
            const data = await res.json();

            assert.strictEqual(res.status, 400);
            assert.strictEqual(data.error, "Nullifier has already been tallied for this election");
        });

        it("Verifies public audit log contains non-PII zero-knowledge audit records", async function () {
            const res = await fetch(`${tallyUrl}/audit-log/${testElectionId}`);
            const data = await res.json();

            assert.strictEqual(res.status, 200);
            assert.ok(data.audit_log.length >= 1);
            const record = data.audit_log[0];
            assert.ok(record.nullifier_hash);
            assert.ok(record.tx_hash);
            assert.strictEqual(record.credential_secret, undefined);
            assert.strictEqual(record.vote_value, undefined);
        });
    });
});
