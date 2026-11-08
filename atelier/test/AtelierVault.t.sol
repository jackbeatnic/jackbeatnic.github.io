// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AtelierVault.sol";

interface IERC1155Receiver {
    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data)
        external
        returns (bytes4);
}

/// @dev A large existing ERC-1155. Transfers move balance. Supply stays put.
contract Held1155 {
    uint256 public immutable totalMinted;
    mapping(uint256 => uint256) public supplyOf;
    mapping(address => mapping(uint256 => uint256)) public balanceOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    constructor(address holder, uint256 id, uint256 supply) {
        totalMinted = supply;
        supplyOf[id] = supply;
        balanceOf[holder][id] = supply;
    }

    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    function totalSupply(uint256 id) external view returns (uint256) {
        return supplyOf[id];
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data)
        external
    {
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "NOT_APPROVED");
        require(balanceOf[from][id] >= amount, "BALANCE");
        balanceOf[from][id] -= amount;
        balanceOf[to][id] += amount;
        if (to.code.length > 0) {
            require(
                IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, amount, data)
                    == IERC1155Receiver.onERC1155Received.selector,
                "RECEIVER"
            );
        }
    }
}

/// @dev One existing ERC-721. No second id is minted on transfer.
contract Held721 {
    mapping(uint256 => address) public ownerOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    uint256 public totalSupply = 1;

    constructor(address holder, uint256 id) {
        ownerOf[id] = holder;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function transferFrom(address from, address to, uint256 id) external {
        require(ownerOf[id] == from, "owner");
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "NOT_APPROVED");
        ownerOf[id] = to;
    }
}

