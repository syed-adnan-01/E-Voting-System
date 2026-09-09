const fs = require("fs");
const path = require("path");
const { getDb } = require("../db/knex");
const { initSchema } = require("../db/schema");
const { insertLeaf, getEmptyRoot, ensurePoseidon } = require("../db/incremental_merkle");

const DB_FILE = path.join(__dirname, "db.json");

class Database {
    constructor() {
        this.knex = getDb();
        this.initialized = false;
        this.initPromise = this._init();
    }

    async _init() {
        if (this.initialized) return;
        await ensurePoseidon();
        await initSchema(this.knex);

        // If db.json does not exist (e.g. wiped by a test setup), reset the tables for a clean test run
        if (!fs.existsSync(DB_FILE)) {
            await this.reset();
        } else {
            // If db.json exists but DB tables are empty, import from db.json
            const eventCount = await this.knex("elections").count("id as count").first();
            if (Number(eventCount?.count || 0) === 0) {
                await this._importFromJson();
            }
        }
        this.initialized = true;
    }

    async reset() {
        await ensurePoseidon();
        await initSchema(this.knex);
        await this.knex("merkle_tree_nodes").del();
        await this.knex("registrations").del();
        await this.knex("elections").del();
        this._writeJsonSnapshot({ events: [], registrations: [], merkle_leaves: [] });
    }

    async _importFromJson() {
        if (!fs.existsSync(DB_FILE)) return;
        try {
            const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
            if (data.events && Array.isArray(data.events)) {
                for (const ev of data.events) {
                    await this.knex("elections").insert({
                        id: String(ev.id),
                        name: ev.name,
                        candidates: JSON.stringify(ev.candidates || []),
                        merkle_root: ev.merkle_root || await getEmptyRoot(10),
                        next_leaf_index: 0,
                        status: ev.status || "active",
                        open_at: ev.open_at || new Date().toISOString(),
                        close_at: ev.close_at || new Date().toISOString(),
                        created_at: ev.created_at || new Date().toISOString()
                    }).onConflict("id").ignore();
                }
            }
            if (data.registrations && Array.isArray(data.registrations)) {
                for (const reg of data.registrations) {
                    await this.knex("registrations").insert({
                        id: reg.id ? Number(reg.id) : undefined,
                        election_id: String(reg.election_id),
                        commitment: reg.commitment,
                        proof_of_identity: reg.proof_of_identity,
                        status: reg.status || "pending",
                        leaf_index: reg.leaf_index !== undefined ? reg.leaf_index : null,
                        created_at: reg.created_at || new Date().toISOString()
                    }).onConflict("commitment").ignore();
                }
            }
        } catch (e) {
            console.error("Warning importing from db.json:", e.message);
        }
    }

