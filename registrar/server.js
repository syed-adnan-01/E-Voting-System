const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const { initPoseidon, MerkleTree } = require("../circuits/merkle");

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

// Helper: Build Merkle Tree for an election
function buildElectionTree(electionId) {
    const leavesData = db.getLeaves(electionId);
    const leaves = leavesData.map(l => l.commitment);
    const tree = new MerkleTree(10, leaves);
    return { tree, leavesData };
}

// --- PUBLIC ENDPOINTS ---

// GET /events — List all elections
app.get("/events", (req, res) => {
    const events = db.getEvents();
    res.json({ success: true, events });
});

// GET /events/:election_id — Get election details
app.get("/events/:election_id", (req, res) => {
    const event = db.getEventById(req.params.election_id);
    if (!event) {
        return res.status(404).json({ error: "Election event not found" });
    }
    res.json({ success: true, event });
});

// POST /register — Register a voter commitment
// STRICT SECURITY RULE: Only commitment (hash) and identity proof are accepted, NEVER raw secret.
app.post("/register", (req, res) => {
    const { election_id, commitment, proof_of_identity } = req.body;

    if (!election_id || !commitment) {
        return res.status(400).json({ error: "Missing election_id or commitment" });
    }

    const event = db.getEventById(election_id);
    if (!event) {
        return res.status(404).json({ error: "Election event not found" });
    }

    if (event.status !== "active") {
        return res.status(400).json({ error: "Election is not open for registration" });
    }

    const registration = db.createRegistration({
        election_id,
        commitment,
        proof_of_identity
    });

    res.json({
        success: true,
        message: "Registration submitted successfully. Awaiting admin approval.",
        registration
    });
});

// GET /registration-status/:commitment — Query registration status
app.get("/registration-status/:commitment", (req, res) => {
    const registration = db.getRegistrationByCommitment(req.params.commitment);
    if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
    }
    res.json({ success: true, registration });
});

// GET /merkle-root/:election_id — Get current Merkle root for election
app.get("/merkle-root/:election_id", (req, res) => {
    const event = db.getEventById(req.params.election_id);
    if (!event) {
        return res.status(404).json({ error: "Election event not found" });
    }

    const { tree, leavesData } = buildElectionTree(req.params.election_id);
    const rootHex = "0x" + BigInt(tree.getRoot()).toString(16).padStart(64, "0");

    res.json({
        success: true,
        election_id: req.params.election_id,
        merkle_root: rootHex,
        root_dec: tree.getRoot().toString(),
        total_leaves: leavesData.length
    });
});

// GET /merkle-path/:commitment — Get Merkle path for an approved commitment
app.get("/merkle-path/:commitment", (req, res) => {
    const registration = db.getRegistrationByCommitment(req.params.commitment);
    if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
    }

    if (registration.status !== "approved" || registration.leaf_index === null) {
        return res.status(403).json({ error: "Registration is not approved" });
    }

    const { tree } = buildElectionTree(registration.election_id);
    const proof = tree.getProof(registration.leaf_index);

    res.json({
        success: true,
        election_id: registration.election_id,
        commitment: registration.commitment,
        leafIndex: registration.leaf_index,
        root: proof.root,
        pathElements: proof.pathElements,
        pathIndices: proof.pathIndices
    });
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
app.post("/events", requireAdmin, (req, res) => {
    const { name, candidates, open_at, close_at } = req.body;

    if (!name || !candidates || !Array.isArray(candidates) || candidates.length === 0) {
        return res.status(400).json({ error: "Name and non-empty candidates array are required" });
    }

    const event = db.createEvent({ name, candidates, open_at, close_at });
    res.json({ success: true, election_id: event.id, event });
});

// GET /registrations/:election_id — List registrations for an election (Admin)
app.get("/registrations/:election_id", requireAdmin, (req, res) => {
    const registrations = db.getRegistrations(req.params.election_id);
    res.json({ success: true, registrations });
});

// POST /registrations/:commitment/approve — Approve voter registration (Admin)
app.post("/registrations/:commitment/approve", requireAdmin, (req, res) => {
    const { commitment } = req.params;
    const registration = db.getRegistrationByCommitment(commitment);

    if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
    }

    if (registration.status === "approved") {
        return res.json({ success: true, message: "Already approved", registration });
    }

    // Add commitment as leaf in Merkle tree
    const leafIndex = db.addLeaf(registration.election_id, commitment);
    const updatedReg = db.updateRegistrationStatus(commitment, "approved", leafIndex);

    // Recalculate tree root
    const { tree } = buildElectionTree(registration.election_id);
    const newRootDec = tree.getRoot().toString();
    const newRootHex = "0x" + BigInt(newRootDec).toString(16).padStart(64, "0");

    db.updateEventRoot(registration.election_id, newRootHex);

    res.json({
        success: true,
        message: "Registration approved and added to Merkle tree.",
        commitment,
        leaf_index: leafIndex,
        merkle_root: newRootHex,
        registration: updatedReg
    });
});

// POST /registrations/:commitment/reject — Reject voter registration (Admin)
app.post("/registrations/:commitment/reject", requireAdmin, (req, res) => {
    const { commitment } = req.params;
    const registration = db.getRegistrationByCommitment(commitment);

    if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
    }

    const updatedReg = db.updateRegistrationStatus(commitment, "rejected");
    res.json({ success: true, message: "Registration rejected.", registration: updatedReg });
});

// POST /events/:election_id/close — Close an election (Admin)
app.post("/events/:election_id/close", requireAdmin, (req, res) => {
    const event = db.closeEvent(req.params.election_id);
    if (!event) {
        return res.status(404).json({ error: "Election not found" });
    }
    res.json({ success: true, message: "Election closed.", event });
});

// Start Server if executed directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Registrar Service running on http://localhost:${PORT}`);
    });
}

module.exports = app;
