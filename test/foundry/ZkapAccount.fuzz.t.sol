// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "./BaseTest.sol";

contract ZkapAccountFuzzTest is BaseTest {
    ZkapAccount public account;

    function setUp() public override {
        super.setUp();
        account = createValidAccount(1, owner);

        // Fund the account
        vm.deal(address(account), 10 ether);

        // Deposit to EntryPoint for the account
        vm.prank(owner);
        entryPoint.depositTo{value: 1 ether}(address(account));
    }

    /// @notice Fuzz test: execute should only work from EntryPoint
    function testFuzz_execute_onlyEntryPoint(address caller) public {
        vm.assume(caller != address(entryPoint));
        vm.assume(caller != address(0));

        vm.prank(caller);
        vm.expectRevert();
        account.execute(address(0x1234), 0, "");
    }

    /// @notice Fuzz test: executeBatch array length validation
    function testFuzz_executeBatch_arrayLengthMismatch(
        uint8 destLen,
        uint8 valueLen,
        uint8 funcLen
    ) public {
        vm.assume(destLen > 0 && destLen <= 10);
        vm.assume(funcLen > 0 && funcLen <= 10);
        vm.assume(destLen != funcLen);
        vm.assume(valueLen > 0); // non-zero value array

        address[] memory dest = new address[](destLen);
        uint256[] memory value = new uint256[](valueLen);
        bytes[] memory func = new bytes[](funcLen);

        // Initialize arrays
        for (uint8 i = 0; i < destLen; i++) {
            dest[i] = address(uint160(i + 1));
        }
        for (uint8 i = 0; i < valueLen; i++) {
            value[i] = 0;
        }
        for (uint8 i = 0; i < funcLen; i++) {
            func[i] = "";
        }

        vm.prank(address(entryPoint));
        vm.expectRevert(ZkapAccount.WrongArrayLengths.selector);
        account.executeBatch(dest, value, func);
    }

    /// @notice Fuzz test: receive ETH from any address
    function testFuzz_receive_anyAmount(address sender, uint96 amount) public {
        vm.assume(sender != address(0));
        vm.assume(sender != address(account));
        vm.assume(amount > 0);
        vm.deal(sender, amount);

        uint256 balanceBefore = address(account).balance;

        vm.prank(sender);
        (bool success,) = address(account).call{value: amount}("");

        assertTrue(success, "Should accept ETH");
        assertEq(address(account).balance, balanceBefore + amount, "Balance should increase");
    }

    /// @notice Fuzz test: threshold must be positive during initialization
    function testFuzz_initialize_zeroThreshold(uint8 weight) public {
        vm.assume(weight > 0);

        address[] memory logicList = new address[](1);
        logicList[0] = address(accountKeyLogic);

        bytes[] memory initDataList = new bytes[](1);
        initDataList[0] = abi.encode(owner);

        uint8[] memory weightList = new uint8[](1);
        weightList[0] = weight;

        // Create encoded key with zero threshold for master key
        bytes memory encodedMasterKey = abi.encode(uint8(0), logicList, initDataList, weightList);
        bytes memory encodedTxKey = abi.encode(uint8(1), logicList, initDataList, weightList);

        vm.expectRevert(ZkapAccount.MasterKeyThresholdMustBePositive.selector);
        factory.createAccount(999, encodedMasterKey, encodedTxKey);
    }

    /// @notice Fuzz test: empty key list should fail
    function testFuzz_initialize_emptyKeyList(uint8 threshold) public {
        vm.assume(threshold > 0);

        address[] memory emptyLogicList = new address[](0);
        bytes[] memory emptyInitDataList = new bytes[](0);
        uint8[] memory emptyWeightList = new uint8[](0);

        bytes memory encodedEmptyKey = abi.encode(threshold, emptyLogicList, emptyInitDataList, emptyWeightList);
        bytes memory encodedValidKey = createEncodedAddressKey(address(accountKeyLogic), owner, 1, 1);

        vm.expectRevert(ZkapAccount.MasterKeyListMustNotBeEmpty.selector);
        factory.createAccount(998, encodedEmptyKey, encodedValidKey);
    }

    /// @notice Fuzz test: zero address in logic list should fail
    function testFuzz_initialize_zeroLogicAddress(uint8 threshold, uint8 weight) public {
        vm.assume(threshold > 0);
        vm.assume(weight >= threshold);

        address[] memory logicList = new address[](1);
        logicList[0] = address(0); // Zero address

        bytes[] memory initDataList = new bytes[](1);
        initDataList[0] = abi.encode(owner);

        uint8[] memory weightList = new uint8[](1);
        weightList[0] = weight;

        bytes memory encodedKey = abi.encode(threshold, logicList, initDataList, weightList);

        vm.expectRevert(ZkapAccount.MasterKeyLogicAddressZero.selector);
        factory.createAccount(997, encodedKey, encodedKey);
    }

    /// @notice Fuzz test: array length mismatch in key data
    function testFuzz_initialize_keyArrayMismatch(uint8 logicLen, uint8 initDataLen) public {
        // Bound inputs to reasonable ranges and ensure mismatch
        logicLen = uint8(bound(logicLen, 1, 5));
        initDataLen = uint8(bound(initDataLen, 1, 5));

        // Skip if lengths match
        if (logicLen == initDataLen) {
            logicLen = logicLen == 5 ? 4 : logicLen + 1;
        }

        address[] memory logicList = new address[](logicLen);
        bytes[] memory initDataList = new bytes[](initDataLen);
        uint8[] memory weightList = new uint8[](logicLen); // Same as logicLen

        for (uint8 i = 0; i < logicLen; i++) {
            logicList[i] = address(accountKeyLogic);
            weightList[i] = 1;
        }
        for (uint8 i = 0; i < initDataLen; i++) {
            initDataList[i] = abi.encode(owner);
        }

        bytes memory encodedKey = abi.encode(uint8(1), logicList, initDataList, weightList);
        bytes memory validKey = createEncodedAddressKey(address(accountKeyLogic), owner, 1, 1);

        vm.expectRevert(ZkapAccount.WrongArrayLengths.selector);
        factory.createAccount(996, encodedKey, validKey);
    }

    /// @notice Fuzz test: withdrawDepositTo should only work from self
    function testFuzz_withdrawDepositTo_onlyOwner(address caller, uint96 amount) public {
        vm.assume(caller != address(account));
        vm.assume(amount > 0);

        vm.prank(caller);
        vm.expectRevert(ZkapAccount.OnlyOwner.selector);
        account.withdrawDepositTo(payable(caller), amount);
    }

    /// @notice Fuzz test: addDeposit from any address
    function testFuzz_addDeposit_anyAddress(address depositor, uint96 amount) public {
        vm.assume(depositor != address(0));
        vm.assume(amount > 0 && amount <= 10 ether);
        vm.deal(depositor, amount);

        uint256 depositBefore = account.getDeposit();

        vm.prank(depositor);
        account.addDeposit{value: amount}();

        assertEq(account.getDeposit(), depositBefore + amount, "Deposit should increase");
    }

    /// @notice Fuzz test: entryPoint getter is immutable
    function testFuzz_entryPoint_immutable(uint256 salt) public {
        // Avoid salt 1 which is used in setUp
        vm.assume(salt != 1);
        // Avoid potential collisions by using large salts
        salt = bound(salt, 1000, type(uint256).max);

        ZkapAccount newAccount = createValidAccount(salt, owner);
        assertEq(address(newAccount.entryPoint()), address(entryPoint), "EntryPoint should be immutable");
    }
}
