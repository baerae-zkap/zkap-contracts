declare module 'secp256r1' {
  export function publicKeyCreate(privateKey: Buffer, compressed: boolean): Buffer;
  export function sign(messageHash: Buffer, privateKey: Buffer): {
    signature: Buffer;
    recovery: number;
  };
  export function verify(messageHash: Buffer, signature: Buffer, publicKey: Buffer): boolean;
}
