import { ethers } from "hardhat";
import { JwtPayload, jwtDecode } from "jwt-decode";
import { generateKeyPair, sign, createPublicKey } from "crypto";
import { promisify } from "util";

const ISS = "https://accounts.google.com";
const AZP =
  "713851302686-6g3to8902iohgip1ivdvpepaj52e7s0i.apps.googleusercontent.com";
const AUD =
  "713851302686-svluejd8li1l5qd9sp806tbmk3lkb4hj.apps.googleusercontent.com";
const SUB = "000000000000000000000"; // Arbitrary user ID for testing
const EMAIL = "test-user@example.com";
const EMAIL_VERIFIED = true;
const NAME = "Test User";
const PICTURE = "https://example.com/photo.jpg";
const GIVEN_NAME = "Test";
const FAMILY_NAME = "User";

const KAKAO_AUD = "d94809e9a1ea2e0a8d51647b585bf68d";
const KAKAO_SUB = "0000000000";
const KAKAO_ISS = "https://kauth.kakao.com";
const KAKAO_NICKNAME = "TestUser";
const KAKAO_EMAIL = "test-kakao@example.com";
const KAKAO_PICTURE = "https://example.com/kakao-photo.jpg";

interface GoogleIdTokenPayload extends JwtPayload {
  iss: string;
  azp: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: boolean;
  nonce?: string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  iat: number;
  exp: number;
}

export interface KakaoIdTokenPayload extends JwtPayload {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  nonce?: string;
  picture?: string;
  iat: number;
  exp: number;
  auth_time: number;
  nickname: string;
}

export interface RsaKeyComponents {
  n: string;
  e: string;
  alg: string;
  kid: string;
  kty: string;
  use: string;
}

export class IdTokenSimulator {
  private privateKey: string = "";
  private publicKey: string = "";
  private kid: string;
  private serviceName: string;
  private rsaComponents: RsaKeyComponents | null = null;

  constructor(serviceName?: string, publicKey?: string, privateKey?: string) {
    this.serviceName = serviceName || "google";
    this.kid = Date.now().toString();
    this.publicKey =
      publicKey ||
      `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvLzd/VDnr8zt9pHfSkO3
G0pUlaGJbYkIXXhma9+R9oETx2u0eZ+bSblq71FlA+PWLdjOW1SYtOngVZT5ZxJQ
8FRFQolE8YzgByHifgo16ogEmeKdCIlCLd48IETTMOo093BLa2BzDygm8xBcpV/y
qlxTUHdw2RH4vf5uulzbHcbdTf94I/DMlNUQX/yTmB8mu3GmDT+1xpL90iVEybjN
WEcIrhWGHYqEFkKeBU1hvPf038Lts07eKiBKZWjo7+ZESCPNmdPvVkx29GuIBlwX
p3824TB0DR0nhhFncXDuVzxDAUFSrnM0JwPa4ZX4M/xHdtUuk4Bp46wj/kb44jO4
ywIDAQAB
-----END PUBLIC KEY-----`;
    this.privateKey =
      privateKey ||
      `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC8vN39UOevzO32
kd9KQ7cbSlSVoYltiQhdeGZr35H2gRPHa7R5n5tJuWrvUWUD49Yt2M5bVJi06eBV
lPlnElDwVEVCiUTxjOAHIeJ+CjXqiASZ4p0IiUIt3jwgRNMw6jT3cEtrYHMPKCbz
EFylX/KqXFNQd3DZEfi9/m66XNsdxt1N/3gj8MyU1RBf/JOYHya7caYNP7XGkv3S
JUTJuM1YRwiuFYYdioQWQp4FTWG89/Tfwu2zTt4qIEplaOjv5kRII82Z0+9WTHb0
a4gGXBenfzbhMHQNHSeGEWdxcO5XPEMBQVKuczQnA9rhlfgz/Ed21S6TgGnjrCP+
RvjiM7jLAgMBAAECggEAHvYguJCQIV/N3bgaWDV5kUmFTLKeN9DWBXdd3e5kJHsS
QpGhnp4XPGXla/L/Tj8PAKBjYcoj7vG68m8o5sazbml0nzCjlbiVe7YMUL7eD2ZW
0uPA/Qh/ScT+OhDwUELrg3fxd2DwHxloIlGZ0StHRLk2lamyYnm3Q3u8sGfRLjYL
v+IK7dJf4v5RacSYPOGbI6BJ9JR8WY8hHmw8BRh56Zo9U2OTJjZ/ARiNPr56qdBl
8bKBkD9DPQciP/BC21bsodxvKRlujzSG+K2huXj+k5Mv6z16LW0YxnOy7koMQcNT
7V8q6IWgRNJ+GZYK8hm+0/iUjeHEFAQAqLyjKgcxAQKBgQD10tGihQozSwbxxN7e
HOl4IVNawvb3svTv8GyrCCVqRJ/qQvZkXo4DjDMsTOmdx0zE9NhthHJLjHPMOOYq
XBUezzC/m1lBTsMyl4CdtoyauN29xa68wFPPhBMALphH2sgW3dXrO/I3Yw7h4dvs
wGPeEYRETRC+Qnyk7wAfvlLxgQKBgQDEjREM8Eg1xTFVWNkJJPegzzttAr5BTVNd
TfX6Cv/TUsxET8/Zh7Q0Wfif3EG6kiJYzNTBH6BRRQOKvqeuazMJf6/DHgQCngxS
mPTb5zZUajIL00Cg61GKyQBAZpB83iOyNKIXze2fGmxLjWc2//L4LX3b9Ao7vlRE
9xnMevL4SwKBgQC51sQG8j7w4hKA6k12azMRT1hdsDDWt6K2VfNBJWpruS+QAUmW
PWltQytYnViroATojRWlTdC+TpMoXAedFHofDZGT+RRz6+BjuedQ07XeLk3sbqsY
JOn3YqiepZsYD0zfBJv5Nxt5Rdj1aTNC+3tEYce1fvFedJMYeVqFpPO9gQKBgCBc
9ezCd7Fa2ceqzHnD+34gATHu3LLV758SYikcvIjoPjgVSC0SOirQka6Izs3QmBU1
DOcLtRMMoQusXuHKRuoOeztOauyfZ3oGM3Mt+/UkUz89NowIkzGd7Qutl6bn0Mrb
/cCbqL+k0yYRj2gv9qrEms+nvDOgIDIG2dmgePdHAoGAT1JTW9bjDfYc1zeRxHLw
CC9ndA2HUiW105zDNJcoBqIEP2VAtKfQXuTuNNg6iz+M6uTRXdtAICYsEvQrRnmW
1N0gw6WsXOyKvSp7Tm3tTRw4g3BQOPs+znNxfj1KBebscaK7JfUOT7Pi1qOkQgHb
ISMIiQRGPUEOf3AsxPOpzXU=
-----END PRIVATE KEY-----`;
  }

