// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

import './INonfungiblePositionManager.sol';

/**
 * @dev Interface of the MigrateV3NFT contract
 */
interface IMigrateV3NFT {
  function migrate (uint256 lockId, INonfungiblePositionManager nftPositionManager, uint256 tokenId) external returns (bool);
}