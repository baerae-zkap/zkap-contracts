# TDD with 95% Coverage Skill for Solidity Smart Contracts

## Trigger Keywords
- "테스트 추가", "테스트 코드", "coverage", "커버리지", "TDD"
- 코드 수정 완료 후 자동 트리거

## Instructions

모든 코드 수정 후 다음 단계를 반드시 수행:

### 1. 테스트 파일 확인/생성
```bash
# 수정한 파일에 해당하는 테스트 파일 확인
# contracts/ZkapAccount.sol -> test/unit/ZkapAccount.test.ts
# contracts/AccountKey/Primitive/Address/AccountKeyAddress.sol -> test/unit/AccountKey/AccountKeyAddress.test.ts
# contracts/paymaster/ZkapPaymaster.sol -> test/unit/ZkapPaymaster.test.ts
```

### 2. 테스트 작성 원칙
- 성공 케이스 (happy path)
- 실패 케이스 (error handling - revert 조건)
- 경계값 (edge cases)
- 각 분기(branch) 커버
- **CNT-XXX 형식의 테스트 ID 부여**

### 3. 테스트 실행
```bash
# 단일 테스트 파일 실행
npx hardhat test test/unit/ZkapAccount.test.ts

# 특정 패턴 테스트
npx hardhat test --grep "ZkapAccount"

# 전체 테스트
npx hardhat test
```

### 4. 커버리지 확인
```bash
# 전체 커버리지 리포트 (unit 테스트만, .solcover.js 필수)
npx hardhat coverage --solcoverjs .solcover.js --testfiles "test/unit/**/*.ts"

# 특정 파일만 커버리지
npx hardhat coverage --solcoverjs .solcover.js --testfiles "test/unit/ZkapAccount.test.ts"

# 커버리지 전 캐시 정리 (설정 변경 시)
npx hardhat clean
```

### 5. 커버리지 목표
- **목표: 95% 이상**
- Statements: 95%+
- Branches: 95%+
- Functions: 95%+
- Lines: 95%+

### 6. 커버리지 부족 시
1. coverage/lcov-report/index.html에서 uncovered 라인 확인
2. 해당 라인을 테스트하는 케이스 추가
3. 다시 커버리지 확인
4. 95% 달성까지 반복

### 7. 커밋 조건
- 모든 테스트 통과
- 커버리지 95% 이상 달성
- 테스트 파일과 소스 파일 함께 커밋

## 테스트 구조 템플릿

### Unit Test 템플릿
```typescript
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { createDummyEncodedKey, encodeAddressKey, encodePrimitiveKeys } from "../helpers/accountKeyHelper";
import {
  createSignedUserOp,
  createUserOp,
  getUserOpHash,
  signUserOp,
  encodeZkapSignature,
} from "../helpers/userOpHelper";

// Helper function
function createTestWallet(seed: number = 0): Wallet {
  const baseKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const keyBigInt = BigInt(baseKey) + BigInt(seed);
  return new Wallet(ethers.toBeHex(keyBigInt, 32));
}

// Fixture: Deploy contracts
async function deployContracts() {
  const signers = await ethers.getSigners();
  const owner = signers[0];

  // Deploy EntryPoint
  const EntryPointFactory = await ethers.getContractFactory("SimpleEntryPoint");
  const entryPoint = await EntryPointFactory.deploy();
  await entryPoint.waitForDeployment();

  // Deploy AccountKeyAddress Logic
  const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
  const accountKeyAddressLogic = await AccountKeyAddressFactory.deploy();
  await accountKeyAddressLogic.waitForDeployment();

  // Deploy ZkapAccount Logic
  const AccountFactory = await ethers.getContractFactory("ZkapAccount");
  const accountLogic = await AccountFactory.deploy(await entryPoint.getAddress());
  await accountLogic.waitForDeployment();

  const testWallet = createTestWallet();

  return { accountLogic, entryPoint, accountKeyAddressLogic, owner, testWallet };
}

describe("ContractName", function () {
  describe("Deployment", function () {
    // CNT-XXX: 설명
    it("CNT-XXX: should deploy successfully", async function () {
      const { accountLogic } = await loadFixture(deployContracts);
      expect(await accountLogic.getAddress()).to.be.properAddress;
    });
  });

  describe("FunctionName", function () {
    // CNT-XXX: 성공 케이스
    it("CNT-XXX: should succeed when valid input", async function () {
      // Arrange
      const { account } = await loadFixture(deployContracts);

      // Act
      const result = await account.someFunction();

      // Assert
      expect(result).to.equal(expected);
    });

    // CNT-XXX: 실패 케이스
    it("CNT-XXX: should revert when invalid input", async function () {
      const { account } = await loadFixture(deployContracts);

      await expect(account.someFunction(invalidInput))
        .to.be.revertedWithCustomError(account, "CustomErrorName");
    });

    // CNT-XXX: 이벤트 발생 확인
    it("CNT-XXX: should emit Event", async function () {
      const { account } = await loadFixture(deployContracts);

      await expect(account.someFunction())
        .to.emit(account, "EventName")
        .withArgs(arg1, arg2);
    });

    // CNT-XXX: 경계값 테스트
    it("CNT-XXX: should handle edge case", async function () {
      // ...
    });
  });
});
```

