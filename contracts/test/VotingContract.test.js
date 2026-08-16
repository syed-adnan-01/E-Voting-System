const { expect } = require("chai");
const hre = require("hardhat");
const snarkjs = require("snarkjs");
const { proveVote } = require("../../scripts/prove_vote");

describe("VotingContract (Phase 2 Smart Contract & Ledger)", function () {
    this.timeout(60000);

    let verifier;
    let votingContract;
    let admin;
    let voter;
    let electionId = 1;
    let proofData;
    let formattedA, formattedB, formattedC, formattedPublicSignals;
    let nullifierHashBytes32;
    let merkleRootBytes32;

    before(async function () {
        [admin, voter] = await hre.ethers.getSigners();

        // 1. Generate real ZK proof for candidate 1 using prove_vote
        proofData = await proveVote({
            voteValue: 1,
            credentialSecret: "123456789",
            electionId: electionId.toString(),
            numCandidates: 4,
            leafIndex: 0,
            depth: 10,
            proofOutputPath: null,
            publicOutputPath: null
        });

        // 2. Export Solidity call data using snarkjs
        const calldataStr = await snarkjs.groth16.exportSolidityCallData(
            proofData.proof,
            proofData.publicSignals
        );
        const parsedCalldata = JSON.parse(`[${calldataStr}]`);

        formattedA = parsedCalldata[0];
        formattedB = parsedCalldata[1];
        formattedC = parsedCalldata[2];
        formattedPublicSignals = parsedCalldata[3];

        merkleRootBytes32 = "0x" + BigInt(proofData.publicSignals[1]).toString(16).padStart(64, "0");
        nullifierHashBytes32 = "0x" + BigInt(proofData.publicSignals[2]).toString(16).padStart(64, "0");

        // 3. Deploy Groth16Verifier & LatticeVerifier
        const VerifierFactory = await hre.ethers.getContractFactory("Groth16Verifier");
        verifier = await VerifierFactory.deploy();
        await verifier.waitForDeployment();

        const LatticeVerifierFactory = await hre.ethers.getContractFactory("LatticeVerifier");
        const latticeVerifier = await LatticeVerifierFactory.deploy();
        await latticeVerifier.waitForDeployment();

        // 4. Deploy VotingContract with matching Merkle Root & Election ID
        const VotingContractFactory = await hre.ethers.getContractFactory("VotingContract");
        votingContract = await VotingContractFactory.deploy(
            await verifier.getAddress(),
            await latticeVerifier.getAddress(),
            merkleRootBytes32,
            electionId
        );
        await votingContract.waitForDeployment();
    });

    it("1. Should initialize with correct parameters", async function () {
        expect(await votingContract.admin()).to.equal(admin.address);
        expect(await votingContract.merkleRoot()).to.equal(merkleRootBytes32);
        expect(await votingContract.electionId()).to.equal(electionId);
        expect(await votingContract.totalVotes()).to.equal(0);
        expect(await votingContract.electionOpen()).to.equal(true);
    });

    it("2. POSITIVE: Should accept valid ZK vote proof and emit VoteRecorded event", async function () {
        const encryptedVote = hre.ethers.toUtf8Bytes("encrypted_vote_payload_candidate_1");

        const tx = await votingContract.connect(voter).submitVote(
            formattedA,
            formattedB,
            formattedC,
            formattedPublicSignals,
            nullifierHashBytes32,
            encryptedVote
        );

        const receipt = await tx.wait();
        expect(receipt.status).to.equal(1);

        // Check state changes
        expect(await votingContract.totalVotes()).to.equal(1);
        expect(await votingContract.nullifiers(nullifierHashBytes32)).to.equal(true);

        // Check event emission
        await expect(tx)
            .to.emit(votingContract, "VoteRecorded")
            .withArgs(nullifierHashBytes32, hre.ethers.hexlify(encryptedVote), (val) => val > 0, 0);
    });

    it("3. NEGATIVE: Should revert on duplicate vote (reused nullifier)", async function () {
        const encryptedVote = hre.ethers.toUtf8Bytes("another_encrypted_vote");

        await expect(
            votingContract.connect(voter).submitVote(
                formattedA,
                formattedB,
                formattedC,
                formattedPublicSignals,
                nullifierHashBytes32,
                encryptedVote
            )
        ).to.be.revertedWith("double vote");
    });

    it("4. NEGATIVE: Should revert on tampered ZK proof", async function () {
        // Generate a new vote proof with a different secret
        const newProofData = await proveVote({
            voteValue: 2,
            credentialSecret: "999888777",
            electionId: electionId.toString(),
            numCandidates: 4,
            leafIndex: 1,
            depth: 10,
            proofOutputPath: null,
            publicOutputPath: null
        });

        const calldataStr = await snarkjs.groth16.exportSolidityCallData(
            newProofData.proof,
            newProofData.publicSignals
        );
        const parsedCalldata = JSON.parse(`[${calldataStr}]`);

        const tamperedA = [...parsedCalldata[0]];
        tamperedA[0] = "0x123456789012345678901234567890"; // Tampered proof point A

        const newNullifierHash = "0x" + BigInt(newProofData.publicSignals[2]).toString(16).padStart(64, "0");
        const newMerkleRoot = "0x" + BigInt(newProofData.publicSignals[1]).toString(16).padStart(64, "0");

        // Update contract Merkle root to match new proof's tree root
        await votingContract.connect(admin).setMerkleRoot(newMerkleRoot);

        await expect(
            votingContract.connect(voter).submitVote(
                tamperedA,
                parsedCalldata[1],
                parsedCalldata[2],
                parsedCalldata[3],
                newNullifierHash,
                hre.ethers.toUtf8Bytes("encrypted")
            )
        ).to.be.revertedWith("invalid Groth16 proof");
    });

    it("5. NEGATIVE: Should revert when election is closed", async function () {
        await votingContract.connect(admin).closeElection();
        expect(await votingContract.electionOpen()).to.equal(false);

        await expect(
            votingContract.connect(voter).submitVote(
                formattedA,
                formattedB,
                formattedC,
                formattedPublicSignals,
                nullifierHashBytes32,
                hre.ethers.toUtf8Bytes("encrypted")
            )
        ).to.be.revertedWith("closed");
    });

    it("6. NEGATIVE: Should revert when non-admin attempts admin functions", async function () {
        await expect(
            votingContract.connect(voter).closeElection()
        ).to.be.revertedWith("Only admin");

        await expect(
            votingContract.connect(voter).openElection()
        ).to.be.revertedWith("Only admin");

        await expect(
            votingContract.connect(voter).setMerkleRoot(merkleRootBytes32)
        ).to.be.revertedWith("Only admin");
    });
});
