// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "./BaseTest.sol";

contract ZkapAccountFactoryFuzzTest is BaseTest {
    // CNT-96: Different salts produce different addresses
    /// @notice Fuzz test: createAccount with various salts should produce unique addresses
    function testFuzz_createAccount_uniqueAddresses(uint256 salt1, uint256 salt2) public view {
        vm.assume(salt1 != salt2);

        bytes memory encodedKey = createEncodedAddressKey(
            address(accountKeyLogic),
            owner,
            1,
            1
        );

        address addr1 = factory.calcAccountAddress(salt1, encodedKey, encodedKey);
        address addr2 = factory.calcAccountAddress(salt2, encodedKey, encodedKey);

        assertNotEq(addr1, addr2, "Different salts should produce different addresses");
    }

    // CNT-106: Calculated address == deployed address
    /// @notice Fuzz test: calcAccountAddress should match actual deployed address
    function testFuzz_calcAccountAddress_matchesDeployed(uint256 salt) public {
        bytes memory encodedKey = createEncodedAddressKey(
            address(accountKeyLogic),
            owner,
            1,
            1
        );

        address calculated = factory.calcAccountAddress(salt, encodedKey, encodedKey);
        ZkapAccount deployed = factory.createAccount(salt, encodedKey, encodedKey);

        assertEq(address(deployed), calculated, "Calculated address should match deployed");
    }

    // CNT-98: Success when weight >= threshold (threshold boundary)
    /// @notice Fuzz test: threshold boundary validation
    function testFuzz_createAccount_thresholdBoundary(uint8 threshold, uint8 weight) public {
        vm.assume(threshold > 0); // threshold must be positive
        vm.assume(weight >= threshold); // weight must meet threshold

        address[] memory logicList = new address[](1);
        logicList[0] = address(accountKeyLogic);

        bytes[] memory initDataList = new bytes[](1);
        initDataList[0] = abi.encode(owner);

        uint8[] memory weightList = new uint8[](1);
        weightList[0] = weight;

        bytes memory encodedKey = abi.encode(threshold, logicList, initDataList, weightList);

        // Should succeed when weight >= threshold
        ZkapAccount account = factory.createAccount(1, encodedKey, encodedKey);
        assertTrue(address(account) != address(0), "Account should be created");
    }

    // CNT-98: Revert when weight < threshold
    /// @notice Fuzz test: insufficient weight should fail
    function testFuzz_createAccount_insufficientWeight(uint8 threshold, uint8 weight) public {
        vm.assume(threshold > 1); // threshold must be > 1 for this test
        vm.assume(weight < threshold); // weight must be less than threshold
        vm.assume(weight > 0); // weight must be positive

        address[] memory logicList = new address[](1);
        logicList[0] = address(accountKeyLogic);

        bytes[] memory initDataList = new bytes[](1);
        initDataList[0] = abi.encode(owner);

        uint8[] memory weightList = new uint8[](1);
        weightList[0] = weight;

        bytes memory encodedKey = abi.encode(threshold, logicList, initDataList, weightList);

        // Should revert when weight < threshold
        vm.expectRevert(ZkapAccount.InsufficientMasterKeyWeight.selector);
        factory.createAccount(1, encodedKey, encodedKey);
    }

    // CNT-97: Revert when threshold = 0
    /// @notice Fuzz test: zero threshold should fail
    function testFuzz_createAccount_zeroThreshold(uint8 weight) public {
        vm.assume(weight > 0);

        address[] memory logicList = new address[](1);
        logicList[0] = address(accountKeyLogic);

        bytes[] memory initDataList = new bytes[](1);
        initDataList[0] = abi.encode(owner);

        uint8[] memory weightList = new uint8[](1);
        weightList[0] = weight;

        bytes memory encodedKey = abi.encode(uint8(0), logicList, initDataList, weightList);

        vm.expectRevert(ZkapAccount.MasterKeyThresholdMustBePositive.selector);
        factory.createAccount(1, encodedKey, encodedKey);
    }

    // CNT-99: Multiple key creation validation
    /// @notice Fuzz test: multiple keys with various weights
    function testFuzz_createAccount_multipleKeys(
        uint8 threshold,
        uint8 weight1,
        uint8 weight2
    ) public {
        vm.assume(threshold > 0);
        vm.assume(uint16(weight1) + uint16(weight2) >= threshold);
        vm.assume(weight1 > 0 && weight2 > 0);

        address[] memory logicList = new address[](2);
        logicList[0] = address(accountKeyLogic);
        logicList[1] = address(accountKeyLogic);

        bytes[] memory initDataList = new bytes[](2);
        initDataList[0] = abi.encode(owner);
        initDataList[1] = abi.encode(address(0x1234));

        uint8[] memory weightList = new uint8[](2);
        weightList[0] = weight1;
        weightList[1] = weight2;

        bytes memory encodedKey = abi.encode(threshold, logicList, initDataList, weightList);

        ZkapAccount account = factory.createAccount(1, encodedKey, encodedKey);
        assertTrue(address(account) != address(0), "Account should be created with multiple keys");
    }
}
