// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.7.6;

import './interfaces/IAlgebraPoolDeployer.sol';
import './AlgebraPool.sol';

contract AlgebraPoolDeployer is IAlgebraPoolDeployer {
  address private dataStorageCache;
  address private factory;
  address private token0Cache;
  address private token1Cache;

  address private immutable owner;

  /// @inheritdoc IAlgebraPoolDeployer
  function getDeployParameters() external view override returns (address, address, address, address) {
    return (dataStorageCache, factory, token0Cache, token1Cache);
  }

  constructor() {
    owner = msg.sender;
  }

  /// @inheritdoc IAlgebraPoolDeployer
  function setFactory(address _factory) external override {
    require(msg.sender == owner);
    require(_factory != address(0));
    require(factory == address(0));

    factory = _factory;
    emit Factory(_factory);
  }

  /// @inheritdoc IAlgebraPoolDeployer
  function deploy(address dataStorage, address token0, address token1) external override returns (address pool) {
    require(msg.sender == factory);

    (dataStorageCache, token0Cache, token1Cache) = (dataStorage, token0, token1);
    pool = address(new AlgebraPool{salt: keccak256(abi.encode(token0, token1))}());
    (dataStorageCache, token0Cache, token1Cache) = (address(0), address(0), address(0));
  }
}
