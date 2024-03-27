// SPDX-License-Identifier: MIT
pragma solidity =0.8.20;
pragma abicoder v2;

import '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol';
import '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraFactory.sol';

interface IAlgebraStateMulticall {
    struct GlobalState {
        uint160 price;
        int24 tick;
		uint16 lastFee;
		uint8 pluginConfig;
		uint16 communityFee;
        uint16 feeZto;
        uint16 feeOtz;
        uint16 timepointIndex;
        bool unlocked;
    }

    struct TickBitMapMappings {
        int16 index;
        uint256 value;
    }

    struct TickInfo {
		uint256 liquidityTotal; // the total position liquidity that references this tick
		int128 liquidityDelta; // amount of net liquidity added (subtracted) when tick is crossed left-right (right-left),
		int24 prevTick;
		int24 nextTick;
		// fee growth per unit of liquidity on the _other_ side of this tick (relative to the current tick)
		// only has relative meaning, not absolute — the value depends on when the tick is initialized
		uint256 outerFeeGrowth0Token;
		uint256 outerFeeGrowth1Token;
	}

    struct TickInfoMappings {
        int24 index;
        TickInfo value;
    }

    struct Timepoints {
        bool initialized;
		uint32 blockTimestamp;
		int56 tickCumulative;
		uint88 volatilityCumulative;
		int24 tick;
		int24 averageTick;
		uint16 windowStartIndex;
    }

    struct StateResult {
        IAlgebraPool pool;
        uint256 blockTimestamp;
        GlobalState globalState;
        uint128 liquidity;
        int24 tickSpacing;
        uint128 maxLiquidityPerTick;
        Timepoints timepoints;
        TickBitMapMappings[] tickBitmap;
        TickInfoMappings[] ticks;
    }

    function getFullState(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 tickBitmapStart,
        int16 tickBitmapEnd
    ) external view returns (StateResult memory state);

    function getFullStateWithoutTicks(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 tickBitmapStart,
        int16 tickBitmapEnd
    ) external view returns (StateResult memory state);

    function getFullStateWithRelativeBitmaps(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 leftBitmapAmount,
        int16 rightBitmapAmount
    ) external view returns (StateResult memory state);

    function getAdditionalBitmapWithTicks(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 tickBitmapStart,
        int16 tickBitmapEnd
    ) external view returns (TickBitMapMappings[] memory tickBitmap, TickInfoMappings[] memory ticks);

    function getAdditionalBitmapWithoutTicks(
        IAlgebraFactory factory,
        address tokenIn,
        address tokenOut,
        int16 tickBitmapStart,
        int16 tickBitmapEnd
    ) external view returns (TickBitMapMappings[] memory tickBitmap);
}