const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const { initPoseidon } = require("../circuits/merkle");
const { getMerkleProof } = require("../db/incremental_merkle");

const app = express();
const PORT = process.env.PORT || 4000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin-secret-token";

app.use(cors());
app.use(express.json());

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
        res.json({ success: true, registrations });
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
