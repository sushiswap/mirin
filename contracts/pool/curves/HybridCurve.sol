// SPDX-License-Identifier: MIT

pragma solidity =0.8.4;

import "../../interfaces/IMirinCurve.sol";
import "../../libraries/MathUtils.sol";

/**
 * @dev Hybrid curve of constant product and constant sum ones (4a(r_0 +r _1) + k = 4ak + (k^3/4r_0r_1))
 * Excerpted from https://github.com/saddle-finance/saddle-contract/blob/0b76f7fb519e34b878aa1d58cffc8d8dc0572c12/contracts/SwapUtils.sol
 *
 * @author LevX, penandlim(@weeb_mcgee)
 */
contract HybridCurve is IMirinCurve {
    using MathUtils for uint256;

    uint8 private constant PRECISION = 104;

    // the precision all pools tokens will be converted to
    uint8 private constant POOL_PRECISION_DECIMALS = 18;

    // Constant value used as max loop limit
    uint256 private constant MAX_LOOP_LIMIT = 256;

    // Constant values used in ramping A calculations
    uint256 private constant A_PRECISION = 100;

    // Swap fee precision. Fees are in increments of 10 bps and cannot be higher than 10%.
    uint256 private constant SWAP_FEE_PRECISION = 1000;
    uint256 private constant MAX_SWAP_FEE = 100;

    function canUpdateData(bytes32 oldData, bytes32 newData) external pure override returns (bool) {
        (uint8 oldDecimals0, uint8 oldDecimals1, ) = decodeData(oldData);
        (uint8 newDecimals0, uint8 newDecimals1, uint240 newA) = decodeData(newData);
        return oldDecimals0 == newDecimals0 && oldDecimals1 == newDecimals1 && newA >= A_PRECISION;
    }

    function isValidData(bytes32 data) public pure override returns (bool) {
        uint8 decimals0 = uint8(uint256(data) >> 248);
        uint8 decimals1 = uint8((uint256(data) >> 240) % (1 << 8));
        uint240 A = uint240(uint256(data));
        return decimals0 <= POOL_PRECISION_DECIMALS && decimals1 <= POOL_PRECISION_DECIMALS && A >= A_PRECISION;
    }

    function decodeData(bytes32 data)
        public
        pure
        returns (
            uint8 decimals0,
            uint8 decimals1,
            uint240 A
        )
    {
        decimals0 = uint8(uint256(data) >> 248);
        decimals1 = uint8((uint256(data) >> 240) % (1 << 8));
        A = uint240(uint256(data));
        require(
            decimals0 <= POOL_PRECISION_DECIMALS && decimals1 <= POOL_PRECISION_DECIMALS && A >= A_PRECISION,
            "MIRIN: INVALID_DATA"
        );
    }

    function computeLiquidity(
        uint256 reserve0,
        uint256 reserve1,
        bytes32 data
    ) external pure override returns (uint256) {
        (uint8 decimals0, uint8 decimals1, uint240 A) = decodeData(data);
        uint256[2] memory xp = _xp(reserve0, reserve1, decimals0, decimals1);
        return _getD(xp, A);
    }

    function computePrice(
        uint112 reserve0,
        uint112 reserve1,
        bytes32 data,
        uint8 tokenIn
    ) external pure override returns (uint224) {
        (uint8 decimals0, uint8 decimals1, uint240 A) = decodeData(data);
        uint256[2] memory xp = _xp(reserve0, reserve1, decimals0, decimals1);
        uint256 D = _getD(xp, A);
        uint8 decimals = tokenIn == 0 ? decimals0 : decimals1;
        return uint224(_getYD(A, tokenIn, xp, D) << (PRECISION / 10**(POOL_PRECISION_DECIMALS - decimals)));
    }

    function computeAmountOut(
        uint256 amountIn,
        uint112 reserve0,
        uint112 reserve1,
        bytes32 data,
        uint8 swapFee,
        uint8 tokenIn
    ) external pure override returns (uint256 amountOut) {
        require(amountIn > 0, "MIRIN: INSUFFICIENT_INPUT_AMOUNT");
        require(reserve0 > 0 && reserve1 > 0, "MIRIN: INSUFFICIENT_LIQUIDITY");
        require(swapFee <= MAX_SWAP_FEE, "MIRIN: INVALID_SWAP_FEE");

        (uint8 decimals0, uint8 decimals1, uint240 A) = decodeData(data);
        uint256[2] memory xp = _xp(reserve0, reserve1, decimals0, decimals1);
        amountIn = amountIn * 10**(POOL_PRECISION_DECIMALS - (tokenIn != 0 ? decimals1 : decimals0));
        uint256 x = xp[tokenIn] + amountIn;
        uint256 y = _getY(x, xp, A);
        amountOut = xp[1 - tokenIn] - y - 1;
        amountOut = (amountOut * (SWAP_FEE_PRECISION - swapFee)) / SWAP_FEE_PRECISION;
        amountOut = amountOut / 10**(POOL_PRECISION_DECIMALS - (tokenIn != 0 ? decimals0 : decimals1));
    }

    function computeAmountIn(
        uint256 amountOut,
        uint112 reserve0,
        uint112 reserve1,
        bytes32 data,
        uint8 swapFee,
        uint8 tokenIn
    ) external pure override returns (uint256 amountIn) {
        require(amountOut > 0, "MIRIN: INSUFFICIENT_OUTPUT_AMOUNT");
        require(reserve0 > 0 && reserve1 > 0 && (tokenIn != 0 ? reserve0 : reserve1) >= amountOut, "MIRIN: INSUFFICIENT_LIQUIDITY");
        require(swapFee <= MAX_SWAP_FEE, "MIRIN: INVALID_SWAP_FEE");

        (uint8 decimals0, uint8 decimals1, uint240 A) = decodeData(data);
        uint256[2] memory xp = _xp(reserve0, reserve1, decimals0, decimals1);
        amountOut = amountOut * 10**(POOL_PRECISION_DECIMALS - (tokenIn != 0 ? decimals0 : decimals1));
        amountOut = (amountOut * SWAP_FEE_PRECISION) / (SWAP_FEE_PRECISION - swapFee);
        uint256 y = xp[1 - tokenIn] - amountOut;
        uint256 x = _getY(y, xp, A);
        amountIn = x + 1 - xp[tokenIn];
        amountIn = amountIn / 10**(POOL_PRECISION_DECIMALS - (tokenIn != 0 ? decimals1: decimals0));
    }

    /**
     * @notice Get D, the StableSwap invariant, based on a set of balances and a particular A.
     * See the StableSwap paper for details
     *
     * @dev Originally https://github.com/saddle-finance/saddle-contract/blob/0b76f7fb519e34b878aa1d58cffc8d8dc0572c12/contracts/SwapUtils.sol#L319
     *
     * @param xp a precision-adjusted set of pool balances. Array should be the same cardinality
     * as the pool.
     * @param _A the amplification coefficient * n * (n - 1) in A_PRECISION.
     * See the StableSwap paper for details
     * @return the invariant, at the precision of the pool
     */
    function _getD(uint256[2] memory xp, uint256 _A) private pure returns (uint256) {
        uint256 s = xp[0] + xp[1];
        if (s == 0) {
            return 0;
        }

        uint256 prevD;
        uint256 D = s;
        uint256 nA = _A * 2;

        for (uint256 i = 0; i < MAX_LOOP_LIMIT; i++) {
            uint256 dP = ((D**2) / (xp[0] * 2)) * D / (xp[1] * 2);

            prevD = D;
            D = (((nA * s / A_PRECISION) + (dP * 2)) * D) / (
                (nA - A_PRECISION) * D / A_PRECISION + (dP * 3)
            );

            if (D.within1(prevD)) {
                return D;
            }
        }
        revert("MIRIN: MAX_LOOP_REACHED");
    }

    /**
     * @notice Calculate the new balances of the tokens given the indexes of the token
     * that is swapped from (FROM) and the token that is swapped to (TO).
     * This function is used as a helper function to calculate how much TO token
     * the user should receive on swap.
     *
     * @dev Originally https://github.com/saddle-finance/saddle-contract/blob/0b76f7fb519e34b878aa1d58cffc8d8dc0572c12/contracts/SwapUtils.sol#L432
     *
     * @param x the new total amount of FROM token
     * @param xp balances of the tokens in the pool
     * @return the amount of TO token that should remain in the pool
     */
    function _getY(
        uint256 x,
        uint256[2] memory xp,
        uint256 _A
    ) private pure returns (uint256) {
        uint256 D = _getD(xp, _A);
        uint256 nA = 2 * _A;

        uint256 c = ((D**2) / (x * 2)) * D * A_PRECISION / (nA * 2);
        uint256 b = x + ((D * A_PRECISION) / nA);

        uint256 yPrev;
        uint256 y = D;

        // iterative approximation
        for (uint256 i = 0; i < MAX_LOOP_LIMIT; i++) {
            yPrev = y;
            y = (y**2 + c) / (y * 2 + b - D);
            if (y.within1(yPrev)) {
                return y;
            }
        }
        revert("MIRIN: MAX_LOOP_REACHED");
    }

    /**
     * @notice Calculate the price of a token in the pool given
     * precision-adjusted balances and a particular D and precision-adjusted
     * array of balances.
     *
     * @dev This is accomplished via solving the quadratic equation iteratively.
     * See the StableSwap paper and Curve.fi implementation for further details.
     *
     * x_1**2 + x1 * (sum' - (A*n**n - 1) * D / (A * n**n)) = D ** (n + 1) / (n ** (2 * n) * prod' * A)
     * x_1**2 + b*x_1 = c
     * x_1 = (x_1**2 + c) / (2*x_1 + b)
     *
     * @dev Originally https://github.com/saddle-finance/saddle-contract/blob/0b76f7fb519e34b878aa1d58cffc8d8dc0572c12/contracts/SwapUtils.sol#L276
     *
     * @param _A the amplification coefficient * n * (n - 1). See the StableSwap paper for details.
     * @param tokenIn Index of token we are calculating for.
     * @param xp a precision-adjusted set of pool balances. Array should be
     * the same cardinality as the pool.
     * @param D the stableswap invariant
     * @return the price of the token, in the same precision as in xp
     */
    function _getYD(
        uint256 _A,
        uint8 tokenIn,
        uint256[2] memory xp,
        uint256 D
    ) internal pure returns (uint256) {
        uint256 nA = 2 * _A;
        uint256 s = xp[1 - tokenIn];
        uint256 c = D**2 / (s * 2);
        c = (c * D * A_PRECISION) / (nA * 2);

        uint256 b = s + D * A_PRECISION / nA;
        uint256 yPrev;
        uint256 y = D;
        for (uint256 i = 0; i < MAX_LOOP_LIMIT; i++) {
            yPrev = y;
            y = (y ** 2 + c) / (y * 2 + b - D);
            if (y.within1(yPrev)) {
                return y;
            }
        }
        revert("MIRIN: MAX_LOOP_REACHED");
    }

    function _xp(
        uint256 reserve0,
        uint256 reserve1,
        uint8 decimals0,
        uint8 decimals1
    ) private pure returns (uint256[2] memory xp) {
        xp[0] = reserve0 * 10**(POOL_PRECISION_DECIMALS - decimals0);
        xp[1] = reserve1 * 10**(POOL_PRECISION_DECIMALS - decimals1);
        return xp;
    }
}
