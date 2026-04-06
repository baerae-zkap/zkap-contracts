import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();
const entrypointAddress = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";

export async function zkapRelatedContractDeployment(depth: number = 16) {
  const EntryPoint = await ethers.getContractFactory("EntryPoint", {
    libraries: {},
  });
  const entryPoint = await EntryPoint.deploy();
  // const entryPoint = await ethers.getContractAt("SimpleEntryPoint", entrypointAddress);

  const PoseidonHashLib = await ethers.deployContract("PoseidonHashLib");
  const Groth16Verifier = await ethers.deployContract("contracts/Utils/Groth16Verifier.sol:Groth16Verifier");

  const PoseidonMerkleTreeDirectoryFactory = await ethers.getContractFactory(
    "PoseidonMerkleTreeDirectory",
    {
      libraries: { PoseidonHashLib },
    }
  );
  const poseidonMerkleTreeDirectory =
    await PoseidonMerkleTreeDirectoryFactory.deploy(depth);

  const zkapAccountFactoryFactory = await ethers.getContractFactory(
    "ZkapAccountFactory"
  );
  const zkapAccountFactory = await zkapAccountFactoryFactory.deploy(
    entryPoint.target
  );

  const webAuthnAccountKeyFactory = await ethers.getContractFactory(
    "AccountKeyWebAuthn"
  );
  const webAuthnAccountKey = await webAuthnAccountKeyFactory.deploy();

  console.log("webAuthnAccountKey: ", webAuthnAccountKey.target);

  const accountKeyZkOAuthRS256VerifierContractFactory =
    await ethers.getContractFactory("AccountKeyZkOAuthRS256Verifier", {
      libraries: { Groth16Verifier, PoseidonHashLib },
    });
  const accountKeyZkOAuthRS256Verifier =
    await accountKeyZkOAuthRS256VerifierContractFactory.deploy();

  const accountKeyAddressContractFactory = await ethers.getContractFactory(
    "AccountKeyAddress"
  );
  const accountKeyAddress = await accountKeyAddressContractFactory.deploy();

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
  const zkapPaymaster = await ZkapPaymasterFactory.deploy(
    entryPoint.target,
    ownerWallet.address,
    ownerWallet.address,
    [signer.address]
  );

  console.log("entryPoint: ", entryPoint.target);
  console.log("zkapAccountFactory: ", zkapAccountFactory.target);
  console.log(
    "accountKeyZkOAuthRS256Verifier: ",
    accountKeyZkOAuthRS256Verifier.target
  );
  console.log("accountKeyAddress: ", accountKeyAddress.target);
  console.log(
    "poseidonMerkleTreeDirectory: ",
    poseidonMerkleTreeDirectory.target
  );
  console.log("zkapPaymaster: ", zkapPaymaster.target);

  return {
    entryPoint,
    zkapAccountFactory,
    accountKeyZkOAuthRS256Verifier,
    accountKeyAddress,
    poseidonMerkleTreeDirectory,
    zkapPaymaster,
  };
}
