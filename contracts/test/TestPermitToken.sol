// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title TestPermitToken
 * @dev Test ERC20 token with EIP-2612 permit functionality for testing EIP-1271 integration
 */
contract TestPermitToken is ERC20, ERC20Permit {
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) ERC20Permit(name) {
        _mint(msg.sender, initialSupply);
    }

    /**
     * @dev Mint tokens (for testing)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
