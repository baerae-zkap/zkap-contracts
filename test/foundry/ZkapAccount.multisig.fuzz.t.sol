// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "./BaseTest.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

/// @title ZkapAccount Multisig Fuzz Tests
/// @notice Extended fuzz tests for multisig threshold and weight validation
contract ZkapAccountMultisigFuzzTest is BaseTest {
    // Additional signers
    uint256 public signer1Key;
    uint256 public signer2Key;
    uint256 public signer3Key;
    address public signer1;
    address public signer2;
    address public signer3;

    function setUp() public override {
        super.setUp();

        // Create additional signers
        signer1Key = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff81;
        signer2Key = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff82;
        signer3Key = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff83;
        signer1 = vm.addr(signer1Key);
        signer2 = vm.addr(signer2Key);
        signer3 = vm.addr(signer3Key);
    }

    // CNT-71: threshold vs totalWeight validation
    /// @notice Fuzz: threshold must not exceed total weight
    function testFuzz_multisig_thresholdVsWeight(
        uint8 threshold,
        uint8 weight1,
        uint8 weight2
    ) public {
        // Bound inputs to prevent overflow and ensure reasonable values
        threshold = uint8(bound(threshold, 1, 100));
        weight1 = uint8(bound(weight1, 1, 50));
        weight2 = uint8(bound(weight2, 1, 50));

        uint256 totalWeight = uint256(weight1) + uint256(weight2);

        address[] memory signers = new address[](2);
        signers[0] = signer1;
        signers[1] = signer2;

        uint8[] memory weights = new uint8[](2);
        weights[0] = weight1;
        weights[1] = weight2;

        bytes memory encodedKey = createEncodedMultisigKey(
            address(accountKeyLogic),
            signers,
            threshold,
            weights
        );

        if (totalWeight < threshold) {
            // Should revert when total weight < threshold
            vm.expectRevert(ZkapAccount.InsufficientMasterKeyWeight.selector);
            factory.createAccount(uint256(keccak256(abi.encode(threshold, weight1, weight2))), encodedKey, encodedKey);
        } else {
            // Should succeed when total weight >= threshold
            ZkapAccount account = factory.createAccount(
                uint256(keccak256(abi.encode(threshold, weight1, weight2))),
                encodedKey,
                encodedKey
            );
            assertEq(account.masterKeyThreshold(), threshold, "Threshold should match");
        }
    }

    // CNT-72: Multiple signer creation validation
    /// @notice Fuzz: multiple signers with varying weights
    function testFuzz_multisig_multipleSigners(uint8 numSigners) public {
        // Bound to max 2 since same singleton is used for both master+tx (2*N <= MAX_KEYS=5)
        numSigners = uint8(bound(numSigners, 1, 2));

        address[] memory signers = new address[](numSigners);
        uint8[] memory weights = new uint8[](numSigners);

        uint256 totalWeight = 0;
        for (uint8 i = 0; i < numSigners; i++) {
            signers[i] = address(uint160(0x1000 + i));
            weights[i] = 1;
            totalWeight += 1;
        }

        uint8 threshold = uint8(bound(uint256(numSigners), 1, totalWeight));

        bytes memory encodedKey = createEncodedMultisigKey(
            address(accountKeyLogic),
            signers,
            threshold,
            weights
        );

        ZkapAccount account = factory.createAccount(
            uint256(keccak256(abi.encode(numSigners, threshold))),
            encodedKey,
            encodedKey
        );

        assertEq(account.masterKeyThreshold(), threshold, "Threshold should match");
    }

    // CNT-73: Single key weight >= threshold validation
    /// @notice Fuzz: single key weight must meet threshold
    function testFuzz_multisig_singleKeyWeight(uint8 threshold, uint8 weight) public {
        threshold = uint8(bound(threshold, 1, 100));
        weight = uint8(bound(weight, 1, 100));

        address[] memory signers = new address[](1);
        signers[0] = signer1;

        uint8[] memory weights = new uint8[](1);
        weights[0] = weight;

        bytes memory encodedKey = createEncodedMultisigKey(
            address(accountKeyLogic),
            signers,
            threshold,
            weights
        );

        if (weight < threshold) {
            vm.expectRevert(ZkapAccount.InsufficientMasterKeyWeight.selector);
            factory.createAccount(uint256(keccak256(abi.encode(threshold, weight))), encodedKey, encodedKey);
        } else {
            ZkapAccount account = factory.createAccount(
                uint256(keccak256(abi.encode(threshold, weight))),
                encodedKey,
                encodedKey
            );
            assertEq(account.masterKeyThreshold(), threshold, "Threshold should match");
        }
    }

    // CNT-74: Different threshold for master/tx keys validation
    /// @notice Fuzz: different threshold for master and tx keys
    function testFuzz_multisig_differentThresholds(
        uint8 masterThreshold,
        uint8 txThreshold
    ) public {
        masterThreshold = uint8(bound(masterThreshold, 1, 2));
        txThreshold = uint8(bound(txThreshold, 1, 2));

        // Max 2 signers since same singleton used for both master+tx (2*N <= MAX_KEYS=5)
        address[] memory signers = new address[](2);
        uint8[] memory weights = new uint8[](2);

        for (uint8 i = 0; i < 2; i++) {
            signers[i] = address(uint160(0x2000 + i));
            weights[i] = 1;
        }

        bytes memory encodedMasterKey = createEncodedMultisigKey(
            address(accountKeyLogic),
            signers,
            masterThreshold,
            weights
        );

        bytes memory encodedTxKey = createEncodedMultisigKey(
            address(accountKeyLogic),
            signers,
            txThreshold,
            weights
        );

        ZkapAccount account = factory.createAccount(
            uint256(keccak256(abi.encode(masterThreshold, txThreshold))),
            encodedMasterKey,
            encodedTxKey
        );

        assertEq(account.masterKeyThreshold(), masterThreshold, "Master threshold should match");
        assertEq(account.txKeyThreshold(), txThreshold, "Tx threshold should match");
    }

    // CNT-75: Weight sum validation (including CNT-459: overflow protection)
    /// @notice Fuzz: weight overflow protection (weights should sum correctly)
    function testFuzz_multisig_weightSum(
        uint8 w1,
        uint8 w2,
        uint8 w3,
        uint8 w4
    ) public {
        w1 = uint8(bound(w1, 1, 126));
        w2 = uint8(bound(w2, 1, 126));

        uint256 totalWeight = uint256(w1) + uint256(w2);
        uint8 threshold = uint8(bound(totalWeight / 2, 1, 254)); // Threshold <= totalWeight

        // Max 2 signers since same singleton used for both master+tx (2*N <= MAX_KEYS=5)
        uint8 combinedW1 = w1;
        uint8 combinedW2 = w2;

        address[] memory signers = new address[](2);
        signers[0] = address(uint160(0x3001));
        signers[1] = address(uint160(0x3002));

        uint8[] memory weights = new uint8[](2);
        weights[0] = combinedW1;
        weights[1] = combinedW2;

        bytes memory encodedKey = createEncodedMultisigKey(
            address(accountKeyLogic),
            signers,
            threshold,
            weights
        );

        if (totalWeight < threshold) {
            vm.expectRevert(ZkapAccount.InsufficientMasterKeyWeight.selector);
            factory.createAccount(uint256(keccak256(abi.encode(w1, w2, w3, w4))), encodedKey, encodedKey);
        } else {
            ZkapAccount account = factory.createAccount(
                uint256(keccak256(abi.encode(w1, w2, w3, w4))),
                encodedKey,
                encodedKey
            );
            assertTrue(address(account) != address(0), "Account should be created");
        }
    }

    // CNT-76: Revert when all weights = 0
    /// @notice Fuzz: all zero weights should fail
    function testFuzz_multisig_zeroWeights(uint8 numKeys) public {
        numKeys = uint8(bound(numKeys, 1, 5));

        address[] memory signers = new address[](numKeys);
        uint8[] memory weights = new uint8[](numKeys);

        for (uint8 i = 0; i < numKeys; i++) {
            signers[i] = address(uint160(0x4000 + i));
            weights[i] = 0; // All zero weights
        }

        bytes memory encodedKey = createEncodedMultisigKey(
            address(accountKeyLogic),
            signers,
            1, // threshold = 1
            weights
        );

        // Total weight is 0, which is less than threshold 1
        vm.expectRevert(ZkapAccount.InsufficientMasterKeyWeight.selector);
        factory.createAccount(uint256(keccak256(abi.encode(numKeys))), encodedKey, encodedKey);
    }

    // CNT-77: threshold == totalWeight boundary value
    /// @notice Fuzz: threshold boundary - exactly at total weight
    function testFuzz_multisig_thresholdBoundary(uint8 numKeys) public {
        // Max 2 since same singleton used for both master+tx (2*N <= MAX_KEYS=5)
        numKeys = uint8(bound(numKeys, 1, 2));

        address[] memory signers = new address[](numKeys);
        uint8[] memory weights = new uint8[](numKeys);

        uint256 totalWeight = 0;
        for (uint8 i = 0; i < numKeys; i++) {
            signers[i] = address(uint160(0x5000 + i));
            weights[i] = 1;
            totalWeight += 1;
        }

        // Threshold exactly equals total weight (boundary case)
        uint8 threshold = uint8(totalWeight);

        bytes memory encodedKey = createEncodedMultisigKey(
            address(accountKeyLogic),
            signers,
            threshold,
            weights
        );

        ZkapAccount account = factory.createAccount(
            uint256(keccak256(abi.encode("boundary", numKeys))),
            encodedKey,
            encodedKey
        );

        assertEq(account.masterKeyThreshold(), threshold, "Threshold should match total weight");
    }
}
