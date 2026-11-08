// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Atelier edition desk
/// @notice Separate from one-of-one sales. A run is 10 to 1000 copies.
///         Fixed: the same price until the run is gone.
///         Step: each sale raises the price of the next copy.
///         Native coin only. Proceeds are pulled.
contract AtelierEdition {
    uint8 public constant CURVE_FIXED = 1;
    uint8 public constant CURVE_STEP = 2;
    uint32 public constant MIN_SUPPLY = 10;
    uint32 public constant MAX_SUPPLY = 1000;
    uint96 public constant MAX_ROYALTY_BPS = 1000;

    struct Run {
        uint8 curve;
        bool listed;
        uint32 supply;
        uint32 sold;
        uint96 price;
        uint96 step;
        uint96 cap;
    }

    address public owner;
    /// @notice Separate key. It may list and cancel before the first copy sells. It does not receive proceeds.
    address public operator;
    address public proceeds;
    address public royaltyReceiver;
    uint96 public royaltyBps;
    bool public paused;
    uint256 private locked = 1;

    mapping(uint256 => mapping(address => uint256)) public balanceOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(uint256 => Run) public runs;
    mapping(uint256 => string) private runUris;
    mapping(uint256 => bool) public seen;
    mapping(address => uint256) public withdrawable;
    uint256[] public runIds;

    event TransferSingle(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256 id,
        uint256 value
    );
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Listed(uint256 indexed id, uint8 curve, uint32 supply, uint96 price);
    event Bought(uint256 indexed id, address indexed buyer, uint32 qty, uint256 cost);
    event Cancelled(uint256 indexed id);
    event Withdrawn(address indexed account, uint256 amount);
    event Paused(bool paused);

    error NotOwner();
    error NotOperator();
    error BadState();
    error BadPrice();
    error BadSupply();
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

    function runCount() external view returns (uint256) {
        return runIds.length;
    }

    function runIdAt(uint256 index) external view returns (uint256) {
        return runIds[index];
    }

    function uri(uint256 id) external view returns (string memory) {
        return runUris[id];
    }

    function quote(uint256 id, uint32 qty) public view returns (uint256 cost) {
        Run memory run = runs[id];
        if (!run.listed || qty == 0 || uint256(run.sold) + qty > run.supply) revert BadState();
        if (run.curve == CURVE_FIXED) return uint256(run.price) * qty;
        for (uint32 i = 0; i < qty; i++) {
            cost += _unit(run, run.sold + i);
        }
    }

    function listFixed(uint256 id, uint32 supply, uint96 price, string calldata tokenUri)
        external
        onlyOwnerOrOperator
    {
        if (price == 0) revert BadPrice();
        _open(id, supply, tokenUri);
        runs[id] = Run({
            curve: CURVE_FIXED,
            listed: true,
            supply: supply,
            sold: 0,
            price: price,
            step: 0,
            cap: 0
        });
        emit Listed(id, CURVE_FIXED, supply, price);
    }

    function listStep(
        uint256 id,
        uint32 supply,
        uint96 startPrice,
        uint96 step,
        uint96 cap,
        string calldata tokenUri
    ) external onlyOwnerOrOperator {
        if (startPrice == 0 || step == 0) revert BadPrice();
        if (cap != 0 && cap < startPrice) revert BadPrice();
        _open(id, supply, tokenUri);
        runs[id] = Run({
            curve: CURVE_STEP,
            listed: true,
            supply: supply,
            sold: 0,
            price: startPrice,
            step: step,
            cap: cap
        });
        emit Listed(id, CURVE_STEP, supply, startPrice);
    }

    function buy(uint256 id, uint32 qty) external payable nonReentrant {
        if (paused) revert PausedSale();
        uint256 cost = quote(id, qty);
        if (msg.value < cost) revert BadPrice();
        Run storage run = runs[id];
        run.sold += qty;
        if (run.sold == run.supply) run.listed = false;
        _pay(cost);
        _credit(msg.sender, msg.value - cost);
        balanceOf[id][msg.sender] += qty;
        emit TransferSingle(msg.sender, address(0), msg.sender, id, qty);
        emit Bought(id, msg.sender, qty, cost);
        if (msg.sender.code.length > 0) {
            require(
                IERC1155Receiver(msg.sender).onERC1155Received(
                    msg.sender, address(0), id, qty, ""
                ) == IERC1155Receiver.onERC1155Received.selector,
                "receiver"
            );
        }
    }

    /// @notice Only before the first copy sells. Unsold runs can be withdrawn from the desk.
    function cancel(uint256 id) external onlyOwnerOrOperator {
        Run storage run = runs[id];
        if (!run.listed || run.sold != 0) revert BadState();
        run.listed = false;
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

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external
        view
        returns (uint256[] memory balances)
    {
        require(accounts.length == ids.length, "length");
        balances = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            balances[i] = balanceOf[ids[i]][accounts[i]];
        }
    }

    function setApprovalForAll(address spender, bool approved) external {
        isApprovedForAll[msg.sender][spender] = approved;
        emit ApprovalForAll(msg.sender, spender, approved);
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata)
        external
    {
        require(to != address(0), "to");
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "auth");
        balanceOf[id][from] -= value;
        balanceOf[id][to] += value;
        emit TransferSingle(msg.sender, from, to, id, value);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata
    ) external {
        require(to != address(0) && ids.length == values.length, "batch");
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "auth");
        for (uint256 i = 0; i < ids.length; i++) {
            balanceOf[ids[i]][from] -= values[i];
            balanceOf[ids[i]][to] += values[i];
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0xd9b67a26 || // ERC-1155
            interfaceId == 0x0e89341c || // ERC-1155 metadata URI
            interfaceId == 0x2a55205a || // ERC-2981
            interfaceId == 0x01ffc9a7;
    }

    function _open(uint256 id, uint32 supply, string calldata tokenUri) internal {
        if (supply < MIN_SUPPLY || supply > MAX_SUPPLY) revert BadSupply();
        Run storage run = runs[id];
        if (run.listed || run.sold != 0) revert BadState();
        runUris[id] = tokenUri;
        if (!seen[id]) {
            seen[id] = true;
            runIds.push(id);
        }
    }

    function _unit(Run memory run, uint32 index) internal pure returns (uint256) {
        uint256 price = uint256(run.price) + uint256(run.step) * index;
        if (run.cap != 0 && price > run.cap) return run.cap;
        return price;
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
}

interface IERC1155Receiver {
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4);
}