### E2E Test 템플릿
```typescript
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { createDummyEncodedKey } from "../helpers/accountKeyHelper";
import { createSignedUserOp } from "../helpers/userOpHelper";

async function deployE2EContracts() {
  const signers = await ethers.getSigners();
  const owner = signers[0];

  // Deploy EntryPoint
  const EntryPointFactory = await ethers.getContractFactory("SimpleEntryPoint");
  const entryPoint = await EntryPointFactory.deploy();

  // Deploy AccountKeyAddress Logic
  const AccountKeyAddressFactory = await ethers.getContractFactory("AccountKeyAddress");
  const accountKeyAddressLogic = await AccountKeyAddressFactory.deploy();

  // Deploy ZkapAccountFactory
  const FactoryContract = await ethers.getContractFactory("ZkapAccountFactory");
  const factory = await FactoryContract.deploy(await entryPoint.getAddress());

  return { entryPoint, factory, accountKeyAddressLogic, owner };
}

describe("E2E: FeatureName", function () {
  // CNT-XXX: 전체 플로우 테스트
  it("CNT-XXX: should complete full flow", async function () {
    const { factory, entryPoint, accountKeyAddressLogic, owner } = await loadFixture(deployE2EContracts);

    // 1. Create wallet
    const testWallet = new ethers.Wallet("0x...");
    const encodedKey = await createDummyEncodedKey(
      await accountKeyAddressLogic.getAddress(),
      testWallet.address
    );
    const accountAddress = await factory.createAccount.staticCall(1, encodedKey, encodedKey);
    await factory.createAccount(1, encodedKey, encodedKey);

    // 2. Fund wallet
    await owner.sendTransaction({
      to: accountAddress,
      value: ethers.parseEther("5.0"),
    });

    // 3. Execute via EntryPoint
    const account = await ethers.getContractAt("ZkapAccount", accountAddress);
    await account.addDeposit({ value: ethers.parseEther("1.0") });

    const callData = account.interface.encodeFunctionData("execute", [
      recipient, amount, "0x"
    ]);
    const userOp = await createSignedUserOp(account, entryPoint, callData, testWallet, 0);
    await entryPoint.handleOps([userOp], owner.address);

    // 4. Verify result
    expect(await ethers.provider.getBalance(recipient)).to.equal(amount);
  });
});
```

## Mock 패턴 예시

### EntryPoint Mock (SimpleEntryPoint)
프로젝트에 `contracts/samples/SimpleEntryPoint.sol`이 있어 테스트용으로 사용

### Factory를 통한 계정 생성
```typescript
const encodedKey = await createDummyEncodedKey(
  await accountKeyAddressLogic.getAddress(),
  signerAddress
);
const accountAddress = await factory.createAccount.staticCall(salt, encodedKey, encodedKey);
await factory.createAccount(salt, encodedKey, encodedKey);
const account = await ethers.getContractAt("ZkapAccount", accountAddress);
```

### Multisig Key 설정
```typescript
const encodedTxKey = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint8", "address[]", "bytes[]", "uint8[]"],
  [
    threshold,
    [logicAddress1, logicAddress2],
    [initData1, initData2],
    [weight1, weight2],
  ]
);
```

### WebAuthn Library Linking
```typescript
const Base64UrlFactory = await ethers.getContractFactory("Base64Url");
const base64Url = await Base64UrlFactory.deploy();

const AccountKeyWebAuthnFactory = await ethers.getContractFactory("AccountKeyWebAuthn", {
  libraries: {
    Base64Url: await base64Url.getAddress(),
    JsonUtils: await jsonUtils.getAddress(),
    StringUtils: await stringUtils.getAddress(),
  },
});
```

## 테스트 파일 구조

```
test/
├── helpers/
│   ├── accountKeyHelper.ts    # Key 인코딩 헬퍼
│   └── userOpHelper.ts        # UserOp 생성/서명 헬퍼
├── unit/                       # 유닛 테스트
│   ├── ZkapAccount.test.ts
│   ├── ZkapAccountFactory.test.ts
│   ├── ZkapPaymaster.test.ts
│   └── AccountKey/
│       ├── AccountKeyAddress.test.ts
│       ├── AccountKeySecp256r1.test.ts
│       ├── AccountKeyWebAuthn.test.ts
│       └── AccountKeyZkOAuthRS256Verifier.test.ts
├── e2e/                        # E2E 테스트
│   ├── WalletCreation.e2e.test.ts
│   ├── Transaction.e2e.test.ts
│   ├── KeyUpdate.e2e.test.ts
│   ├── Recovery.e2e.test.ts
│   └── PaymasterIntegration.e2e.test.ts
└── contracts/                  # 컨트랙트별 상세 테스트
    └── AccountKey/
        └── Primitive/
```

