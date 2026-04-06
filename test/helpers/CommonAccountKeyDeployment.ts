import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

export async function commonAccountKeyDeployment(depth: number = 16) {
    const accountKeyAddressFactoryFactory = await ethers.getContractFactory("AccountKeyAddressFactory");
    const accountKeyAddressFactory = await accountKeyAddressFactoryFactory.deploy();

    const accountKeyMultisigFactoryFactory = await ethers.getContractFactory("AccountKeyMultisigFactory");
    const accountKeyMultisigFactory = await accountKeyMultisigFactoryFactory.deploy();

    const secp256r1FactoryFactory = await ethers.getContractFactory("AccountKeySecp256r1Factory");
    const secp256r1Factory = await secp256r1FactoryFactory.deploy();

    const EntryPoint = await ethers.getContractFactory("EntryPoint", {
        libraries: {},
    });
    const entryPoint = await EntryPoint.deploy();

    const Bn128 = await ethers.deployContract("Bn128");
    const Bn128G2 = await ethers.deployContract("Bn128G2");
    const Operations = await ethers.deployContract("Operations");
    const PolymathVerifyBn128 = await ethers.deployContract("PolymathVerifyBn128");
    const Groth16AltBN128 = await ethers.deployContract("Groth16AltBN128");
    const PoseidonHashLib = await ethers.deployContract("PoseidonHashLib");
    const Groth16Verifier = await ethers.deployContract("contracts/Utils/Groth16Verifier.sol:Groth16Verifier");

    const PoseidonMerkleTreeDirectoryFactory = await ethers.getContractFactory("PoseidonMerkleTreeDirectory", {
        libraries: { PoseidonHashLib },
    });
    const poseidonMerkleTreeDirectory = await PoseidonMerkleTreeDirectoryFactory.deploy(depth);

    const PoseidonHasherFactoryFactory = await ethers.getContractFactory("PoseidonHasher", {
        libraries: { PoseidonHashLib },
    });
    const poseidonHasherFactory = await PoseidonHasherFactoryFactory.deploy();

    const ZksnarkVerifyingKeyDirectoryFactory = await ethers.getContractFactory("ZksnarkVerifyingKeyDirectory");
    const zksnarkVerifyingKeyDirectory = await ZksnarkVerifyingKeyDirectoryFactory.deploy();

    const OAuthRS256PubkeyRegistryDirectoryFactory = await ethers.getContractFactory(
        "OAuthRS256PubkeyRegistryDirectory"
    );
    const oAuthRS256PubkeyRegistryDirectory = await OAuthRS256PubkeyRegistryDirectoryFactory.deploy();

    const SECP256K1 = await ethers.deployContract("SECP256K1");

    const accountKeyOAuthRS256VerifierFactoryFactory = await ethers.getContractFactory(
        "AccountKeyOAuthRS256VerifierFactory"
    );
    const accountKeyOAuthRS256VerifierFactory = await accountKeyOAuthRS256VerifierFactoryFactory.deploy();

    const secp256k1FactoryFactory = await ethers.getContractFactory("AccountKeySecp256k1Factory", {
        libraries: { SECP256K1 },
    });
    const secp256k1Factory = await secp256k1FactoryFactory.deploy();

    const webAuthnFactoryFactory = await ethers.getContractFactory("AccountKeyWebAuthnFactory");
    const webAuthnFactory = await webAuthnFactoryFactory.deploy();

    const ZksnarkCommonVerifyingKeyDirectoryFactory = await ethers.getContractFactory(
        "ZksnarkCommonVerifyingKeyDirectory"
    );
    const zksnarkCommonVerifyingKeyDirectory = await ZksnarkCommonVerifyingKeyDirectoryFactory.deploy();

    const accountKeyZkOAuthRS256VerifierFactoryFactory = await ethers.getContractFactory(
        "AccountKeyZkOAuthRS256VerifierFactory"
    );
    const accountKeyZkOAuthRS256VerifierFactory = await accountKeyZkOAuthRS256VerifierFactoryFactory.deploy();

    const accountKeyZkOAuthRS256VerifierFactory2Factory = await ethers.getContractFactory(
        "AccountKeyZkOAuthRS256VerifierFactory2",
        {
            libraries: { Groth16Verifier, PoseidonHashLib },
        }
    );
    const accountKeyZkOAuthRS256VerifierFactory2 = await accountKeyZkOAuthRS256VerifierFactory2Factory.deploy();

    const zkapAccountFactoryFactory = await ethers.getContractFactory("ZkapAccountFactory");
    const zkapAccountFactory = await zkapAccountFactoryFactory.deploy(entryPoint.target);

    const accountKeyZkOAuthRS256VerifierContractFactory = await ethers.getContractFactory(
        "AccountKeyZkOAuthRS256Verifier2"
    );
    const accountKeyZkOAuthRS256Verifier = await accountKeyZkOAuthRS256VerifierContractFactory.deploy();

    const accountKeyZkOAuthRS256Verifier3ContractFactory = await ethers.getContractFactory(
        "AccountKeyZkOAuthRS256Verifier3",
        {
            libraries: { Groth16Verifier, PoseidonHashLib },
        }
    );
    const accountKeyZkOAuthRS256Verifier3 = await accountKeyZkOAuthRS256Verifier3ContractFactory.deploy();

    const accountKeyAddressContractFactory = await ethers.getContractFactory("AccountKeyAddress2");
    const accountKeyAddress = await accountKeyAddressContractFactory.deploy();

    const primitiveAccountKeyFactoryFactory = await ethers.getContractFactory("PrimitiveAccountKeyFactory");
    const primitiveAccountKeyFactory = await primitiveAccountKeyFactoryFactory.deploy(
        accountKeyAddressFactory.target,
        secp256k1Factory.target,
        secp256r1Factory.target,
        webAuthnFactory.target,
        accountKeyOAuthRS256VerifierFactory.target,
        oAuthRS256PubkeyRegistryDirectory.target,
        accountKeyZkOAuthRS256VerifierFactory.target,
        zksnarkCommonVerifyingKeyDirectory.target,
        poseidonMerkleTreeDirectory.target,
        zksnarkVerifyingKeyDirectory.target,
        accountKeyZkOAuthRS256VerifierFactory2.target
    );

    const CompositeAccountKeyFactory = await ethers.getContractFactory("CompositeAccountKeyFactory");
    const compositeFactory = await CompositeAccountKeyFactory.deploy(
        primitiveAccountKeyFactory.target,
        accountKeyMultisigFactory.target
    );

    const TestTokenFactory = await ethers.getContractFactory("DemoToken");
    const testToken = await TestTokenFactory.deploy("YeopJeon", "PUN");

    const ownerWallet = new ethers.Wallet(
        process.env.PRIVATE_KEY ||
          (() => {
            throw new Error("PRIVATE_KEY is not defined");
          })()
      );

      const signer = new ethers.Wallet(
        process.env.PAYMASTER_PRIVATE_KEY ||
          (() => {
            throw new Error("PAYMASTER_PRIVATE_KEY is not defined");
          })()
      );

    const ZkapPaymasterFactory = await ethers.getContractFactory("ZkapPaymaster");
    const zkapPaymaster = await ZkapPaymasterFactory.deploy(entryPoint.target, ownerWallet.address, ownerWallet.address, [signer.address]);

    return {
        entryPoint,
        accountKeyAddressFactory,
        secp256k1Factory,
        secp256r1Factory,
        webAuthnFactory,
        accountKeyOAuthRS256VerifierFactory,
        oAuthRS256PubkeyRegistryDirectory,
        zksnarkCommonVerifyingKeyDirectory,
        accountKeyZkOAuthRS256VerifierFactory,
        primitiveAccountKeyFactory,
        accountKeyMultisigFactory,
        compositeFactory,
        zkapAccountFactory,
        accountKeyZkOAuthRS256Verifier,
        accountKeyZkOAuthRS256Verifier3,
        accountKeyAddress,
        poseidonMerkleTreeDirectory,
        zksnarkVerifyingKeyDirectory,
        accountKeyZkOAuthRS256VerifierFactory2,
        zkapPaymaster,
        testToken,
    };
}
