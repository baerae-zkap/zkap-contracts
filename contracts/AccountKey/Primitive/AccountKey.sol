// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../ContractInterface/IAccountKey.sol";

abstract contract AccountKey is ERC165, IAccountKey {
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC165) returns (bool) {
        return
            interfaceId == type(IAccountKey).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
