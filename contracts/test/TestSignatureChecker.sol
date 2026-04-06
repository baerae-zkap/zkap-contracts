// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/**
 * @title TestSignatureChecker
 * @dev Test contract for verifying EIP-1271 signatures using OpenZeppelin's SignatureChecker
 */
contract TestSignatureChecker {
    using SignatureChecker for address;

    /**
     * @dev Verify a signature using SignatureChecker.isValidSignatureNow
     * @param signer The address of the signer (can be EOA or contract)
     * @param hash The hash that was signed
     * @param signature The signature bytes
     * @return bool True if signature is valid
     */
    function isValidSignatureNow(
        address signer,
        bytes32 hash,
        bytes memory signature
    ) external view returns (bool) {
        return signer.isValidSignatureNow(hash, signature);
    }

    /**
     * @dev Verify ERC-1271 signature specifically (for contracts only)
     * @param signer The contract address
     * @param hash The hash that was signed
     * @param signature The signature bytes
     * @return bool True if signature is valid
     */
    function isValidERC1271SignatureNow(
        address signer,
        bytes32 hash,
        bytes memory signature
    ) external view returns (bool) {
        return signer.isValidERC1271SignatureNow(hash, signature);
    }
}
