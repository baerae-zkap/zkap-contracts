// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DemoToken is ERC20 {
    mapping(address => uint256) public stakedAmount;
    mapping(address => uint256) public totalReward;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        _mint(msg.sender, 1000000000000000000000000);
    }

    function stake(uint256 amount) external {
        uint256 reward = amount / 10; // 10% of the amount is the reward
        _transfer(msg.sender, address(this), amount);
        _mint(address(this), reward);
        stakedAmount[msg.sender] += amount + reward;
        totalReward[msg.sender] += reward;
    }

    function unstake(uint256 amount) external {
        _transfer(address(this), msg.sender, amount);
        stakedAmount[msg.sender] -= amount;
    }
}
