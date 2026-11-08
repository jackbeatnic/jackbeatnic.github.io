// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AtelierOne.sol";
import "../src/AtelierEdition.sol";

contract AtelierOneTest is Test {
    AtelierOne desk;
    address artist = address(0xA11);
    address buyer = address(0xB0B);
    address bidder = address(0xC0C);
    address other = address(0xD0D);

    function setUp() public {
        vm.prank(artist);
        desk = new AtelierOne();
        vm.deal(buyer, 100 ether);
        vm.deal(bidder, 100 ether);
        vm.deal(other, 100 ether);
    }

    function testFixedBuyCreditsProceedsAndRefundsExtra() public {
        vm.prank(artist);
        desk.listFixed(7, "ipfs://one", 1 ether, 0, 0);
        vm.prank(buyer);
        desk.buy{value: 1.4 ether}(7);
        assertEq(desk.ownerOf(7), buyer);
        assertEq(desk.withdrawable(artist), 1 ether);
        assertEq(desk.withdrawable(buyer), 0.4 ether);
        vm.prank(artist);
        desk.withdraw();
        assertEq(artist.balance, 1 ether);
    }

    function testStrangerCannotList() public {
        vm.prank(buyer);
        vm.expectRevert(AtelierOne.NotOwner.selector);
        desk.listFixed(1, "ipfs://x", 1 ether, 0, 0);
    }

    function testCannotBuyTwice() public {
        vm.prank(artist);
        desk.listFixed(1, "ipfs://x", 1 ether, 0, 0);
        vm.prank(buyer);
        desk.buy{value: 1 ether}(1);
        vm.prank(other);
        vm.expectRevert(AtelierOne.BadState.selector);
        desk.buy{value: 1 ether}(1);
    }

    function testAuctionReserveMissRefundsAndReturnsWork() public {
        uint64 start = uint64(block.timestamp);
        uint64 end = start + 1 hours;
        vm.prank(artist);
        desk.listAuction(3, "ipfs://a", 1 ether, 2 ether, start, end, 500, 0);
        vm.prank(bidder);
        desk.bid{value: 1 ether}(3);
        vm.warp(end);
        desk.settle(3);
        assertEq(desk.ownerOf(3), artist);
        assertEq(desk.withdrawable(bidder), 1 ether);
        assertEq(desk.withdrawable(artist), 0);
    }

    function testAuctionWinPaysProceeds() public {
        uint64 start = uint64(block.timestamp);
        uint64 end = start + 1 hours;
        vm.prank(artist);
        desk.listAuction(4, "ipfs://a", 1 ether, 2 ether, start, end, 500, 0);
        vm.prank(bidder);
        desk.bid{value: 2 ether}(4);
        vm.prank(other);
        desk.bid{value: 2.1 ether}(4);
        vm.warp(end);
        desk.settle(4);
        assertEq(desk.ownerOf(4), other);
        assertEq(desk.withdrawable(bidder), 2 ether);
        assertEq(desk.withdrawable(artist), 2.1 ether);
    }

    function testLowBidReverts() public {
        uint64 start = uint64(block.timestamp);
        vm.prank(artist);
        desk.listAuction(5, "ipfs://a", 1 ether, 0, start, start + 1 hours, 1000, 0);
        vm.prank(bidder);
        desk.bid{value: 1 ether}(5);
        vm.prank(other);
        vm.expectRevert(AtelierOne.BadPrice.selector);
        desk.bid{value: 1.05 ether}(5);
    }

    function testExtensionMovesTheEnd() public {
        uint64 start = uint64(block.timestamp);
        uint64 end = start + 1 hours;
        vm.prank(artist);
        desk.listAuction(6, "ipfs://a", 1 ether, 0, start, end, 0, 10 minutes);
        vm.warp(end - 1 minutes);
        vm.prank(bidder);
        desk.bid{value: 1 ether}(6);
        (, , , , , , uint64 pieceEnd, , , , , ) = _piece(6);
        assertEq(pieceEnd, uint64(block.timestamp) + 10 minutes);
    }

    function testCancelAuctionWithBidReverts() public {
        uint64 start = uint64(block.timestamp);
        vm.prank(artist);
        desk.listAuction(8, "ipfs://a", 1 ether, 0, start, start + 1 hours, 0, 0);
        vm.prank(bidder);
        desk.bid{value: 1 ether}(8);
        vm.prank(artist);
        vm.expectRevert(AtelierOne.BadState.selector);
        desk.cancel(8);
    }

    function testCancelFixedReturnsTheWork() public {
        vm.prank(artist);
        desk.listFixed(9, "ipfs://x", 1 ether, 0, 0);
        vm.prank(artist);
        desk.cancel(9);
        assertEq(desk.ownerOf(9), artist);
    }

    function testPauseBlocksBuyAndWithdrawStillWorks() public {
        vm.prank(artist);
        desk.listFixed(10, "ipfs://x", 1 ether, 0, 0);
        vm.prank(buyer);
        desk.buy{value: 1 ether}(10);
        vm.prank(artist);
        desk.setPaused(true);
        vm.prank(artist);
        desk.listFixed(11, "ipfs://y", 1 ether, 0, 0);
        vm.prank(other);
        vm.expectRevert(AtelierOne.PausedSale.selector);
        desk.buy{value: 1 ether}(11);
        vm.prank(artist);
        desk.withdraw();
        assertEq(artist.balance, 1 ether);
    }

    function _piece(uint256 id)
        internal
        view
        returns (
            uint8,
            bool,
            bool,
            uint16,
            uint32,
            uint64,
            uint64,
            uint64,
            uint96,
            uint96,
            uint96,
            address
        )
    {
        return desk.pieces(id);
    }
}

