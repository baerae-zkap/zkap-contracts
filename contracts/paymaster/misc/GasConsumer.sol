// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GasConsumer
 * @dev Test contract for gas limit exceeded testing
 * This contract has a function that consumes arbitrary amounts of gas.
 */
contract GasConsumer {
    uint256 public counter;

    /**
     * @dev Consumes gas by performing iterations
     * @param iterations Number of iterations to perform
     */
    function consumeGas(uint256 iterations) external {
        for (uint256 i = 0; i < iterations; i++) {
            counter += 1;
        }
    }
}
