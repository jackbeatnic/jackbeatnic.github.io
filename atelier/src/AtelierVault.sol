// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Atelier vault
/// @notice Escrow for a work a source wallet already holds. The owner or the
///         operator pulls an approved ERC-1155 or ERC-721 from that depositor
///         into this contract and sells that same token. The depositor is not
///         the contract owner. This contract does not mint. The original
///         supply does not change: the balance moves wallet, vault, then
///         buyer, or back to the depositor when the sale does not complete.
///         While the units sit here they are not spendable from the wallet.
///         A one-of-one list on this desk would mint a second id. That path
///         is rejected. Deploy on Avalanche first, then Base, from this source.
contract AtelierVault {
    uint8 public constant KIND_FIXED = 1;
    uint8 public constant KIND_AUCTION = 2;
    uint8 public constant STD_721 = 1;
    uint8 public constant STD_1155 = 2;
    uint16 public constant MIN_INCREMENT_BPS = 500;
    uint16 public constant MAX_INCREMENT_BPS = 5000;
    uint32 public constant MIN_EXTENSION = 5 minutes;
    uint64 public constant MAX_AUCTION = 30 days;
    uint64 public constant MAX_EXTENSION = 1 hours;
    uint96 public constant MAX_ROYALTY_BPS = 1000;

    struct Lot {
        uint8 kind;
        uint8 standard;
        bool sold;
        bool listed;
        uint16 incrementBps;
        uint32 extensionSecs;
        uint64 startTime;
        uint64 endTime;
        uint64 hardEnd;
        uint96 price;
        uint96 reservePrice;
        uint96 bid;
        address bidder;
        address collection;
        address depositor;
        uint256 tokenId;
        uint256 qty;
    }

    address public owner;
    /// @notice Separate key. It may deposit and cancel an unsold lot with no bid. It does not receive proceeds.
    address public operator;
    address public proceeds;
    address public fallbackRoyaltyReceiver;
    uint96 public fallbackRoyaltyBps;
    bool public paused;
    uint256 private locked = 1;

    address private pullCollection;
    address private pullFrom;
    uint256 private pullTokenId;
    uint256 private pullQty;

    mapping(uint256 => Lot) private _lots;
    mapping(address => uint256) public withdrawable;
    uint256[] public lotIds;

    event Deposited(
        uint256 indexed lotId,
        address indexed collection,
        uint256 indexed tokenId,
        address depositor,
        uint256 qty,
        uint8 kind
    );
    event Listed(uint256 indexed lotId, uint8 kind, uint96 price);
    event Bought(uint256 indexed lotId, address indexed buyer, uint256 price);
    event Bid(uint256 indexed lotId, address indexed bidder, uint256 amount);
    event Settled(uint256 indexed lotId, address indexed winner, uint256 amount, bool won);
    event Cancelled(uint256 indexed lotId);
    event Withdrawn(address indexed account, uint256 amount);
    event Paused(bool paused);

    error NotOwner();
    error NotOperator();
    error BadState();
    error BadTime();
    error BadPrice();
    error BadQty();
    error PausedSale();
    error Reentered();
    error CloneId();
    error UnexpectedToken();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev Owner, or the operator once the owner has set one. An unset operator authorizes nobody.
    modifier onlyOwnerOrOperator() {
        if (msg.sender != owner && (operator == address(0) || msg.sender != operator)) {
            revert NotOperator();
        }
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentered();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address owner_, address operator_) {
        require(owner_ != address(0), "owner");
        require(operator_ != address(0), "operator");
        owner = owner_;
        proceeds = owner_;
        operator = operator_;
    }

    function lotCount() external view returns (uint256) {
        return lotIds.length;
    }

    function lotIdAt(uint256 index) external view returns (uint256) {
        return lotIds[index];
    }

    /// @notice Sale terms for a lot. Split from the asset record so the
    ///         return value stays small enough for the compiler.
    function lotSale(uint256 lotId)
        external
        view
        returns (
            uint8 kind,
            uint8 standard,
            bool sold,
            bool listed,
            uint64 startTime,
            uint64 endTime,
            uint96 price,
            uint96 reservePrice,
            uint96 highBid,
            uint16 incrementBps,
            uint32 extensionSecs
        )
    {
        Lot storage lot = _lots[lotId];
        return (
            lot.kind,
            lot.standard,
            lot.sold,
            lot.listed,
            lot.startTime,
            lot.endTime,
            lot.price,
            lot.reservePrice,
            lot.bid,
            lot.incrementBps,
            lot.extensionSecs
        );
    }

    /// @notice The original token. `tokenId` is the id that was pulled, not a new one.
    function lotAsset(uint256 lotId)
        external
        view
        returns (address collection, address depositor, address bidder, uint256 tokenId, uint256 qty)
    {
        Lot storage lot = _lots[lotId];
        return (lot.collection, lot.depositor, lot.bidder, lot.tokenId, lot.qty);
    }

    /// @notice The one-of-one desk mints a fresh id. This vault must not.
    function listFixed(uint256, string calldata, uint96, uint64, uint64) external pure {
        revert CloneId();
    }

    /// @notice The one-of-one desk mints a fresh id. This vault must not.
    function listAuction(uint256, string calldata, uint96, uint96, uint64, uint64, uint16, uint32)
        external
        pure
    {
        revert CloneId();
    }

    function depositFixed(
        uint8 standard,
        address collection,
        uint256 tokenId,
        uint256 qty,
        address from,
        uint96 price,
        uint64 startTime,
        uint64 endTime
    ) external nonReentrant onlyOwnerOrOperator {
        if (price == 0) revert BadPrice();
        if (endTime != 0 && endTime <= startTime) revert BadTime();
        _pull(standard, collection, tokenId, qty, from);
        uint256 lotId = _open(KIND_FIXED, standard, collection, tokenId, qty, from);
        Lot storage lot = _lots[lotId];
        lot.startTime = startTime;
        lot.endTime = endTime;
        lot.hardEnd = endTime;
        lot.price = price;
        emit Listed(lotId, KIND_FIXED, price);
        emit Deposited(lotId, collection, tokenId, from, qty, KIND_FIXED);
    }

    function depositAuction(
        uint8 standard,
        address collection,
        uint256 tokenId,
        uint256 qty,
        address from,
        uint96 minBid,
        uint96 reservePrice,
        uint64 startTime,
        uint64 endTime,
        uint16 incrementBps,
        uint32 extensionSecs
    ) external nonReentrant onlyOwnerOrOperator {
        if (minBid == 0) revert BadPrice();
        if (reservePrice != 0 && reservePrice < minBid) revert BadPrice();
        if (endTime <= startTime || endTime - startTime > MAX_AUCTION) revert BadTime();
        if (incrementBps > MAX_INCREMENT_BPS) revert BadPrice();
        if (extensionSecs > MAX_EXTENSION) revert BadTime();
        if (incrementBps < MIN_INCREMENT_BPS) incrementBps = MIN_INCREMENT_BPS;
        if (extensionSecs < MIN_EXTENSION) extensionSecs = MIN_EXTENSION;
        _pull(standard, collection, tokenId, qty, from);
        uint256 lotId = _open(KIND_AUCTION, standard, collection, tokenId, qty, from);
        uint64 hardEnd = endTime + 1 days;
        Lot storage lot = _lots[lotId];
        lot.incrementBps = incrementBps;
        lot.extensionSecs = extensionSecs;
        lot.startTime = startTime;
        lot.endTime = endTime;
        lot.hardEnd = hardEnd;
        lot.price = minBid;
        lot.reservePrice = reservePrice;
        emit Listed(lotId, KIND_AUCTION, minBid);
        emit Deposited(lotId, collection, tokenId, from, qty, KIND_AUCTION);
    }

    function buy(uint256 lotId) external payable nonReentrant {
        if (paused) revert PausedSale();
        Lot storage lot = _lots[lotId];
        if (!lot.listed || lot.sold || lot.kind != KIND_FIXED) revert BadState();
        if (lot.startTime != 0 && block.timestamp < lot.startTime) revert BadTime();
        if (lot.endTime != 0 && block.timestamp > lot.endTime) revert BadTime();
        if (msg.value < lot.price) revert BadPrice();
        uint256 price = lot.price;
        lot.sold = true;
        lot.listed = false;
        _pay(lot.collection, lot.tokenId, price);
        _credit(msg.sender, msg.value - price);
        _release(lot, msg.sender);
        emit Bought(lotId, msg.sender, price);
    }

    function bid(uint256 lotId) external payable nonReentrant {
        if (paused) revert PausedSale();
        Lot storage lot = _lots[lotId];
        if (!lot.listed || lot.sold || lot.kind != KIND_AUCTION) revert BadState();
        if (block.timestamp < lot.startTime || block.timestamp >= lot.endTime) revert BadTime();
        uint256 minAmount = lot.bidder == address(0) ? lot.price : _nextBid(lot.bid, lot.incrementBps);
        if (msg.value < minAmount || msg.value > type(uint96).max) revert BadPrice();
        if (lot.bidder != address(0)) _credit(lot.bidder, lot.bid);
        lot.bidder = msg.sender;
        lot.bid = uint96(msg.value);
        if (lot.extensionSecs > 0 && lot.endTime - uint64(block.timestamp) <= lot.extensionSecs) {
            uint64 extended = uint64(block.timestamp) + lot.extensionSecs;
            if (extended > lot.hardEnd) extended = lot.hardEnd;
            if (extended > lot.endTime) lot.endTime = extended;
        }
        emit Bid(lotId, msg.sender, msg.value);
    }

    function settle(uint256 lotId) external nonReentrant {
        Lot storage lot = _lots[lotId];
        if (!lot.listed || lot.sold || lot.kind != KIND_AUCTION) revert BadState();
        if (block.timestamp < lot.endTime) revert BadTime();
        lot.listed = false;
        bool won = lot.bidder != address(0) && (lot.reservePrice == 0 || lot.bid >= lot.reservePrice);
        if (won) {
            lot.sold = true;
            _pay(lot.collection, lot.tokenId, lot.bid);
            _release(lot, lot.bidder);
            emit Settled(lotId, lot.bidder, lot.bid, true);
        } else {
            _credit(lot.bidder, lot.bid);
            _release(lot, lot.depositor);
            emit Settled(lotId, address(0), 0, false);
        }
    }

    /// @notice Fixed-price window ended with no buyer. The same units go home.
    function reclaim(uint256 lotId) external nonReentrant {
        Lot storage lot = _lots[lotId];
        if (!lot.listed || lot.sold || lot.kind != KIND_FIXED) revert BadState();
        if (lot.endTime == 0 || block.timestamp <= lot.endTime) revert BadTime();
        lot.listed = false;
        _release(lot, lot.depositor);
        emit Cancelled(lotId);
    }

    /// @notice Only before a bid. The same units go back to the depositor.
    function cancel(uint256 lotId) external nonReentrant onlyOwnerOrOperator {
        Lot storage lot = _lots[lotId];
        if (!lot.listed || lot.sold) revert BadState();
        if (lot.kind == KIND_AUCTION && lot.bidder != address(0)) revert BadState();
        lot.listed = false;
        _release(lot, lot.depositor);
        emit Cancelled(lotId);
    }

    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert BadState();
        withdrawable[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "withdraw");
    }

    function setPaused(bool next) external onlyOwner {
        paused = next;
        emit Paused(next);
    }

    function setProceeds(address next) external onlyOwner {
        require(next != address(0), "proceeds");
        proceeds = next;
    }

    /// @notice Used only when the escrowed token does not implement EIP-2981.
    function setFallbackRoyalty(address receiver, uint96 bps) external onlyOwner {
        require(receiver != address(0), "royalty");
        require(bps <= MAX_ROYALTY_BPS, "royalty");
        fallbackRoyaltyReceiver = receiver;
        fallbackRoyaltyBps = bps;
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "owner");
        owner = next;
    }

    function setOperator(address next) external onlyOwner {
        require(next != address(0), "operator");
        operator = next;
    }

    function onERC1155Received(address, address from, uint256 id, uint256 value, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (
            msg.sender != pullCollection || from != pullFrom || id != pullTokenId || value != pullQty
        ) {
            revert UnexpectedToken();
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert UnexpectedToken();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x4e2312e0;
    }

    function _pull(uint8 standard, address collection, uint256 tokenId, uint256 qty, address from)
        internal
    {
        if (from == address(0) || collection == address(0)) revert BadState();
        if (collection == address(this)) revert CloneId();
        if (qty == 0) revert BadQty();
        if (standard == STD_721) {
            if (qty != 1) revert BadQty();
            IERC721(collection).transferFrom(from, address(this), tokenId);
            if (IERC721(collection).ownerOf(tokenId) != address(this)) revert BadState();
        } else if (standard == STD_1155) {
            uint256 beforeBal = IERC1155(collection).balanceOf(address(this), tokenId);
            pullCollection = collection;
            pullFrom = from;
            pullTokenId = tokenId;
            pullQty = qty;
            IERC1155(collection).safeTransferFrom(from, address(this), tokenId, qty, "");
            pullCollection = address(0);
            uint256 afterBal = IERC1155(collection).balanceOf(address(this), tokenId);
            if (afterBal < beforeBal + qty) revert BadState();
        } else {
            revert BadState();
        }
    }

    function _open(
        uint8 kind,
        uint8 standard,
        address collection,
        uint256 tokenId,
        uint256 qty,
        address from
    ) internal returns (uint256 lotId) {
        lotId = lotIds.length + 1;
        lotIds.push(lotId);
        Lot storage lot = _lots[lotId];
        lot.kind = kind;
        lot.standard = standard;
        lot.listed = true;
        lot.collection = collection;
        lot.depositor = from;
        lot.tokenId = tokenId;
        lot.qty = qty;
    }

    function _release(Lot storage lot, address to) internal {
        if (lot.standard == STD_1155) {
            IERC1155(lot.collection).safeTransferFrom(address(this), to, lot.tokenId, lot.qty, "");
        } else {
            IERC721(lot.collection).transferFrom(address(this), to, lot.tokenId);
        }
    }

    function _nextBid(uint96 current, uint16 bps) internal pure returns (uint256) {
        if (bps == 0) return uint256(current) + 1;
        uint256 step = (uint256(current) * bps) / 10000;
        if (step == 0) step = 1;
        return uint256(current) + step;
    }

    function _pay(address collection, uint256 tokenId, uint256 amount) internal {
        (address receiver, uint256 cut) = _royalty(collection, tokenId, amount);
        if (cut > amount / 10) cut = amount / 10;
        _credit(receiver, cut);
        _credit(proceeds, amount - cut);
    }

    function _royalty(address collection, uint256 tokenId, uint256 amount)
        internal
        view
        returns (address receiver, uint256 cut)
    {
        try IERC2981(collection).royaltyInfo(tokenId, amount) returns (address found, uint256 amt) {
            if (found != address(0) && amt > 0 && amt <= amount) return (found, amt);
        } catch {}
        if (fallbackRoyaltyReceiver != address(0) && fallbackRoyaltyBps > 0) {
            return (fallbackRoyaltyReceiver, (amount * fallbackRoyaltyBps) / 10000);
        }
        return (address(0), 0);
    }

    function _credit(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        withdrawable[to] += amount;
    }
}

interface IERC2981 {
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address, uint256);
}

interface IERC721 {
    function transferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IERC1155 {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data)
        external;
    function balanceOf(address account, uint256 id) external view returns (uint256);
}
