// SPDX-License-Identifier: LGPL-3.0+
pragma solidity ^0.8.13;

import "./Bn128.sol";
import "hardhat/console.sol";

library RetrieveX {
    function _retrieveX(uint256[] memory inputs) internal pure returns (uint256 x) {
        uint256 ord = Bn128.curveOrder;

        assembly {
            let transcript := mload(0x40)
            let trs := transcript

            for {
                let i_ptr := add(inputs, 0x20)
                let i_end := add(i_ptr, shl(0x05, mload(inputs)))
            } lt(i_ptr, i_end) {
                i_ptr := add(i_ptr, 0x20)
                trs := add(trs, 0x20)
            } {
                mstore(trs, mload(i_ptr))
            }

            x := mod(keccak256(transcript, sub(trs, transcript)), ord)

        }
    }    
}
