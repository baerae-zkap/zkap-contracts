# ZK Setup & Hash Generation Scripts Guide

이 문서는 `zkap-contracts/` 디렉토리에 위치한 ZK 셋업 및 해시 생성 스크립트들의
**역할, 사용법, 출력 형식, 의미적 매핑 규칙**을 설명합니다.

대상 스크립트:
- `zk-config.sh`
- `setup-zk-build.sh`
- `generate-hash-aud.sh`
- `generate-hash-leaf.sh`

전제:
- `zkap-contracts` 와 `zkup` 는 **형제 디렉토리**
- Rust 바이너리는 `zkup/circuit/src/bin` 아래에 존재
- ZK 파라미터는 `build.rs → ZkapConfig` 로 전달됨

---

## 디렉토리 구조 (요약)

```text
project-root/
├── zkap-contracts/
│   ├── zk-config.sh
│   ├── setup-zk-build.sh
│   ├── generate-hash-aud.sh
│   ├── generate-hash-leaf.sh
│   └── zk-assets/
│       └── crs/
│           ├── aud_output.json
│           └── leaf_output.json
└── zkup/
    └── circuit/
        └── src/bin/
            ├── generate_baerae_crs.rs
            └── generate_hash.rs
````

---

## 1. `zk-config.sh`

### 목적

* ZK 회로, CRS 생성, 해시 생성에 사용되는 **모든 파라미터를 한 곳에서 정의**
* `build.rs`가 읽는 환경변수를 export 하여 **회로 파라미터 불일치 방지**
* 파라미터 변경 시, 이후 모든 단계가 동일한 설정을 사용하도록 보장

---

### Export 되는 환경 변수

| 변수명                      | 설명                      |
| ------------------------ | ----------------------- |
| `ZK_MAX_JWT_B64_LEN`     | JWT 전체 Base64 문자열 최대 길이 |
| `ZK_MAX_PAYLOAD_B64_LEN` | Payload Base64 최대 길이    |
| `ZK_MAX_EXP_LEN`         | `exp` 클레임 최대 길이         |
| `ZK_MAX_ISS_LEN`         | `iss` 최대 길이             |
| `ZK_MAX_NONCE_LEN`       | `nonce` 최대 길이           |
| `ZK_MAX_SUB_LEN`         | `sub` 최대 길이             |
| `ZK_N`                   | Anchor 벡터 전체 차원         |
| `ZK_K`                   | Threshold 값             |
| `ZK_TREE_HEIGHT`         | Merkle Tree 높이          |
| `ZK_NUM_AUDIENCE_LIMIT`  | 허용되는 `aud` 최대 개수        |

---
⚠️클레임 길이는 \"key\"를 포함한 길이입니다.(e.g., `\"key\": \"value\"`)

### 현재 설정 값 출력

```bash
./zk-config.sh --print
```

출력 예:

```text
ZK_MAX_JWT_B64_LEN=1024
ZK_MAX_PAYLOAD_B64_LEN=896
ZK_K=3
ZK_NUM_AUDIENCE_LIMIT=5
```

---

### 환경변수 값을 직접 바꾸는 예시

`zk-config.sh`는 **이미 설정된 환경변수를 덮어쓰지 않습니다**.
따라서 아래처럼 **미리 export 하면 해당 값이 사용됩니다.**

```bash
export ZK_K=4
export ZK_NUM_AUDIENCE_LIMIT=8

./setup-zk-build.sh
```

⚠️ 이 경우 **CRS, aud hash, leaf hash를 모두 다시 생성해야 합니다.**

---

## 2. `setup-zk-build.sh`

### 목적

* Groth16 CRS (pk.key)
* Solidity Verifier (`Groth16Verifier.sol`)
* NAPI 바이너리

를 생성하고 `zkap-contracts/zk-assets/` 하위로 배포합니다.

---

### 사용법

```bash
cd zkap-contracts
./setup-zk-build.sh
```

---

## 3. `generate-hash-aud.sh`

### 목적

* 허용된 OAuth `aud` 목록으로부터 **aud 해시 리스트 생성**
* `generate_hash.rs`의 `aud` 서브커맨드 래퍼

---

### 기본 출력 위치

```text
zkap-contracts/zk-assets/crs/aud_output.json
```

(`--out` 옵션으로 변경 가능)

---

### 사용법

```bash
./generate-hash-aud.sh \
  --values "\"aud1\", \"aud2\""
```

실제 예시:

```bash
./generate-hash-aud.sh \
  --values "\"...apps.googleusercontent.com\", \"...\""
```

---

### `aud_output.json` 형식 및 의미

```json
{
  "input": [
    "\"...apps.googleusercontent.com\"",
    "\"...\"",
    "forbidden",
    "forbidden",
    "forbidden"
  ],
  "output": {
    "aud_to_field": [
      "0x3663...",
      "0x245e...",
      "0xA72a...",
      "0xA72a...",
      "0xA72a..."
    ],
    "h_aud_lists": "0x4FD7..."
  }
}
```

#### 의미 설명

* `input`

  * `ZK_NUM_AUDIENCE_LIMIT` 길이로 padding됨
  * 초과/미사용 슬롯은 `"forbidden"` 으로 채워짐

* `output.aud_to_field`

  * 각 `aud`를 필드 원소로 해시한 결과
  * **OAuth 제공자 `<OAUTH>`에 대해:**

    * `H_<OAUTH>_AUD` 에 해당

* `output.h_aud_lists`

  * `aud_to_field` 전체 리스트에 대한 집계 해시
  * 회로/논문에서 **`H_AUD_LISTS`**

즉,

```text
aud_to_field[i]  = H_<OAUTH_i>_AUD
h_aud_lists      = H_AUD_LISTS
```

---

## 4. `generate-hash-leaf.sh`

### 목적

* `(iss, pk)` 쌍으로부터 **leaf hash 생성**
* `generate_hash.rs`의 `leaf` 서브커맨드 래퍼

---

### 기본 출력 위치

```text
zkap-contracts/zk-assets/crs/leaf_output.json
```

---

### 사용법

```bash
./generate-hash-leaf.sh \
  --iss "\"https://accounts.google.com\", \"https://kauth.kakao.com\"" \
  --pk "pk1, pk2"
```

---

### `leaf_output.json` 형식 및 의미

```json
{
  "input": [
    {
      "iss": "\"https://accounts.google.com\"",
      "pk": "..."
    },
    {
      "iss": "\"https://kauth.kakao.com\"",
      "pk": "..."
    }
  ],
  "output": [
    "0x8452...",
    "0x833b..."
  ]
}
```

#### 의미 설명

* `input[i]`

  * i번째 OAuth 제공자의 `(iss, pk)` 쌍

* `output[i]`

  * 해당 `(iss, pk)`에 대한 leaf 해시
  * **입력 순서 그대로 매핑됨**

즉,

```text
output[i] = <OAUTH_i>_LEAF
```
---

## 권장 실행 순서

```text
1. zk-config.sh 값 확인 / 설정
2. setup-zk-build.sh 실행 (CRS 생성)
3. generate-hash-aud.sh 실행
4. generate-hash-leaf.sh 실행
```

⚠️ ZK 파라미터(`ZK_K`, `ZK_NUM_AUDIENCE_LIMIT` 등)가 변경되면
**반드시 2번부터 다시 수행해야 합니다.**