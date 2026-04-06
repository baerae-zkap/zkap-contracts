# zkMobile End-to-End Build/Test Procedure

## Directory Structure Prerequisites

* `zkap-contracts/` and `zkMobile/` are **sibling directories**.

Example:

```text
<WORKSPACE>/
  zkap-contracts/
  zkMobile/
  zkup/
```

---

## Execution Order Summary

0. **(Terminal E · System)** Launch Android Emulator with 4GB RAM
1. **(Terminal A · zkap-contracts)** Start Hardhat local node
2. **(Terminal B · zkap-contracts)** Deploy contracts + generate artifacts for zkMobile
3. **(Terminal B · zkap-contracts)** Generate ZK artifacts / Proving Key + link to mobile
4. **(Terminal D · zkMobile)** Run Android / iOS in Release mode
5. Perform functional tests in the app based on the **ZkpVerification.e2e.test** criteria
---

## ⚠️ Android Emulator Memory (4GB) Configuration Required
> **ZKP (zero-knowledge proof) generation tests require the Android Emulator to be launched with at least 4GB RAM.**
> Insufficient memory may cause the app to be force-killed (Out Of Memory),
> or proof generation may fail or stall abnormally.

### Android Emulator Launch Example (4GB)

```bash
emulator -avd Pixel_8 -memory 4096
```
* `-memory 4096` = allocate 4GB RAM
* Replace `Pixel_8` with the AVD name created on your local machine.

---

## 1) Start Hardhat Local Node (zkap-contracts)

**Terminal A (zkap-contracts repo)**

```bash
cd zkap-contracts
npx hardhat node --hostname 0.0.0.0
```

* Bind to `0.0.0.0` so Android / iOS Emulators can connect
* **Do not close this terminal during any subsequent steps**

---

## 2) Deploy Contracts + Generate Mobile Artifacts (zkap-contracts)

> ⚠️ **Must be performed while the Hardhat node is running.**

**Terminal B (zkap-contracts repo)**

```bash
cd zkap-contracts
npx hardhat run script/deployForMobile.js --network localhost
```

### Deployment Artifacts

On successful deployment, the following files are created / updated.

* `zkMobile/src/constants/abis/`
* `zkMobile/src/constants/deployedContracts.json`

> ⚠️ If the ABI / addresses changed after deployment,
> a **Metro restart may be required** since RN reads these via static `require()`.

```bash
npx react-native start --reset-cache
```

## 3) Generate ZK Artifacts / Proving Key and Link to Mobile (zkap-contracts)

> ⚠️ **This step must be completed before running proof generation tests.**
> (Can be performed after node/deployment)

**Terminal B (zkap-contracts repo, reuse same terminal)**

```bash
cd zkap-contracts
bash setup-zk-build-mobile.sh
```

### What This Step Does

* Based on `ZK_*` parameters in `zk-config.sh`:

  * Generate `pk.key` and Solidity Groth16 Verifier
  * zkMobile integration tasks:
    * Build rustBridge (craby)
  * Build NAPI (Node) bindings
* Invoke `zkMobile/scripts/setup-zk-all.sh`
* Install DEBUG app
* Install `pk.key` into Android / iOS app sandbox

⚠️ **The Emulator must already be running for the Android installation to work correctly.**

---

## 4) Run in Release Mode (zkMobile)

> ⚠️ **ZKP tests must only be performed in Release mode.**

**Terminal D (zkMobile repo)**

### Android (Release)

```bash
cd zkMobile
npx react-native run-android --mode release
```

### iOS (Release)

```bash
cd zkMobile
npx react-native run-ios Release
```

---

## 5) App Functional Testing (Based on E2E Criteria)
* The test buttons and functional flows in the app **directly reflect the test procedure defined in `ZkpVerification.e2e.test`**.
* The test buttons in the app UI **correspond 1:1 with the steps** in `ZkpVerification.e2e.test`.
* Therefore, functional testing is performed by **pressing buttons in the exact order specified in `ZkpVerification.e2e.test`**.
