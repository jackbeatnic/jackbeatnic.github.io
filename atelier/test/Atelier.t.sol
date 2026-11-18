// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AtelierOne.sol";
import "../src/AtelierEdition.sol";

contract AtelierOneTest is Test {
    AtelierOne desk;
    address artist = address(0xA11);
    address operator = address(0x0E1);
    address buyer = address(0xB0B);
    address bidder = address(0xC0C);
    address other = address(0xD0D);

    function setUp() public {
        desk = new AtelierOne(artist, operator);
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
        vm.expectRevert(AtelierOne.NotOperator.selector);
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

    function testRoyaltyIsTakenFromThePrice() public {
        address receiver = address(0xFEE);
        vm.startPrank(artist);
        desk.setRoyalty(receiver, 500);
        desk.listFixed(12, "ipfs://x", 1 ether, 0, 0);
        vm.stopPrank();
        vm.prank(buyer);
        desk.buy{value: 1 ether}(12);
        assertEq(desk.withdrawable(receiver), 0.05 ether);
        assertEq(desk.withdrawable(artist), 0.95 ether);
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

    function testOwnerSetsOperatorAndOperatorListsSaleToProceeds() public {
        address next = address(0x0E2);
        address receiver = address(0xFEE);
        assertEq(desk.operator(), operator);
        assertEq(desk.owner(), artist);
        assertEq(desk.proceeds(), artist);
        assertTrue(desk.owner() != address(this));

        vm.prank(artist);
        desk.setOperator(next);
        assertEq(desk.operator(), next);

        vm.prank(artist);
        desk.setRoyalty(receiver, 500);
        vm.prank(next);
        desk.listFixed(21, "ipfs://op", 1 ether, 0, 0);
        vm.prank(buyer);
        desk.buy{value: 1 ether}(21);

        assertEq(desk.ownerOf(21), buyer);
        assertEq(desk.withdrawable(artist), 0.95 ether);
        assertEq(desk.withdrawable(receiver), 0.05 ether);
        assertEq(desk.withdrawable(operator), 0);
        assertEq(desk.withdrawable(next), 0);
    }

    function testOperatorCanListAuctionAndCancelWithNoBid() public {
        uint64 start = uint64(block.timestamp);
        vm.prank(operator);
        desk.listAuction(22, "ipfs://a", 1 ether, 0, start, start + 1 hours, 500, 0);
        vm.prank(operator);
        desk.cancel(22);
        assertEq(desk.ownerOf(22), artist);
        assertEq(desk.withdrawable(operator), 0);
    }

    function testOperatorCannotGovernOne() public {
        vm.startPrank(operator);
        vm.expectRevert(AtelierOne.NotOwner.selector);
        desk.setProceeds(operator);
        vm.expectRevert(AtelierOne.NotOwner.selector);
        desk.setRoyalty(operator, 100);
        vm.expectRevert(AtelierOne.NotOwner.selector);
        desk.transferOwnership(operator);
        vm.expectRevert(AtelierOne.NotOwner.selector);
        desk.setOperator(buyer);
        vm.expectRevert(AtelierOne.NotOwner.selector);
        desk.setPaused(true);
        vm.stopPrank();
        assertEq(desk.proceeds(), artist);
        assertEq(desk.royaltyReceiver(), artist);
        assertEq(desk.royaltyBps(), 0);
        assertEq(desk.owner(), artist);
        assertEq(desk.operator(), operator);
        assertFalse(desk.paused());
    }

    function testConstructorRejectsZeroOwnerAndOperator() public {
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "owner"));
        new AtelierOne(address(0), operator);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "operator"));
        new AtelierOne(artist, address(0));

        address deployer = address(0xD00);
        vm.prank(deployer);
        AtelierOne deployed = new AtelierOne(artist, operator);
        assertEq(deployed.owner(), artist);
        assertEq(deployed.proceeds(), artist);
        assertEq(deployed.operator(), operator);
        assertEq(deployed.royaltyReceiver(), artist);
        assertEq(deployed.royaltyBps(), 0);
        assertTrue(deployed.owner() != deployer);

        vm.prank(artist);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "operator"));
        desk.setOperator(address(0));
        vm.prank(buyer);
        vm.expectRevert(AtelierOne.NotOperator.selector);
        desk.listFixed(23, "ipfs://x", 1 ether, 0, 0);
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
    address operator = address(0x0E1);
    address buyer = address(0xB0B);

    function setUp() public {
        desk = new AtelierEdition(artist, operator);
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

    function testEditionRoyaltyIsTakenFromThePrice() public {
        address receiver = address(0xFEE);
        vm.startPrank(artist);
        desk.setRoyalty(receiver, 500);
        desk.listFixed(6, 10, 1 ether, "ipfs://e");
        vm.stopPrank();
        vm.prank(buyer);
        desk.buy{value: 1 ether}(6, 1);
        assertEq(desk.withdrawable(receiver), 0.05 ether);
        assertEq(desk.withdrawable(artist), 0.95 ether);
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

    function testOwnerSetsOperatorAndOperatorListsEditionToProceeds() public {
        address next = address(0x0E2);
        address receiver = address(0xFEE);
        vm.prank(artist);
        desk.setOperator(next);
        vm.prank(artist);
        desk.setRoyalty(receiver, 500);
        assertEq(desk.operator(), next);
        assertEq(desk.proceeds(), artist);
        assertEq(desk.owner(), artist);
        assertTrue(desk.owner() != address(this));

        vm.prank(next);
        desk.listFixed(8, 10, 1 ether, "ipfs://e");
        vm.prank(buyer);
        desk.buy{value: 1 ether}(8, 1);

        assertEq(desk.balanceOf(8, buyer), 1);
        assertEq(desk.withdrawable(artist), 0.95 ether);
        assertEq(desk.withdrawable(receiver), 0.05 ether);
        assertEq(desk.withdrawable(operator), 0);
        assertEq(desk.withdrawable(next), 0);
    }

    function testOperatorCanListStepAndCancelBeforeFirstSale() public {
        vm.prank(operator);
        desk.listStep(9, 10, 1 ether, 0.1 ether, 0, "ipfs://e");
        vm.prank(operator);
        desk.cancel(9);
        (uint8 curve, bool listed, , uint32 sold, , , ) = desk.runs(9);
        assertEq(curve, desk.CURVE_STEP());
        assertFalse(listed);
        assertEq(sold, 0);
    }

    function testStrangerCannotListEdition() public {
        vm.prank(buyer);
        vm.expectRevert(AtelierEdition.NotOperator.selector);
        desk.listFixed(11, 10, 1 ether, "ipfs://e");
        vm.prank(buyer);
        vm.expectRevert(AtelierEdition.NotOperator.selector);
        desk.listStep(12, 10, 1 ether, 0.1 ether, 0, "ipfs://e");
    }

    function testConstructorRejectsZeroOwnerAndOperator() public {
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "owner"));
        new AtelierEdition(address(0), operator);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "operator"));
        new AtelierEdition(artist, address(0));

        address deployer = address(0xD00);
        vm.prank(deployer);
        AtelierEdition deployed = new AtelierEdition(artist, operator);
        assertEq(deployed.owner(), artist);
        assertEq(deployed.proceeds(), artist);
        assertEq(deployed.operator(), operator);
        assertEq(deployed.royaltyReceiver(), artist);
        assertEq(deployed.royaltyBps(), 0);
        assertTrue(deployed.owner() != deployer);

        vm.prank(artist);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "operator"));
        desk.setOperator(address(0));
        vm.prank(buyer);
        vm.expectRevert(AtelierEdition.NotOperator.selector);
        desk.listFixed(13, 10, 1 ether, "ipfs://e");
    }

    function testOperatorCannotGovernEdition() public {
        vm.startPrank(operator);
        vm.expectRevert(AtelierEdition.NotOwner.selector);
        desk.setProceeds(operator);
        vm.expectRevert(AtelierEdition.NotOwner.selector);
        desk.setRoyalty(operator, 100);
        vm.expectRevert(AtelierEdition.NotOwner.selector);
        desk.transferOwnership(operator);
        vm.expectRevert(AtelierEdition.NotOwner.selector);
        desk.setOperator(buyer);
        vm.expectRevert(AtelierEdition.NotOwner.selector);
        desk.setPaused(true);
        vm.stopPrank();
        assertEq(desk.owner(), artist);
        assertEq(desk.proceeds(), artist);
        assertEq(desk.royaltyReceiver(), artist);
        assertEq(desk.royaltyBps(), 0);
        assertEq(desk.operator(), operator);
        assertFalse(desk.paused());
    }
}
