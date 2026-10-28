/**
 * test/test_face_phase3.js
 * =========================
 * Automated verification for Phase 3:
 * 1. FR1.5 Privacy Guarantee: Ephemeral face profile deletion on approval & rejection.
 * 2. Resilience: Non-blocking behavior when face-service is offline.
 */

const http = require("http");
const assert = require("assert");
const crypto = require("crypto");

// Setup mock face-service on port 9876
const mockStore = new Map();
let deleteCallCount = 0;
let lastDeletedFaceId = null;

const mockFaceServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    // Check internal secret header
    if (req.headers["x-internal-secret"] !== "test_secret_phase3") {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Unauthorized" }));
    }

    if (req.method === "POST" && url.pathname.startsWith("/face/enroll/")) {
        const subjectId = url.pathname.split("/").pop();
        mockStore.set(subjectId, { enrolled: true, count: 5 });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, embeddings_created: 5 }));
    }

    if (req.method === "GET" && url.pathname.startsWith("/face/profile/")) {
        const subjectId = url.pathname.split("/").pop();
        if (mockStore.has(subjectId)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ enrolled: true, embedding_count: 5 }));
        } else {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ detail: "Profile not found" }));
        }
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/face/profile/")) {
        const subjectId = url.pathname.split("/").pop();
        deleteCallCount++;
        lastDeletedFaceId = subjectId;
        const existed = mockStore.delete(subjectId);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, deleted: existed }));
    }

    res.writeHead(404);
    res.end();
});

async function runTests() {
    console.log("==========================================================================");
    console.log("       PHASE 3 VERIFICATION: FR1.5 PRIVACY DELETION & INTEGRATION        ");
    console.log("==========================================================================");

    // 1. Start mock face service
    await new Promise((resolve) => mockFaceServer.listen(9876, resolve));
    console.log("[+] Mock face service listening on http://localhost:9876");

    // Configure environment for registrar
    process.env.FACE_SERVICE_URL = "http://localhost:9876";
    process.env.FACE_SERVICE_SECRET = "test_secret_phase3";
    process.env.ADMIN_TOKEN = "test-admin-secret-token";
    process.env.PORT = "0";

    const registrarApp = require("../registrar/server");
    const registrarServer = http.createServer(registrarApp);
    await new Promise((resolve) => registrarServer.listen(0, resolve));
    const registrarPort = registrarServer.address().port;
    const REG_URL = `http://localhost:${registrarPort}`;
    console.log(`[+] Registrar test instance running on ${REG_URL}`);

    try {
        // --- TEST 1: Ephemeral deletion on registration APPROVAL ---
        console.log("\n[Test 1] Testing automatic face profile deletion on voter APPROVAL...");
        const commitment1 = "0x" + crypto.randomBytes(32).toString("hex");
        const faceId1 = crypto.createHash("sha256").update(commitment1).digest("hex").substring(0, 16);

        // Pre-enroll face in mock face service
        mockStore.set(faceId1, { enrolled: true, count: 5 });
        assert.strictEqual(mockStore.has(faceId1), true, "Face profile should exist before approval");

        // Submit registration to registrar
        const regRes1 = await fetch(`${REG_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                election_id: "1",
                commitment: commitment1,
                proof_of_identity: "Student-Alice-123"
            })
        });
        const regData1 = await regRes1.json();
        assert.strictEqual(regData1.success, true, "Registration should succeed");

        // Approve voter registration
        const prevDeleteCount = deleteCallCount;
        const approveRes = await fetch(`${REG_URL}/registrations/${encodeURIComponent(commitment1)}/approve`, {
            method: "POST",
            headers: { "X-Admin-Token": "test-admin-secret-token" }
        });
        const approveData = await approveRes.json();
        assert.strictEqual(approveData.success, true, "Approval should succeed");

        // Verify DELETE was triggered on mock face service
        assert.strictEqual(deleteCallCount, prevDeleteCount + 1, "DELETE request should have been sent to face service");
        assert.strictEqual(lastDeletedFaceId, faceId1, `Face ID deleted must match derived ID: ${faceId1}`);
        assert.strictEqual(mockStore.has(faceId1), false, "Face profile must be deleted from face service storage!");
        console.log("  ✓ PASSED: Voter biometric profile deleted automatically on approval (FR1.5 compliant).");

        // --- TEST 2: Ephemeral deletion on registration REJECTION ---
        console.log("\n[Test 2] Testing automatic face profile deletion on voter REJECTION...");
        const commitment2 = "0x" + crypto.randomBytes(32).toString("hex");
        const faceId2 = crypto.createHash("sha256").update(commitment2).digest("hex").substring(0, 16);

        // Pre-enroll face
        mockStore.set(faceId2, { enrolled: true, count: 5 });
        assert.strictEqual(mockStore.has(faceId2), true, "Face profile should exist before rejection");

        // Submit registration
        const regRes2 = await fetch(`${REG_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                election_id: "1",
                commitment: commitment2,
                proof_of_identity: "Student-Bob-456"
            })
        });
        const regData2 = await regRes2.json();
        assert.strictEqual(regData2.success, true);

        // Reject voter registration
        const prevDeleteCount2 = deleteCallCount;
        const rejectRes = await fetch(`${REG_URL}/registrations/${encodeURIComponent(commitment2)}/reject`, {
            method: "POST",
            headers: { "X-Admin-Token": "test-admin-secret-token" }
        });
        const rejectData = await rejectRes.json();
        assert.strictEqual(rejectData.success, true, "Rejection should succeed");

        // Verify DELETE was triggered
        assert.strictEqual(deleteCallCount, prevDeleteCount2 + 1, "DELETE request should have been sent to face service on rejection");
        assert.strictEqual(lastDeletedFaceId, faceId2, `Face ID deleted must match derived ID: ${faceId2}`);
        assert.strictEqual(mockStore.has(faceId2), false, "Face profile must be deleted from face service storage on rejection!");
        console.log("  ✓ PASSED: Voter biometric profile deleted automatically on rejection (FR1.5 compliant).");

        // --- TEST 3: Offline Resilience (Non-blocking) ---
        console.log("\n[Test 3] Testing registrar non-blocking resilience when face service is offline...");
        // Close mock server
        await new Promise((resolve) => mockFaceServer.close(resolve));

        const commitment3 = "0x" + crypto.randomBytes(32).toString("hex");
        await fetch(`${REG_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                election_id: "1",
                commitment: commitment3,
                proof_of_identity: "Student-Charlie-789"
            })
        });

        // Approve should still succeed even though face service is dead
        const offlineApproveRes = await fetch(`${REG_URL}/registrations/${encodeURIComponent(commitment3)}/approve`, {
            method: "POST",
            headers: { "X-Admin-Token": "test-admin-secret-token" }
        });
        const offlineApproveData = await offlineApproveRes.json();
        assert.strictEqual(offlineApproveData.success, true, "Approval must not fail if face service is unreachable");
        console.log("  ✓ PASSED: Approval succeeds without blocking when face service is offline.");

        console.log("\n==========================================================================");
        console.log("       ALL PHASE 3 VERIFICATION TESTS PASSED SUCCESSFULLY!               ");
        console.log("==========================================================================");

    } finally {
        registrarServer.close();
        try { mockFaceServer.close(); } catch (_) {}
    }
}

runTests().catch((err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
});
