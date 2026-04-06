import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ZkapModule = buildModule("ZkapModule", (m) => {
  const entryPoint = m.contract("EntryPoint");
  const SECP256K1 = m.library("SECP256K1");
  const Base64Url = m.contract("Base64Url");
  const JsonUtils = m.contract("JsonUtils");
  const StringUtils = m.contract("StringUtils");

  const accountKeyFactory = m.contract("AccountKeyAddressFactory");
  const secp256k1Factory = m.contract("AccountKeySecp256k1Factory", [], {libraries: {SECP256K1}});
  const secp256r1Factory = m.contract("AccountKeySecp256r1Factory", []);
  const webAuthnFactory = m.contract("AccountKeyWebAuthnFactory", [], {libraries: {Base64Url, JsonUtils, StringUtils}});
  const oAuthRS256Factory = m.contract("AccountKeyOAuthRS256VerifierFactory", [], { libraries: { Base64Url, JsonUtils}})

  const oAuthRS256PubkeyRegistryDirectory = m.contract("OAuthRS256PubkeyRegistryDirectory");

  const multisigFactory = m.contract("AccountKeyMultisigFactory", []);

  const primitiveAccountKeyFactory = m.contract("PrimitiveAccountKeyFactory", [accountKeyFactory, secp256k1Factory, secp256r1Factory, webAuthnFactory, oAuthRS256Factory, oAuthRS256PubkeyRegistryDirectory]);
  const compositeAccountKeyFactory = m.contract("CompositeAccountKeyFactory", [primitiveAccountKeyFactory, multisigFactory]);

  const zkapAccountFactory = m.contract("ZkapAccountFactory", [entryPoint]);

  return {entryPoint, zkapAccountFactory};
});

export default ZkapModule;