  async initialize() {
    // Uses fixed RSA keys for deterministic test outputs

    // Extract RSA key components
    const key = createPublicKey(this.publicKey);
    const keyInfo = key.export({ format: "jwk" });

    this.rsaComponents = {
      n: keyInfo.n!,
      e: keyInfo.e!,
      alg: "RS256",
      kid: this.kid,
      kty: "RSA",
      use: "sig",
    };
  }

  async generateIdToken(nonce: string): Promise<string> {
    if (!this.rsaComponents) {
      await this.initialize();
    }
    const now = Math.floor(Date.now() / 1000);
    let payload: GoogleIdTokenPayload | KakaoIdTokenPayload;
    if (this.serviceName === "google") {
      payload = {
        iss: ISS,
        azp: AZP,
        aud: AUD,
        sub: SUB,
        email: EMAIL,
        email_verified: EMAIL_VERIFIED,
        nonce: nonce,
        name: NAME,
        // picture: PICTURE, // commented out to keep max_payload_len < 1024 bytes
        given_name: GIVEN_NAME,
        family_name: FAMILY_NAME,
        iat: now - 1, // issued 1 second ago
        exp: now + 3600, // expires in 1 hour
      };
    } else if (this.serviceName === "kakao") {
      payload = {
        iss: KAKAO_ISS,
        aud: KAKAO_AUD,
        sub: KAKAO_SUB,
        email: KAKAO_EMAIL,
        iat: now - 1,
        exp: now + 3600,
        auth_time: now - 1,
        nonce: nonce,
        picture: KAKAO_PICTURE,
        nickname: KAKAO_NICKNAME,
      };
    } else {
      throw new Error("Invalid service name");
    }
    // Build JWT header
    const header = {
      alg: "RS256",
      kid: this.kid,
      typ: "JWT",
    };

    // Base64url encode header and payload
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
      "base64url"
    );
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      "base64url"
    );

    // Generate signature
    const signature = await promisify(sign)(
      "sha256",
      new Uint8Array(Buffer.from(`${encodedHeader}.${encodedPayload}`)),
      this.privateKey
    );

    const encodedSignature = signature.toString("base64url");
    // Assemble JWT token
    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  getKid(): string {
    return this.kid;
  }

  getIss(): string {
    return this.serviceName === "google" ? ISS : KAKAO_ISS;
  }

  getUserInfo(): {
    email: string;
    sub: string;
    iss: string;
    aud: string;
  } {
    if (this.serviceName === "google") {
      return {
        email: EMAIL,
        sub: SUB,
        iss: ISS,
        aud: AUD,
      };
    } else if (this.serviceName === "kakao") {
      return {
        email: KAKAO_NICKNAME,
        sub: KAKAO_SUB,
        iss: KAKAO_ISS,
        aud: KAKAO_AUD,
      };
    } else {
      throw new Error("Invalid service name");
    }
  }

  getRsaComponents(): RsaKeyComponents {
    if (!this.rsaComponents) {
      throw new Error(
        "RSA components not initialized. Call initialize() first."
      );
    }
    return this.rsaComponents;
  }

  //   let e = ethers.hexlify(Buffer.from("AQAB", "base64"));

  getModulusAsHex(): string {
    if (!this.rsaComponents) {
      throw new Error(
        "RSA components not initialized. Call initialize() first."
      );
    }
    let n = ethers.hexlify(
      new Uint8Array(Buffer.from(this.rsaComponents.n, "base64"))
    );
    return n;
  }

  getExponentAsHex(): string {
    if (!this.rsaComponents) {
      throw new Error(
        "RSA components not initialized. Call initialize() first."
      );
    }
    let e = ethers.hexlify(
      new Uint8Array(Buffer.from(this.rsaComponents.e, "base64"))
    );
    return e;
  }
}

// Example usage for manual testing
async function main() {
  const simulator = new IdTokenSimulator();
  await simulator.initialize();

  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const idToken = await simulator.generateIdToken(nonce);

  console.log("Generated ID Token:", idToken);
  console.log("KID:", simulator.getKid());
  console.log(
    "RSA Components:",
    JSON.stringify(simulator.getRsaComponents(), null, 2)
  );
}

if (process.argv[1] === __filename) {
  main();
}
