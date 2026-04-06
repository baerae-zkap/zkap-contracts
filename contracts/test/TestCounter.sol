// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TestCounter
 * @dev Counter contract for testing (for testing external contract calls)
 */
contract TestCounter {
    uint256 public count;

    event Incremented(uint256 newCount);
    event Deposited(address sender, uint256 amount);

    function increment() external {
        count++;
        emit Incremented(count);
    }

    function decrement() external {
        require(count > 0, "Counter: cannot decrement below zero");
        count--;
    }

    function deposit() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    function setCount(uint256 _count) external {
        count = _count;
    }

    receive() external payable {}
}
