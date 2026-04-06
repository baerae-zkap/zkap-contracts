// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "./BaseTest.sol";

/// @title ZkapAccount Invariant Tests
/// @notice Tests that verify invariants that must always hold for ZkapAccount
contract ZkapAccountInvariantTest is BaseTest {
    ZkapAccount public account;
    ZkapAccountHandler public handler;

    function setUp() public override {
        super.setUp();
        account = createValidAccount(1, owner);
        vm.deal(address(account), 100 ether);
        vm.prank(owner);
        entryPoint.depositTo{value: 10 ether}(address(account));

        handler = new ZkapAccountHandler(account, entryPoint, owner);
        targetContract(address(handler));
    }

    /// @notice Invariant: EntryPoint address should never change
    function invariant_entryPointImmutable() public view {
        assertEq(
            address(account.entryPoint()),
            address(entryPoint),
            "EntryPoint should be immutable"
        );
    }

    /// @notice Invariant: masterKeyThreshold should always be > 0 after initialization
    function invariant_masterKeyThresholdPositive() public view {
        assertTrue(
            account.masterKeyThreshold() > 0,
            "Master key threshold must be positive"
        );
    }

    /// @notice Invariant: txKeyThreshold should always be > 0 after initialization
    function invariant_txKeyThresholdPositive() public view {
        assertTrue(
            account.txKeyThreshold() > 0,
            "Tx key threshold must be positive"
        );
    }

    /// @notice Invariant: account should always be able to receive ETH
    function invariant_canReceiveEth() public {
        uint256 balanceBefore = address(account).balance;
        uint256 sendAmount = 0.1 ether;

        (bool success,) = address(account).call{value: sendAmount}("");

        assertTrue(success, "Account should accept ETH");
        assertEq(
            address(account).balance,
            balanceBefore + sendAmount,
            "Balance should increase"
        );
    }
}

/// @title Handler contract for ZkapAccount invariant testing
contract ZkapAccountHandler is Test {
    ZkapAccount public account;
    IEntryPoint public entryPoint;
    address public owner;

    uint256 public callCount;
    uint256 public successfulDeposits;
    uint256 public failedCalls;

    constructor(ZkapAccount _account, IEntryPoint _entryPoint, address _owner) {
        account = _account;
        entryPoint = _entryPoint;
        owner = _owner;
        vm.deal(address(this), 1000 ether);
    }

    /// @notice Handler: attempt to add deposit
    function addDeposit(uint96 amount) external {
        amount = uint96(bound(amount, 0.001 ether, 1 ether));
        callCount++;

        try account.addDeposit{value: amount}() {
            successfulDeposits++;
        } catch {
            failedCalls++;
        }
    }

    /// @notice Handler: send ETH to account
    function sendEth(uint96 amount) external {
        amount = uint96(bound(amount, 0.001 ether, 1 ether));
        callCount++;

        (bool success,) = address(account).call{value: amount}("");
        if (success) {
            successfulDeposits++;
        } else {
            failedCalls++;
        }
    }

    /// @notice Handler: get deposit (view function, always succeeds)
    function getDeposit() external view returns (uint256) {
        return account.getDeposit();
    }

    receive() external payable {}
}
