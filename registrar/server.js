const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
const { initPoseidon } = require("../circuits/merkle");
const { getMerkleProof } = require("../db/incremental_merkle");

const app = express();
const PORT = process.env.PORT || 4000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin-secret-token";

// Face Recognition Service Configuration
const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || "http://localhost:8000";
const FACE_SERVICE_SECRET = process.env.FACE_SERVICE_SECRET || "pqzkvote_face_service_secret_2026";
const ADMIN_FACE_ID = "admin-main";

// Deterministic 16-char voter face identifier derived from commitment
function deriveFaceId(commitment) {
    if (!commitment) return "";
    return crypto.createHash("sha256").update(String(commitment)).digest("hex").substring(0, 16);
}

// FR1.5 Privacy Guarantee: Delete ephemeral biometric profile upon approval or rejection
async function cleanupVoterFaceProfile(commitment) {
    if (!commitment) return;
    const faceId = deriveFaceId(commitment);
    try {
        const response = await fetch(`${FACE_SERVICE_URL}/face/profile/${faceId}`, {
            method: "DELETE",
            headers: { "X-Internal-Secret": FACE_SERVICE_SECRET }
        });
        if (response.ok) {
            console.log(`[registrar] Ephemeral face profile deleted for ${faceId} (FR1.5 compliance)`);
        } else if (response.status !== 404) {
            console.warn(`[registrar] Ephemeral face cleanup returned HTTP ${response.status} for ${faceId}`);
        }
    } catch (err) {
        // Face service offline or network issue; non-blocking to voting core
        console.warn(`[registrar] Non-blocking face cleanup notice for ${faceId}:`, err.message);
    }
}

app.use(cors());
app.use(express.json({ limit: "20mb" }));

// Initialize Poseidon instance on server startup
let poseidonInitialized = false;
initPoseidon().then(() => {
    poseidonInitialized = true;
    console.log("Poseidon hash engine initialized for Registrar.");
}).catch(err => {
    console.error("Failed to initialize Poseidon:", err);
});

// Middleware: Admin Authentication
function requireAdmin(req, res, next) {
    const token = req.headers["x-admin-token"] || req.query.admin_token;
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: "Unauthorized: Invalid admin token" });
    }
    next();
}

// --- PUBLIC ENDPOINTS ---

// GET /health
app.get("/health", async (req, res) => {
    try {
        await db._init();
        res.json({ status: "ok", service: "registrar-service", database: "connected", timestamp: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ status: "error", message: e.message });
    }
});

