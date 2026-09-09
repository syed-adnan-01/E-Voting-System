async function initSchema(knex) {
    // 1. Elections Table
    if (!(await knex.schema.hasTable("elections"))) {
        await knex.schema.createTable("elections", (table) => {
            table.string("id", 64).primary();
            table.string("name", 255).notNullable();
            table.text("candidates").notNullable(); // JSON stringified candidate list
            table.string("merkle_root", 66).notNullable();
            table.integer("next_leaf_index").defaultTo(0).notNullable();
            table.string("status", 32).defaultTo("active").notNullable();
            table.string("open_at", 64).notNullable();
            table.string("close_at", 64).notNullable();
            table.string("created_at", 64).notNullable();
        });
    }

    // 2. Registrations Table
    if (!(await knex.schema.hasTable("registrations"))) {
        await knex.schema.createTable("registrations", (table) => {
            table.increments("id").primary();
            table.string("election_id", 64).notNullable().references("id").inTable("elections").onDelete("CASCADE");
            table.string("commitment", 78).notNullable().unique();
            table.text("proof_of_identity").nullable();
            table.string("status", 32).defaultTo("pending").notNullable();
            table.integer("leaf_index").nullable();
            table.string("created_at", 64).notNullable();

            // Unique constraint on (election_id, leaf_index) to prevent any duplicate leaf assignments
            table.unique(["election_id", "leaf_index"]);
        });
    }

    // 3. Merkle Tree Nodes Table (Incremental Merkle Tree node cache)
    if (!(await knex.schema.hasTable("merkle_tree_nodes"))) {
        await knex.schema.createTable("merkle_tree_nodes", (table) => {
            table.string("election_id", 64).notNullable().references("id").inTable("elections").onDelete("CASCADE");
            table.integer("level").notNullable();
            table.integer("index_in_level").notNullable();
            table.string("node_hash", 78).notNullable();

            table.primary(["election_id", "level", "index_in_level"]);
        });
    }

    // 4. Tallies Table
    if (!(await knex.schema.hasTable("tallies"))) {
        await knex.schema.createTable("tallies", (table) => {
            table.string("election_id", 64).primary().references("id").inTable("elections").onDelete("CASCADE");
            table.integer("total_votes").defaultTo(0).notNullable();
            table.text("candidate_totals").notNullable(); // JSON stringified { [idx]: count }
            table.integer("proof_types_groth16").defaultTo(0).notNullable();
            table.integer("proof_types_lattice").defaultTo(0).notNullable();
        });
    }

    // 5. Audit Logs Table
    if (!(await knex.schema.hasTable("audit_logs"))) {
        await knex.schema.createTable("audit_logs", (table) => {
            table.increments("id").primary();
            table.string("election_id", 64).notNullable().references("id").inTable("elections").onDelete("CASCADE");
            table.string("nullifier_hash", 66).notNullable().unique(); // DB-level uniqueness constraint
            table.string("proof_type", 32).notNullable();
            table.string("tx_hash", 66).notNullable();
            table.bigInteger("timestamp").notNullable();
            table.text("encrypted_vote").nullable();

            table.index(["election_id", "timestamp"]);
        });
    }

    // 6. Anomalies Table
    if (!(await knex.schema.hasTable("anomalies"))) {
        await knex.schema.createTable("anomalies", (table) => {
            table.increments("id").primary();
            table.string("election_id", 64).notNullable();
            table.string("nullifier_hash", 66).notNullable();
            table.string("tx_hash", 66).nullable();
            table.float("timestamp").notNullable();
            table.float("score").notNullable();
            table.string("severity", 16).notNullable();
            table.text("reasons").notNullable();
            table.boolean("reviewed").defaultTo(false).notNullable();

            table.index(["election_id", "timestamp"]);
        });
    }
}

module.exports = {
    initSchema
};
