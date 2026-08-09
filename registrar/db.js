const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "db.json");

function loadDb() {
    if (!fs.existsSync(DB_FILE)) {
        const initial = {
            events: [],
            registrations: [],
            merkle_leaves: []
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    try {
        const content = fs.readFileSync(DB_FILE, "utf8");
        return JSON.parse(content);
    } catch (err) {
        console.error("Error reading db.json, re-initializing:", err.message);
        const initial = { events: [], registrations: [], merkle_leaves: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
}

function saveDb(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

class Database {
    constructor() {
        this.data = loadDb();
    }

    reload() {
        this.data = loadDb();
    }

    // --- EVENTS ---
    getEvents() {
        return this.data.events;
    }

    getEventById(id) {
        return this.data.events.find(e => e.id.toString() === id.toString());
    }

    createEvent({ name, candidates, open_at, close_at }) {
        const nextId = (this.data.events.reduce((max, e) => Math.max(max, parseInt(e.id) || 0), 0) + 1).toString();
        const newEvent = {
            id: nextId,
            name,
            candidates: Array.isArray(candidates) ? candidates : [candidates],
            open_at: open_at || new Date().toISOString(),
            close_at: close_at || new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
            merkle_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
            status: "active",
            created_at: new Date().toISOString()
        };
        this.data.events.push(newEvent);
        saveDb(this.data);
        return newEvent;
    }

    updateEventRoot(id, merkleRoot) {
        const event = this.getEventById(id);
        if (event) {
            event.merkle_root = merkleRoot;
            saveDb(this.data);
        }
        return event;
    }

    closeEvent(id) {
        const event = this.getEventById(id);
        if (event) {
            event.status = "closed";
            saveDb(this.data);
        }
        return event;
    }

    // --- REGISTRATIONS ---
    getRegistrations(electionId) {
        if (!electionId) return this.data.registrations;
        return this.data.registrations.filter(r => r.election_id.toString() === electionId.toString());
    }

    getRegistrationByCommitment(commitment) {
        return this.data.registrations.find(r => r.commitment === commitment);
    }

    createRegistration({ election_id, commitment, proof_of_identity }) {
        const existing = this.getRegistrationByCommitment(commitment);
        if (existing) {
            return existing;
        }

        const newRegistration = {
            id: (this.data.registrations.length + 1).toString(),
            election_id: election_id.toString(),
            commitment,
            proof_of_identity: proof_of_identity || "voter-id-verified",
            status: "pending",
            leaf_index: null,
            created_at: new Date().toISOString()
        };

        this.data.registrations.push(newRegistration);
        saveDb(this.data);
        return newRegistration;
    }

    updateRegistrationStatus(commitment, status, leafIndex = null) {
        const reg = this.getRegistrationByCommitment(commitment);
        if (reg) {
            reg.status = status;
            if (leafIndex !== null) {
                reg.leaf_index = leafIndex;
            }
            saveDb(this.data);
        }
        return reg;
    }

    // --- MERKLE LEAVES ---
    getLeaves(electionId) {
        return this.data.merkle_leaves
            .filter(l => l.election_id.toString() === electionId.toString())
            .sort((a, b) => a.leaf_index - b.leaf_index);
    }

    addLeaf(electionId, commitment) {
        const leaves = this.getLeaves(electionId);
        const leafIndex = leaves.length;
        const newLeaf = {
            election_id: electionId.toString(),
            leaf_index: leafIndex,
            commitment
        };
        this.data.merkle_leaves.push(newLeaf);
        saveDb(this.data);
        return leafIndex;
    }
}

module.exports = new Database();
