// SPDX-License-Identifier: MIT
pragma solidity =0.8.20;
pragma abicoder v2;

import '@cryptoalgebra/integral-core/contracts/interfaces/IERC20Minimal.sol';
import '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol';
import '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraFactory.sol';
import '../interfaces/IAlgebraStateMulticall.sol';
import '../interfaces/IAlgebraOracleV1TWAP.sol';

contract AlgebraStateMulticall is IAlgebraStateMulticall {
	IAlgebraOracleV1TWAP public oracleTwap;

	constructor(address _oracletwap) {
		oracleTwap = IAlgebraOracleV1TWAP(_oracletwap);
	}

    function getFullState(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 tickBitmapStart,
        int16 tickBitmapEnd
    ) external view override returns (StateResult memory state) {
        require(tickBitmapEnd >= tickBitmapStart, "tickBitmapEnd < tickBitmapStart");

        state = _fillStateWithoutTicks(factory, tokenIn, tokenOut, tickBitmapStart, tickBitmapEnd);
        state.ticks = _calcTicksFromBitMap(factory, tokenIn, tokenOut, state.tickBitmap);
    }

    function getFullStateWithoutTicks(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 tickBitmapStart,
        int16 tickBitmapEnd
    ) external view override returns (StateResult memory state) {
        require(tickBitmapEnd >= tickBitmapStart, "tickBitmapEnd < tickBitmapStart");

        return _fillStateWithoutTicks(factory, tokenIn, tokenOut, tickBitmapStart, tickBitmapEnd);
    }

    function getFullStateWithRelativeBitmaps(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 leftBitmapAmount,
        int16 rightBitmapAmount
    ) external view override returns (StateResult memory state) {
        require(leftBitmapAmount > 0, "leftBitmapAmount <= 0");
        require(rightBitmapAmount > 0, "rightBitmapAmount <= 0");

        state = _fillStateWithoutBitmapsAndTicks(factory, tokenIn, tokenOut);
        int16 currentBitmapIndex = _getBitmapIndexFromTick(state.globalState.tick);

        state.tickBitmap = _calcTickBitmaps(
            factory,
            tokenIn,
            tokenOut,
            currentBitmapIndex - leftBitmapAmount,
            currentBitmapIndex + rightBitmapAmount
        );
        state.ticks = _calcTicksFromBitMap(factory, tokenIn, tokenOut, state.tickBitmap);
    }

    function getAdditionalBitmapWithTicks(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 tickBitmapStart,
        int16 tickBitmapEnd
    ) external view override returns (TickBitMapMappings[] memory tickBitmap, TickInfoMappings[] memory ticks) {
        require(tickBitmapEnd >= tickBitmapStart, "tickBitmapEnd < tickBitmapStart");

        tickBitmap = _calcTickBitmaps(factory, tokenIn, tokenOut, tickBitmapStart, tickBitmapEnd);
        ticks = _calcTicksFromBitMap(factory, tokenIn, tokenOut, tickBitmap);
    }

    function getAdditionalBitmapWithoutTicks(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 tickBitmapStart,
        int16 tickBitmapEnd
    ) external view override returns (TickBitMapMappings[] memory tickBitmap) {
        require(tickBitmapEnd >= tickBitmapStart, "tickBitmapEnd < tickBitmapStart");

        return _calcTickBitmaps(factory, tokenIn, tokenOut, tickBitmapStart, tickBitmapEnd);
    }

    function _fillStateWithoutTicks(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 tickBitmapStart,
        int16 tickBitmapEnd
    ) internal view returns (StateResult memory state) {
        state = _fillStateWithoutBitmapsAndTicks(factory, tokenIn, tokenOut);
        state.tickBitmap = _calcTickBitmaps(factory, tokenIn, tokenOut, tickBitmapStart, tickBitmapEnd);
    }

    function _fillStateWithoutBitmapsAndTicks(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut
    ) internal view returns (StateResult memory state) {
        IAlgebraPool pool = _getPool(factory, tokenIn, tokenOut);

        state.pool = pool;
        state.blockTimestamp = block.timestamp;
        state.liquidity = pool.liquidity();
        state.tickSpacing = pool.tickSpacing();
        state.maxLiquidityPerTick = pool.maxLiquidityPerTick();

        /* (
            state.globalState.price,
            state.globalState.tick,
            state.globalState.feeZto,
            state.globalState.feeOtz,
            state.globalState.timepointIndex,
            state.globalState.communityFeeToken0,
            state.globalState.communityFeeToken1,
            // intentionally skip initialized as not used and saves us from stack too deep

        ) = pool.globalState(); */

		(
            state.globalState.price,
            ,
            state.globalState.lastFee,
			state.globalState.pluginConfig,
			state.globalState.communityFee,
            // intentionally skip initialized as not used and saves us from stack too deep
        ) = pool.globalState();

        (
            state.timepoints.initialized,
            state.timepoints.blockTimestamp,
            state.timepoints.tickCumulative,
            state.timepoints.volatilityCumulative,
			state.globalState.tick,
            state.timepoints.averageTick,
            state.timepoints.windowStartIndex
        ) = oracleTwap.getActualTimestamp(address(pool));
    }

    function _calcTickBitmaps(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 tickBitmapStart,
        int16 tickBitmapEnd
    ) internal view returns (TickBitMapMappings[] memory tickBitmap) {
        IAlgebraPool pool = _getPool(factory, tokenIn, tokenOut);

        uint256 numberOfPopulatedBitmaps = 0;
        for (int256 i = tickBitmapStart; i <= tickBitmapEnd; i++) {
            uint256 bitmap = pool.tickTable(int16(i));
            if (bitmap == 0) continue;
            numberOfPopulatedBitmaps++;
        }

        tickBitmap = new TickBitMapMappings[](numberOfPopulatedBitmaps);
        uint256 globalIndex = 0;
        for (int256 i = tickBitmapStart; i <= tickBitmapEnd; i++) {
            int16 index = int16(i);
            uint256 bitmap = pool.tickTable(index);
            if (bitmap == 0) continue;

            tickBitmap[globalIndex] = TickBitMapMappings({ index: index, value: bitmap });
            globalIndex++;
        }
    }

    function _calcTicksFromBitMap(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        TickBitMapMappings[] memory tickBitmap
    ) internal view returns (TickInfoMappings[] memory ticks) {
        IAlgebraPool pool = _getPool(factory, tokenIn, tokenOut);

        uint256 numberOfPopulatedTicks = 0;
        for (uint256 i = 0; i < tickBitmap.length; i++) {
            uint256 bitmap = tickBitmap[i].value;

            for (uint256 j = 0; j < 256; j++) {
                if (bitmap & (1 << j) > 0) numberOfPopulatedTicks++;
            }
        }

        ticks = new TickInfoMappings[](numberOfPopulatedTicks);

        uint256 globalIndex = 0;
        for (uint256 i = 0; i < tickBitmap.length; i++) {
            uint256 bitmap = tickBitmap[i].value;

            for (uint256 j = 0; j < 256; j++) {
                if (bitmap & (1 << j) > 0) {
					int256 indexAsInt256 = int256(tickBitmap[i].index);
					int256 jAsInt256 = int256(j);

						// Perform the operation in int256, then cast the result to int24
					int24 populatedTick = int24((indexAsInt256 << 8) + jAsInt256);

                    ticks[globalIndex].index = populatedTick;
                    TickInfo memory newTickInfo = ticks[globalIndex].value;

                    (
                        newTickInfo.liquidityTotal,
                        newTickInfo.liquidityDelta,
                        ,
                        ,
                        newTickInfo.outerFeeGrowth0Token,
                        newTickInfo.outerFeeGrowth1Token
                    ) = pool.ticks(populatedTick);

                    globalIndex++;
                }
            }
        }
    }

    function _getPool(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut
    ) internal view returns (IAlgebraPool pool) {
        pool = IAlgebraPool(factory.poolByPair(tokenIn, tokenOut));
        require(address(pool) != address(0), "Pool does not exist");
    }

    function _getBitmapIndexFromTick(int24 tick) internal pure returns (int16) {
        return int16(tick >> 8);
    }
}