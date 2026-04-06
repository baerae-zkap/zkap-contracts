// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestToken
 * @dev ERC20 token contract for testing
 * Mints 100,000 tokens to the deployer upon deployment.
 */
contract TestToken is ERC20, Ownable {
    uint256 public constant INITIAL_SUPPLY = 100000 * 10 ** 18; // 100,000 tokens (18 decimals)

    /**
     * @dev Mints initial tokens to the deployer upon contract deployment.
     */
    constructor() ERC20("YeopJeon", "PUN") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /**
     * @dev Additional token minting function callable only by the owner
     * @param to Address to receive the tokens
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