contract AtelierEditionTest is Test {
    AtelierEdition desk;
    address artist = address(0xA11);
    address buyer = address(0xB0B);

    function setUp() public {
        vm.prank(artist);
        desk = new AtelierEdition();
        vm.deal(buyer, 1000 ether);
    }

    function testSupplyBounds() public {
        vm.startPrank(artist);
        vm.expectRevert(AtelierEdition.BadSupply.selector);
        desk.listFixed(1, 9, 1 ether, "ipfs://e");
        vm.expectRevert(AtelierEdition.BadSupply.selector);
        desk.listFixed(1, 1001, 1 ether, "ipfs://e");
        desk.listFixed(1, 10, 1 ether, "ipfs://e");
        desk.listFixed(2, 1000, 1 ether, "ipfs://e");
        vm.stopPrank();
    }

    function testFixedRunChargesTheSamePriceUntilGone() public {
        vm.prank(artist);
        desk.listFixed(1, 10, 2 ether, "ipfs://e");
        vm.prank(buyer);
        desk.buy{value: 4 ether}(1, 2);
        assertEq(desk.balanceOf(1, buyer), 2);
        assertEq(desk.withdrawable(artist), 4 ether);
        assertEq(desk.quote(1, 1), 2 ether);
    }

    function testStepRaisesTheNextPriceAndHonoursCap() public {
        vm.prank(artist);
        desk.listStep(3, 10, 100, 10, 120, "ipfs://e");
        assertEq(desk.quote(3, 1), 100);
        assertEq(desk.quote(3, 3), 100 + 110 + 120);
        vm.prank(buyer);
        desk.buy{value: 210}(3, 2);
        assertEq(desk.quote(3, 2), 120 + 120);
    }

    function testCannotBuyPastTheRun() public {
        vm.prank(artist);
        desk.listFixed(4, 10, 1 ether, "ipfs://e");
        vm.prank(buyer);
        vm.expectRevert(AtelierEdition.BadState.selector);
        desk.buy{value: 11 ether}(4, 11);
    }

    function testCancelOnlyBeforeTheFirstSale() public {
        vm.prank(artist);
        desk.listFixed(5, 10, 1 ether, "ipfs://e");
        vm.prank(buyer);
        desk.buy{value: 1 ether}(5, 1);
        vm.prank(artist);
        vm.expectRevert(AtelierEdition.BadState.selector);
        desk.cancel(5);
    }
}
