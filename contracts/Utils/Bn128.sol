// Copyright (c) 2015-2020 Clearmatics Technologies Ltd
//
// SPDX-License-Identifier: LGPL-3.0+

pragma solidity >=0.8.0;

import "./Operations.sol";
import "hardhat/console.sol";

/// Several pairing-related utility functions.
///
/// Precompiled contract details (bn256Add, bn256ScalarMul, bn256Pairing) can
/// be found at the following links:
/// implementations:
///   https://github.com/ethereum/go-ethereum/blob/master/core/vm/contracts.go
/// gas and costs:
// solhint-disable-next-line
///   https://github.com/ethereum/go-ethereum/blob/master/params/protocol_params.go
library Bn128 {
    uint256 internal constant curveOrder =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // The prime q in the base field F_q for G1
    uint256 internal constant q =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    uint256 internal constant b = 254;

    struct G1Point {
        uint256 X;
        uint256 Y;
    }

    // Encoding of field elements is: X[0] * z + X[1]
    struct G2Point {
        uint256 X0;
        uint256 X1;
        uint256 Y0;
        uint256 Y1;
    }

    // Return the sum of two points of G1
    function add(
        G1Point memory p1,
        G1Point memory p2
    ) internal view returns (G1Point memory result) {
        assembly {
            // Free memory pointer
            let ptr := mload(0x40)

            // Store p1.x and p1.y in memory
            mstore(ptr, mload(p1))
            mstore(add(ptr, 0x20), mload(add(p1, 0x20)))

            // Store p2.x and p2.y in memory
            mstore(add(ptr, 0x40), mload(p2))
            mstore(add(ptr, 0x60), mload(add(p2, 0x20)))

            // Precompiled contract (0x06)
            // p1.x, p1.y, p2.x, p2.y
            let success := staticcall(gas(), 0x06, ptr, 0x80, ptr, 0x40)

            // Load the result
            mstore(result, mload(ptr))
            mstore(add(result, 0x20), mload(add(ptr, 0x20)))
        }
    }

    // Return the product of a point on G1 and a scalar, i.e.
    // p == p.mul(1) and p.add(p) == p.mul(2) for all points p.
    function mul(
        uint256 scalar,
        G1Point memory point
    ) internal view returns (G1Point memory result) {
        assembly {
            // Free memory pointer
            let ptr := mload(0x40)

            // Store point.x and point.y in memory
            mstore(ptr, mload(point))
            mstore(add(ptr, 0x20), mload(add(point, 0x20)))

            // Store scalar in memory
            mstore(add(ptr, 0x40), scalar)

            // Precompiled contract (0x07)
            // point.x, point.y, scalar
            let success := staticcall(gas(), 0x07, ptr, 0x60, ptr, 0x40)

            // Load the result
            mstore(result, mload(ptr))
            mstore(add(result, 0x20), mload(add(ptr, 0x20)))
        }
    }

    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        if (p.X == 0 && p.Y == 0) {
            return G1Point(0, 0);
        }
        return G1Point(p.X, q - (p.Y % q));
    }

    // naive multi-scalar multiplication
    function naiveMSM(
        uint256[] memory scalars,
        G1Point[] memory bases
    ) internal view returns (G1Point memory result) {
        uint256[5] memory io; // [sum.X, sum.Y, base.X, base.Y, scalar]
        assembly {
            let success := 0
            let len := mload(bases)
            let ioMul := add(io, 0x40)

            for {
                let pScalars := add(scalars, 0x20)
                let pBases := add(bases, 0x20)
                let end := add(pScalars, shl(0x05, len))
            } lt(pScalars, end) {
                pScalars := add(pScalars, 0x20)
                pBases := add(pBases, 0x20)
            } {
                /* mul scalar */
                let base := mload(pBases)

                mstore(ioMul, mload(base))
                mstore(add(ioMul, 0x20), mload(add(base, 0x20)))

                // Store scalar in memory
                mstore(add(ioMul, 0x40), mload(pScalars))

                // Precompiled contract ecMul (0x07)
                // base.x, base.y, scalar
                success := staticcall(gas(), 0x07, ioMul, 0x60, ioMul, 0x40)

                // Precompiled contract ecAdd (0x06)
                // sum.x, sum.y, point.x, point.y
                success := staticcall(gas(), 0x06, io, 0x80, io, 0x40)
            }
            mstore(result, mload(io))
            mstore(add(result, 0x20), mload(add(io, 0x20)))
        }
    }

    function msm(
        uint256[] memory scalars,
        G1Point[] memory bases
    ) internal view returns (G1Point memory result) {
        uint256 c = Operations.ln(bases.length) + 2;
        // uint256 c = 1;
        uint256 lb = (1 << c) - 1; // Do not calculated zero bits
        uint256 w = (b + c - 1) / c;
        uint256[] memory buckets = new uint256[](lb << 1);
        uint256[2] memory window;
        uint256[4] memory mem;
        // TODO: Pippenger Algorithm
        assembly {
            let success := 0
            let len := mload(scalars)
            let bBuckets := add(buckets, 0x20)

            for {
                let d := shl(mul(sub(w, 1), c), 0x01) // 1 << ((w - 1) * c): 2^((w - 1) * c)
            } gt(d, 0) {
                d := shr(c, d) // d >> c: d / 2^c
            } {
                /* fill buckets */
                for {
                    let pScalars := add(scalars, 0x20)
                    let eScalars := add(pScalars, shl(0x05, len))
                    let pBases := add(bases, 0x20)
                } lt(pScalars, eScalars) {
                    pScalars := add(pScalars, 0x20)
                    pBases := add(pBases, 0x20)
                } {
                    let scalar := div(mload(pScalars), d)
                    mstore(pScalars, mod(mload(pScalars), d))

                    if iszero(scalar) {
                        continue
                    }

                    let dst := add(bBuckets, shl(0x06, sub(lb, scalar))) // pointer of buckets[lb - scalar]
                    mstore(mem, mload(dst))
                    mstore(add(mem, 0x20), mload(add(dst, 0x20)))

                    let base := mload(pBases)
                    mstore(add(mem, 0x40), mload(base))
                    mstore(add(mem, 0x60), mload(add(base, 0x20)))

                    // Precompiled contract ecAdd (0x06)
                    // dst.x, dst.y, base.x, base.y
                    success := staticcall(gas(), 0x06, mem, 0x80, dst, 0x40)
                }

                /* make window */
                mstore(window, mload(bBuckets))
                mstore(add(window, 0x20), mload(add(bBuckets, 0x20)))
                for {
                    let pBuckets := add(bBuckets, 0x40)
                    let eBuckets := add(bBuckets, shl(0x06, lb))
                } lt(pBuckets, eBuckets) {
                    pBuckets := add(pBuckets, 0x40)
                } {
                    let prev := sub(pBuckets, 0x40)
                    let x := mload(pBuckets)
                    let y := mload(add(pBuckets, 0x20))

                    if or(gt(x, 0x00), gt(y, 0x00)) {
                        // Precompiled contract ecAdd (0x06)
                        // buckets[i - 1].x, buckets[i  - 1].y, buckets[i].x, buckets[i].y
                        success := staticcall(
                            gas(),
                            0x06,
                            prev,
                            0x80,
                            pBuckets,
                            0x40
                        )
                    }
                    if and(iszero(x), iszero(y)) {
                        mstore(pBuckets, mload(prev))
                        mstore(add(pBuckets, 0x20), mload(add(prev, 0x20)))
                    }

                    /* update window */
                    mstore(prev, mload(window))
                    mstore(add(prev, 0x20), mload(add(window, 0x20)))
                    // Precompiled contract ecAdd (0x06)
                    // window.x, window.y, buckets[i].x, buckets[i].y
                    success := staticcall(gas(), 0x06, prev, 0x80, window, 0x40)
                }

                /* 2^c squared result */
                mstore(mem, mload(result))
                mstore(add(mem, 0x20), mload(add(result, 0x20)))
                for {
                    let i := 0
                } lt(i, c) {
                    i := add(i, 0x01)
                } {
                    mstore(add(mem, 0x40), mload(mem))
                    mstore(add(mem, 0x60), mload(add(mem, 0x20)))
                    // Precompiled contract ecAdd (0x06)
                    // result.x, result.y, result.x, result.y
                    success := staticcall(gas(), 0x06, mem, 0x80, mem, 0x40)
                }

                /* result += window */
                mstore(add(mem, 0x40), mload(window))
                mstore(add(mem, 0x60), mload(add(window, 0x20)))
                // result.x, result.y, window.x, window.y
                success := staticcall(gas(), 0x06, mem, 0x80, result, 0x40)

                /* clear buckets*/
                for {
                    let ptr := bBuckets
                    let end := add(ptr, shl(0x06, lb))
                } lt(ptr, end) {
                    ptr := add(ptr, 0x20)
                } {
                    mstore(ptr, 0x00)
                }
            } // end for
        } // end assembly
    }
}