    _writeJsonSnapshot(data) {
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
        } catch (e) {
            // Ignore snapshot write errors
        }
    }

    async _syncJsonSnapshot() {
        try {
            const events = await this.getEvents();
            const registrations = await this.knex("registrations").select("*");
            const leaves = await this.knex("registrations")
                .where({ status: "approved" })
                .whereNotNull("leaf_index")
                .orderBy("leaf_index", "asc");

            const formattedRegs = registrations.map(r => ({
                id: String(r.id),
                election_id: String(r.election_id),
                commitment: r.commitment,
                proof_of_identity: r.proof_of_identity,
                status: r.status,
                leaf_index: r.leaf_index,
                created_at: r.created_at
            }));

            const formattedLeaves = leaves.map(l => ({
                election_id: String(l.election_id),
                leaf_index: l.leaf_index,
                commitment: l.commitment
            }));

            this._writeJsonSnapshot({
                events,
                registrations: formattedRegs,
                merkle_leaves: formattedLeaves
            });
        } catch (e) {
            // Non-fatal
        }
    }

    // --- EVENTS ---
    async getEvents() {
        await this._init();
        const rows = await this.knex("elections").select("*").orderBy("id", "asc");
        return rows.map(r => ({
            ...r,
            candidates: typeof r.candidates === "string" ? JSON.parse(r.candidates) : r.candidates
        }));
    }

    async getEventById(id) {
        await this._init();
        const row = await this.knex("elections").where({ id: String(id) }).first();
        if (!row) return null;
        return {
            ...row,
            candidates: typeof row.candidates === "string" ? JSON.parse(row.candidates) : row.candidates
        };
    }

    async createEvent({ name, candidates, open_at, close_at }) {
        await this._init();
        const rows = await this.knex("elections").select("id");
        let maxId = 0;
        for (const r of rows) {
            const parsed = parseInt(r.id, 10);
            if (!isNaN(parsed) && parsed > maxId) {
                maxId = parsed;
            }
        }
        const nextId = (maxId + 1).toString();

        const emptyRoot = await getEmptyRoot(10);
        const newEvent = {
            id: nextId,
            name,
            candidates: JSON.stringify(Array.isArray(candidates) ? candidates : [candidates]),
            open_at: open_at || new Date().toISOString(),
            close_at: close_at || new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
            merkle_root: emptyRoot,
            next_leaf_index: 0,
            status: "active",
            created_at: new Date().toISOString()
        };

        await this.knex("elections").insert(newEvent);
        await this._syncJsonSnapshot();

        return {
            ...newEvent,
            candidates: Array.isArray(candidates) ? candidates : [candidates]
        };
    }

    async updateEventRoot(id, merkleRoot) {
        await this._init();
        await this.knex("elections").where({ id: String(id) }).update({ merkle_root: merkleRoot });
        await this._syncJsonSnapshot();
        return this.getEventById(id);
    }

    async closeEvent(id) {
        await this._init();
        await this.knex("elections").where({ id: String(id) }).update({ status: "closed" });
        await this._syncJsonSnapshot();
        return this.getEventById(id);
    }

    // --- REGISTRATIONS ---
    async getRegistrations(electionId) {
        await this._init();
        const query = this.knex("registrations").select("*");
        if (electionId) {
            query.where({ election_id: String(electionId) });
        }
        const rows = await query.orderBy("id", "asc");
        return rows.map(r => ({
            id: String(r.id),
            election_id: String(r.election_id),
            commitment: r.commitment,
            proof_of_identity: r.proof_of_identity,
            status: r.status,
            leaf_index: r.leaf_index,
            created_at: r.created_at
        }));
    }

    async getRegistrationByCommitment(commitment) {
        await this._init();
        const row = await this.knex("registrations").where({ commitment }).first();
        if (!row) return null;
        return {
            id: String(row.id),
            election_id: String(row.election_id),
            commitment: row.commitment,
            proof_of_identity: row.proof_of_identity,
            status: row.status,
            leaf_index: row.leaf_index,
            created_at: row.created_at
        };
    }

    async createRegistration({ election_id, commitment, proof_of_identity }) {
        await this._init();
        const existing = await this.getRegistrationByCommitment(commitment);
        if (existing) {
            return existing;
        }

        const newRegistration = {
            election_id: String(election_id),
            commitment,
            proof_of_identity: proof_of_identity || "voter-id-verified",
            status: "pending",
            leaf_index: null,
            created_at: new Date().toISOString()
        };

        const [insertedId] = await this.knex("registrations").insert(newRegistration);
        await this._syncJsonSnapshot();

        return {
            id: String(insertedId || (await this.getRegistrationByCommitment(commitment)).id),
            ...newRegistration
        };
    }

    async updateRegistrationStatus(commitment, status, leafIndex = null) {
        await this._init();
        const updateData = { status };
        if (leafIndex !== null) {
            updateData.leaf_index = leafIndex;
        }
        await this.knex("registrations").where({ commitment }).update(updateData);
        await this._syncJsonSnapshot();
        return this.getRegistrationByCommitment(commitment);
    }

    /**
     * Hardened Atomic Approval:
     * Executes leaf index assignment, IMT branch node updates, elections.merkle_root update,
     * and identity proof redaction inside a SINGLE atomic transaction.
     */
    async approveRegistration(commitment) {
        await this._init();

        return await this.knex.transaction(async (trx) => {
            const reg = await trx("registrations").where({ commitment }).first();
            if (!reg) {
                return { error: "not_found" };
            }

            if (reg.status === "approved") {
                const event = await trx("elections").where({ id: reg.election_id }).first();
                return {
                    alreadyApproved: true,
                    leafIndex: reg.leaf_index,
                    merkleRoot: event.merkle_root,
                    registration: {
                        id: String(reg.id),
                        election_id: String(reg.election_id),
                        commitment: reg.commitment,
                        proof_of_identity: reg.proof_of_identity,
                        status: reg.status,
                        leaf_index: reg.leaf_index,
                        created_at: reg.created_at
                    }
                };
            }

            // Insert leaf into Incremental Merkle Tree atomically
            const { leafIndex, rootHex } = await insertLeaf(trx, reg.election_id, commitment, 10);

            // Redact / purge plaintext proof_of_identity upon approval (Privacy Hardening)
            const redactedProof = "REDACTED_POST_APPROVAL";

            await trx("registrations").where({ commitment }).update({
                status: "approved",
                leaf_index: leafIndex,
                proof_of_identity: redactedProof
            });

            const updatedReg = await trx("registrations").where({ commitment }).first();

            return {
                leafIndex,
                merkleRoot: rootHex,
                registration: {
                    id: String(updatedReg.id),
                    election_id: String(updatedReg.election_id),
                    commitment: updatedReg.commitment,
                    proof_of_identity: updatedReg.proof_of_identity,
                    status: updatedReg.status,
                    leaf_index: updatedReg.leaf_index,
                    created_at: updatedReg.created_at
                }
            };
        });
    }

    // --- MERKLE LEAVES ---
    async getLeaves(electionId) {
        await this._init();
        const rows = await this.knex("registrations")
            .where({
                election_id: String(electionId),
                status: "approved"
            })
            .whereNotNull("leaf_index")
            .orderBy("leaf_index", "asc");

        return rows.map(r => ({
            election_id: String(r.election_id),
            leaf_index: r.leaf_index,
            commitment: r.commitment
        }));
    }

    async addLeaf(electionId, commitment) {
        await this._init();
        return await this.knex.transaction(async (trx) => {
            const { leafIndex } = await insertLeaf(trx, electionId, commitment, 10);
            return leafIndex;
        });
    }
}

module.exports = new Database();
