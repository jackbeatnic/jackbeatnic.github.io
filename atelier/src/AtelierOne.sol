// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Atelier one-of-one desk
/// @notice Studio listings for a single work: a fixed price, or one auction
///         (minimum bid, optional reserve, optional anti-snipe extension).
///         The same source is deployed on Avalanche first, then on Base.
///         Buyers pay the chain's native coin. Proceeds are pulled, not pushed.
contract AtelierOne {
    string public constant name = "Jack Beatnic Atelier";
    string public constant symbol = "JBA";

    uint8 public constant KIND_FIXED = 1;
    uint8 public constant KIND_AUCTION = 2;
    uint16 public constant MIN_INCREMENT_BPS = 500;
    uint16 public constant MAX_INCREMENT_BPS = 5000;
    uint32 public constant MIN_EXTENSION = 5 minutes;
    uint64 public constant MAX_AUCTION = 30 days;
    uint64 public constant MAX_EXTENSION = 1 hours;
    uint96 public constant MAX_ROYALTY_BPS = 1000;

    struct Piece {
        uint8 kind;
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
    }

    address public owner;
    /// @notice Separate key. It may list and cancel an unsold sale. It does not receive proceeds.
    address public operator;
    address public proceeds;
    address public royaltyReceiver;
    uint96 public royaltyBps;
    bool public paused;
    uint256 private locked = 1;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(uint256 => string) private tokenUris;
    mapping(uint256 => Piece) public pieces;
    mapping(uint256 => bool) public seen;
    mapping(address => uint256) public withdrawable;
    uint256[] public saleIds;

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Listed(uint256 indexed id, uint8 kind, uint96 price);
    event Bought(uint256 indexed id, address indexed buyer, uint256 price);
    event Bid(uint256 indexed id, address indexed bidder, uint256 amount);
    event Settled(uint256 indexed id, address indexed winner, uint256 amount, bool won);
    event Cancelled(uint256 indexed id);
    event Withdrawn(address indexed account, uint256 amount);
    event Paused(bool paused);

    error NotOwner();
    error NotOperator();
    error BadState();
    error BadTime();
    error BadPrice();
    error PausedSale();
    error Reentered();

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

    constructor() {
        owner = msg.sender;
        proceeds = msg.sender;
        royaltyReceiver = msg.sender;
    }

    function saleCount() external view returns (uint256) {
        return saleIds.length;
    }

    function saleIdAt(uint256 index) external view returns (uint256) {
        return saleIds[index];
    }

    function tokenURI(uint256 id) external view returns (string memory) {
        require(ownerOf[id] != address(0), "missing");
        return tokenUris[id];
    }

    function listFixed(
        uint256 id,
        string calldata uri,
        uint96 price,
        uint64 startTime,
        uint64 endTime
    ) external onlyOwnerOrOperator {
        if (price == 0) revert BadPrice();
        if (endTime != 0 && endTime <= startTime) revert BadTime();
        _open(id, uri);
        pieces[id] = Piece({
            kind: KIND_FIXED,
            sold: false,
            listed: true,
            incrementBps: 0,
            extensionSecs: 0,
            startTime: startTime,
            endTime: endTime,
            hardEnd: endTime,
            price: price,
            reservePrice: 0,
            bid: 0,
            bidder: address(0)
        });
        emit Listed(id, KIND_FIXED, price);
    }

    function listAuction(
        uint256 id,
        string calldata uri,
        uint96 minBid,
        uint96 reservePrice,
        uint64 startTime,
        uint64 endTime,
        uint16 incrementBps,
        uint32 extensionSecs
    ) external onlyOwnerOrOperator {
        if (minBid == 0) revert BadPrice();
        if (reservePrice != 0 && reservePrice < minBid) revert BadPrice();
        if (endTime <= startTime || endTime - startTime > MAX_AUCTION) revert BadTime();
        if (incrementBps > MAX_INCREMENT_BPS) revert BadPrice();
        if (extensionSecs > MAX_EXTENSION) revert BadTime();
        if (incrementBps < MIN_INCREMENT_BPS) incrementBps = MIN_INCREMENT_BPS;
        if (extensionSecs < MIN_EXTENSION) extensionSecs = MIN_EXTENSION;
        _open(id, uri);
        uint64 hardEnd = endTime + 1 days;
        pieces[id] = Piece({
            kind: KIND_AUCTION,
            sold: false,
            listed: true,
            incrementBps: incrementBps,
            extensionSecs: extensionSecs,
            startTime: startTime,
            endTime: endTime,
            hardEnd: hardEnd,
            price: minBid,
            reservePrice: reservePrice,
            bid: 0,
            bidder: address(0)
        });
        emit Listed(id, KIND_AUCTION, minBid);
    }

    function buy(uint256 id) external payable nonReentrant {
        if (paused) revert PausedSale();
        Piece storage piece = pieces[id];
        if (!piece.listed || piece.sold || piece.kind != KIND_FIXED) revert BadState();
        if (piece.startTime != 0 && block.timestamp < piece.startTime) revert BadTime();
        if (piece.endTime != 0 && block.timestamp > piece.endTime) revert BadTime();
        if (msg.value < piece.price) revert BadPrice();
        uint256 price = piece.price;
        piece.sold = true;
        piece.listed = false;
        _pay(price);
        _credit(msg.sender, msg.value - price);
        _transfer(address(this), msg.sender, id);
        emit Bought(id, msg.sender, price);
    }

    function bid(uint256 id) external payable nonReentrant {
        if (paused) revert PausedSale();
        Piece storage piece = pieces[id];
        if (!piece.listed || piece.sold || piece.kind != KIND_AUCTION) revert BadState();
        if (block.timestamp < piece.startTime || block.timestamp >= piece.endTime) revert BadTime();
        uint256 minAmount = piece.bidder == address(0)
            ? piece.price
            : _nextBid(piece.bid, piece.incrementBps);
        if (msg.value < minAmount || msg.value > type(uint96).max) revert BadPrice();
        if (piece.bidder != address(0)) _credit(piece.bidder, piece.bid);
        piece.bidder = msg.sender;
        piece.bid = uint96(msg.value);
        if (
            piece.extensionSecs > 0 &&
            piece.endTime - uint64(block.timestamp) <= piece.extensionSecs
        ) {
            uint64 extended = uint64(block.timestamp) + piece.extensionSecs;
            if (extended > piece.hardEnd) extended = piece.hardEnd;
            if (extended > piece.endTime) piece.endTime = extended;
        }
        emit Bid(id, msg.sender, msg.value);
    }

    function settle(uint256 id) external nonReentrant {
        Piece storage piece = pieces[id];
        if (!piece.listed || piece.sold || piece.kind != KIND_AUCTION) revert BadState();
        if (block.timestamp < piece.endTime) revert BadTime();
        piece.listed = false;
        bool won = piece.bidder != address(0) &&
            (piece.reservePrice == 0 || piece.bid >= piece.reservePrice);
        if (won) {
            piece.sold = true;
            _pay(piece.bid);
            _transfer(address(this), piece.bidder, id);
            emit Settled(id, piece.bidder, piece.bid, true);
        } else {
            _credit(piece.bidder, piece.bid);
            _transfer(address(this), owner, id);
            emit Settled(id, address(0), 0, false);
        }
    }

    function cancel(uint256 id) external onlyOwnerOrOperator nonReentrant {
        Piece storage piece = pieces[id];
        if (!piece.listed || piece.sold) revert BadState();
        if (piece.kind == KIND_AUCTION && piece.bidder != address(0)) revert BadState();
        piece.listed = false;
        _transfer(address(this), owner, id);
        emit Cancelled(id);
    }

    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert BadState();
        withdrawable[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "withdraw");
        emit Withdrawn(msg.sender, amount);
    }

    function setPaused(bool next) external onlyOwner {
        paused = next;
        emit Paused(next);
    }

    function setProceeds(address next) external onlyOwner {
        require(next != address(0), "proceeds");
        proceeds = next;
    }

    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        require(receiver != address(0), "royalty");
        require(bps <= MAX_ROYALTY_BPS, "royalty");
        royaltyReceiver = receiver;
        royaltyBps = bps;
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "owner");
        owner = next;
    }

    function setOperator(address next) external onlyOwner {
        require(next != address(0), "operator");
        operator = next;
    }

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        return (royaltyReceiver, (salePrice * royaltyBps) / 10000);
    }

    function approve(address spender, uint256 id) external {
        address tokenOwner = ownerOf[id];
        require(msg.sender == tokenOwner || isApprovedForAll[tokenOwner][msg.sender], "auth");
        getApproved[id] = spender;
        emit Approval(tokenOwner, spender, id);
    }

    function setApprovalForAll(address spender, bool approved) external {
        isApprovedForAll[msg.sender][spender] = approved;
        emit ApprovalForAll(msg.sender, spender, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        _authorized(from, id);
        _transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes calldata) external {
        transferFrom(from, to, id);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f || // ERC-721 metadata
            interfaceId == 0x2a55205a || // ERC-2981
            interfaceId == 0x01ffc9a7; // ERC-165
    }

    function _open(uint256 id, string calldata uri) internal {
        Piece storage piece = pieces[id];
        if (piece.listed || piece.sold) revert BadState();
        if (ownerOf[id] == address(0)) {
            _mint(address(this), id);
        } else {
            if (ownerOf[id] != owner) revert BadState();
            _transfer(owner, address(this), id);
        }
        tokenUris[id] = uri;
        if (!seen[id]) {
            seen[id] = true;
            saleIds.push(id);
        }
    }

    function _nextBid(uint96 current, uint16 bps) internal pure returns (uint256) {
        if (bps == 0) return uint256(current) + 1;
        uint256 step = (uint256(current) * bps) / 10000;
        if (step == 0) step = 1;
        return uint256(current) + step;
    }

    function _pay(uint256 amount) internal {
        uint256 cut = (amount * royaltyBps) / 10000;
        _credit(royaltyReceiver, cut);
        _credit(proceeds, amount - cut);
    }

    function _credit(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        withdrawable[to] += amount;
    }

    function _mint(address to, uint256 id) internal {
        require(to != address(0) && ownerOf[id] == address(0), "mint");
        ownerOf[id] = to;
        balanceOf[to] += 1;
        emit Transfer(address(0), to, id);
    }

    function _authorized(address from, uint256 id) internal view {
        require(ownerOf[id] == from, "owner");
        require(
            msg.sender == from ||
                getApproved[id] == msg.sender ||
                isApprovedForAll[from][msg.sender],
            "auth"
        );
    }

    function _transfer(address from, address to, uint256 id) internal {
        require(to != address(0) && ownerOf[id] == from, "transfer");
        getApproved[id] = address(0);
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        ownerOf[id] = to;
        emit Transfer(from, to, id);
        if (to.code.length > 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, id, "") ==
                    IERC721Receiver.onERC721Received.selector,
                "receiver"
            );
        }
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 id, bytes calldata data)
        external
        returns (bytes4);
}
