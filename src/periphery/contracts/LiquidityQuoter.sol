// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.20;

import './libraries/PositionValue.sol';
import './interfaces/INonfungiblePositionManager.sol';

import '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraFactory.sol';

contract LiquidityQuoter {
    INonfungiblePositionManager nft;
    constructor(address _nft) {
        nft = INonfungiblePositionManager(_nft);
    }

    function getSqrtPrice(
        uint256 tokenId
    ) internal view returns (uint160 sqrtPriceX96) {
        (,,address token0,address token1,,,,,,,)= nft.positions(tokenId);

        address factory = nft.factory();
        address pair = IAlgebraFactory(factory).getPair(token0, token1);

        (uint160 sqrtRatioX96,,,,,,) = IAlgebraPool(pair).safelyGetStateOfAMM();

        return sqrtRatioX96;
    }

    function total(
        uint256 tokenId
    ) public view returns (uint256 amount0, uint256 amount1) {
        uint160 sqrtRatioX96 = getSqrtPrice(tokenId);

        return PositionValue.total(nft, tokenId, sqrtRatioX96);
    }

    function getEstimate(uint256 tokenId, uint128 liquidity)
        external
        view
        returns (
            uint256 amount0, uint256 amount1
        )
    {
        uint160 sqrtRatioX96 = getSqrtPrice(tokenId);
        (, , , , int24 tickLower, int24 tickUpper, , , , , ) = nft.positions(tokenId);

        (amount0, amount1) = PositionValue._principalPublic(
            sqrtRatioX96,
            tickLower,
            tickUpper,
            liquidity
        );
    }

    function principal(
        uint256 tokenId
    ) public view returns (uint256 amount0, uint256 amount1) {
        uint160 sqrtRatioX96 = getSqrtPrice(tokenId);
    
        return PositionValue.principal(nft, tokenId, sqrtRatioX96);
    }

    function fees(
        uint256 tokenId
    ) public view returns (uint256 amount0, uint256 amount1) {
        return PositionValue.fees(nft, tokenId);
    }

    function totalGas(
        uint256 tokenId
    ) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        uint160 sqrtRatioX96 = getSqrtPrice(tokenId);
        PositionValue.total(nft, tokenId, sqrtRatioX96);
        return gasBefore - gasleft();
    }

    function principalGas(
        uint256 tokenId
    ) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        uint160 sqrtRatioX96 = getSqrtPrice(tokenId);
        PositionValue.principal(nft, tokenId, sqrtRatioX96);
        return gasBefore - gasleft();
    }

    function feesGas(uint256 tokenId) external view returns (uint256) {
        uint256 gasBefore = gasleft();
        PositionValue.fees(nft, tokenId);
        return gasBefore - gasleft();
    }

    struct Overview {
        uint256 amountTotal0;
        uint256 amountTotal1;
        uint256 amountPrincipal0;
        uint256 amountPrincipal1;
        uint256 fees0;
        uint256 fees1;
    }

    function overview(uint256 tokenId) external view returns (Overview memory) {
        (uint256 amountTotal0, uint256 amountTotal1) = total(tokenId);
        (uint256 amountPrincipal0, uint256 amountPrincipal1) = principal(tokenId);
        (uint256 fees0, uint256 fees1) = fees(tokenId);

        return (Overview({
            amountTotal0: amountTotal0,
            amountTotal1: amountTotal1,
            amountPrincipal0: amountPrincipal0,
            amountPrincipal1: amountPrincipal1,
            fees0: fees0,
            fees1: fees1
        }));
    }
}
