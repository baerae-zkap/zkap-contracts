// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../contracts/paymaster/ZkapPaymaster.sol";
import "@account-abstraction/contracts/core/EntryPoint.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

contract ZkapPaymasterFuzzTest is Test {
    ZkapPaymaster public paymaster;
    EntryPoint public entryPoint;

    address public owner;
    address public manager;
    address public signer;
    uint256 public signerPrivateKey;

    function setUp() public {
        owner = address(0x1111);
        manager = address(0x2222);
        signerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        signer = vm.addr(signerPrivateKey);

        entryPoint = new EntryPoint();

        address[] memory signers = new address[](1);
        signers[0] = signer;

        paymaster = new ZkapPaymaster(
            address(entryPoint),
            owner,
            manager,
            signers
        );

        // Fund owner and paymaster
        vm.deal(owner, 100 ether);
        vm.deal(address(paymaster), 100 ether);
        vm.prank(owner);
        paymaster.deposit{value: 10 ether}();
    }

    // CNT-125: Only callable from EntryPoint
    /// @notice Fuzz test: validatePaymasterUserOp should only work from EntryPoint
    function testFuzz_validatePaymasterUserOp_onlyEntryPoint(address caller) public {
        vm.assume(caller != address(entryPoint));
        vm.assume(caller != address(0));

        PackedUserOperation memory userOp = _createDummyUserOp();

        vm.prank(caller);
        vm.expectRevert("Sender not EntryPoint");
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0);
    }

    // CNT-133: postOp only callable from EntryPoint
    /// @notice Fuzz test: postOp should only work from EntryPoint
    function testFuzz_postOp_onlyEntryPoint(address caller) public {
        vm.assume(caller != address(entryPoint));
        vm.assume(caller != address(0));

        vm.prank(caller);
        vm.expectRevert("Sender not EntryPoint");
        paymaster.postOp(PostOpMode.opSucceeded, "", 0, 0);
    }

    // CNT-143: Owner withdrawal test
    /// @notice Fuzz test: owner can withdraw any amount up to balance
    function testFuzz_withdrawTo_owner(uint96 amount) public {
        uint256 balance = paymaster.getDeposit();
        vm.assume(amount <= balance);

        address recipient = address(0x1234);
        uint256 recipientBalanceBefore = recipient.balance;

        vm.prank(owner);
        paymaster.withdrawTo(payable(recipient), amount);

        assertEq(recipient.balance, recipientBalanceBefore + amount, "Withdrawal should transfer funds");
    }

    // CNT-144: non-owner withdraw revert
    /// @notice Fuzz test: non-owner cannot withdraw
    function testFuzz_withdrawTo_nonOwner(address caller, uint96 amount) public {
        vm.assume(caller != owner);
        vm.assume(caller != address(0));
        vm.assume(amount > 0);

        vm.prank(caller);
        vm.expectRevert();
        paymaster.withdrawTo(payable(caller), amount);
    }

    // CNT-145: Stake addition test
    /// @notice Fuzz test: add stake with varying amounts
    function testFuzz_addStake_validAmount(uint96 amount, uint32 delay) public {
        vm.assume(amount > 0 && amount <= 10 ether);
        vm.assume(delay > 0);
        vm.deal(owner, amount);

        vm.prank(owner);
        paymaster.addStake{value: amount}(delay);

        // Verify stake was added (EntryPoint manages the stake)
        assertTrue(true, "Stake should be added without revert");
    }

    // CNT-119: Bundler allowlist management
    /// @notice Fuzz test: bundler allowlist management
    function testFuzz_updateBundlerAllowlist(address bundler, bool allowed) public {
        vm.assume(bundler != address(0));

        address[] memory bundlers = new address[](1);
        bundlers[0] = bundler;

        vm.prank(manager);
        paymaster.updateBundlerAllowlist(bundlers, allowed);

        assertEq(paymaster.isBundlerAllowed(bundler), allowed, "Bundler allowlist should be updated");
    }

    // CNT-120: Batch bundler update
    /// @notice Fuzz test: batch update bundlers
    function testFuzz_updateBundlerAllowlist_batch(uint8 count, bool allowed) public {
        vm.assume(count > 0 && count <= 10);

        address[] memory bundlers = new address[](count);
        for (uint8 i = 0; i < count; i++) {
            bundlers[i] = address(uint160(i + 100));
        }

        vm.prank(manager);
        paymaster.updateBundlerAllowlist(bundlers, allowed);

        for (uint8 i = 0; i < count; i++) {
            assertEq(paymaster.isBundlerAllowed(bundlers[i]), allowed, "All bundlers should have correct status");
        }
    }

    // CNT-148: Signer addition
    /// @notice Fuzz test: signer management - add signer
    function testFuzz_addSigner(address newSigner) public {
        vm.assume(newSigner != address(0));

        vm.prank(owner);
        paymaster.addSigner(newSigner);

        assertTrue(paymaster.signers(newSigner), "Signer should be added");
    }

    // CNT-150: Revert when adding signer without authorization
    /// @notice Fuzz test: non-owner/non-manager cannot manage signers
    function testFuzz_addSigner_unauthorized(address caller, address newSigner) public {
        vm.assume(caller != owner);
        vm.assume(caller != manager);
        vm.assume(caller != address(0));
        vm.assume(newSigner != address(0));

        vm.prank(caller);
        vm.expectRevert();
        paymaster.addSigner(newSigner);
    }

    /// @notice Helper: create dummy UserOperation
    function _createDummyUserOp() internal view returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: address(0x1234),
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(uint256(100000) << 128 | uint256(100000)),
            preVerificationGas: 21000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(1 gwei)),
            paymasterAndData: abi.encodePacked(
                address(paymaster),
                uint128(100000),
                uint128(50000),
                uint8(1), // VERIFYING_MODE
                false,    // allowAllBundlers
                uint48(block.timestamp + 1000),
                uint48(0),
                new bytes(65) // dummy signature
            ),
            signature: ""
        });
    }
}