## 주요 테스트 케이스 체크리스트

### ZkapAccount
- [ ] Deployment (CNT-1 ~ CNT-4)
- [ ] Initialization (CNT-5 ~ CNT-12)
- [ ] Execute (CNT-13 ~ CNT-25)
- [ ] ExecuteBatch (CNT-26 ~ CNT-35)
- [ ] MasterKey Update (CNT-36 ~ CNT-50)
- [ ] TxKey Update (CNT-51 ~ CNT-65)
- [ ] Deposit Management (CNT-66 ~ CNT-75)
- [ ] UUPS Upgrade (CNT-76 ~ CNT-85)
- [ ] Receive/Fallback (CNT-86 ~ CNT-95)

### ZkapAccountFactory
- [ ] CreateAccount (CNT-100 ~ CNT-115)
- [ ] CalcAccountAddress (CNT-116 ~ CNT-125)

### AccountKey Types
- [ ] AccountKeyAddress (CNT-150 ~ CNT-170)
- [ ] AccountKeySecp256r1 (CNT-171 ~ CNT-190)
- [ ] AccountKeyWebAuthn (CNT-191 ~ CNT-220)
- [ ] AccountKeyZkOAuthRS256Verifier (CNT-221 ~ CNT-250)

### E2E Flows
- [ ] Wallet Creation (CNT-283 ~ CNT-308)
- [ ] Transaction Execution (CNT-309 ~ CNT-330)
- [ ] Key Update Flow (CNT-331 ~ CNT-350)
- [ ] Paymaster Integration (CNT-351 ~ CNT-370)
- [ ] Recovery Flow (CNT-371 ~ CNT-390)

## Solidity Coverage 설정

**중요: `.solcover.js` 파일이 프로젝트 루트에 필요합니다.**

`.solcover.js` 설정:
```javascript
module.exports = {
  skipFiles: [
    // 유틸리티 및 외부 라이브러리
    'Utils',
    'Token',
    'exp',
    'SimpleEntryPoint.sol',
    // 테스트 헬퍼 컨트랙트
    'test',
    'paymaster/misc/Eip7702Support.sol',
    'paymaster/misc/GasConsumer.sol',
    'paymaster/misc/PimlicoTestInfiniteSupplyToken.sol',
    // 외부 암호화 라이브러리
    'AccountKey/Primitive/PKI/Secp256r1/Secp256r1.sol',
    // 추상 컨트랙트 (직접 테스트 불가)
    'AccountKey/Primitive/AccountKey.sol',
  ],
};
```

**주의사항:**
- `hardhat.config.ts`의 `solcover` 설정은 작동하지 않음
- 반드시 `.solcover.js` 파일과 `--solcoverjs .solcover.js` 옵션 사용
- 설정 변경 후 `npx hardhat clean` 실행 필요

## Custom Error 테스트 패턴

```typescript
// CustomError without args
await expect(account.someFunction())
  .to.be.revertedWithCustomError(account, "Unauthorized");

// CustomError with args
await expect(account.someFunction())
  .to.be.revertedWithCustomError(account, "InvalidKey")
  .withArgs(keyIndex, reason);

// Panic (assert failure)
await expect(account.someFunction())
  .to.be.revertedWithPanic(0x01); // 0x01 = assertion failure
```

## Gas Benchmark 테스트

```typescript
describe("Gas Benchmark", function () {
  it("should measure gas for execute", async function () {
    const tx = await entryPoint.handleOps([userOp], owner.address);
    const receipt = await tx.wait();
    console.log("Gas used:", receipt?.gasUsed.toString());

    // Optional: assert gas limit
    expect(receipt?.gasUsed).to.be.lessThan(500000n);
  });
});
```

## 현재 커버리지 현황 (2025-01-29)

| 컨트랙트 | Stmts | Branch | Funcs | Lines |
|----------|-------|--------|-------|-------|
| **ZkapAccount.sol** | 100% | 99.14% | 100% | 100% |
| **ZkapAccountFactory.sol** | 100% | 100% | 100% | 100% |
| **ZkapPaymaster.sol** | 100% | 100% | 100% | 100% |
| **AccountKeyAddress.sol** | 100% | 100% | 100% | 100% |
| **AccountKeySecp256r1.sol** | 100% | 100% | 100% | 100% |
| **AccountKeyWebAuthn.sol** | 100% | 100% | 100% | 100% |
| **All files** | 98.73% | 93.06% | 96.69% | 97.84% |
