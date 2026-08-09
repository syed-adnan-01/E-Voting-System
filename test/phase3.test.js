const assert = require("assert");
const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const { initPoseidon, generateLeaf, generateNullifier } = require("../circuits/merkle");
const { proveVote } = require("../scripts/prove_vote");
const { verifyVote } = require("../scripts/verify_vote");

describe("Phase 3 Integration Test (Registrar, Admin & Voter Workflow)", function () {
    this.timeout(60000);

    let registrarApp;
    let server;
    const PORT = 4005;
    const BASE_URL = `http://localhost:${PORT}`;
    const ADMIN_TOKEN = "admin-secret-token";

    let electionId;
    let voterSecret = "999111222333";
    let commitmentHash;

    before(async function () {
        await initPoseidon();

        // Remove old test db.json if present
        const dbPath = path.join(__dirname, "../registrar/db.json");
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }

        // Start Registrar App instance
        registrarApp = require("../registrar/server");
        server = http.createServer(registrarApp);
        await new Promise((resolve) => server.listen(PORT, resolve));
    });

    after(function (done) {
        if (server) {
            server.close(done);
        } else {
            done();
        }
    });

    it("1. Admin creates a new voting event via POST /events", async function () {
        const res = await fetch(`${BASE_URL}/events`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Admin-Token": ADMIN_TOKEN
            },
            body: JSON.stringify({
                name: "Phase 3 Integration Election",
                candidates: ["Candidate Alpha", "Candidate Beta"]
            })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.ok(data.election_id);
        electionId = data.election_id;
    });

    it("2. Voter computes local commitment and registers via POST /register", async function () {
        const leafBigInt = generateLeaf(voterSecret);
        commitmentHash = leafBigInt.toString();

        const res = await fetch(`${BASE_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                election_id: electionId,
                commitment: commitmentHash,
                proof_of_identity: "TEST-IDENTITY-PROOF-123"
            })
        });

        const data = await res.json();
        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.registration.status, "pending");
    });

    it("3. Admin lists and approves the voter commitment via POST /registrations/:commitment/approve", async function () {
        // List registrations
        const listRes = await fetch(`${BASE_URL}/registrations/${electionId}`, {
            headers: { "X-Admin-Token": ADMIN_TOKEN }
        });
        const listData = await listRes.json();
        assert.strictEqual(listData.registrations.length, 1);
        assert.strictEqual(listData.registrations[0].status, "pending");

        // Approve registration
        const approveRes = await fetch(`${BASE_URL}/registrations/${encodeURIComponent(commitmentHash)}/approve`, {
            method: "POST",
            headers: { "X-Admin-Token": ADMIN_TOKEN }
        });
        const approveData = await approveRes.json();
        assert.strictEqual(approveRes.status, 200);
        assert.strictEqual(approveData.success, true);
        assert.strictEqual(approveData.leaf_index, 0);
        assert.ok(approveData.merkle_root);
    });

    it("4. Approved voter fetches Merkle path via GET /merkle-path/:commitment", async function () {
        const res = await fetch(`${BASE_URL}/merkle-path/${encodeURIComponent(commitmentHash)}`);
        const data = await res.json();

        assert.strictEqual(res.status, 200);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.leafIndex, 0);
        assert.strictEqual(data.pathElements.length, 10);
        assert.strictEqual(data.pathIndices.length, 10);
        assert.ok(data.root);
    });

    it("5. Voter generates valid Groth16 ZK proof using fetched Merkle tree path", async function () {
        const { proof, publicSignals } = await proveVote({
            voteValue: 0,
            credentialSecret: voterSecret,
            electionId: electionId.toString(),
            numCandidates: 2,
            leafIndex: 0,
            depth: 10,
            proofOutputPath: null,
            publicOutputPath: null
        });

        assert.ok(proof);
        assert.strictEqual(publicSignals.length, 4);

        const isValid = await verifyVote({
            proofObj: proof,
            publicObj: publicSignals,
            vkeyPath: path.join(__dirname, "../build/verification_key.json")
        });

        assert.strictEqual(isValid, true, "Generated proof must verify cleanly");
    });

    it("6. NEGATIVE: Unauthorized admin request is rejected with 401", async function () {
        const res = await fetch(`${BASE_URL}/events`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Admin-Token": "invalid-token"
            },
            body: JSON.stringify({ name: "Unauthorized Event", candidates: ["X", "Y"] })
        });
        assert.strictEqual(res.status, 401);
    });

    it("7. NEGATIVE: Merkle path query for non-approved commitment returns 403 or 404", async function () {
        const fakeCommitment = "9999999999999999999";
        const res = await fetch(`${BASE_URL}/merkle-path/${fakeCommitment}`);
        assert.ok(res.status === 403 || res.status === 404);
    });
});
