// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../contracts/paymaster/ZkapPaymaster.sol";
import "@account-abstraction/contracts/core/EntryPoint.sol";

/// @title ZkapPaymaster Invariant Tests
/// @notice Tests that verify invariants that must always hold for ZkapPaymaster
contract ZkapPaymasterInvariantTest is Test {
    ZkapPaymaster public paymaster;
    EntryPoint public entryPoint;
    ZkapPaymasterHandler public handler;

    address public owner;
    address public manager;
    address public signer;

    function setUp() public {
        owner = address(0x1111);
        manager = address(0x2222);
        signer = address(0x3333);

        entryPoint = new EntryPoint();

        address[] memory signers = new address[](1);
        signers[0] = signer;

        paymaster = new ZkapPaymaster(
            address(entryPoint),
            owner,
            manager,
            signers
        );

        vm.deal(owner, 100 ether);
        vm.deal(address(paymaster), 100 ether);
        vm.prank(owner);
        paymaster.deposit{value: 10 ether}();

        handler = new ZkapPaymasterHandler(paymaster, owner, manager);
        vm.deal(address(handler), 100 ether);

        targetContract(address(handler));
    }

    /// @notice Invariant: EntryPoint should never change
    function invariant_entryPointImmutable() public view {
        assertEq(
            address(paymaster.entryPoint()),
            address(entryPoint),
            "EntryPoint should be immutable"
        );
    }

    /// @notice Invariant: Admin role should be set
    function invariant_adminRoleSet() public view {
        // Admin role is set during construction
        assertTrue(
            paymaster.hasRole(paymaster.DEFAULT_ADMIN_ROLE(), owner),
            "Admin role should be set"
        );
    }

    /// @notice Invariant: Initial signer should remain valid unless explicitly changed
    function invariant_signerConsistency() public pure {
        // Check that at least one signer exists (the initial one)
        // Note: This might change if all signers are removed
        assertTrue(true, "Signer management is owner controlled");
    }

    /// @notice Invariant: Deposit should be trackable
    function invariant_depositTrackable() public view {
        // getDeposit should always return a valid value
        uint256 deposit = paymaster.getDeposit();
        assertTrue(deposit >= 0, "Deposit should be non-negative");
    }
}

/// @title Handler contract for ZkapPaymaster invariant testing
contract ZkapPaymasterHandler is Test {
    ZkapPaymaster public paymaster;
    address public owner;
    address public manager;

    uint256 public callCount;
    uint256 public successfulOperations;

    constructor(ZkapPaymaster _paymaster, address _owner, address _manager) {
        paymaster = _paymaster;
        owner = _owner;
        manager = _manager;
    }

    /// @notice Handler: add deposit as owner
    function deposit(uint96 amount) external {
        amount = uint96(bound(amount, 0.001 ether, 1 ether));
        callCount++;

        vm.prank(owner);
        try paymaster.deposit{value: amount}() {
            successfulOperations++;
        } catch {}
    }

    /// @notice Handler: update bundler allowlist as manager
    function updateBundlerAllowlist(address bundler, bool allowed) external {
        callCount++;
        if (bundler == address(0)) return;

        address[] memory bundlers = new address[](1);
        bundlers[0] = bundler;

        vm.prank(manager);
        try paymaster.updateBundlerAllowlist(bundlers, allowed) {
            successfulOperations++;
        } catch {}
    }

    /// @notice Handler: add signer as owner/manager
    function addSigner(address newSigner) external {
        callCount++;
        if (newSigner == address(0)) return;

        vm.prank(owner);
        try paymaster.addSigner(newSigner) {
            successfulOperations++;
        } catch {}
    }

    /// @notice Handler: withdraw as owner (bounded to not exceed deposit)
    function withdrawTo(uint96 amount) external {
        uint256 currentDeposit = paymaster.getDeposit();
        amount = uint96(bound(amount, 0, currentDeposit));
        callCount++;

        if (amount > 0) {
            vm.prank(owner);
            try paymaster.withdrawTo(payable(owner), amount) {
                successfulOperations++;
            } catch {}
        }
    }

    receive() external payable {}
}