contract AtelierVaultTest is Test {
    AtelierVault vault;
    Held1155 token;
    uint8 std1155;
    uint8 std721;
    address kasa = address(0xA11);
    address operator = address(0x0E1);
    address holder = address(0xBEE);
    address buyer = address(0xB0B);
    uint256 constant ID = 7;
    uint256 constant SUPPLY = 20_000;

    function setUp() public {
        vault = new AtelierVault(kasa, operator);
        std1155 = vault.STD_1155();
        std721 = vault.STD_721();
        token = new Held1155(holder, ID, SUPPLY);
        vm.prank(holder);
        token.setApprovalForAll(address(vault), true);
        vm.deal(buyer, 10 ether);
    }

    function testDepositOneOfLargeSupplyThenAuctionSettlesToBuyer() public {
        uint256 supplyBefore = token.totalSupply(ID);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(supplyBefore, SUPPLY);
        assertEq(token.balanceOf(holder, ID), SUPPLY);

        uint64 start = uint64(block.timestamp);
        uint64 end = start + 1 hours;
        vm.prank(kasa);
        vault.depositAuction(
            std1155, address(token), ID, 1, holder, 0.02 ether, 0.02 ether, start, end, 500, 0
        );

        assertEq(token.balanceOf(holder, ID), SUPPLY - 1);
        assertEq(token.balanceOf(address(vault), ID), 1);
        assertEq(token.totalSupply(ID), supplyBefore);
        assertEq(token.totalSupply(), SUPPLY);
        _assertOrigin(1, holder, true);

        vm.prank(holder);
        vm.expectRevert(bytes("BALANCE"));
        token.safeTransferFrom(holder, buyer, ID, SUPPLY, "");

        vm.prank(buyer);
        vault.bid{value: 0.02 ether}(1);
        vm.warp(end);
        vault.settle(1);

        assertEq(token.balanceOf(buyer, ID), 1);
        assertEq(token.balanceOf(address(vault), ID), 0);
        assertEq(token.balanceOf(holder, ID), SUPPLY - 1);
        assertEq(token.totalSupply(ID), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(vault.withdrawable(kasa), 0.02 ether);
        assertEq(vault.lotCount(), 1);
    }

    function testCancelReturnsTheUnitToTheDepositor() public {
        vm.prank(kasa);
        vault.depositFixed(std1155, address(token), ID, 1, holder, 0.02 ether, 0, 0);
        assertEq(token.balanceOf(holder, ID), SUPPLY - 1);
        assertEq(token.balanceOf(address(vault), ID), 1);

        vm.prank(kasa);
        vault.cancel(1);

        assertEq(token.balanceOf(holder, ID), SUPPLY);
        assertEq(token.balanceOf(address(vault), ID), 0);
        assertEq(token.totalSupply(ID), SUPPLY);
        _assertOrigin(1, holder, false);
    }

    function testCannotDepositWithoutApproval() public {
        Held1155 raw = new Held1155(holder, ID, SUPPLY);
        vm.prank(kasa);
        vm.expectRevert(bytes("NOT_APPROVED"));
        vault.depositFixed(std1155, address(raw), ID, 1, holder, 1 ether, 0, 0);
        assertEq(raw.balanceOf(holder, ID), SUPPLY);
        assertEq(raw.balanceOf(address(vault), ID), 0);
        assertEq(raw.totalSupply(ID), SUPPLY);
        assertEq(vault.lotCount(), 0);
    }

    function testRejectsZeroQtyAndBalanceOverdrawAndCloneId() public {
        vm.startPrank(kasa);
        vm.expectRevert(AtelierVault.BadQty.selector);
        vault.depositFixed(std1155, address(token), ID, 0, holder, 1 ether, 0, 0);

        vm.expectRevert(bytes("BALANCE"));
        vault.depositAuction(
            std1155,
            address(token),
            ID,
            SUPPLY + 1,
            holder,
            0.02 ether,
            0,
            uint64(block.timestamp),
            uint64(block.timestamp) + 1 hours,
            0,
            0
        );

        vm.expectRevert(AtelierVault.CloneId.selector);
        vault.listFixed(99, "ipfs://clone", 1 ether, 0, 0);
        vm.expectRevert(AtelierVault.CloneId.selector);
        vault.listAuction(
            99, "ipfs://clone", 1 ether, 0, uint64(block.timestamp), uint64(block.timestamp) + 1 hours, 0, 0
        );
        vm.expectRevert(AtelierVault.CloneId.selector);
        vault.depositFixed(std1155, address(vault), ID, 1, holder, 1 ether, 0, 0);
        vm.stopPrank();

        assertEq(token.balanceOf(holder, ID), SUPPLY);
        assertEq(token.balanceOf(address(vault), ID), 0);
        assertEq(token.totalSupply(ID), SUPPLY);
        assertEq(vault.lotCount(), 0);
    }

    function testReserveMissReturnsTheUnitToTheDepositor() public {
        uint64 start = uint64(block.timestamp);
        uint64 end = start + 1 hours;
        vm.prank(kasa);
        vault.depositAuction(
            std1155, address(token), ID, 1, holder, 0.02 ether, 0.05 ether, start, end, 500, 0
        );
        vm.prank(buyer);
        vault.bid{value: 0.02 ether}(1);
        vm.warp(end);
        vault.settle(1);

        assertEq(token.balanceOf(holder, ID), SUPPLY);
        assertEq(token.balanceOf(buyer, ID), 0);
        assertEq(token.balanceOf(address(vault), ID), 0);
        assertEq(token.totalSupply(ID), SUPPLY);
        assertEq(vault.withdrawable(buyer), 0.02 ether);
        assertEq(vault.withdrawable(kasa), 0);
    }

    function testErc721PullUsesTheSameTokenId() public {
        Held721 piece = new Held721(holder, 4);
        vm.prank(holder);
        piece.setApprovalForAll(address(vault), true);
        vm.prank(kasa);
        vault.depositFixed(std721, address(piece), 4, 1, holder, 1 ether, 0, 0);
        assertEq(piece.ownerOf(4), address(vault));
        assertEq(piece.totalSupply(), 1);

        vm.prank(buyer);
        vault.buy{value: 1 ether}(1);
        assertEq(piece.ownerOf(4), buyer);
        assertEq(piece.totalSupply(), 1);
    }

    function _assertOrigin(uint256 lotId, address depositor, bool listed) internal view {
        (address collection, address recordedDepositor, , uint256 tokenId, uint256 qty) =
            vault.lotAsset(lotId);
        (uint8 kind, uint8 standard, bool sold, bool isListed, , , , , , , ) = vault.lotSale(lotId);
        assertEq(collection, address(token));
        assertEq(tokenId, ID);
        assertEq(qty, 1);
        assertEq(recordedDepositor, depositor);
        assertEq(standard, std1155);
        assertTrue(kind == vault.KIND_FIXED() || kind == vault.KIND_AUCTION());
        assertFalse(sold);
        assertEq(isListed, listed);
    }

    function testWindowEndReturnsTheUnit() public {
        uint64 start = uint64(block.timestamp);
        uint64 end = start + 1 hours;
        vm.prank(kasa);
        vault.depositFixed(std1155, address(token), ID, 1, holder, 0.02 ether, start, end);
        vm.warp(end + 1);
        vault.reclaim(1);
        assertEq(token.balanceOf(holder, ID), SUPPLY);
        assertEq(token.balanceOf(address(vault), ID), 0);
        assertEq(token.totalSupply(ID), SUPPLY);
    }

    function testOriginalRoyaltyIsPaidFromTheSale() public {
        Royalty1155 royaltyToken = new Royalty1155(holder, ID, SUPPLY, address(0xFEE), 500);
        vm.prank(holder);
        royaltyToken.setApprovalForAll(address(vault), true);
        vm.prank(kasa);
        vault.depositFixed(std1155, address(royaltyToken), ID, 1, holder, 1 ether, 0, 0);
        vm.prank(buyer);
        vault.buy{value: 1 ether}(1);
        assertEq(vault.withdrawable(address(0xFEE)), 0.05 ether);
        assertEq(vault.withdrawable(kasa), 0.95 ether);
        assertEq(royaltyToken.totalSupply(ID), SUPPLY);
        assertEq(royaltyToken.balanceOf(buyer, ID), 1);
    }

    function testOperatorDepositsOneUnitSupplyUnchangedAndSaleCreditsOwner() public {
        Royalty1155 royaltyToken = new Royalty1155(holder, ID, SUPPLY, address(0xFEE), 500);
        vm.prank(holder);
        royaltyToken.setApprovalForAll(address(vault), true);
        uint256 supplyBefore = royaltyToken.totalSupply(ID);
        assertEq(royaltyToken.totalSupply(), SUPPLY);

        assertEq(vault.operator(), operator);
        assertEq(vault.owner(), kasa);
        assertEq(vault.proceeds(), kasa);
        assertTrue(vault.owner() != address(this));

        vm.prank(operator);
        vault.depositFixed(std1155, address(royaltyToken), ID, 1, holder, 1 ether, 0, 0);

        assertEq(royaltyToken.totalSupply(ID), supplyBefore);
        assertEq(royaltyToken.totalSupply(), SUPPLY);
        assertEq(royaltyToken.balanceOf(holder, ID), SUPPLY - 1);
        assertEq(royaltyToken.balanceOf(address(vault), ID), 1);
        assertEq(royaltyToken.balanceOf(operator, ID), 0);
        assertEq(royaltyToken.balanceOf(kasa, ID), 0);

        vm.prank(buyer);
        vault.buy{value: 1 ether}(1);
        assertEq(vault.withdrawable(kasa), 0.95 ether);
        assertEq(vault.withdrawable(address(0xFEE)), 0.05 ether);
        assertEq(vault.withdrawable(operator), 0);
        assertEq(royaltyToken.balanceOf(buyer, ID), 1);
        assertEq(royaltyToken.totalSupply(ID), SUPPLY);
    }

    function testStrangerCannotDeposit() public {
        vm.prank(buyer);
        vm.expectRevert(AtelierVault.NotOperator.selector);
        vault.depositFixed(std1155, address(token), ID, 1, holder, 1 ether, 0, 0);
        vm.prank(buyer);
        vm.expectRevert(AtelierVault.NotOperator.selector);
        vault.depositAuction(
            std1155,
            address(token),
            ID,
            1,
            holder,
            0.02 ether,
            0,
            uint64(block.timestamp),
            uint64(block.timestamp) + 1 hours,
            500,
            0
        );
        assertEq(token.balanceOf(holder, ID), SUPPLY);
        assertEq(token.totalSupply(ID), SUPPLY);
        assertEq(vault.lotCount(), 0);
    }

    function testOperatorCannotGovernVault() public {
        vm.startPrank(operator);
        vm.expectRevert(AtelierVault.NotOwner.selector);
        vault.setProceeds(operator);
        vm.expectRevert(AtelierVault.NotOwner.selector);
        vault.setFallbackRoyalty(operator, 100);
        vm.expectRevert(AtelierVault.NotOwner.selector);
        vault.transferOwnership(operator);
        vm.expectRevert(AtelierVault.NotOwner.selector);
        vault.setOperator(buyer);
        vm.expectRevert(AtelierVault.NotOwner.selector);
        vault.setPaused(true);
        vm.stopPrank();
        assertEq(vault.owner(), kasa);
        assertEq(vault.proceeds(), kasa);
        assertEq(vault.fallbackRoyaltyReceiver(), address(0));
        assertEq(vault.fallbackRoyaltyBps(), 0);
        assertEq(vault.operator(), operator);
        assertFalse(vault.paused());
    }

    function testConstructorRejectsZeroOwnerAndOperator() public {
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "owner"));
        new AtelierVault(address(0), operator);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "operator"));
        new AtelierVault(kasa, address(0));

        address deployer = address(0xD00);
        vm.prank(deployer);
        AtelierVault deployed = new AtelierVault(kasa, operator);
        assertEq(deployed.owner(), kasa);
        assertEq(deployed.proceeds(), kasa);
        assertEq(deployed.operator(), operator);
        assertEq(deployed.fallbackRoyaltyReceiver(), address(0));
        assertEq(deployed.fallbackRoyaltyBps(), 0);
        assertTrue(deployed.owner() != deployer);

        vm.prank(kasa);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "operator"));
        vault.setOperator(address(0));
        vm.prank(buyer);
        vm.expectRevert(AtelierVault.NotOperator.selector);
        vault.depositFixed(std1155, address(token), ID, 1, holder, 1 ether, 0, 0);
    }

    function testOperatorCancelReturnsTheUnitToTheDepositor() public {
        uint64 start = uint64(block.timestamp);
        vm.prank(operator);
        vault.depositAuction(
            std1155, address(token), ID, 1, holder, 0.02 ether, 0.02 ether, start, start + 1 hours, 500, 0
        );
        vm.prank(operator);
        vault.cancel(1);
        assertEq(token.balanceOf(holder, ID), SUPPLY);
        assertEq(token.balanceOf(address(vault), ID), 0);
        assertEq(token.balanceOf(operator, ID), 0);
        assertEq(token.balanceOf(kasa, ID), 0);
        assertEq(token.totalSupply(ID), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
    }
}

contract Royalty1155 is Held1155 {
    address public royaltyReceiver;
    uint256 public royaltyBps;

    constructor(address holder, uint256 id, uint256 supply, address receiver, uint256 bps)
        Held1155(holder, id, supply)
    {
        royaltyReceiver = receiver;
        royaltyBps = bps;
    }

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        return (royaltyReceiver, (salePrice * royaltyBps) / 10000);
    }
}
