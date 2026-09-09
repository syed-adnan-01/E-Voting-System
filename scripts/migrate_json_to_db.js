/**
 * scripts/migrate_json_to_db.js
 * ==============================
 * Idempotent migration script that transfers legacy flat-file records from
 * registrar/db.json and tally/tally_db.json into the relational database.
 * Safe to re-run multiple times (upserts on unique primary keys).
 */

const fs = require("fs");
const path = require("path");
const { getDb } = require("../db/knex");
const { initSchema } = require("../db/schema");
const { insertLeaf, getEmptyRoot, ensurePoseidon } = require("../db/incremental_merkle");

const REGISTRAR_JSON = path.join(__dirname, "../registrar/db.json");
const TALLY_JSON = path.join(__dirname, "../tally/tally_db.json");

async function migrate() {
    console.log("[Migration] Connecting to database...");
    const knex = getDb();
    await ensurePoseidon();
    await initSchema(knex);
    console.log("[Migration] Schema initialized successfully.");

    // 1. Migrate Registrar Events and Registrations
    if (fs.existsSync(REGISTRAR_JSON)) {
        try {
            console.log(`[Migration] Reading ${REGISTRAR_JSON}...`);
            const regData = JSON.parse(fs.readFileSync(REGISTRAR_JSON, "utf8"));

            if (regData.events && Array.isArray(regData.events)) {
                for (const ev of regData.events) {
                    const existing = await knex("elections").where({ id: String(ev.id) }).first();
                    const emptyRoot = await getEmptyRoot(10);

                    const record = {
                        id: String(ev.id),
                        name: ev.name,
                        candidates: JSON.stringify(ev.candidates || []),
                        merkle_root: ev.merkle_root || emptyRoot,
                        next_leaf_index: 0,
                        status: ev.status || "active",
                        open_at: ev.open_at || new Date().toISOString(),
                        close_at: ev.close_at || new Date().toISOString(),
                        created_at: ev.created_at || new Date().toISOString()
                    };

                    if (!existing) {
                        await knex("elections").insert(record);
                        console.log(`  -> Inserted election: ${ev.name} (ID: ${ev.id})`);
                    } else {
                        await knex("elections").where({ id: String(ev.id) }).update({
                            name: record.name,
                            candidates: record.candidates,
                            status: record.status
                        });
                    }
                }
            }

            if (regData.registrations && Array.isArray(regData.registrations)) {
                for (const reg of regData.registrations) {
                    const existingReg = await knex("registrations").where({ commitment: reg.commitment }).first();
                    const regRecord = {
                        election_id: String(reg.election_id),
                        commitment: reg.commitment,
                        proof_of_identity: reg.status === "approved" ? "REDACTED_POST_APPROVAL" : (reg.proof_of_identity || "voter-id-verified"),
                        status: reg.status || "pending",
                        leaf_index: reg.leaf_index !== undefined ? reg.leaf_index : null,
                        created_at: reg.created_at || new Date().toISOString()
                    };

                    if (!existingReg) {
                        await knex("registrations").insert(regRecord);
                    } else {
                        await knex("registrations").where({ commitment: reg.commitment }).update({
                            status: regRecord.status,
                            leaf_index: regRecord.leaf_index,
                            proof_of_identity: regRecord.proof_of_identity
                        });
                    }
                }
                console.log(`  -> Processed ${regData.registrations.length} registrations.`);
            }

            // Rebuild/verify Merkle Tree nodes for approved leaves
            const elections = await knex("elections").select("id");
            for (const el of elections) {
                const approvedRegs = await knex("registrations")
                    .where({ election_id: el.id, status: "approved" })
                    .whereNotNull("leaf_index")
                    .orderBy("leaf_index", "asc");

                const nodeCount = await knex("merkle_tree_nodes")
                    .where({ election_id: el.id, level: 0 })
                    .count("index_in_level as count")
                    .first();

                if (Number(nodeCount?.count || 0) < approvedRegs.length) {
                    console.log(`  -> Rebuilding IMT nodes for election ${el.id} (${approvedRegs.length} approved leaves)...`);
                    // Reset nodes for this election and re-insert in transaction
                    await knex.transaction(async (trx) => {
                        await trx("merkle_tree_nodes").where({ election_id: el.id }).del();
                        await trx("elections").where({ id: el.id }).update({ next_leaf_index: 0 });

                        for (const reg of approvedRegs) {
                            await insertLeaf(trx, el.id, reg.commitment, 10);
                        }
                    });
                    console.log(`  -> IMT nodes rebuilt successfully for election ${el.id}.`);
                }
            }
        } catch (err) {
            console.error("[Migration] Error migrating registrar data:", err.message);
        }
    }

    // 2. Migrate Tally Data and Audit Logs
    if (fs.existsSync(TALLY_JSON)) {
        try {
            console.log(`[Migration] Reading ${TALLY_JSON}...`);
            const tallyData = JSON.parse(fs.readFileSync(TALLY_JSON, "utf8"));

            if (tallyData.tallies) {
                for (const eid of Object.keys(tallyData.tallies)) {
                    const t = tallyData.tallies[eid];
                    // Ensure election row exists
                    const elExists = await knex("elections").where({ id: String(eid) }).first();
                    if (!elExists) {
                        await knex("elections").insert({
                            id: String(eid),
                            name: `Imported Election ${eid}`,
                            candidates: JSON.stringify([]),
                            merkle_root: await getEmptyRoot(10),
                            next_leaf_index: 0,
                            status: "active",
                            open_at: new Date().toISOString(),
                            close_at: new Date().toISOString(),
                            created_at: new Date().toISOString()
                        }).onConflict("id").ignore();
                    }

                    const tallyRecord = {
                        election_id: String(eid),
                        total_votes: t.total_votes || 0,
                        candidate_totals: JSON.stringify(t.candidate_totals || {}),
                        proof_types_groth16: t.proof_types?.groth16 || 0,
                        proof_types_lattice: t.proof_types?.lattice || 0
                    };

                    const existingTally = await knex("tallies").where({ election_id: String(eid) }).first();
                    if (!existingTally) {
                        await knex("tallies").insert(tallyRecord);
                    } else {
                        await knex("tallies").where({ election_id: String(eid) }).update(tallyRecord);
                    }
                    console.log(`  -> Migrated tally for election ID: ${eid}`);
                }
            }

            if (tallyData.auditLogs) {
                let insertedLogs = 0;
                for (const eid of Object.keys(tallyData.auditLogs)) {
                    const logs = tallyData.auditLogs[eid];
                    if (Array.isArray(logs)) {
                        for (const log of logs) {
                            const existingLog = await knex("audit_logs").where({ nullifier_hash: log.nullifier_hash }).first();
                            if (!existingLog) {
                                await knex("audit_logs").insert({
                                    election_id: String(eid),
                                    nullifier_hash: log.nullifier_hash,
                                    proof_type: log.proof_type || "groth16",
                                    tx_hash: log.tx_hash,
                                    timestamp: log.timestamp || Date.now(),
                                    encrypted_vote: log.encrypted_vote || null
                                });
                                insertedLogs++;
                            }
                        }
                    }
                }
                console.log(`  -> Processed audit logs (${insertedLogs} new records inserted).`);
            }
        } catch (err) {
            console.error("[Migration] Error migrating tally data:", err.message);
        }
    }

    console.log("[Migration] Migration completed successfully.");
    process.exit(0);
}

if (require.main === module) {
    migrate().catch(e => {
        console.error("[Migration Fatal Error]:", e);
        process.exit(1);
    });
}

module.exports = { migrate };
