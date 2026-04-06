// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../../contracts/ZkapAccount.sol";
import "../../contracts/ZkapAccountFactory.sol";
import "../../contracts/AccountKey/Primitive/Address/AccountKeyAddress.sol";
import "@account-abstraction/contracts/core/EntryPoint.sol";

abstract contract BaseTest is Test {
    EntryPoint public entryPoint;
    ZkapAccountFactory public factory;
    AccountKeyAddress public accountKeyLogic;

    address public owner;
    uint256 public ownerPrivateKey;

    function setUp() public virtual {
        // Setup owner with known private key for signing
        ownerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        owner = vm.addr(ownerPrivateKey);

        // Deploy EntryPoint
        entryPoint = new EntryPoint();

        // Deploy AccountKeyAddress logic contract
        accountKeyLogic = new AccountKeyAddress();

        // Deploy ZkapAccountFactory
        factory = new ZkapAccountFactory(entryPoint);

        // Fund owner
        vm.deal(owner, 100 ether);
    }

    /// @notice Creates encoded key data for AccountKeyAddress
    function createEncodedAddressKey(
        address keyLogic,
        address signer,
        uint8 threshold,
        uint8 weight
    ) internal pure returns (bytes memory) {
        address[] memory logicList = new address[](1);
        logicList[0] = keyLogic;

        bytes[] memory initDataList = new bytes[](1);
        initDataList[0] = abi.encode(signer);

        uint8[] memory weightList = new uint8[](1);
        weightList[0] = weight;

        return abi.encode(threshold, logicList, initDataList, weightList);
    }

    /// @notice Creates a valid account with address key
    function createValidAccount(
        uint256 salt,
        address signer
    ) internal returns (ZkapAccount) {
        bytes memory encodedKey = createEncodedAddressKey(
            address(accountKeyLogic),
            signer,
            1, // threshold
            1  // weight
        );

        return factory.createAccount(salt, encodedKey, encodedKey);
    }

    /// @notice Creates encoded key data for multiple signers
    function createEncodedMultisigKey(
        address keyLogic,
        address[] memory signers,
        uint8 threshold,
        uint8[] memory weights
    ) internal pure returns (bytes memory) {
        require(signers.length == weights.length, "Array length mismatch");

        address[] memory logicList = new address[](signers.length);
        bytes[] memory initDataList = new bytes[](signers.length);

        for (uint256 i = 0; i < signers.length; i++) {
            logicList[i] = keyLogic;
            initDataList[i] = abi.encode(signers[i]);
        }

        return abi.encode(threshold, logicList, initDataList, weights);
    }

    /// @notice Creates a multisig account with multiple keys
    function createMultisigAccount(
        uint256 salt,
        address[] memory signers,
        uint8 threshold,
        uint8[] memory weights
    ) internal returns (ZkapAccount) {
        bytes memory encodedKey = createEncodedMultisigKey(
            address(accountKeyLogic),
            signers,
            threshold,
            weights
        );

        return factory.createAccount(salt, encodedKey, encodedKey);
    }
}
