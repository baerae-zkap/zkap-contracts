// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Bn128.sol";
import "./Bn128G2.sol";
import "./Operations.sol";


library PolymathVerifyBn128 {
    uint256 internal constant minusGamma = 5;
    uint256 internal constant minusAlpha = 3;

    struct PairingVk {
        Bn128.G1Point g1Generator;
        Bn128.G2Point g2Generator;
        Bn128.G2Point g2x;
        Bn128.G1Point g1z;
        Bn128.G2Point g2z;
    }

    struct VerifyingKeyBase {
        PairingVk e;
        uint256 n;
        uint256 m0;
        uint256 sigma;
        uint256 omega;
    } 

    struct UserSpecificVerifyingKey {
        Bn128.G2Point g2mu;
        Bn128.G2Point g2muX;
        Bn128.G2Point g2muZ;
        Bn128.G2Point vacc;
    }

    struct VerifyingKey {
        VerifyingKeyBase base;
        UserSpecificVerifyingKey user;    
    }
    
    struct VerifyInput {
        VerifyingKey vk;
        uint256[] inputs;
        uint256[] proof;
    }
    uint256 constant ORD = Bn128.curveOrder;

    // Proof :
    //      uint256[2] a_g1         : G1
    //      uint256[2] c_g1         : G1
    //      uint256[1] a_at_x1      : F 
    //      uint256[2] -d_g1        : G1
    function _verify(VerifyInput memory verifyInput) internal returns (bool result) {

        // inputs: 1 (constant) + 128 (nonce) + 8 (state) + 32 (modular) + 1 (currentTime)
        require(verifyInput.inputs.length == 1 + 128 + 8 + 32 + 1, "Invalid inputs length");
        require(verifyInput.proof.length == 7, "Invalid proof length");

        // x2, cAtX1, x1,
        uint256 x1 = 0;
        {
            // Build x1Inputs array (concatenate inputs with the first 4 elements of proof)
            uint256[] memory x1Inputs = new uint256[](verifyInput.inputs.length + 4);
            for (uint256 i = 0; i < verifyInput.inputs.length; i++) {
                x1Inputs[i] = verifyInput.inputs[i];
            }
            x1Inputs[verifyInput.inputs.length] = verifyInput.proof[0];
            x1Inputs[verifyInput.inputs.length + 1] = verifyInput.proof[1];
            x1Inputs[verifyInput.inputs.length + 2] = verifyInput.proof[2];
            x1Inputs[verifyInput.inputs.length + 3] = verifyInput.proof[3];
         

            // Compute challenge x1
            x1 = _retrieveX(x1Inputs);
        }

        uint256 cAtX1 = 0;
        {
            // Compute y1, y1Inv, y1Gamma
            uint256 y1 = Operations.modExp(x1, verifyInput.vk.base.sigma, ORD);
            uint256 y1Inv = Operations.modExp(y1, ORD - 2, ORD);
            uint256 y1Gamma = Operations.modExp(y1Inv, minusGamma, ORD);

            // Compute piAtX1 and y1Alpha
            uint256 piAtX1 = _computePiAtX1(verifyInput.inputs, x1, y1Gamma, verifyInput.vk.base.n, verifyInput.vk.base.omega);
            uint256 y1Alpha = Operations.modExp(y1Inv, minusAlpha, ORD);

            // Compute cAtX1: ((a_at_x1 + y1Gamma) * a_at_x1 - piAtX1) / y1Alpha
            uint256 sum_aGamma = addmod(verifyInput.proof[4], y1Gamma, ORD);
            uint256 prod_a     = mulmod(sum_aGamma, verifyInput.proof[4], ORD);
            uint256 neg_pi     = mulmod(piAtX1, ORD - 1, ORD);
            uint256 numerator  = addmod(prod_a, neg_pi, ORD);
            uint256 y1AlphaInv = Operations.modExp(y1Alpha, ORD - 2, ORD);
            cAtX1 = mulmod(numerator, y1AlphaInv, ORD);
        }

        uint256 x2 = 0;
        {
            // Compute challenge x2
            uint256[] memory x2Inputs = new uint256[](3);
            x2Inputs[0] = x1;
            x2Inputs[1] = verifyInput.proof[4];
            x2Inputs[2] = cAtX1;
            x2 = _retrieveX(x2Inputs);
        }

        Bn128.G1Point memory commitmentsMinusEvalsInG1;
        {
            // Construct a_g1, c_g1
            Bn128.G1Point memory a_g1 = Bn128.G1Point(verifyInput.proof[0], verifyInput.proof[1]);
            Bn128.G1Point memory c_g1 = Bn128.G1Point(verifyInput.proof[2], verifyInput.proof[3]);

           commitmentsMinusEvalsInG1 = Bn128.add(
                Bn128.add(
                    Bn128.mul(1, a_g1),
                    Bn128.mul(x2, c_g1)
                ),
                Bn128.mul(
                    mulmod(
                        addmod(
                            verifyInput.proof[4],
                            mulmod(
                                x2,
                                cAtX1,
                                ORD
                            ),
                            ORD
                        ),
                        ORD - 1,
                        ORD
                    ),
                    verifyInput.vk.base.e.g1Generator
                )
            );
        }
        Bn128.G1Point memory x2ZG1 = Bn128.mul(x2, verifyInput.vk.base.e.g1z);
        // result = x2ZG1;

        Bn128.G2Point memory xMinusX1InG2;
        {
            Bn128.G2Point memory ecTwistMul1 = Bn128G2.ECTwistMul(
                ORD - 1,
                verifyInput.vk.user.g2muX.X0, verifyInput.vk.user.g2muX.X1,
                verifyInput.vk.user.g2muX.Y0, verifyInput.vk.user.g2muX.Y1
            );
            Bn128.G2Point memory ecTwistMul2 = Bn128G2.ECTwistMul(
                x1,
                verifyInput.vk.user.g2mu.X0, verifyInput.vk.user.g2mu.X1,
                verifyInput.vk.user.g2mu.Y0, verifyInput.vk.user.g2mu.Y1
            );
            xMinusX1InG2 = Bn128G2.ECTwistAdd(
                ecTwistMul1.X0, ecTwistMul1.X1, ecTwistMul1.Y0, ecTwistMul1.Y1,
                ecTwistMul2.X0, ecTwistMul2.X1, ecTwistMul2.Y0, ecTwistMul2.Y1
            );
        }

        uint256[] memory pairingInputs = _computePairingInputs(verifyInput.vk.user, verifyInput.proof, commitmentsMinusEvalsInG1, x2ZG1, xMinusX1InG2);
        result = _pairing(pairingInputs);
        // result = true;
    }

    function _pairing(uint256[] memory input) internal returns (bool result) {
         
        // Three G1 points (uint256[2]), three G2 points (uint256[4])
        require(input.length == 18);

        // Verification equation:
        //      commitments_minus_evals_in_g1*mu_z_g2 + x2_z_g1*v_acc = proof.d_g1*x_minus_x1_in_g2
        //      commitments_minus_evals_in_g1*mu_z_g2 + x2_z_g1*v_acc - proof.d_g1*x_minus_x1_in_g2 = 0

        // input 0x0000 ~ 0x0040 : commitments_minus_evals_in_g1
        // input 0x0040 ~ 0x00c0 : mu_z_g2
        // input 0x00c0 ~ 0x0100 : x2_z_g1
        // input 0x0100 ~ 0x0180 : v_acc
        // input 0x0180 ~ 0x01c0 : proof.d_g1 * (-F::one())
        // input 0x01c0 ~ 0x0240 : x_minus_x1_in_g2
        assembly {
        // Total input size: 3 pairs × (64 + 128) = 576 bytes (0x240)
        let memPtr := mload(0x40)
        mstore(0x40, add(memPtr, 0x240))

        // Data starts after the first 32 bytes (length) of input.
        // Each element is stored in 32-byte units: input[0] is at add(input, 0x20),
        // input[1] at add(input, 0x40), input[2] at add(input, 0x60), and so on.
        
        // ── Pair 1 ──
        // commitments_minus_evals_in_g1: input[0] (X) and input[1] (Y)
        mstore(memPtr, mload(add(input, 0x20)))           // G1.X = input[0]
        mstore(add(memPtr, 0x20), mload(add(input, 0x40)))  // G1.Y = input[1]
        // mu_z_g2: input[2]..input[5]
        mstore(add(memPtr, 0x40), mload(add(input, 0x60)))  // G2.X[1] = input[2]
        mstore(add(memPtr, 0x60), mload(add(input, 0x80)))  // G2.X[0] = input[3]
        mstore(add(memPtr, 0x80), mload(add(input, 0xA0)))  // G2.Y[1] = input[4]
        mstore(add(memPtr, 0xA0), mload(add(input, 0xC0)))  // G2.Y[0] = input[5]
        
        // ── Pair 2 ──
        // x2_z_g1: input[6] and input[7]
        mstore(add(memPtr, 0xC0), mload(add(input, 0xE0)))  // G1.X = input[6]
        mstore(add(memPtr, 0xE0), mload(add(input, 0x100)))  // G1.Y = input[7]
        // v_acc: input[8]..input[11]
        mstore(add(memPtr, 0x100), mload(add(input, 0x120))) // G2.X[1] = input[8]
        mstore(add(memPtr, 0x120), mload(add(input, 0x140))) // G2.X[0] = input[9]
        mstore(add(memPtr, 0x140), mload(add(input, 0x160))) // G2.Y[1] = input[10]
        mstore(add(memPtr, 0x160), mload(add(input, 0x180))) // G2.Y[0] = input[11]
        
        // ── Pair 3 ──
        // proof_d_g1 * (-F::one()): input[12] and input[13]
        mstore(add(memPtr, 0x180), mload(add(input, 0x1A0))) // G1.X = input[12]
        mstore(add(memPtr, 0x1A0), mload(add(input, 0x1C0))) // G1.Y = input[13]
        // x_minus_x1_in_g2: input[14]..input[17]
        mstore(add(memPtr, 0x1C0), mload(add(input, 0x1E0))) // G2.X[1] = input[14]
        mstore(add(memPtr, 0x1E0), mload(add(input, 0x200))) // G2.X[0] = input[15]
        mstore(add(memPtr, 0x200), mload(add(input, 0x220))) // G2.Y[1] = input[16]
        mstore(add(memPtr, 0x220), mload(add(input, 0x240))) // G2.Y[0] = input[17]
        
        // ── Call the bn256Pairing precompile ──
        // Input size: 0x240 (576 bytes), output size: 0x20 (32 bytes)
        let callSuccess := call(sub(gas(), 2000), 0x08, 0, memPtr, 0x240, memPtr, 0x20)
        // Pairing verification succeeds if the precompile output is 1
        result := and(callSuccess, eq(mload(memPtr), 1))
        }
    }

    function _computePiAtX1(uint256[] memory inputs, uint256 x1, uint256 y1Gamma, uint256 n, uint256 omega) internal view returns (uint256 result) {
        uint256 ord = Bn128.curveOrder;

        assembly {

            function modExp(base, exponent, modulus) -> res {
                let ptr := mload(0x40)
                mstore(ptr, 0x20)             // base length (32 bytes)
                mstore(add(ptr, 0x20), 0x20)   // exponent length
                mstore(add(ptr, 0x40), 0x20)   // modulus length
                mstore(add(ptr, 0x60), base)
                mstore(add(ptr, 0x80), exponent)
                mstore(add(ptr, 0xa0), modulus)
                if iszero(staticcall(sub(gas(), 2000), 5, ptr, 0xc0, ptr, 0x20)) {
                    revert(0, 0)
                }
                res := mload(ptr)
            }

            // inv_two = 2^{-1} mod p = 2^(p-2) mod p
            let inv_two := modExp(2, sub(ord, 2), ord)

            // Length of public_inputs array = m
            let m_val := mload(inputs)
            // num_instance_constraints = (m << 1) - 1
            let num_constraints := sub(shl(1, m_val), 1)

            // lagrange = (x1^n - 1) / n mod p
            let x1_n := modExp(x1, n, ord)
            // (x1^n - 1) mod p
            let lagrange_numer := addmod(x1_n, sub(ord, 1), ord)
            // Modular inverse of n: n^(p-2) mod p
            let inv_n := modExp(n, sub(ord, 2), ord)
            let lagrange := mulmod(lagrange_numer, inv_n, ord)

            // Initialize sum to 0
            let sum := 0

            // for (i = 0; i < num_constraints; i++)
            for { let i := 0 } lt(i, num_constraints) { i := add(i, 1) } {
                // Compute x_prime
                let x_prime := 0

                // When i < m_val
                if lt(i, m_val) {
                    // public_inputs[i] is found at array start address + 32-byte offset
                    let ptr := add(inputs, 0x20)
                    let input_val := mload(add(ptr, mul(i, 0x20)))
                    x_prime := mulmod(inv_two, addmod(1, input_val, ord), ord)

                }

                // When i >= m_val (else branch)
                if iszero(lt(i, m_val)) {
                    // index = i - m_val + 1
                    let index := add(sub(i, m_val), 1)
                    let ptr := add(inputs, 0x20)
                    let input_val := mload(add(ptr, mul(index, 0x20)))
                    // (1 - public_inputs[index]) mod p
                    let diff := addmod(1, sub(ord, input_val), ord)
                    x_prime := mulmod(inv_two, diff, ord)

                }

                // omega_i = omega^i mod p
                let omega_i := modExp(omega, i, ord)

                // Denominator: (x1 - omega_i) mod p
                let denom := addmod(x1, sub(ord, omega_i), ord)
                // Modular inverse of denom: denom^(p-2) mod p
                let denom_inv := modExp(denom, sub(ord, 2), ord)

                // eval = (x_prime * lagrange * omega_i) / (x1 - omega_i) mod p
                let prod := mulmod(x_prime, lagrange, ord)
                prod := mulmod(prod, omega_i, ord)
                let eval_val := mulmod(prod, denom_inv, ord)

                // sum += eval_val mod p
                sum := addmod(sum, eval_val, ord)
            }

            result := sum

            // Final result: result = sum * y1_gamma mod p
            result := mulmod(sum, y1Gamma, ord)
        }
    }

    function _retrieveX(uint256[] memory inputs) internal pure returns (uint256 x) {
        uint256 ord = Bn128.curveOrder;

        assembly {
            // let transcript := mload(0x40)
            // let trs := transcript

            // for {
            //     let i_ptr := add(inputs, 0x20)
            //     let i_end := add(i_ptr, shl(0x05, mload(inputs)))
            // } lt(i_ptr, i_end) {
            //     i_ptr := add(i_ptr, 0x20)
            //     trs := add(trs, 0x20)
            // } {
            //     mstore(trs, mload(i_ptr))
            // }

            // x := mod(keccak256(transcript, sub(trs, transcript)), ord)
            x := mod(keccak256(add(inputs, 0x20), shl(0x05, mload(inputs))), ord)
        }
    }

    // Separates pairing-related G1/G2 operations into a dedicated function.
    function _computePairingComponents(
        Bn128.G1Point memory g1Generator,
        Bn128.G1Point memory g1z,
        UserSpecificVerifyingKey memory userVk,
        uint256[] memory proof,
        uint256 x1,
        uint256 x2,
        uint256 cAtX1,
        uint256 ord
    ) internal view returns (
        Bn128.G1Point memory commitmentsMinusEvalsInG1,
        Bn128.G1Point memory x2ZG1,
        Bn128.G2Point memory xMinusX1InG2
    ) {
        // Construct a_g1, c_g1
        Bn128.G1Point memory a_g1 = Bn128.G1Point(proof[0], proof[1]);
        Bn128.G1Point memory c_g1 = Bn128.G1Point(proof[2], proof[3]);
        Bn128.G1Point memory term1 = Bn128.mul(1, a_g1);
        Bn128.G1Point memory term2 = Bn128.mul(x2, c_g1);
        
        uint256 tmp = mulmod(x2, cAtX1, ord);
        uint256 combined = addmod(proof[4], tmp, ord);
        uint256 negCombined = mulmod(combined, ord - 1, ord);
        // PolymathVerifyBn128.PairingVk memory baseE = commonVk.e;  // Assign nested struct to local variable
        // Bn128.G1Point memory g1Gen = baseE.g1Generator; // Store required field in local variable
        Bn128.G1Point memory term3 = Bn128.mul(negCombined, g1Generator);
        // Bn128.G1Point memory term3 = Bn128.mul(negCombined, vk.base.e.g1Generator);
        
        commitmentsMinusEvalsInG1 = Bn128.add(Bn128.add(term1, term2), term3);
        x2ZG1 = Bn128.mul(x2, g1z);
        
        uint256 minusX1 = mulmod(x1, ord - 1, ord);
        Bn128.G2Point memory ecTwistMul1 = Bn128G2.ECTwistMul(
            1,
            userVk.g2muX.X0, userVk.g2muX.X1,
            userVk.g2muX.Y0, userVk.g2muX.Y1
        );
        Bn128.G2Point memory ecTwistMul2 = Bn128G2.ECTwistMul(
            minusX1,
            userVk.g2mu.X0, userVk.g2mu.X1,
            userVk.g2mu.Y0, userVk.g2mu.Y1
        );
        xMinusX1InG2 = Bn128G2.ECTwistAdd(
            ecTwistMul1.X0, ecTwistMul1.X1, ecTwistMul1.Y0, ecTwistMul1.Y1,
            ecTwistMul2.X0, ecTwistMul2.X1, ecTwistMul2.Y0, ecTwistMul2.Y1
        );
    }

    function _computePairingInputs(
        UserSpecificVerifyingKey memory userVk,
        uint256[] memory proof,
        Bn128.G1Point memory commitmentsMinusEvalsInG1,
        Bn128.G1Point memory x2ZG1,
        Bn128.G2Point memory xMinusX1InG2
    ) internal pure returns (uint256[] memory pairingInputs) {
        pairingInputs = new uint256[](18);
        pairingInputs[0]  = commitmentsMinusEvalsInG1.X;
        pairingInputs[1]  = commitmentsMinusEvalsInG1.Y;
        pairingInputs[2]  = userVk.g2muZ.X1;
        pairingInputs[3]  = userVk.g2muZ.X0;
        pairingInputs[4]  = userVk.g2muZ.Y1;
        pairingInputs[5]  = userVk.g2muZ.Y0;
        pairingInputs[6]  = x2ZG1.X;
        pairingInputs[7]  = x2ZG1.Y;
        pairingInputs[8]  = userVk.vacc.X1;
        pairingInputs[9]  = userVk.vacc.X0;
        pairingInputs[10] = userVk.vacc.Y1;
        pairingInputs[11] = userVk.vacc.Y0;
        pairingInputs[12] = proof[5];
        pairingInputs[13] = proof[6];
        pairingInputs[14] = xMinusX1InG2.X1;
        pairingInputs[15] = xMinusX1InG2.X0;
        pairingInputs[16] = xMinusX1InG2.Y1;
        pairingInputs[17] = xMinusX1InG2.Y0;
    }
        
}
