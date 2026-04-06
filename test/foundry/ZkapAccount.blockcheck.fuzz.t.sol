// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "./BaseTest.sol";

/// @title ZkapAccount Block Check Fuzz Tests
/// @notice Extended fuzz tests for txKeyUpdateBlock and masterKeyUpdateBlock validation
contract ZkapAccountBlockCheckFuzzTest is BaseTest {
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

    // CNT-59: Block execute in same block after txKey update
    /// @notice Fuzz: txKeyUpdateBlock blocks execute in same block
    function testFuzz_blockCheck_txKeyBlocksSameBlockExecute(uint256 blockNumber) public {
        blockNumber = bound(blockNumber, 1, type(uint64).max);

        // Roll to specific block
        vm.roll(blockNumber);

        // Get encoded key for update
        bytes memory newEncodedTxKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9999),
            1,
            1
        );

        // Impersonate EntryPoint to call account directly
        vm.startPrank(address(entryPoint));

        // Update tx key (sets txKeyUpdateBlock to current block)
        account.updateTxKey(newEncodedTxKey);

        // Try to execute in same block - should fail
        vm.expectRevert(ZkapAccount.TxKeyUpdateInProgress.selector);
        account.execute(address(0x1234), 0, "");

        vm.stopPrank();
    }

    // CNT-61: Allow execute in next block after txKey update
    /// @notice Fuzz: txKeyUpdateBlock allows execute in next block
    function testFuzz_blockCheck_txKeyAllowsNextBlockExecute(uint256 blockNumber) public {
        blockNumber = bound(blockNumber, 1, type(uint64).max - 1);

        // Roll to specific block
        vm.roll(blockNumber);

        // Get encoded key for update
        bytes memory newEncodedTxKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9998),
            1,
            1
        );

        vm.startPrank(address(entryPoint));

        // Update tx key
        account.updateTxKey(newEncodedTxKey);

        vm.stopPrank();

        // Roll to next block
        vm.roll(blockNumber + 1);

        vm.prank(address(entryPoint));
        // Execute should succeed in next block
        account.execute(address(0x1234), 0, "");
    }

    // CNT-62: Block txKey update in same block after masterKey update
    /// @notice Fuzz: masterKeyUpdateBlock blocks txKey update in same block
    function testFuzz_blockCheck_masterKeyBlocksTxKeyUpdate(uint256 blockNumber) public {
        blockNumber = bound(blockNumber, 1, type(uint64).max);

        vm.roll(blockNumber);

        bytes memory newEncodedMasterKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9997),
            1,
            1
        );

        bytes memory newEncodedTxKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9996),
            1,
            1
        );

        vm.startPrank(address(entryPoint));

        // Update master key (sets masterKeyUpdateBlock to current block)
        account.updateMasterKey(newEncodedMasterKey);

        // Try to update tx key in same block - should fail
        vm.expectRevert(ZkapAccount.MasterKeyUpdateInProgress.selector);
        account.updateTxKey(newEncodedTxKey);

        vm.stopPrank();
    }

    // CNT-63: Allow txKey update in next block after masterKey update
    /// @notice Fuzz: masterKeyUpdateBlock allows txKey update in next block
    function testFuzz_blockCheck_masterKeyAllowsTxKeyNextBlock(uint256 blockNumber) public {
        blockNumber = bound(blockNumber, 1, type(uint64).max - 1);

        vm.roll(blockNumber);

        bytes memory newEncodedMasterKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9995),
            1,
            1
        );

        bytes memory newEncodedTxKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9994),
            1,
            1
        );

        vm.startPrank(address(entryPoint));

        // Update master key
        account.updateMasterKey(newEncodedMasterKey);

        vm.stopPrank();

        // Roll to next block
        vm.roll(blockNumber + 1);

        vm.prank(address(entryPoint));
        // Update tx key should succeed in next block
        account.updateTxKey(newEncodedTxKey);
    }

    // CNT-60: Block executeBatch in same block after txKey update
    /// @notice Fuzz: executeBatch also blocked by txKeyUpdateBlock
    function testFuzz_blockCheck_txKeyBlocksExecuteBatch(uint256 blockNumber) public {
        blockNumber = bound(blockNumber, 1, type(uint64).max);

        vm.roll(blockNumber);

        bytes memory newEncodedTxKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9993),
            1,
            1
        );

        vm.startPrank(address(entryPoint));

        account.updateTxKey(newEncodedTxKey);

        address[] memory dest = new address[](1);
        dest[0] = address(0x1234);
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        bytes[] memory funcs = new bytes[](1);
        funcs[0] = "";

        vm.expectRevert(ZkapAccount.TxKeyUpdateInProgress.selector);
        account.executeBatch(dest, values, funcs);

        vm.stopPrank();
    }

    // CNT-65: Allow execute after multiple block advances
    /// @notice Fuzz: multiple block advances should allow execution
    function testFuzz_blockCheck_multipleBlockAdvances(uint256 startBlock, uint8 advances) public {
        startBlock = bound(startBlock, 1, type(uint64).max - 256);
        advances = uint8(bound(advances, 1, 100));

        vm.roll(startBlock);

        bytes memory newEncodedTxKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9992),
            1,
            1
        );

        vm.prank(address(entryPoint));
        account.updateTxKey(newEncodedTxKey);

        // Advance by 'advances' blocks
        vm.roll(startBlock + advances);

        vm.prank(address(entryPoint));
        // Execute should always succeed after at least 1 block advance
        account.execute(address(0x1234), 0, "");
    }

    // CNT-64: txKey update does not block masterKey update
    /// @notice Fuzz: updateMasterKey not blocked by txKeyUpdateBlock
    function testFuzz_blockCheck_txKeyDoesNotBlockMasterKey(uint256 blockNumber) public {
        blockNumber = bound(blockNumber, 1, type(uint64).max);

        vm.roll(blockNumber);

        bytes memory newEncodedTxKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9991),
            1,
            1
        );

        bytes memory newEncodedMasterKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9990),
            1,
            1
        );

        vm.startPrank(address(entryPoint));

        // Update tx key first
        account.updateTxKey(newEncodedTxKey);

        // Update master key in same block - should succeed (txKeyUpdate doesn't block masterKey update)
        account.updateMasterKey(newEncodedMasterKey);

        vm.stopPrank();
    }

    // CNT-66: Consecutive masterKey updates (different blocks)
    /// @notice Fuzz: consecutive master key updates in different blocks
    function testFuzz_blockCheck_consecutiveMasterKeyUpdates(uint8 numUpdates) public {
        numUpdates = uint8(bound(numUpdates, 2, 3));

        uint256 currentBlock = 1;
        vm.roll(currentBlock);

        for (uint8 i = 0; i < numUpdates; i++) {
            bytes memory newKey = createEncodedAddressKey(
                address(accountKeyLogic),
                address(uint160(0x8000 + i)),
                1,
                1
            );

            vm.prank(address(entryPoint));
            account.updateMasterKey(newKey);

            // Move to next block for next update
            currentBlock += 1;
            vm.roll(currentBlock);
        }

        // Final threshold should be 1 (from last update)
        assertEq(account.masterKeyThreshold(), 1, "Master key threshold should be 1");
    }

    /// @notice Fuzz: block number edge cases - execute blocked immediately after update
    function testFuzz_blockCheck_blockNumberEdgeCases(uint256 blockNumber) public {
        // Test at various block number boundaries
        if (blockNumber == 0) {
            blockNumber = 1;
        }
        blockNumber = bound(blockNumber, 1, type(uint64).max - 1);

        vm.roll(blockNumber);

        bytes memory newEncodedTxKey = createEncodedAddressKey(
            address(accountKeyLogic),
            address(0x9989),
            1,
            1
        );

        vm.prank(address(entryPoint));
        account.updateTxKey(newEncodedTxKey);

        // Execute should be blocked in same block
        vm.prank(address(entryPoint));
        vm.expectRevert(ZkapAccount.TxKeyUpdateInProgress.selector);
        account.execute(address(0x1234), 0, "");

        // Next block should allow execution
        vm.roll(blockNumber + 1);
        vm.prank(address(entryPoint));
        account.execute(address(0x1234), 0, "");
    }
}
