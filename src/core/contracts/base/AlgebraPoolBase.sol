// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.17;

import '../interfaces/callback/IAlgebraSwapCallback.sol';
import '../interfaces/IAlgebraPool.sol';
import '../interfaces/IAlgebraPoolDeployer.sol';
import '../interfaces/IAlgebraPoolErrors.sol';
import '../interfaces/IAlgebraPlugin.sol';
import '../interfaces/IERC20Minimal.sol';

import '../libraries/TickManagement.sol';
import '../libraries/Constants.sol';
import './common/Timestamp.sol';

/// @title Algebra pool base abstract contract
/// @notice Contains state variables, immutables and common internal functions
abstract contract AlgebraPoolBase is IAlgebraPool, IAlgebraPoolErrors, Timestamp {
  using TickManagement for mapping(int24 => TickManagement.Tick);

  struct GlobalState {
    uint160 price; // The square root of the current price in Q64.96 format
    int24 tick; // The current tick
    int24 prevInitializedTick; // The previous initialized tick in linked list
    uint16 fee; // The current fee in hundredths of a bip, i.e. 1e-6
    uint8 pluginConfig;
    uint16 communityFee; // The community fee represented as a percent of all collected fee in thousandths (1e-3)
    bool unlocked; // True if the contract is unlocked, otherwise - false
  }

  /// @inheritdoc IAlgebraPoolImmutables
  address public immutable override factory;
  /// @inheritdoc IAlgebraPoolImmutables
  address public immutable override token0;
  /// @inheritdoc IAlgebraPoolImmutables
  address public immutable override token1;
  /// @inheritdoc IAlgebraPoolImmutables
  address public immutable override communityVault;

  /// @inheritdoc IAlgebraPoolState
  uint256 public override totalFeeGrowth0Token;
  /// @inheritdoc IAlgebraPoolState
  uint256 public override totalFeeGrowth1Token;
  /// @inheritdoc IAlgebraPoolState
  GlobalState public override globalState;

  /// @inheritdoc IAlgebraPoolState
  uint32 public override communityFeeLastTimestamp;

  /// @dev The amounts of token0 and token1 that will be sent to the vault
  uint104 internal communityFeePending0;
  uint104 internal communityFeePending1;

  /// @inheritdoc IAlgebraPoolState
  address public override plugin;

  /// @inheritdoc IAlgebraPoolState
  mapping(int24 => TickManagement.Tick) public override ticks;

  /// @inheritdoc IAlgebraPoolState
  mapping(int16 => uint256) public override tickTable;

  /// @inheritdoc IAlgebraPoolState
  uint128 public override liquidity;
  /// @inheritdoc IAlgebraPoolState
  int24 public override tickSpacing;

  /// @inheritdoc IAlgebraPoolImmutables
  function maxLiquidityPerTick() external pure override returns (uint128) {
    return Constants.MAX_LIQUIDITY_PER_TICK;
  }

  /// @inheritdoc IAlgebraPoolState
  function getCommunityFeePending() external view returns (uint128, uint128) {
    return (communityFeePending0, communityFeePending1);
  }

  modifier onlyValidTicks(int24 bottomTick, int24 topTick) {
    TickManagement.checkTickRangeValidity(bottomTick, topTick);
    _;
  }

  constructor() {
    (plugin, factory, communityVault, token0, token1) = IAlgebraPoolDeployer(msg.sender).getDeployParameters();
    globalState.fee = Constants.BASE_FEE;
    globalState.prevInitializedTick = TickMath.MIN_TICK;
  }

  function _balanceToken0() internal view returns (uint256) {
    return IERC20Minimal(token0).balanceOf(address(this));
  }

  function _balanceToken1() internal view returns (uint256) {
    return IERC20Minimal(token1).balanceOf(address(this));
  }

  /// @dev Using function to save bytecode
  function _swapCallback(int256 amount0, int256 amount1, bytes calldata data) internal {
    IAlgebraSwapCallback(msg.sender).algebraSwapCallback(amount0, amount1, data);
  }

  /// @dev Add or remove a tick to the corresponding data structure
  function _insertOrRemoveTick(
    int24 tick,
    int24 currentTick,
    int24 prevInitializedTick,
    bool remove
  ) internal virtual returns (int24 newPrevInitializedTick);
}
