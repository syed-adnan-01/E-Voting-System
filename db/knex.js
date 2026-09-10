const path = require("path");
const fs = require("fs");
const knex = require("knex");

let dbInstance = null;

function getDb(customConfig = null) {
    if (dbInstance && !customConfig) {
        return dbInstance;
    }

    const isPostgres = Boolean(process.env.DATABASE_URL);
    const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, "../data/pq_zkvote.sqlite");

    if (!isPostgres) {
        const dataDir = path.dirname(dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    const config = customConfig || (isPostgres
        ? {
            client: "pg",
            connection: {
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
            },
            pool: { min: 2, max: 20 }
        }
        : {
            client: "better-sqlite3",
            connection: {
                filename: dbPath
            },
            useNullAsDefault: true,
            pool: {
                afterCreate: (db, done) => {
                    // WAL mode for high concurrency
                    db.pragma("journal_mode = WAL");
                    db.pragma("synchronous = NORMAL");
                    db.pragma("foreign_keys = ON");
                    db.pragma("busy_timeout = 5000");
                    done(null, db);
                }
            }
        });

    const instance = knex(config);
    if (!customConfig) {
        dbInstance = instance;
    }
    return instance;
}

async function closeDb() {
    if (dbInstance) {
        await dbInstance.destroy();
        dbInstance = null;
    }
}

module.exports = {
    getDb,
    closeDb
};
