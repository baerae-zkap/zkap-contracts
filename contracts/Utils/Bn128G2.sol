// SPDX-License-Identifier: LGPL-3.0+

pragma solidity >=0.8.0;

import "./Bn128.sol";

/**
 * @title Elliptic curve operations on twist points for alt_bn128
 * @author Mustafa Al-Bassam (mus@musalbas.com)
 * @dev Homepage: https://github.com/musalbas/solidity-BN256G2
 */

library Bn128G2 {
    uint256 internal constant FIELD_MODULUS =
        0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47;
    uint256 internal constant TWISTBX =
        0x2b149d40ceb8aaae81be18991be06ac3b5b4c5e559dbefa33267e6dc24a138e5;
    uint256 internal constant TWISTBY =
        0x9713b03af0fed4cd2cafadeed8fdf4a74fa084e52d1852e4a2bd0685c315d2;
    uint internal constant PTXX = 0;
    uint internal constant PTXY = 1;
    uint internal constant PTYX = 2;
    uint internal constant PTYY = 3;
    uint internal constant PTZX = 4;
    uint internal constant PTZY = 5;

    /**
     * @notice Add two twist points
     * @param pt1x0 Coefficient 1 of x on point 1
     * @param pt1x1 Coefficient 2 of x on point 1
     * @param pt1y0 Coefficient 1 of y on point 1
     * @param pt1y1 Coefficient 2 of y on point 1
     * @param pt2x0 Coefficient 1 of x on point 2
     * @param pt2x1 Coefficient 2 of x on point 2
     * @param pt2y0 Coefficient 1 of y on point 2
     * @param pt2y1 Coefficient 2 of y on point 2
     * @return (pt3x0, pt3x1, pt3y0, pt3y1)
     */
    function ECTwistAdd(
        uint256 pt1x0,
        uint256 pt1x1,
        uint256 pt1y0,
        uint256 pt1y1,
        uint256 pt2x0,
        uint256 pt2x1,
        uint256 pt2y0,
        uint256 pt2y1
    ) internal view returns (Bn128.G2Point memory) {
        if (pt1x0 == 0 && pt1x1 == 0 && pt1y0 == 0 && pt1y1 == 0) {
            if (!(pt2x0 == 0 && pt2x1 == 0 && pt2y0 == 0 && pt2y1 == 0)) {
                assert(_isOnCurve(pt2x0, pt2x1, pt2y0, pt2y1));
            }
            return Bn128.G2Point(pt2x0, pt2x1, pt2y0, pt2y1);
        } else if (pt2x0 == 0 && pt2x1 == 0 && pt2y0 == 0 && pt2y1 == 0) {
            assert(_isOnCurve(pt1x0, pt1x1, pt1y0, pt1y1));
            return Bn128.G2Point(pt1x0, pt1x1, pt1y0, pt1y1);
        }

        assert(_isOnCurve(pt1x0, pt1x1, pt1y0, pt1y1));
        assert(_isOnCurve(pt2x0, pt2x1, pt2y0, pt2y1));

        uint256[6] memory pt3 = _ECTwistAddJacobian(
            pt1x0,
            pt1x1,
            pt1y0,
            pt1y1,
            1,
            0,
            pt2x0,
            pt2x1,
            pt2y0,
            pt2y1,
            1,
            0
        );

        return
            _fromJacobian(
                pt3[PTXX],
                pt3[PTXY],
                pt3[PTYX],
                pt3[PTYY],
                pt3[PTZX],
                pt3[PTZY]
            );
    }

    /**
     * @notice Multiply a twist point by a scalar
     * @param s     Scalar to multiply by
     * @param pt1x0 Coefficient 1 of x
     * @param pt1x1 Coefficient 2 of x
     * @param pt1y0 Coefficient 1 of y
     * @param pt1y1 Coefficient 2 of y
     * @return (pt2x0, pt2x1, pt2y0, pt2y1)
     */
    function ECTwistMul(
        uint256 s,
        uint256 pt1x0,
        uint256 pt1x1,
        uint256 pt1y0,
        uint256 pt1y1
    ) internal view returns (Bn128.G2Point memory) {
        uint256 pt1zx = 1;
        if (pt1x0 == 0 && pt1x1 == 0 && pt1y0 == 0 && pt1y1 == 0) {
            pt1x0 = 1;
            pt1y0 = 1;
            pt1zx = 0;
        } else {
            assert(_isOnCurve(pt1x0, pt1x1, pt1y0, pt1y1));
        }

        uint256[6] memory pt2 = _ECTwistMulJacobian(
            s,
            pt1x0,
            pt1x1,
            pt1y0,
            pt1y1,
            pt1zx,
            0
        );

        return
            _fromJacobian(
                pt2[PTXX],
                pt2[PTXY],
                pt2[PTYX],
                pt2[PTYY],
                pt2[PTZX],
                pt2[PTZY]
            );
    }

    /**
     * @notice Get the field modulus
     * @return The field modulus
     */
    function GetFieldModulus() internal pure returns (uint256) {
        return FIELD_MODULUS;
    }

    function submod(
        uint256 a,
        uint256 b,
        uint256 n
    ) internal pure returns (uint256) {
        return addmod(a, n - b, n);
    }

    function _FQ2Mul(
        uint256 xx,
        uint256 xy,
        uint256 yx,
        uint256 yy
    ) internal pure returns (uint256 first, uint256 second) {
        assembly {
            // First coordinate: A = xx * yx mod FIELD_MODULUS, B = xy * yy mod FIELD_MODULUS
            let A := mulmod(xx, yx, FIELD_MODULUS)
            let B := mulmod(xy, yy, FIELD_MODULUS)
            // submod: (A - B) mod FIELD_MODULUS = addmod(A, FIELD_MODULUS - B, FIELD_MODULUS)
            first := addmod(A, sub(FIELD_MODULUS, B), FIELD_MODULUS)

            // Second coordinate: C = xx * yy mod FIELD_MODULUS, D = xy * yx mod FIELD_MODULUS
            let C := mulmod(xx, yy, FIELD_MODULUS)
            let D := mulmod(xy, yx, FIELD_MODULUS)
            second := addmod(C, D, FIELD_MODULUS)
        }
    }

    function _FQ2Muc(
        uint256 xx,
        uint256 xy,
        uint256 c
    ) internal pure returns (uint256 first, uint256 second) {
        // return (
        //     mulmod(xx, c, FIELD_MODULUS),
        //     mulmod(xy, c, FIELD_MODULUS)
        // );
        assembly {
            first := mulmod(xx, c, FIELD_MODULUS)
            second := mulmod(xy, c, FIELD_MODULUS)
        }
    }

    function _FQ2Add(
        uint256 xx,
        uint256 xy,
        uint256 yx,
        uint256 yy
    ) internal pure returns (uint256 first, uint256 second) {
        // return (
        //     addmod(xx, yx, FIELD_MODULUS),
        //     addmod(xy, yy, FIELD_MODULUS)
        // );

        assembly {
            first := addmod(xx, yx, FIELD_MODULUS)
            second := addmod(xy, yy, FIELD_MODULUS)
        }
    }

    function _FQ2Sub(
        uint256 xx,
        uint256 xy,
        uint256 yx,
        uint256 yy
    ) internal pure returns (uint256 rx, uint256 ry) {
        // return (
        //     submod(xx, yx, FIELD_MODULUS),
        //     submod(xy, yy, FIELD_MODULUS)
        // );
        assembly {
            rx := addmod(xx, sub(FIELD_MODULUS, yx), FIELD_MODULUS)
            ry := addmod(xy, sub(FIELD_MODULUS, yy), FIELD_MODULUS)
        }
    }

    function _FQ2Div(
        uint256 xx,
        uint256 xy,
        uint256 yx,
        uint256 yy
    ) internal view returns (uint256, uint256) {
        (yx, yy) = _FQ2Inv(yx, yy);
        return _FQ2Mul(xx, xy, yx, yy);
    }

    function _FQ2Inv(
        uint256 x,
        uint256 y
    ) internal view returns (uint256 first, uint256 second) {
        uint256 inv = _modInv(
            addmod(
                mulmod(y, y, FIELD_MODULUS),
                mulmod(x, x, FIELD_MODULUS),
                FIELD_MODULUS
            ),
            FIELD_MODULUS
        );
        assembly {
            first := mulmod(x, inv, FIELD_MODULUS)
            second := sub(FIELD_MODULUS, mulmod(y, inv, FIELD_MODULUS))
        }
    }

    function _isOnCurve(
        uint256 xx,
        uint256 xy,
        uint256 yx,
        uint256 yy
    ) internal pure returns (bool) {
        uint256 yyx;
        uint256 yyy;
        uint256 xxxx;
        uint256 xxxy;
        (yyx, yyy) = _FQ2Mul(yx, yy, yx, yy);
        (xxxx, xxxy) = _FQ2Mul(xx, xy, xx, xy);
        (xxxx, xxxy) = _FQ2Mul(xxxx, xxxy, xx, xy);
        (yyx, yyy) = _FQ2Sub(yyx, yyy, xxxx, xxxy);
        (yyx, yyy) = _FQ2Sub(yyx, yyy, TWISTBX, TWISTBY);
        return yyx == 0 && yyy == 0;
    }

    function _modInv(
        uint256 a,
        uint256 n
    ) internal view returns (uint256 result) {
        bool success;
        assembly {
            let freemem := mload(0x40)
            mstore(freemem, 0x20)
            mstore(add(freemem, 0x20), 0x20)
            mstore(add(freemem, 0x40), 0x20)
            mstore(add(freemem, 0x60), a)
            mstore(add(freemem, 0x80), sub(n, 2))
            mstore(add(freemem, 0xA0), n)
            success := staticcall(
                sub(gas(), 2000),
                5,
                freemem,
                0xC0,
                freemem,
                0x20
            )
            result := mload(freemem)
        }
        require(success);
    }

    function _fromJacobian(
        uint256 pt1x0,
        uint256 pt1x1,
        uint256 pt1y0,
        uint256 pt1y1,
        uint256 pt1zx,
        uint256 pt1zy
    ) internal view returns (Bn128.G2Point memory result) {
        uint256 invzx;
        uint256 invzy;
        (invzx, invzy) = _FQ2Inv(pt1zx, pt1zy);
        (uint256 pt2x0, uint256 pt2x1) = _FQ2Mul(pt1x0, pt1x1, invzx, invzy);
        (uint256 pt2y0, uint256 pt2y1) = _FQ2Mul(pt1y0, pt1y1, invzx, invzy);
        result = Bn128.G2Point(pt2x0, pt2x1, pt2y0, pt2y1);
    }

    function _ECTwistAddJacobian(
        uint256 pt1x0,
        uint256 pt1x1,
        uint256 pt1y0,
        uint256 pt1y1,
        uint256 pt1zx,
        uint256 pt1zy,
        uint256 pt2x0,
        uint256 pt2x1,
        uint256 pt2y0,
        uint256 pt2y1,
        uint256 pt2zx,
        uint256 pt2zy
    ) internal pure returns (uint256[6] memory pt3) {
        if (pt1zx == 0 && pt1zy == 0) {
            (
                pt3[PTXX],
                pt3[PTXY],
                pt3[PTYX],
                pt3[PTYY],
                pt3[PTZX],
                pt3[PTZY]
            ) = (pt2x0, pt2x1, pt2y0, pt2y1, pt2zx, pt2zy);
            return pt3;
        } else if (pt2zx == 0 && pt2zy == 0) {
            (
                pt3[PTXX],
                pt3[PTXY],
                pt3[PTYX],
                pt3[PTYY],
                pt3[PTZX],
                pt3[PTZY]
            ) = (pt1x0, pt1x1, pt1y0, pt1y1, pt1zx, pt1zy);
            return pt3;
        }

        (pt2y0, pt2y1) = _FQ2Mul(pt2y0, pt2y1, pt1zx, pt1zy); // U1 = y2 * z1
        (pt3[PTYX], pt3[PTYY]) = _FQ2Mul(pt1y0, pt1y1, pt2zx, pt2zy); // U2 = y1 * z2
        (pt2x0, pt2x1) = _FQ2Mul(pt2x0, pt2x1, pt1zx, pt1zy); // V1 = x2 * z1
        (pt3[PTZX], pt3[PTZY]) = _FQ2Mul(pt1x0, pt1x1, pt2zx, pt2zy); // V2 = x1 * z2

        if (pt2x0 == pt3[PTZX] && pt2x1 == pt3[PTZY]) {
            if (pt2y0 == pt3[PTYX] && pt2y1 == pt3[PTYY]) {
                (
                    pt3[PTXX],
                    pt3[PTXY],
                    pt3[PTYX],
                    pt3[PTYY],
                    pt3[PTZX],
                    pt3[PTZY]
                ) = _ECTwistDoubleJacobian(
                    pt1x0,
                    pt1x1,
                    pt1y0,
                    pt1y1,
                    pt1zx,
                    pt1zy
                );
                return pt3;
            }
            (
                pt3[PTXX],
                pt3[PTXY],
                pt3[PTYX],
                pt3[PTYY],
                pt3[PTZX],
                pt3[PTZY]
            ) = (1, 0, 1, 0, 0, 0);
            return pt3;
        }

        (pt2zx, pt2zy) = _FQ2Mul(pt1zx, pt1zy, pt2zx, pt2zy); // W = z1 * z2
        (pt1x0, pt1x1) = _FQ2Sub(pt2y0, pt2y1, pt3[PTYX], pt3[PTYY]); // U = U1 - U2
        (pt1y0, pt1y1) = _FQ2Sub(pt2x0, pt2x1, pt3[PTZX], pt3[PTZY]); // V = V1 - V2
        (pt1zx, pt1zy) = _FQ2Mul(pt1y0, pt1y1, pt1y0, pt1y1); // V_squared = V * V
        (pt2y0, pt2y1) = _FQ2Mul(pt1zx, pt1zy, pt3[PTZX], pt3[PTZY]); // V_squared_times_V2 = V_squared * V2
        (pt1zx, pt1zy) = _FQ2Mul(pt1zx, pt1zy, pt1y0, pt1y1); // V_cubed = V * V_squared
        (pt3[PTZX], pt3[PTZY]) = _FQ2Mul(pt1zx, pt1zy, pt2zx, pt2zy); // newz = V_cubed * W
        (pt2x0, pt2x1) = _FQ2Mul(pt1x0, pt1x1, pt1x0, pt1x1); // U * U
        (pt2x0, pt2x1) = _FQ2Mul(pt2x0, pt2x1, pt2zx, pt2zy); // U * U * W
        (pt2x0, pt2x1) = _FQ2Sub(pt2x0, pt2x1, pt1zx, pt1zy); // U * U * W - V_cubed
        (pt2zx, pt2zy) = _FQ2Muc(pt2y0, pt2y1, 2); // 2 * V_squared_times_V2
        (pt2x0, pt2x1) = _FQ2Sub(pt2x0, pt2x1, pt2zx, pt2zy); // A = U * U * W - V_cubed - 2 * V_squared_times_V2
        (pt3[PTXX], pt3[PTXY]) = _FQ2Mul(pt1y0, pt1y1, pt2x0, pt2x1); // newx = V * A
        (pt1y0, pt1y1) = _FQ2Sub(pt2y0, pt2y1, pt2x0, pt2x1); // V_squared_times_V2 - A
        (pt1y0, pt1y1) = _FQ2Mul(pt1x0, pt1x1, pt1y0, pt1y1); // U * (V_squared_times_V2 - A)
        (pt1x0, pt1x1) = _FQ2Mul(pt1zx, pt1zy, pt3[PTYX], pt3[PTYY]); // V_cubed * U2
        (pt3[PTYX], pt3[PTYY]) = _FQ2Sub(pt1y0, pt1y1, pt1x0, pt1x1); // newy = U * (V_squared_times_V2 - A) - V_cubed * U2
    }

    function _ECTwistDoubleJacobian(
        uint256 pt1x0,
        uint256 pt1x1,
        uint256 pt1y0,
        uint256 pt1y1,
        uint256 pt1zx,
        uint256 pt1zy
    )
        internal
        pure
        returns (
            uint256 pt2x0,
            uint256 pt2x1,
            uint256 pt2y0,
            uint256 pt2y1,
            uint256 pt2zx,
            uint256 pt2zy
        )
    {
        (pt2x0, pt2x1) = _FQ2Muc(pt1x0, pt1x1, 3); // 3 * x
        (pt2x0, pt2x1) = _FQ2Mul(pt2x0, pt2x1, pt1x0, pt1x1); // W = 3 * x * x
        (pt1zx, pt1zy) = _FQ2Mul(pt1y0, pt1y1, pt1zx, pt1zy); // S = y * z
        (pt2y0, pt2y1) = _FQ2Mul(pt1x0, pt1x1, pt1y0, pt1y1); // x * y
        (pt2y0, pt2y1) = _FQ2Mul(pt2y0, pt2y1, pt1zx, pt1zy); // B = x * y * S
        (pt1x0, pt1x1) = _FQ2Mul(pt2x0, pt2x1, pt2x0, pt2x1); // W * W
        (pt2zx, pt2zy) = _FQ2Muc(pt2y0, pt2y1, 8); // 8 * B
        (pt1x0, pt1x1) = _FQ2Sub(pt1x0, pt1x1, pt2zx, pt2zy); // H = W * W - 8 * B
        (pt2zx, pt2zy) = _FQ2Mul(pt1zx, pt1zy, pt1zx, pt1zy); // S_squared = S * S
        (pt2y0, pt2y1) = _FQ2Muc(pt2y0, pt2y1, 4); // 4 * B
        (pt2y0, pt2y1) = _FQ2Sub(pt2y0, pt2y1, pt1x0, pt1x1); // 4 * B - H
        (pt2y0, pt2y1) = _FQ2Mul(pt2y0, pt2y1, pt2x0, pt2x1); // W * (4 * B - H)
        (pt2x0, pt2x1) = _FQ2Muc(pt1y0, pt1y1, 8); // 8 * y
        (pt2x0, pt2x1) = _FQ2Mul(pt2x0, pt2x1, pt1y0, pt1y1); // 8 * y * y
        (pt2x0, pt2x1) = _FQ2Mul(pt2x0, pt2x1, pt2zx, pt2zy); // 8 * y * y * S_squared
        (pt2y0, pt2y1) = _FQ2Sub(pt2y0, pt2y1, pt2x0, pt2x1); // newy = W * (4 * B - H) - 8 * y * y * S_squared
        (pt2x0, pt2x1) = _FQ2Muc(pt1x0, pt1x1, 2); // 2 * H
        (pt2x0, pt2x1) = _FQ2Mul(pt2x0, pt2x1, pt1zx, pt1zy); // newx = 2 * H * S
        (pt2zx, pt2zy) = _FQ2Mul(pt1zx, pt1zy, pt2zx, pt2zy); // S * S_squared
        (pt2zx, pt2zy) = _FQ2Muc(pt2zx, pt2zy, 8); // newz = 8 * S * S_squared
    }

    function _ECTwistMulJacobian(
        uint256 d,
        uint256 pt1x0,
        uint256 pt1x1,
        uint256 pt1y0,
        uint256 pt1y1,
        uint256 pt1zx,
        uint256 pt1zy
    ) internal pure returns (uint256[6] memory pt2) {
        while (d != 0) {
            if ((d & 1) != 0) {
                pt2 = _ECTwistAddJacobian(
                    pt2[PTXX],
                    pt2[PTXY],
                    pt2[PTYX],
                    pt2[PTYY],
                    pt2[PTZX],
                    pt2[PTZY],
                    pt1x0,
                    pt1x1,
                    pt1y0,
                    pt1y1,
                    pt1zx,
                    pt1zy
                );
            }
            (pt1x0, pt1x1, pt1y0, pt1y1, pt1zx, pt1zy) = _ECTwistDoubleJacobian(
                pt1x0,
                pt1x1,
                pt1y0,
                pt1y1,
                pt1zx,
                pt1zy
            );

            d = d / 2;
        }
    }
}