// GET /events — List all elections
app.get("/events", async (req, res) => {
    try {
        const events = await db.getEvents();
        res.json({ success: true, events });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /events/:election_id — Get election details
app.get("/events/:election_id", async (req, res) => {
    try {
        const event = await db.getEventById(req.params.election_id);
        if (!event) {
            return res.status(404).json({ error: "Election event not found" });
        }
        res.json({ success: true, event });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /register — Register a voter commitment
// STRICT SECURITY RULE: Only commitment (hash) and identity proof are accepted, NEVER raw secret.
app.post("/register", async (req, res) => {
    try {
        const { election_id, commitment, proof_of_identity } = req.body;

        if (!election_id || !commitment) {
            return res.status(400).json({ error: "Missing election_id or commitment" });
        }

        const event = await db.getEventById(election_id);
        if (!event) {
            return res.status(404).json({ error: "Election event not found" });
        }

        if (event.status !== "active") {
            return res.status(400).json({ error: "Election is not open for registration" });
        }

        const registration = await db.createRegistration({
            election_id,
            commitment,
            proof_of_identity
        });

        res.json({
            success: true,
            message: "Registration submitted successfully. Awaiting admin approval.",
            registration
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /registration-status/:commitment — Query registration status
app.get("/registration-status/:commitment", async (req, res) => {
    try {
        const registration = await db.getRegistrationByCommitment(req.params.commitment);
        if (!registration) {
            return res.status(404).json({ error: "Registration not found" });
        }
        res.json({ success: true, registration });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /merkle-root/:election_id — Get current Merkle root for election
app.get("/merkle-root/:election_id", async (req, res) => {
    try {
        const event = await db.getEventById(req.params.election_id);
        if (!event) {
            return res.status(404).json({ error: "Election event not found" });
        }

        const leavesData = await db.getLeaves(req.params.election_id);
        const rootHex = event.merkle_root;
        const rootDec = BigInt(rootHex).toString();

        res.json({
            success: true,
            election_id: req.params.election_id,
            merkle_root: rootHex,
            root_dec: rootDec,
            total_leaves: leavesData.length
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /merkle-path/:commitment — Get Merkle path for an approved commitment
app.get("/merkle-path/:commitment", async (req, res) => {
    try {
        const registration = await db.getRegistrationByCommitment(req.params.commitment);
        if (!registration) {
            return res.status(404).json({ error: "Registration not found" });
        }

        if (registration.status !== "approved" || registration.leaf_index === null) {
            return res.status(403).json({ error: "Registration is not approved" });
        }

        const proof = await getMerkleProof(db.knex, registration.election_id, registration.leaf_index, 10);

        res.json({
            success: true,
            election_id: registration.election_id,
            commitment: registration.commitment,
            leafIndex: registration.leaf_index,
            root: proof.root,
            pathElements: proof.pathElements,
            pathIndices: proof.pathIndices
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- ADMIN ENDPOINTS ---

// POST /admin/login — Admin authentication check
app.post("/admin/login", (req, res) => {
    const { token } = req.body;
    if (token === ADMIN_TOKEN) {
        return res.json({ success: true, token: ADMIN_TOKEN });
    }
    res.status(401).json({ error: "Invalid admin token" });
});

// GET /admin/face/profile — Check admin face enrollment status
app.get("/admin/face/profile", async (req, res) => {
    try {
        const response = await fetch(`${FACE_SERVICE_URL}/face/profile/${ADMIN_FACE_ID}`, {
            headers: { "X-Internal-Secret": FACE_SERVICE_SECRET }
        });
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            return res.status(response.status).json({
                enrolled: false,
                error: errData.detail || "Failed to query face service"
            });
        }
        const data = await response.json();
        res.json({
            success: true,
            enrolled: data.enrolled,
            embedding_count: data.embedding_count,
            model_version: data.model_version
        });
    } catch (err) {
        console.error("Face service connection error:", err.message);
        res.status(503).json({
            enrolled: false,
            error: "Face recognition service is currently unavailable",
            offline: true
        });
    }
});

// POST /admin/face/verify — Verify admin face biometric (1:1 matching with liveness)
app.post("/admin/face/verify", async (req, res) => {
    try {
        const { token, image, prev_image } = req.body;
        if (token !== ADMIN_TOKEN) {
            return res.status(401).json({ success: false, error: "Invalid admin token" });
        }
        if (!image) {
            return res.status(400).json({ success: false, error: "Face image is required" });
        }

        const response = await fetch(`${FACE_SERVICE_URL}/face/verify/${ADMIN_FACE_ID}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Secret": FACE_SERVICE_SECRET
            },
            body: JSON.stringify({
                image,
                prev_image: prev_image || undefined
            })
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                matched: false,
                error: data.detail || "Face verification failed"
            });
        }

        res.json({
            success: data.matched,
            matched: data.matched,
            confidence: data.confidence,
            similarity: data.similarity,
            message: data.message
        });
    } catch (err) {
        console.error("Face verification error:", err.message);
        res.status(503).json({
            success: false,
            matched: false,
            error: "Face recognition service is currently unavailable"
        });
    }
});

// POST /admin/face/enroll — Enroll admin face images (requires admin token)
app.post("/admin/face/enroll", requireAdmin, async (req, res) => {
    try {
        const { images } = req.body;
        if (!images || !Array.isArray(images) || images.length < 3) {
            return res.status(400).json({
                success: false,
                error: "At least 3 face image samples required for enrollment"
            });
        }

        const response = await fetch(`${FACE_SERVICE_URL}/face/enroll/${ADMIN_FACE_ID}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Secret": FACE_SERVICE_SECRET
            },
            body: JSON.stringify({
                images,
                subject_id_str: "System Administrator"
            })
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                error: data.detail || "Face enrollment failed"
            });
        }

        res.json({
            success: true,
            embeddings_created: data.embeddings_created,
            message: data.message
        });
    } catch (err) {
        console.error("Face enrollment error:", err.message);
        res.status(503).json({
            success: false,
            error: "Face recognition service is currently unavailable"
        });
    }
});

// DELETE /admin/face/profile — Reset admin face profile (requires admin token)
app.delete("/admin/face/profile", requireAdmin, async (req, res) => {
    try {
        const response = await fetch(`${FACE_SERVICE_URL}/face/profile/${ADMIN_FACE_ID}`, {
            method: "DELETE",
            headers: {
                "X-Internal-Secret": FACE_SERVICE_SECRET
            }
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                error: data.detail || "Failed to delete face profile"
            });
        }

        res.json({ success: true, message: "Admin face profile deleted successfully" });
    } catch (err) {
        console.error("Face profile deletion error:", err.message);
        res.status(503).json({
            success: false,
            error: "Face recognition service is currently unavailable"
        });
    }
});

// POST /voter-face/enroll — Enroll voter face images during registration (Public)
app.post("/voter-face/enroll", async (req, res) => {
    try {
        const { face_id, images } = req.body;
        if (!face_id) {
            return res.status(400).json({ success: false, error: "Missing face_id parameter" });
        }
        if (!images || !Array.isArray(images) || images.length < 3) {
            return res.status(400).json({
                success: false,
                error: "At least 3 face image samples required for enrollment"
            });
        }

        const response = await fetch(`${FACE_SERVICE_URL}/face/enroll/${face_id}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Secret": FACE_SERVICE_SECRET
            },
            body: JSON.stringify({
                images,
                subject_id_str: `Voter-${face_id}`
            })
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                error: data.detail || "Voter face enrollment failed"
            });
        }

        res.json({
            success: true,
            face_id,
            embeddings_created: data.embeddings_created,
            message: data.message
        });
    } catch (err) {
        console.error("Voter face enrollment error:", err.message);
        res.status(503).json({
            success: false,
            error: "Face recognition service is currently unavailable"
        });
    }
});

// GET /voter-face/profile/:face_id — Check voter face enrollment status
app.get("/voter-face/profile/:face_id", async (req, res) => {
    try {
        const { face_id } = req.params;
        const response = await fetch(`${FACE_SERVICE_URL}/face/profile/${face_id}`, {
            headers: { "X-Internal-Secret": FACE_SERVICE_SECRET }
        });
        if (!response.ok) {
            return res.status(response.status).json({ enrolled: false });
        }
        const data = await response.json();
        res.json({
            success: true,
            enrolled: data.enrolled,
            embedding_count: data.embedding_count
        });
    } catch (err) {
        res.status(503).json({ enrolled: false, error: "Face service offline" });
    }
});

// POST /admin/voter-face/verify — Verify voter face against enrolled profile during admin approval (Admin)
app.post("/admin/voter-face/verify", requireAdmin, async (req, res) => {
    try {
        const { face_id, image, prev_image } = req.body;
        if (!face_id) {
            return res.status(400).json({ success: false, error: "Missing voter face_id" });
        }
        if (!image) {
            return res.status(400).json({ success: false, error: "Live face image required for verification" });
        }

        const response = await fetch(`${FACE_SERVICE_URL}/face/verify/${face_id}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Secret": FACE_SERVICE_SECRET
            },
            body: JSON.stringify({
                image,
                prev_image: prev_image || undefined
            })
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                matched: false,
                error: data.detail || "Voter face verification failed"
            });
        }

        res.json({
            success: true,
            matched: data.matched,
            confidence: data.confidence,
            similarity: data.similarity,
            distance: data.distance,
            message: data.message
        });
    } catch (err) {
        console.error("Voter face verification error:", err.message);
        res.status(503).json({
            success: false,
            matched: false,
            error: "Face recognition service is currently unavailable"
        });
    }
});

// POST /events — Create a new election event (Admin)
app.post("/events", requireAdmin, async (req, res) => {
    try {
        const { name, candidates, open_at, close_at } = req.body;

        if (!name || !candidates || !Array.isArray(candidates) || candidates.length === 0) {
            return res.status(400).json({ error: "Name and non-empty candidates array are required" });
        }

        const event = await db.createEvent({ name, candidates, open_at, close_at });
        res.json({ success: true, election_id: event.id, event });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /registrations/:election_id — List registrations for an election (Admin)
app.get("/registrations/:election_id", requireAdmin, async (req, res) => {
    try {
        const registrations = await db.getRegistrations(req.params.election_id);
        const enhanced = registrations.map(reg => ({
            ...reg,
            face_id: deriveFaceId(reg.commitment)
        }));
        res.json({ success: true, registrations: enhanced });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /registrations/:commitment/approve — Approve voter registration (Admin)
// Executes atomic single-transaction leaf insertion, IMT branch update, root update, and identity redaction
app.post("/registrations/:commitment/approve", requireAdmin, async (req, res) => {
    try {
        const { commitment } = req.params;
        const result = await db.approveRegistration(commitment);

        if (result.error === "not_found") {
            return res.status(404).json({ error: "Registration not found" });
        }

        if (result.alreadyApproved) {
            return res.json({ success: true, message: "Already approved", registration: result.registration });
        }

        // FR1.5 Privacy Mandate: delete voter biometric profile now that decision is finalized
        await cleanupVoterFaceProfile(commitment);

        res.json({
            success: true,
            message: "Registration approved and added to Merkle tree.",
            commitment,
            leaf_index: result.leafIndex,
            merkle_root: result.merkleRoot,
            registration: result.registration
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /registrations/:commitment/reject — Reject voter registration (Admin)
app.post("/registrations/:commitment/reject", requireAdmin, async (req, res) => {
    try {
        const { commitment } = req.params;
        const registration = await db.getRegistrationByCommitment(commitment);

        if (!registration) {
            return res.status(404).json({ error: "Registration not found" });
        }

        const updatedReg = await db.updateRegistrationStatus(commitment, "rejected");

        // FR1.5 Privacy Mandate: delete voter biometric profile now that decision is finalized
        await cleanupVoterFaceProfile(commitment);

        res.json({ success: true, message: "Registration rejected.", registration: updatedReg });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /events/:election_id/close — Close an election (Admin)
app.post("/events/:election_id/close", requireAdmin, async (req, res) => {
    try {
        const event = await db.closeEvent(req.params.election_id);
        if (!event) {
            return res.status(404).json({ error: "Election event not found" });
        }
        res.json({ success: true, message: "Election closed.", event });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Start Server if executed directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Registrar Service running on http://localhost:${PORT}`);
    });
}

module.exports = app;
