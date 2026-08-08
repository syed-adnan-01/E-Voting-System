const { buildPoseidon } = require("circomlibjs");

let poseidon;
let F;

async function initPoseidon() {
    if (!poseidon) {
        poseidon = await buildPoseidon();
        F = poseidon.F;
    }
    return { poseidon, F };
}

function poseidonHash(inputs) {
    if (!poseidon) throw new Error("Poseidon not initialized. Call initPoseidon() first.");
    const res = poseidon(inputs);
    return F.toObject(res);
}

function generateLeaf(credentialSecret) {
    return poseidonHash([BigInt(credentialSecret)]);
}

function generateNullifier(credentialSecret, electionId) {
    return poseidonHash([BigInt(credentialSecret), BigInt(electionId)]);
}

class MerkleTree {
    constructor(depth = 10, leaves = []) {
        this.depth = depth;
        this.zeroValue = BigInt(0);
        this.zeros = new Array(depth);
        this.tree = new Array(depth + 1);

        // Precompute zero hashes for each level
        this.zeros[0] = this.zeroValue;
        for (let i = 1; i < depth; i++) {
            this.zeros[i] = poseidonHash([this.zeros[i - 1], this.zeros[i - 1]]);
        }

        // Initialize levels
        for (let i = 0; i <= depth; i++) {
            this.tree[i] = [];
        }

        // Fill leaf level
        const numLeaves = Math.pow(2, depth);
        for (let i = 0; i < numLeaves; i++) {
            this.tree[0][i] = (i < leaves.length && leaves[i] !== undefined && leaves[i] !== null) 
                ? BigInt(leaves[i]) 
                : this.zeros[0];
        }

        // Build upper levels
        for (let level = 0; level < depth; level++) {
            for (let i = 0; i < this.tree[level].length; i += 2) {
                const left = this.tree[level][i];
                const right = this.tree[level][i + 1];
                const parent = poseidonHash([left, right]);
                this.tree[level + 1].push(parent);
            }
        }
    }

    getRoot() {
        return this.tree[this.depth][0];
    }

    getProof(index) {
        if (index < 0 || index >= Math.pow(2, this.depth)) {
            throw new Error(`Index out of bounds: ${index}`);
        }

        const pathElements = [];
        const pathIndices = [];
        let currentIndex = index;

        for (let level = 0; level < this.depth; level++) {
            const isRight = currentIndex % 2 === 1;
            const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

            pathElements.push(this.tree[level][siblingIndex]);
            pathIndices.push(isRight ? 1 : 0);

            currentIndex = Math.floor(currentIndex / 2);
        }

        return {
            pathElements: pathElements.map(x => x.toString()),
            pathIndices,
            root: this.getRoot().toString(),
            leaf: this.tree[0][index].toString()
        };
    }

    verifyProof(leaf, pathElements, pathIndices, root) {
        let current = BigInt(leaf);
        for (let i = 0; i < pathElements.length; i++) {
            const sibling = BigInt(pathElements[i]);
            const isRight = pathIndices[i] === 1;
            const left = isRight ? sibling : current;
            const right = isRight ? current : sibling;
            current = poseidonHash([left, right]);
        }
        return current.toString() === BigInt(root).toString();
    }
}

module.exports = {
    initPoseidon,
    poseidonHash,
    generateLeaf,
    generateNullifier,
    MerkleTree
};
