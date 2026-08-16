const { expect } = require("chai");
const hre = require("hardhat");
const snarkjs = require("snarkjs");
const { proveVote } = require("../../scripts/prove_vote");

async function expectRevert(promise, expectedReason) {
    try {
        await promise;
        expect.fail(`Expected transaction to revert with "${expectedReason}", but it succeeded`);
    } catch (err) {
        expect(err.message).to.include(expectedReason);
    }
}

describe("Security Attack Tests — Smart Contract & On-Chain Ledger", function () {
    this.timeout(60000);

    let verifier;
    let latticeVerifier;
    let votingContract;
    let admin;
    let voter;
    let attacker;
    let electionId = 1;
    let proofData;
    let formattedA, formattedB, formattedC, formattedPublicSignals;
    let nullifierHashBytes32;
    let merkleRootBytes32;

    let dummyLatticeProofHash;
    let dummyLatticeNullifier;

    before(async function () {
        [admin, voter, attacker] = await hre.ethers.getSigners();

        dummyLatticeProofHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("lattice_proof_1"));
        dummyLatticeNullifier = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("nullifier_lattice_1"));

        // 1. Generate real ZK proof for candidate 0 using prove_vote
        proofData = await proveVote({
            voteValue: 0,
            credentialSecret: "123456789123",
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

        // 3. Deploy Verifier & LatticeVerifier
        const VerifierFactory = await hre.ethers.getContractFactory("Groth16Verifier");
        verifier = await VerifierFactory.deploy();
        await verifier.waitForDeployment();

        const LatticeVerifierFactory = await hre.ethers.getContractFactory("LatticeVerifier");
        latticeVerifier = await LatticeVerifierFactory.deploy();
        await latticeVerifier.waitForDeployment();

        // 4. Deploy VotingContract
        const VotingContractFactory = await hre.ethers.getContractFactory("VotingContract");
        votingContract = await VotingContractFactory.deploy(
            await verifier.getAddress(),
            await latticeVerifier.getAddress(),
            merkleRootBytes32,
            electionId
        );
        await votingContract.waitForDeployment();
    });

    describe("1. Contract Constructor & Boundary Checks", function () {
        it("Reverts deployment if Groth16 verifier address is zero", async function () {
            const VotingContractFactory = await hre.ethers.getContractFactory("VotingContract");
            await expectRevert(
                VotingContractFactory.deploy(
                    hre.ethers.ZeroAddress,
                    await latticeVerifier.getAddress(),
                    merkleRootBytes32,
                    electionId
                ),
                "Invalid Groth16 verifier"
            );
        });

        it("Reverts deployment if Lattice verifier address is zero", async function () {
            const VotingContractFactory = await hre.ethers.getContractFactory("VotingContract");
            await expectRevert(
                VotingContractFactory.deploy(
                    await verifier.getAddress(),
                    hre.ethers.ZeroAddress,
                    merkleRootBytes32,
                    electionId
                ),
                "Invalid lattice verifier"
            );
        });
    });

    describe("2. Groth16 Double Voting & Replay Attacks", function () {
        it("Accepts valid vote proof on initial submission", async function () {
            const encryptedVote = hre.ethers.toUtf8Bytes("encrypted_vote_payload_cand_0");

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
            expect(await votingContract.totalVotes()).to.equal(1n);
            expect(await votingContract.nullifiers(nullifierHashBytes32)).to.equal(true);
        });

        it("Rejects double voting with identical nullifier", async function () {
            const encryptedVote = hre.ethers.toUtf8Bytes("replay_attempt_payload");

            await expectRevert(
                votingContract.connect(attacker).submitVote(
                    formattedA,
                    formattedB,
                    formattedC,
                    formattedPublicSignals,
                    nullifierHashBytes32,
                    encryptedVote
                ),
                "double vote"
            );
        });
    });

    describe("3. Tampered Public Signals Attacks", function () {
        let freshProof, freshA, freshB, freshC, freshPublic;
        let freshNullifierBytes32, freshRootBytes32;

        before(async function () {
            freshProof = await proveVote({
                voteValue: 1,
                credentialSecret: "999888777666",
                electionId: electionId.toString(),
                numCandidates: 4,
                leafIndex: 1,
                depth: 10,
                proofOutputPath: null,
                publicOutputPath: null
            });

            const calldataStr = await snarkjs.groth16.exportSolidityCallData(
                freshProof.proof,
                freshProof.publicSignals
            );
            const parsed = JSON.parse(`[${calldataStr}]`);

            freshA = parsed[0];
            freshB = parsed[1];
            freshC = parsed[2];
            freshPublic = parsed[3];

            freshRootBytes32 = "0x" + BigInt(freshProof.publicSignals[1]).toString(16).padStart(64, "0");
            freshNullifierBytes32 = "0x" + BigInt(freshProof.publicSignals[2]).toString(16).padStart(64, "0");

            // Update contract Merkle root to match fresh proof
            await votingContract.connect(admin).setMerkleRoot(freshRootBytes32);
        });

        it("Rejects vote if publicSignals nullifier != contract nullifier argument", async function () {
            const tamperedNullifier = "0x" + "1".repeat(64);

            await expectRevert(
                votingContract.connect(voter).submitVote(
                    freshA,
                    freshB,
                    freshC,
                    freshPublic,
                    tamperedNullifier, // Mismatch!
                    hre.ethers.toUtf8Bytes("encrypted")
                ),
                "nullifier mismatch"
            );
        });

        it("Rejects vote if publicSignals Merkle root != contract Merkle root state", async function () {
            const tamperedPublic = [...freshPublic];
            tamperedPublic[1] = "999999999999999999999999999999"; // Mismatched root in signal

            await expectRevert(
                votingContract.connect(voter).submitVote(
                    freshA,
                    freshB,
                    freshC,
                    tamperedPublic,
                    freshNullifierBytes32,
                    hre.ethers.toUtf8Bytes("encrypted")
                ),
                "merkle root mismatch"
            );
        });

        it("Rejects vote if publicSignals electionId != contract electionId", async function () {
            const tamperedPublic = [...freshPublic];
            tamperedPublic[0] = "99"; // Wrong election ID

            await expectRevert(
                votingContract.connect(voter).submitVote(
                    freshA,
                    freshB,
                    freshC,
                    tamperedPublic,
                    freshNullifierBytes32,
                    hre.ethers.toUtf8Bytes("encrypted")
                ),
                "election id mismatch"
            );
        });

        it("Rejects vote if Groth16 proof parameter A is tampered", async function () {
            const tamperedA = [...freshA];
            tamperedA[0] = "0x123456789012345678901234567890";

            await expectRevert(
                votingContract.connect(voter).submitVote(
                    tamperedA,
                    freshB,
                    freshC,
                    freshPublic,
                    freshNullifierBytes32,
                    hre.ethers.toUtf8Bytes("encrypted")
                ),
                "invalid Groth16 proof"
            );
        });
    });

    describe("4. QRZ-KPA Lattice Vote Security Checks", function () {
        it("Accepts valid lattice vote proof", async function () {
            const currentRoot = await votingContract.merkleRoot();
            const tx = await votingContract.connect(voter).submitLatticeVote(
                dummyLatticeProofHash,
                dummyLatticeNullifier,
                currentRoot,
                4,
                hre.ethers.toUtf8Bytes("lattice_encrypted_vote")
            );
            const receipt = await tx.wait();
            expect(receipt.status).to.equal(1);
            expect(await votingContract.nullifiers(dummyLatticeNullifier)).to.equal(true);
        });

        it("Rejects double voting with identical lattice nullifier", async function () {
            const currentRoot = await votingContract.merkleRoot();
            await expectRevert(
                votingContract.connect(attacker).submitLatticeVote(
                    dummyLatticeProofHash,
                    dummyLatticeNullifier, // Reused nullifier
                    currentRoot,
                    4,
                    hre.ethers.toUtf8Bytes("replay_lattice")
                ),
                "double vote"
            );
        });

        it("Rejects zero bytes nullifier in lattice submission", async function () {
            const currentRoot = await votingContract.merkleRoot();
            await expectRevert(
                votingContract.connect(voter).submitLatticeVote(
                    dummyLatticeProofHash,
                    hre.ethers.ZeroHash,
                    currentRoot,
                    4,
                    hre.ethers.toUtf8Bytes("zero_nullifier")
                ),
                "invalid nullifier"
            );
        });

        it("Rejects lattice vote if claimed root != contract Merkle root", async function () {
            const fakeRoot = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("fake_root"));
            const freshLatticeNullifier = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("nullifier_lattice_2"));

            await expectRevert(
                votingContract.connect(voter).submitLatticeVote(
                    dummyLatticeProofHash,
                    freshLatticeNullifier,
                    fakeRoot, // Claimed root mismatch
                    4,
                    hre.ethers.toUtf8Bytes("fake_root_vote")
                ),
                "invalid lattice proof (on-chain checks)"
            );
        });
    });

    describe("5. Election Lifetime & Closure Attacks", function () {
        it("Rejects vote submission when election is closed", async function () {
            // Close election as admin
            await votingContract.connect(admin).closeElection();
            expect(await votingContract.electionOpen()).to.equal(false);

            const currentRoot = await votingContract.merkleRoot();
            const freshNullifier = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("post_closure_nullifier"));

            await expectRevert(
                votingContract.connect(voter).submitLatticeVote(
                    dummyLatticeProofHash,
                    freshNullifier,
                    currentRoot,
                    4,
                    hre.ethers.toUtf8Bytes("post_closure_vote")
                ),
                "closed"
            );
        });

        it("Rejects closeElection call if election is already closed", async function () {
            await expectRevert(
                votingContract.connect(admin).closeElection(),
                "already closed"
            );
        });

        it("Allows admin to re-open election and rejects openElection if already open", async function () {
            await votingContract.connect(admin).openElection();
            expect(await votingContract.electionOpen()).to.equal(true);

            await expectRevert(
                votingContract.connect(admin).openElection(),
                "already open"
            );
        });
    });

    describe("6. Access Control & Admin Privilege Attacks", function () {
        it("Rejects non-admin attempt to set Merkle root", async function () {
            const newRoot = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("unauthorized_root"));
            await expectRevert(
                votingContract.connect(attacker).setMerkleRoot(newRoot),
                "Only admin"
            );
        });

        it("Rejects non-admin attempt to close election", async function () {
            await expectRevert(
                votingContract.connect(attacker).closeElection(),
                "Only admin"
            );
        });

        it("Rejects non-admin attempt to open election when open", async function () {
            await expectRevert(
                votingContract.connect(attacker).openElection(),
                "Only admin"
            );
        });
    });
});
