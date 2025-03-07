// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraFactory.sol';
import '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol';
import '@cryptoalgebra/integral-core/contracts/libraries/TickMath.sol';

import './libraries/TransferHelper.sol';
import './libraries/LiquidityAmounts.sol';
import './interfaces/INonfungiblePositionManager.sol';
import './interfaces/IMigrateV3NFT.sol';
import './interfaces/ILiquidityLocker.sol';

interface IFeeResolver {
    function useFee(bytes[] memory r, address sender) external returns (ILiquidityLocker.FeeStruct memory fee);
}

contract LiquidityLocker is ILiquidityLocker, Ownable2Step, IERC721Receiver, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using EnumerableSet for EnumerableSet.AddressSet;

    mapping(bytes32 nameHash => FeeStruct) private FEES; // map keccak(fee_name) to fee struct e.g. keccak256("DEFAULT") => FeeStruct
    EnumerableSet.Bytes32Set private FEE_LOOKUP; // contains keccak(feeName)
    EnumerableSet.AddressSet private allowedNftPositionManagers;

    IFeeResolver public FEE_RESOLVER; // Resolve R fees

    address public AUTO_COLLECT_ACCOUNT; // account controlled by UNCX to auto collect fees if a fee option involving collection fees was accepted
    address payable public FEE_ADDR_LP; // LP fee destination
    address payable public FEE_ADDR_COLLECT; // collect fee destination
    uint256 public constant FEE_DENOMINATOR = 10000; // denominator for all fees

    IMigrateV3NFT public MIGRATOR; // migrate to future amm versions while liquidity remains locked
    address public MIGRATE_IN; // address of the migration in contract
    uint256 public NONCE = 0; // incremental lock nonce counter, this is the unique ID for the next lock

    // If a locks unlock date is set to ETERNAL_LOCK the lock is eternal and not ever withdrawable.
    // It can however be migrated by the owner to future AMMS and is therefore preferrable to burning liquidity, or sending liquidity NFT's to the dead address.
    uint256 public constant ETERNAL_LOCK = type(uint256).max;

    // a mapping of lock_id => Lock
    mapping(uint256 lockId => Lock) public LOCKS;

    mapping(address userAddress => EnumerableSet.UintSet) private USER_LOCKS; // a set of all lock_ids owned by a user, useful for on chain enumeration.

    constructor(address payable _autoCollectAddress, address payable _lpFeeReceiver, address payable _collectFeeReceiver) {
        AUTO_COLLECT_ACCOUNT = _autoCollectAddress;
        FEE_ADDR_LP = _lpFeeReceiver;
        FEE_ADDR_COLLECT = _collectFeeReceiver;
        addOrEditFee("DEFAULT", 0, 0, 0, address(0));
    }

    function allowNftPositionManager (address _nftPositionManager) external onlyOwner {
        allowedNftPositionManagers.add(_nftPositionManager);
        emit OnAllowNftPositionManager(_nftPositionManager);
    }

    function setFeeResolver (IFeeResolver _resolver) external onlyOwner {
        FEE_RESOLVER = _resolver;
    }

    function setFeeParams (address _autoCollectAccount, address payable _lpFeeReceiver, address payable _collectFeeReceiver) external onlyOwner {
        AUTO_COLLECT_ACCOUNT = _autoCollectAccount;
        FEE_ADDR_LP = _lpFeeReceiver;
        FEE_ADDR_COLLECT = _collectFeeReceiver;
    }

    function addOrEditFee(string memory _name, uint256 _lpFee, uint256 _collectFee, uint256 _flatFee, address _flatFeeToken) public onlyOwner {
        bytes32 nameHash = keccak256(abi.encodePacked(_name));

        FeeStruct memory newFee = FeeStruct(_name, _lpFee, _collectFee, _flatFee, _flatFeeToken);
        FEES[nameHash] = newFee;

        if (!FEE_LOOKUP.contains(nameHash)) {
            FEE_LOOKUP.add(nameHash);
            emit onAddFee(nameHash, newFee.name, newFee.lpFee, newFee.collectFee, newFee.flatFee, newFee.flatFeeToken);
        } else {
            emit onEditFee(nameHash, newFee.name, newFee.lpFee, newFee.collectFee, newFee.flatFee, newFee.flatFeeToken);
        }
    }

    function removeFee (string memory _name) external onlyOwner {
        bytes32 nameHash = keccak256(abi.encodePacked(_name));
        require(nameHash != keccak256(abi.encodePacked("DEFAULT")), "DEFAULT");
        require(FEE_LOOKUP.contains(nameHash), "Fee not exists");
        FEE_LOOKUP.remove(nameHash);
        delete FEES[nameHash];
        emit onRemoveFee(nameHash);
    }

    function getFee (string memory _name) public override view returns (FeeStruct memory) {
        bytes32 feeHash = keccak256(abi.encodePacked(_name));
        require(FEE_LOOKUP.contains(feeHash), "NOT FOUND");
        return FEES[feeHash];
    }

    function getFeeOptionAtIndex (uint256 _index) external view returns (FeeStruct memory) {
        return FEES[FEE_LOOKUP.at(_index)];
    }

    function getFeeOptionLength () external view returns (uint256) {
        return FEE_LOOKUP.length();
    }

    function deductFlatFee (FeeStruct memory fee) private {
        if (fee.flatFeeToken == address(0)) { // fee in gas token
            require(msg.value == fee.flatFee, 'FLAT FEE');
            (bool success, ) = FEE_ADDR_LP.call{value: fee.flatFee}("");
            if (!success) {
                revert("Gas token transfer failed");
            }
        } else { // fee in another token
            TransferHelper.safeTransferFrom(fee.flatFeeToken, msg.sender, FEE_ADDR_LP, fee.flatFee);
        }
    }

    /**
    @dev locks nft in its current range and collects fees and sends them back to collector
    @param params The locking params as seen in IUNCX_LiquidityLocker_UniV3.sol
    *
    * This will fail with rebasing tokens (liquidity nfts already stuck on univ3).
    */
    function lock (LockParams calldata params) external payable override nonReentrant returns (uint256) {
        require(params.owner != address(0), "OWNER CANNOT = address(0)");
        require(params.collectAddress != address(0), 'COLLECT_ADDR');
        require(params.unlockDate < 1e10 || params.unlockDate == ETERNAL_LOCK, 'MILLISECONDS'); // prevents errors when timestamp entered in milliseconds
        require(params.unlockDate > block.timestamp, 'DATE PASSED');
        require(allowedNftPositionManagers.contains(address(params.nftPositionManager)), 'INVALID NFT POSITION MANAGER');
        FeeStruct memory fee;
		address token0;
		address token1;

        if (msg.sender == MIGRATE_IN) {
            fee.collectFee = abi.decode(params.r[0], (uint256));
        } else {
            if (params.r.length > 0) {
                fee = FEE_RESOLVER.useFee(params.r, msg.sender);
            } else {
                fee = getFee(params.feeName);
            }

            if (fee.flatFee > 0) {
                deductFlatFee(fee);
            }
        }

        params.nftPositionManager.safeTransferFrom(msg.sender, address(this), params.nft_id);

        INonfungiblePositionManager.Position memory position;
        (,,token0,token1,position.tickLower,position.tickUpper,position.liquidity,,,,) = params.nftPositionManager.positions(params.nft_id);
        IAlgebraFactory factory = IAlgebraFactory(params.nftPositionManager.factory());
        address pool = factory.getPair(token0, token1);

        // collect fees for user to prevent being charged a fee on existing fees
        params.nftPositionManager.collect(INonfungiblePositionManager.CollectParams(params.nft_id, params.dustRecipient, type(uint128).max, type(uint128).max));

        // Take lp fee
        if (fee.lpFee > 0) {
            uint128 liquidity = _getLiquidity(params.nftPositionManager, params.nft_id);
            params.nftPositionManager.decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams(params.nft_id, uint128(liquidity * fee.lpFee / FEE_DENOMINATOR), 0, 0, block.timestamp));
            params.nftPositionManager.collect(INonfungiblePositionManager.CollectParams(params.nft_id, FEE_ADDR_LP, type(uint128).max, type(uint128).max));
        }

        Lock memory newLock;
        newLock.lock_id = NONCE;
        newLock.nftPositionManager = params.nftPositionManager;
        newLock.pool = pool;
        newLock.nft_id = params.nft_id;
        newLock.owner = params.owner;
        newLock.additionalCollector = params.additionalCollector;
        newLock.collectAddress = params.collectAddress;
        newLock.unlockDate = params.unlockDate;
        newLock.countryCode = params.countryCode;
        newLock.ucf = fee.collectFee;
        LOCKS[NONCE] = newLock;
        USER_LOCKS[params.owner].add(NONCE);
        NONCE++;

        emitLockEvent(newLock.lock_id);

        return newLock.lock_id;
    }

    function emitLockEvent (uint256 _lockId) private {
        Lock memory newLock = LOCKS[_lockId];
        INonfungiblePositionManager.Position memory position;
        (,,,,position.tickLower,position.tickUpper,position.liquidity,,,,) = newLock.nftPositionManager.positions(newLock.nft_id);
        emit onLock(
            newLock.lock_id, 
            address(newLock.nftPositionManager), 
            newLock.nft_id,
            newLock.owner,
            newLock.additionalCollector,
            newLock.collectAddress,
            newLock.unlockDate,
            newLock.countryCode,
            newLock.ucf,
            newLock.pool,
            position
        );
    }

    /**
    * @dev Collect fees to _recipient if msg.sender is the owner of _lockId
    */
    function collect (uint256 _lockId, address _recipient, uint128 _amount0Max, uint128 _amount1Max) external override nonReentrant returns (uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1) {
        (amount0, amount1, fee0, fee1) = _collect(_lockId, _recipient, _amount0Max, _amount1Max);
    }

    /**
    * @dev Private collect function, wrap this in re-entrancy guard calls
    */
    function _collect (uint256 _lockId, address _recipient, uint128 _amount0Max, uint128 _amount1Max) private returns(uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1) {
        Lock memory userLock = LOCKS[_lockId];
        bool collectorIsBot = AUTO_COLLECT_ACCOUNT == msg.sender;
        require(userLock.owner == msg.sender || userLock.additionalCollector == msg.sender || collectorIsBot, "OWNER");
        if (userLock.ucf == 0) { // No Protocol fee
            (amount0, amount1) = userLock.nftPositionManager.collect(INonfungiblePositionManager.CollectParams(userLock.nft_id, _recipient, _amount0Max, _amount1Max));
        } else { // Protocol fees
            (,,address _token0,address _token1,,,,,,,) = userLock.nftPositionManager.positions(userLock.nft_id);

            uint256 balance0 = IERC20(_token0).balanceOf(address(this));
            uint256 balance1 = IERC20(_token1).balanceOf(address(this));

            userLock.nftPositionManager.collect(INonfungiblePositionManager.CollectParams(userLock.nft_id, address(this), _amount0Max, _amount1Max));

            balance0 = IERC20(_token0).balanceOf(address(this)) - balance0;
            balance1 = IERC20(_token1).balanceOf(address(this)) - balance1;
            address feeTo = collectorIsBot ? _recipient : FEE_ADDR_COLLECT;
            address remainderTo = collectorIsBot ? userLock.collectAddress : _recipient;

            if (balance0 > 0) {
                fee0 = balance0 * userLock.ucf / FEE_DENOMINATOR;
                TransferHelper.safeTransfer(_token0, feeTo, fee0);
                amount0 = balance0 - fee0;
                TransferHelper.safeTransfer(_token0, remainderTo, amount0);
            }
            if (balance1 > 0) {
                fee1 = balance1 * userLock.ucf / FEE_DENOMINATOR;
                TransferHelper.safeTransfer(_token1, feeTo, fee1);
                amount1 = balance1 - fee1;
                TransferHelper.safeTransfer(_token1, remainderTo, amount1);
            }
        }
    }

    /**
    * @dev increases liquidity. Can be called by anyone. 
    * You should ideally call increaseLiquidity from the NftPositionManager directly for gas efficiency. 
    * This method is here just for convenience for some contracts which solely interact with the UNCX lockers / lockIds
    */
    function increaseLiquidity(uint256 _lockId, INonfungiblePositionManager.IncreaseLiquidityParams calldata params) external payable override nonReentrant returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
        Lock memory userLock = LOCKS[_lockId];
        require(userLock.nft_id == params.tokenId, "NFT ID");

        (,,address token0,address token1,,,,,,,) = userLock.nftPositionManager.positions(userLock.nft_id);

        uint256 balance0Before = IERC20(token0).balanceOf(address(this));
        uint256 balance1Before = IERC20(token1).balanceOf(address(this));

        TransferHelper.safeTransferFrom(token0, msg.sender, address(this), params.amount0Desired);
        TransferHelper.safeTransferFrom(token1, msg.sender, address(this), params.amount1Desired);
        TransferHelper.safeApprove(token0, address(userLock.nftPositionManager), params.amount0Desired);
        TransferHelper.safeApprove(token1, address(userLock.nftPositionManager), params.amount1Desired);

        (liquidity, amount0, amount1) = userLock.nftPositionManager.increaseLiquidity(params);

        uint256 balance0diff = IERC20(token0).balanceOf(address(this)) - balance0Before;
        uint256 balance1diff = IERC20(token1).balanceOf(address(this)) - balance1Before;
        if (balance0diff > 0) {
            TransferHelper.safeTransfer(token0, msg.sender, balance0diff);
        }
        if (balance1diff > 0) {
            TransferHelper.safeTransfer(token1, msg.sender, balance1diff);
        }

        emit onIncreaseLiquidity(_lockId); // This can be called directly from the NFT position manager in which case this event won't fire
    }

    /**
    * @dev decrease liquidity if a lock has expired (useful before relocking)
    */
    function decreaseLiquidity(uint256 _lockId, INonfungiblePositionManager.DecreaseLiquidityParams calldata params) external payable override nonReentrant returns (uint256 amount0, uint256 amount1) {
        isLockAdmin(_lockId);
        Lock memory userLock = LOCKS[_lockId];
        require(userLock.nft_id == params.tokenId, 'NFT ID');
        if (userLock.unlockDate == ETERNAL_LOCK) {
            revert('ETERNAL_LOCK');
        } else {
            require(userLock.unlockDate < block.timestamp, 'NOT YET');
        }
        _collect(_lockId, msg.sender, type(uint128).max, type(uint128).max); // collect protocol fees
        (amount0, amount1) = userLock.nftPositionManager.decreaseLiquidity(params);
        userLock.nftPositionManager.collect(INonfungiblePositionManager.CollectParams(userLock.nft_id, msg.sender, type(uint128).max, type(uint128).max));
        emit onDecreaseLiquidity(_lockId);
    }

    /**
    * @dev set the unlock date further in the future
    */
    function relock(uint256 _lockId, uint256 _unlockDate) external override nonReentrant {
        isLockAdmin(_lockId);
        Lock storage userLock = LOCKS[_lockId];
        require(_unlockDate > userLock.unlockDate, 'DATE');
        require(_unlockDate > block.timestamp, 'DATE PASSED');
        require(_unlockDate < 1e10 || _unlockDate == ETERNAL_LOCK, 'MILLISECONDS'); // prevents errors when timestamp entered in milliseconds
        userLock.unlockDate = _unlockDate;
        emit onRelock(_lockId, userLock.unlockDate);
    }

    /**
    * @dev withdraw a UniV3 liquidity NFT and send it to _receiver
    * Only callable once unlockDate has expired
    */
    function withdraw (uint256 _lockId, address _receiver) external override nonReentrant {
        isLockAdmin(_lockId);
        Lock memory userLock = LOCKS[_lockId];
        if (userLock.unlockDate == ETERNAL_LOCK) {
            revert('ETERNAL_LOCK');
        } else {
            require(userLock.unlockDate < block.timestamp, 'NOT YET');
        }

        if (userLock.ucf > 0) {
            _collect(_lockId, _receiver, type(uint128).max, type(uint128).max);
        }

        userLock.nftPositionManager.safeTransferFrom(address(this), _receiver, userLock.nft_id);
        USER_LOCKS[userLock.owner].remove(_lockId);

        emit onWithdraw(_lockId, userLock.owner, _receiver);

        delete LOCKS[_lockId]; // clear the state for this lock (reset all values to zero)
    }

    /**
    * @dev set migrate in contract address
    */
    function setMigrateInContract (address _migrateIn) external override onlyOwner {
        MIGRATE_IN = _migrateIn;
    }

    /**
    * @dev migrate a lock to a new amm version (Uniswap V4)
    */
    function migrate (uint256 _lockId) external override nonReentrant {
        require(address(MIGRATOR) != address(0), "NOT SET");
        isLockAdmin(_lockId);
        Lock memory userLock = LOCKS[_lockId];
        userLock.nftPositionManager.approve(address(MIGRATOR), userLock.nft_id);
        MIGRATOR.migrate(_lockId, userLock.nftPositionManager, userLock.nft_id);
        USER_LOCKS[userLock.owner].remove(_lockId);

        delete LOCKS[_lockId]; // clear the state for this lock (reset all values to zero)

        emit onMigrate(_lockId);
    }

    /**
    * @dev allow a lock owner to add an additional address, usually a contract, to collect fees. Useful for bots
    */
    function setAdditionalCollector (uint256 _lockId, address _additionalCollector) external override nonReentrant {
        isLockAdmin(_lockId);
        Lock storage userLock = LOCKS[_lockId];
        userLock.additionalCollector = _additionalCollector;

        emit onSetAdditionalCollector(_lockId, _additionalCollector);
    }

    /**
    * @dev set the adress to which fees are automatically collected
    */
    function setCollectAddress (uint256 _lockId, address _collectAddress) external override nonReentrant {
        isLockAdmin(_lockId);
        require(_collectAddress != address(0), 'COLLECT_ADDR');
        Lock storage userLock = LOCKS[_lockId];
        userLock.collectAddress = _collectAddress;

        emit onSetCollectAddress(_lockId, _collectAddress);
    }

    /**
    * @dev transfer ownership of a lock to _newOwner 
    */
    function transferLockOwnership (uint256 _lockId, address _newOwner) external override nonReentrant {
        isLockAdmin(_lockId);
        require(msg.sender != _newOwner, "SAME OWNER");
        Lock storage userLock = LOCKS[_lockId];
        userLock.pendingOwner = _newOwner;

        emit onLockOwnershipTransferStarted(_lockId, msg.sender, _newOwner);
    }

    /**
    * @dev accept lock ownership transfer
    */
    function acceptLockOwnership (uint256 _lockId, address _collectAddress) external override nonReentrant {
        Lock storage userLock = LOCKS[_lockId];
        require(userLock.pendingOwner == msg.sender, "OWNER");

        address oldOwner = userLock.owner;
        USER_LOCKS[userLock.owner].remove(_lockId);
        userLock.owner = msg.sender;
        userLock.pendingOwner = address(0);
        userLock.collectAddress = _collectAddress;
        userLock.additionalCollector = address(0);
        USER_LOCKS[msg.sender].add(_lockId);

        emit onTransferLockOwnership(_lockId, oldOwner, msg.sender, _collectAddress);
    }

    /**
    * @dev set the migrator contract which allows locked LP NFT's to be migrated to future AMM versions
    */
    function setMigrator(address _migrator) external override onlyOwner {
        MIGRATOR = IMigrateV3NFT(_migrator);

        emit onSetMigrator(_migrator);
    }

    /**
    * @dev set ucf
    */
    function setUCF(uint256 _lockId, uint256 _ucf) external override onlyOwner {
        Lock storage l = LOCKS[_lockId];
        require(_ucf < l.ucf, "L");
        l.ucf = _ucf;
        emit onSetUCF(_lockId, _ucf);
    }

    /**
    * @dev check if msg.sender is the owner of lock with _lockId
    */
    function isLockAdmin (uint256 _lockId) private view {
        Lock memory userLock = LOCKS[_lockId];
        require(userLock.owner == msg.sender, "OWNER");
    }

    /**
    * @dev returns a Lock struct for _lockId
    */
    function getLock(uint256 _lockId) external view override returns (Lock memory _lock) {
        _lock = LOCKS[_lockId];
    }

    /**
    * @dev gets the number of unique locks in this contract, used to page through the lock array (includes expired and withdrawn locks)
    */
    function getLocksLength() external view override returns (uint256) {
        return NONCE;
    }

    /**
    * @dev gets the number of locks for a user
    */
    function getNumUserLocks(address _user) external view override returns (uint256) {
        return USER_LOCKS[_user].length();
    }

    /**
    * @dev gets the lock at a specific index for a user
    */
    function getUserLockAtIndex(address _user, uint256 _index) external view override returns (Lock memory) {
        return LOCKS[USER_LOCKS[_user].at(_index)];
    }

    function _setPartialMintParamsFromPosition (INonfungiblePositionManager _nftPositionManager, uint256 _tokenId) private view returns (INonfungiblePositionManager.MintParams memory) {
        INonfungiblePositionManager.MintParams memory m;
        (,,m.token0,m.token1,,,,,,,) = _nftPositionManager.positions(_tokenId);
        return m;
    }

    /**
    * @dev check if a nft position manager is whitelisted to lock
    */
    function nftPositionManagerIsAllowed (address _nftPositionManager) external view returns (bool) {
        return allowedNftPositionManagers.contains(_nftPositionManager);
    }

    /**
    * @dev get a locks liquidity in amounts of token0 and token1 for a generic position (not from state)
    */
    function getAmountsForLiquidity (int24 currentTick, int24 tickLower, int24 tickHigher, uint128 liquidity) public pure override returns (uint256, uint256) {
        return LiquidityAmounts.getAmountsForLiquidity(
            TickMath.getSqrtRatioAtTick(currentTick),
            TickMath.getSqrtRatioAtTick(tickLower),
            TickMath.getSqrtRatioAtTick(tickHigher),
            liquidity
        );
    }

    /**
    * @dev returns just the liquidity value from a position
    */
    function _getLiquidity (INonfungiblePositionManager _nftPositionManager, uint256 _tokenId) private view returns (uint128) {
        (,,,,,,uint128 liquidity,,,,) = _nftPositionManager.positions(_tokenId);
        return liquidity;
    }

    /**
    * @dev Allows admin to remove any eth mistakenly sent to the contract
    */
    function adminRefundEth (uint256 _amount, address payable _receiver) external onlyOwner nonReentrant {
        (bool success, ) = _receiver.call{value: _amount}("");
        if (!success) {
            revert("Gas token transfer failed");
        }
    }

    /**
    * @dev Allows admin to remove any ERC20's mistakenly sent to the contract
    * Since this contract is only for locking NFT liquidity, this allows removal of ERC20 tokens and cannot remove locked NFT liquidity.
    */
    function adminRefundERC20(address _token, address _receiver, uint256 _amount) external onlyOwner nonReentrant {
        // TransferHelper.safeTransfer = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        // Attempting to transfer nfts with this function (substituting a nft_id for _amount) wil fail with 'ST' as NFTS do not have the same interface
        TransferHelper.safeTransfer(_token, _receiver, _amount);
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

}