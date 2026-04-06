// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ReentrantAttacker
 * @dev Test contract for reentrancy attack testing on ZkapAccount.execute()
 * This contract attempts to reenter the execute function when receiving ETH.
 */
contract ReentrantAttacker {
    address public target;
    bool public attacked;

    constructor(address _target) {
        target = _target;
    }

    function attack() external payable {
        attacked = true;
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            // Try to reenter execute() - this should fail because we're not EntryPoint
            (bool success, ) = target.call(
                abi.encodeWithSignature(
                    "execute(address,uint256,bytes)",
                    address(this),
                    0,
                    ""
                )
            );
            // We expect this to fail with "account: not from EntryPoint"
            require(!success, "Reentrancy should have been blocked");
        }
    }
}

/**
 * @title ReentrantBatchAttacker
 * @dev Test contract for reentrancy attack testing on ZkapAccount.executeBatch()
 * This contract attempts to reenter the executeBatch function when receiving ETH.
 */
contract ReentrantBatchAttacker {
    address public target;
    bool public attacked;

    constructor(address _target) {
        target = _target;
    }

    function attackBatch() external payable {
        attacked = true;
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            address[] memory dests = new address[](1);
            dests[0] = address(this);
            uint256[] memory values = new uint256[](1);
            values[0] = 0;
            bytes[] memory funcs = new bytes[](1);
            funcs[0] = "";

            // Try to reenter executeBatch() - this should fail because we're not EntryPoint
            (bool success, ) = target.call(
                abi.encodeWithSignature(
                    "executeBatch(address[],uint256[],bytes[])",
                    dests,
                    values,
                    funcs
                )
            );
            // We expect this to fail with "account: not from EntryPoint"
            require(!success, "Reentrancy should have been blocked");
        }
    }
}
