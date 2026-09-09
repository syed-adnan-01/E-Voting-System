const { initPoseidon } = require("../circuits/merkle");

let poseidon;
let F;
let zerosCache = {};

async function ensurePoseidon() {
    if (!poseidon) {
        const res = await initPoseidon();
        poseidon = res.poseidon;
        F = res.F;
    }
    return { poseidon, F };
}

function poseidonHash(inputs) {
    if (!poseidon) throw new Error("Poseidon not initialized.");
    const res = poseidon(inputs);
    return F.toObject(res);
}

async function getZeroHashes(depth = 10) {
    await ensurePoseidon();
    if (zerosCache[depth]) {
        return zerosCache[depth];
    }
    const zeros = new Array(depth + 1);
    zeros[0] = BigInt(0);
    for (let i = 1; i <= depth; i++) {
        zeros[i] = poseidonHash([zeros[i - 1], zeros[i - 1]]);
    }
    zerosCache[depth] = zeros;
    return zeros;
}

async function getEmptyRoot(depth = 10) {
    const zeros = await getZeroHashes(depth);
    return "0x" + BigInt(zeros[depth]).toString(16).padStart(64, "0");
}

/**
 * Atomically inserts a leaf into the Incremental Merkle Tree inside an active transaction.
 * Updates branch nodes up to depth, updates election root and next_leaf_index.
 */
async function insertLeaf(trx, electionId, commitment, depth = 10) {
    await ensurePoseidon();
    const zeros = await getZeroHashes(depth);

    // Acquire election record (with write intent)
    const electionQuery = trx("elections").where({ id: String(electionId) });
    if (trx.client && trx.client.driverName === "pg") {
        electionQuery.forUpdate();
    }
    const election = await electionQuery.first();
    if (!election) {
        throw new Error(`Election ${electionId} not found`);
    }

    const leafIndex = election.next_leaf_index || 0;
    const maxCapacity = Math.pow(2, depth);
    if (leafIndex >= maxCapacity) {
        throw new Error(`Merkle tree capacity exceeded (max: ${maxCapacity})`);
    }

    const leafBigInt = BigInt(commitment);
    let currentHash = leafBigInt;
    let currentIndex = leafIndex;

    // Collect all node updates to batch upsert
    const nodeUpdates = [];
    nodeUpdates.push({
        election_id: String(electionId),
        level: 0,
        index_in_level: leafIndex,
        node_hash: leafBigInt.toString()
    });

    for (let level = 0; level < depth; level++) {
        const isRight = currentIndex % 2 === 1;
        const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

        // Fetch sibling hash from DB or use precomputed zero hash
        const siblingRecord = await trx("merkle_tree_nodes")
            .where({
                election_id: String(electionId),
                level,
                index_in_level: siblingIndex
            })
            .first();

        const siblingHash = siblingRecord ? BigInt(siblingRecord.node_hash) : zeros[level];

        const left = isRight ? siblingHash : currentHash;
        const right = isRight ? currentHash : siblingHash;
        const parentHash = poseidonHash([left, right]);

        currentIndex = Math.floor(currentIndex / 2);
        currentHash = parentHash;

        nodeUpdates.push({
            election_id: String(electionId),
            level: level + 1,
            index_in_level: currentIndex,
            node_hash: parentHash.toString()
        });
    }

    // Upsert nodes in merkle_tree_nodes
    for (const node of nodeUpdates) {
        const exists = await trx("merkle_tree_nodes")
            .where({
                election_id: node.election_id,
                level: node.level,
                index_in_level: node.index_in_level
            })
            .first();

        if (exists) {
            await trx("merkle_tree_nodes")
                .where({
                    election_id: node.election_id,
                    level: node.level,
                    index_in_level: node.index_in_level
                })
                .update({ node_hash: node.node_hash });
        } else {
            await trx("merkle_tree_nodes").insert(node);
        }
    }

    // Root at level = depth
    const rootDec = currentHash.toString();
    const rootHex = "0x" + BigInt(currentHash).toString(16).padStart(64, "0");

    // Atomically update election root and next_leaf_index in the same transaction
    await trx("elections")
        .where({ id: String(electionId) })
        .update({
            merkle_root: rootHex,
            next_leaf_index: leafIndex + 1
        });

    return {
        leafIndex,
        rootDec,
        rootHex
    };
}

/**
 * Computes the Merkle inclusion proof for a given leaf index in O(D) database queries.
 */
async function getMerkleProof(knex, electionId, leafIndex, depth = 10) {
    await ensurePoseidon();
    const zeros = await getZeroHashes(depth);

    const election = await knex("elections").where({ id: String(electionId) }).first();
    if (!election) {
        throw new Error(`Election ${electionId} not found`);
    }

    const maxCapacity = Math.pow(2, depth);
    if (leafIndex < 0 || leafIndex >= maxCapacity) {
        throw new Error(`Index out of bounds: ${leafIndex}`);
    }

    const pathElements = [];
    const pathIndices = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < depth; level++) {
        const isRight = currentIndex % 2 === 1;
        const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

        const siblingRecord = await knex("merkle_tree_nodes")
            .where({
                election_id: String(electionId),
                level,
                index_in_level: siblingIndex
            })
            .first();

        const siblingHash = siblingRecord ? siblingRecord.node_hash : zeros[level].toString();

        pathElements.push(siblingHash);
        pathIndices.push(isRight ? 1 : 0);

        currentIndex = Math.floor(currentIndex / 2);
    }

    // Leaf hash from level 0
    const leafRecord = await knex("merkle_tree_nodes")
        .where({
            election_id: String(electionId),
            level: 0,
            index_in_level: leafIndex
        })
        .first();

    const rootBigInt = BigInt(election.merkle_root);

    return {
        leafIndex,
        pathElements,
        pathIndices,
        root: rootBigInt.toString(),
        rootHex: election.merkle_root,
        leaf: leafRecord ? leafRecord.node_hash : zeros[0].toString()
    };
}

module.exports = {
    ensurePoseidon,
    getZeroHashes,
    getEmptyRoot,
    insertLeaf,
    getMerkleProof
};
