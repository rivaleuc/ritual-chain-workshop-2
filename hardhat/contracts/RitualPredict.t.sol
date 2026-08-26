// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {RitualPredict} from "./RitualPredict.sol";
import {RitualChain} from "./ritual/RitualChain.sol";
import {
    MockScheduler,
    MockRitualWallet,
    MockTEERegistry,
    MockHttpPrecompile,
    MockJqPrecompile
} from "./mocks/RitualMocks.sol";

/**
 * Unit tests for RitualPredict.
 *
 * The mocks are `vm.etch`ed at the canonical Ritual addresses, so the contract under
 * test is byte-for-byte the one that gets deployed: it still reaches for 0x0801,
 * 0x0803, the Scheduler and the RitualWallet by their real addresses. No network
 * access and no funded account are needed.
 */
contract RitualPredictTest is Test {
    uint256 constant BLOCK_TIME_MS = 195;

    /// 60s of betting at 195ms/block.
    uint64 constant BETTING_BLOCKS = 307;
    /// 30s of resolve delay at 195ms/block.
    uint64 constant RESOLVE_BLOCKS = 153;

    RitualPredict predict;

    MockScheduler scheduler = MockScheduler(RitualChain.SCHEDULER);
    MockRitualWallet wallet = MockRitualWallet(RitualChain.RITUAL_WALLET);
    MockTEERegistry registry = MockTEERegistry(RitualChain.TEE_SERVICE_REGISTRY);
    MockHttpPrecompile http = MockHttpPrecompile(RitualChain.HTTP_PRECOMPILE);
    MockJqPrecompile jq = MockJqPrecompile(RitualChain.JQ_PRECOMPILE);

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address executorA = makeAddr("executorA");
    address executorB = makeAddr("executorB");

    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        string question,
        uint64 closeBlock,
        uint64 resolveBlock,
        uint256 scheduleId
    );
    event ResolutionRuleSet(
        uint256 indexed marketId,
        string oracleUrl,
        string jsonPath,
        uint256 target,
        RitualPredict.Comparator comparator
    );
    event MarketResolved(
        uint256 indexed marketId,
        RitualPredict.Outcome outcome,
        uint256 observedValue
    );
    event MarketInvalidated(uint256 indexed marketId, string reason);
    event ResolutionFailed(uint256 indexed marketId, uint8 attempt, string reason);
    event ResolutionAttempted(uint256 indexed marketId, uint8 attempt, address executor);
    event WinningsClaimed(uint256 indexed marketId, address indexed claimant, uint256 amount);
    event StakeRefunded(uint256 indexed marketId, address indexed claimant, uint256 amount);

    function setUp() public {
        // blockhash(block.number - 1) must be reachable.
        vm.roll(1_000);

        vm.etch(RitualChain.SCHEDULER, address(new MockScheduler()).code);
        vm.etch(RitualChain.RITUAL_WALLET, address(new MockRitualWallet()).code);
        vm.etch(RitualChain.TEE_SERVICE_REGISTRY, address(new MockTEERegistry()).code);
        vm.etch(RitualChain.HTTP_PRECOMPILE, address(new MockHttpPrecompile()).code);
        vm.etch(RitualChain.JQ_PRECOMPILE, address(new MockJqPrecompile()).code);

        address[] memory executors = new address[](1);
        executors[0] = executorA;
        registry.setExecutors(executors);

        // Healthy oracle by default: 200 with a JSON body, jq yields 4200.
        http.setOk(200, bytes('{"price":4200}'));
        jq.setValue(4200);

        predict = new RitualPredict(BLOCK_TIME_MS);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    // ───────────────────────────── helpers ──────────────────────────────

    function _params() internal pure returns (RitualPredict.NewMarket memory) {
        return
            RitualPredict.NewMarket({
                question: "Will ETH/USD be at least $4,000 when this market resolves?",
                oracleUrl: "https://oracle.example/api/eth",
                jsonPath: ".price",
                target: 4_000,
                comparator: RitualPredict.Comparator.GTE,
                bettingSeconds: 60,
                resolveDelaySeconds: 30
            });
    }

    function _create() internal returns (uint256) {
        return predict.createMarket(_params());
    }

    function _createWith(
        uint256 target,
        RitualPredict.Comparator comparator
    ) internal returns (uint256) {
        RitualPredict.NewMarket memory p = _params();
        p.target = target;
        p.comparator = comparator;
        return predict.createMarket(p);
    }

    function _bet(address who, uint256 id, bool isYes, uint256 amount) internal {
        vm.prank(who);
        predict.bet{value: amount}(id, isYes);
    }

    /// Fire one scheduled execution the way the Scheduler would.
    function _fire(uint256 id, uint256 executionIndex) internal {
        vm.prank(RitualChain.SCHEDULER);
        predict.onScheduledResolve(executionIndex, id);
    }

    function _rollPastResolve(uint256 id) internal {
        vm.roll(predict.getMarket(id).resolveBlock);
    }

    // ─────────────────────────── createMarket ───────────────────────────

    function test_CreateMarket_StoresTheRuleAndOpensBetting() public {
        uint256 start = block.number;
        uint256 id = _create();

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(m.id, 1);
        assertEq(m.creator, address(this));
        assertEq(m.oracleUrl, "https://oracle.example/api/eth");
        assertEq(m.jsonPath, ".price");
        assertEq(m.target, 4_000);
        assertEq(uint8(m.comparator), uint8(RitualPredict.Comparator.GTE));
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Open));
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Unresolved));
        assertEq(m.attempts, 0);
        assertEq(predict.marketCount(), 1);

        // Durations are converted to block counts at blockTimeMs, not timestamps.
        assertEq(m.closeBlock, uint64(start) + BETTING_BLOCKS);
        assertEq(m.resolveBlock, uint64(start) + BETTING_BLOCKS + RESOLVE_BLOCKS);
    }

    function test_CreateMarket_BooksThreeAttemptsInOneScheduleCall() public {
        uint256 id = _create();
        RitualPredict.Market memory m = predict.getMarket(id);

        assertEq(scheduler.callCount(), 1, "exactly one schedule() call");
        MockScheduler.Booking memory b = scheduler.booking(m.scheduleId);

        assertEq(b.startBlock, m.resolveBlock, "attempt 1 lands at resolveBlock");
        assertEq(b.numCalls, predict.MAX_ATTEMPTS());
        assertEq(b.frequency, predict.RETRY_INTERVAL_BLOCKS());
        assertEq(b.ttl, predict.SCHEDULER_TTL_BLOCKS());
        assertEq(b.gas, predict.RESOLVE_GAS_LIMIT());
        assertEq(b.value, 0);
        assertEq(b.payer, address(predict), "the contract's own balance pays");
        assertTrue(b.maxFeePerGas >= predict.MIN_MAX_FEE_PER_GAS());

        // frequency * numCalls must stay under the Scheduler's MAX_LIFESPAN.
        assertLt(uint256(b.frequency) * b.numCalls, 10_000);
    }

    function test_CreateMarket_EncodesCallbackWithZeroExecutionIndexPlaceholder() public {
        uint256 id = _create();
        MockScheduler.Booking memory b = scheduler.booking(
            predict.getMarket(id).scheduleId
        );

        // The Scheduler overwrites bytes 4-35 with the real index at execution time.
        assertEq(
            b.data,
            abi.encodeCall(RitualPredict.onScheduledResolve, (0, id))
        );
    }

    function test_CreateMarket_ApprovesTheSchedulerAtConstruction() public view {
        assertTrue(scheduler.approved(RitualChain.SCHEDULER));
    }

    function test_CreateMarket_EmitsCreationAndRuleSeparately() public {
        uint256 start = block.number;

        vm.expectEmit(true, true, false, true);
        emit MarketCreated(
            1,
            address(this),
            "Will ETH/USD be at least $4,000 when this market resolves?",
            uint64(start) + BETTING_BLOCKS,
            uint64(start) + BETTING_BLOCKS + RESOLVE_BLOCKS,
            1
        );
        vm.expectEmit(true, false, false, true);
        emit ResolutionRuleSet(
            1,
            "https://oracle.example/api/eth",
            ".price",
            4_000,
            RitualPredict.Comparator.GTE
        );

        _create();
    }

    function test_CreateMarket_AssignsSequentialIds() public {
        assertEq(_create(), 1);
        assertEq(_create(), 2);
        assertEq(_create(), 3);
        assertEq(predict.marketCount(), 3);
    }

    function test_CreateMarket_RevertsOnEmptyQuestion() public {
        RitualPredict.NewMarket memory p = _params();
        p.question = "";
        vm.expectRevert(RitualPredict.EmptyString.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsOnEmptyOracleUrl() public {
        RitualPredict.NewMarket memory p = _params();
        p.oracleUrl = "";
        vm.expectRevert(RitualPredict.EmptyString.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsOnEmptyJsonPath() public {
        RitualPredict.NewMarket memory p = _params();
        p.jsonPath = "";
        vm.expectRevert(RitualPredict.EmptyString.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsOnTooShortBettingWindow() public {
        RitualPredict.NewMarket memory p = _params();
        p.bettingSeconds = predict.MIN_BETTING_SECONDS() - 1;
        vm.expectRevert(RitualPredict.BadDuration.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsOnTooShortResolveDelay() public {
        RitualPredict.NewMarket memory p = _params();
        p.resolveDelaySeconds = predict.MIN_RESOLVE_DELAY_SECONDS() - 1;
        vm.expectRevert(RitualPredict.BadDuration.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsWhenTotalExceedsMaxMarketSeconds() public {
        RitualPredict.NewMarket memory p = _params();
        p.bettingSeconds = predict.MAX_MARKET_SECONDS();
        p.resolveDelaySeconds = predict.MIN_RESOLVE_DELAY_SECONDS();
        vm.expectRevert(RitualPredict.BadDuration.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsWhenSchedulingFails() public {
        scheduler.setScheduleReverts(true);
        vm.expectRevert(bytes("scheduler down"));
        predict.createMarket(_params());

        // Nothing half-created survives the revert.
        assertEq(predict.marketCount(), 0);
    }

    function test_Constructor_RejectsZeroBlockTime() public {
        vm.expectRevert(RitualPredict.BadDuration.selector);
        new RitualPredict(0);
    }

    // ─────────────────────────────── bet ────────────────────────────────

    function test_Bet_AccumulatesPerSideAndPerAccount() public {
        uint256 id = _create();
        _bet(alice, id, true, 3 ether);
        _bet(carol, id, true, 1 ether);
        _bet(bob, id, false, 2 ether);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(m.totalYes, 4 ether);
        assertEq(m.totalNo, 2 ether);
        assertEq(predict.yesStake(id, alice), 3 ether);
        assertEq(predict.yesStake(id, carol), 1 ether);
        assertEq(predict.noStake(id, bob), 2 ether);
        assertEq(address(predict).balance, 6 ether);
    }

    function test_Bet_RevertsOnZeroStake() public {
        uint256 id = _create();
        vm.prank(alice);
        vm.expectRevert(RitualPredict.ZeroStake.selector);
        predict.bet{value: 0}(id, true);
    }

    function test_Bet_RevertsAtCloseBlock() public {
        uint256 id = _create();
        vm.roll(predict.getMarket(id).closeBlock);

        vm.prank(alice);
        vm.expectRevert(RitualPredict.BettingClosed.selector);
        predict.bet{value: 1 ether}(id, true);
    }

    function test_Bet_RevertsOnUnknownMarket() public {
        vm.prank(alice);
        vm.expectRevert(RitualPredict.UnknownMarket.selector);
        predict.bet{value: 1 ether}(42, true);
    }

    function test_GetMarket_ReportsClosedOnceTheWindowPasses() public {
        uint256 id = _create();
        assertEq(uint8(predict.getMarket(id).state), uint8(RitualPredict.MarketState.Open));

        vm.roll(predict.getMarket(id).closeBlock);
        assertEq(uint8(predict.getMarket(id).state), uint8(RitualPredict.MarketState.Closed));
    }

    function test_GetMarkets_ReturnsNewestFirst() public {
        _create();
        _create();
        RitualPredict.Market[] memory all = predict.getMarkets();
        assertEq(all.length, 2);
        assertEq(all[0].id, 2);
        assertEq(all[1].id, 1);
    }

    // ──────────────────────── resolution: happy path ────────────────────

    function test_Resolve_OnlyTheSchedulerMayCallBack() public {
        uint256 id = _create();
        _rollPastResolve(id);

        vm.prank(alice);
        vm.expectRevert(RitualPredict.OnlyScheduler.selector);
        predict.onScheduledResolve(0, id);
    }

    function test_Resolve_YesWhenObservedSatisfiesTheComparator() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);

        vm.expectEmit(true, false, false, true);
        emit MarketResolved(id, RitualPredict.Outcome.Yes, 4_200);
        _fire(id, 0);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolved));
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Yes));
        assertEq(m.observedValue, 4_200);
        assertEq(m.attempts, 1);
    }

    function test_Resolve_NoWhenObservedFailsTheComparator() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _bet(bob, id, false, 1 ether);
        jq.setValue(3_500);
        _rollPastResolve(id);

        _fire(id, 0);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.No));
        assertEq(m.observedValue, 3_500);
    }

    function test_Resolve_SendsTheMarketRuleToTheHttpPrecompile() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _rollPastResolve(id);
        _fire(id, 0);

        assertEq(http.callCount(), 1);
        assertEq(http.lastUrl(), "https://oracle.example/api/eth");
        assertEq(http.lastMethod(), RitualChain.HTTP_GET);
        assertEq(http.lastTtl(), predict.HTTP_TTL_BLOCKS());
        assertEq(http.lastExecutor(), executorA, "executor comes from the registry");
    }

    function test_Resolve_CancelsTheRemainingBookedAttempts() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        uint256 scheduleId = predict.getMarket(id).scheduleId;
        _rollPastResolve(id);

        assertEq(scheduler.getCallState(scheduleId), 1, "active before");
        _fire(id, 0);
        assertEq(scheduler.getCallState(scheduleId), 2, "cancelled after");
    }

    function test_Resolve_SurvivesAFailingCancel() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _rollPastResolve(id);
        scheduler.setCancelReverts(true);

        _fire(id, 0);

        assertEq(
            uint8(predict.getMarket(id).state),
            uint8(RitualPredict.MarketState.Resolved)
        );
    }

    function test_Resolve_IsIdempotentForLeftoverExecutions() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _rollPastResolve(id);
        _fire(id, 0);

        // A stale execution lands after settlement: no revert, no state change.
        jq.setValue(1); // would flip the outcome if it were re-read
        _fire(id, 1);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Yes));
        assertEq(m.observedValue, 4_200);
        assertEq(m.attempts, 1, "a leftover execution does not burn an attempt");
        assertEq(http.callCount(), 1, "and does not re-read the oracle");
    }

    function test_Resolve_UnknownMarketDoesNotRevert() public {
        _fire(999, 0);
    }

    // ──────────────── resolution: a failed read is never a NO ───────────

    function _assertFailedNotNo(uint256 id) internal view {
        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(
            uint8(m.state),
            uint8(RitualPredict.MarketState.Resolving),
            "still retrying"
        );
        assertEq(
            uint8(m.outcome),
            uint8(RitualPredict.Outcome.Unresolved),
            "a failed read must never be recorded as NO"
        );
        assertEq(m.attempts, 1);
    }

    function test_Resolve_PrecompileRevertIsAFailureNotANo() public {
        uint256 id = _create();
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        http.setMode(MockHttpPrecompile.Mode.Reverts);

        _fire(id, 0);
        _assertFailedNotNo(id);
    }

    function test_Resolve_UndecodableEnvelopeIsAFailureNotANo() public {
        uint256 id = _create();
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        http.setMode(MockHttpPrecompile.Mode.Garbage);

        _fire(id, 0);
        _assertFailedNotNo(id);
    }

    function test_Resolve_UnsettledAsyncOutputIsAFailureNotANo() public {
        uint256 id = _create();
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        http.setMode(MockHttpPrecompile.Mode.Unsettled);

        _fire(id, 0);
        _assertFailedNotNo(id);
    }

    function test_Resolve_ExecutorErrorMessageIsAFailureNotANo() public {
        uint256 id = _create();
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        http.setExecutorError("dns lookup failed");

        vm.expectEmit(true, false, false, true);
        emit ResolutionFailed(id, 1, "dns lookup failed");
        _fire(id, 0);
        _assertFailedNotNo(id);
    }

    function test_Resolve_Non200IsAFailureNotANo() public {
        uint256 id = _create();
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        http.setOk(503, bytes("service unavailable"));

        vm.expectEmit(true, false, false, true);
        emit ResolutionFailed(id, 1, "oracle returned non-200");
        _fire(id, 0);
        _assertFailedNotNo(id);
    }

    function test_Resolve_UnparseableBodyIsAFailureNotANo() public {
        uint256 id = _create();
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        jq.setReverts(true);

        vm.expectEmit(true, false, false, true);
        emit ResolutionFailed(id, 1, "jq could not extract a uint256");
        _fire(id, 0);
        _assertFailedNotNo(id);
    }

    function test_Resolve_NoRegisteredExecutorIsAFailureNotANo() public {
        uint256 id = _create();
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        registry.setExecutors(new address[](0));

        vm.expectEmit(true, false, false, true);
        emit ResolutionAttempted(id, 1, address(0));
        _fire(id, 0);

        _assertFailedNotNo(id);
        assertEq(http.callCount(), 0, "no executor means no HTTP call at all");
    }

    function test_Resolve_RetriesCanLandOnADifferentExecutor() public {
        address[] memory executors = new address[](2);
        executors[0] = executorA;
        executors[1] = executorB;
        registry.setExecutors(executors);

        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _rollPastResolve(id);

        // A reverting executor rolls back the mock's own bookkeeping, so the pick is
        // read from ResolutionAttempted rather than from the mock.
        http.setMode(MockHttpPrecompile.Mode.Reverts);
        vm.recordLogs();
        _fire(id, 0);
        address first = _attemptedExecutor();

        // A new seed on the retry, so the pick is re-rolled rather than sticky.
        vm.roll(block.number + predict.RETRY_INTERVAL_BLOCKS());
        http.setOk(200, bytes('{"price":4200}'));
        vm.recordLogs();
        _fire(id, 1);
        address second = _attemptedExecutor();

        assertEq(uint8(predict.getMarket(id).state), uint8(RitualPredict.MarketState.Resolved));
        assertTrue(first == executorA || first == executorB);
        assertTrue(second == executorA || second == executorB);
        assertEq(second, http.lastExecutor(), "the retry used the re-rolled pick");
    }

    /// The executor from the most recent ResolutionAttempted in the recorded logs.
    function _attemptedExecutor() internal returns (address executor) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("ResolutionAttempted(uint256,uint8,address)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == topic) {
                (, executor) = abi.decode(logs[i].data, (uint8, address));
            }
        }
    }

    function test_Resolve_ThreeFailuresInvalidateTheMarket() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        http.setMode(MockHttpPrecompile.Mode.Reverts);

        _fire(id, 0);
        vm.roll(block.number + predict.RETRY_INTERVAL_BLOCKS());
        _fire(id, 1);
        assertEq(
            uint8(predict.getMarket(id).state),
            uint8(RitualPredict.MarketState.Resolving),
            "two failures are not enough"
        );

        vm.roll(block.number + predict.RETRY_INTERVAL_BLOCKS());
        vm.expectEmit(true, false, false, true);
        emit MarketInvalidated(id, "http precompile reverted");
        _fire(id, 2);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Invalid));
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Unresolved));
        assertEq(m.attempts, predict.MAX_ATTEMPTS());
        assertEq(m.invalidReason, "http precompile reverted");
    }

    function test_Resolve_EmptyWinningSideInvalidatesButKeepsTheOutcome() public {
        uint256 id = _create();
        _bet(bob, id, false, 2 ether); // nobody backs YES
        _rollPastResolve(id);

        vm.expectEmit(true, false, false, true);
        emit MarketInvalidated(id, "no winning stake");
        _fire(id, 0);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Invalid));
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Yes), "outcome still recorded");
        assertEq(m.observedValue, 4_200);
    }

    // ───────────────────────────── comparators ──────────────────────────

    function _resolveWith(
        uint256 target,
        RitualPredict.Comparator comparator,
        uint256 observed
    ) internal returns (RitualPredict.Outcome) {
        uint256 id = _createWith(target, comparator);
        _bet(alice, id, true, 1 ether);
        _bet(bob, id, false, 1 ether);
        jq.setValue(observed);
        _rollPastResolve(id);
        _fire(id, 0);
        return predict.getMarket(id).outcome;
    }

    function test_Comparator_GT() public {
        assertEq(uint8(_resolveWith(100, RitualPredict.Comparator.GT, 101)), uint8(RitualPredict.Outcome.Yes));
        assertEq(uint8(_resolveWith(100, RitualPredict.Comparator.GT, 100)), uint8(RitualPredict.Outcome.No));
    }

    function test_Comparator_GTE() public {
        assertEq(uint8(_resolveWith(100, RitualPredict.Comparator.GTE, 100)), uint8(RitualPredict.Outcome.Yes));
        assertEq(uint8(_resolveWith(100, RitualPredict.Comparator.GTE, 99)), uint8(RitualPredict.Outcome.No));
    }

    function test_Comparator_LT() public {
        assertEq(uint8(_resolveWith(100, RitualPredict.Comparator.LT, 99)), uint8(RitualPredict.Outcome.Yes));
        assertEq(uint8(_resolveWith(100, RitualPredict.Comparator.LT, 100)), uint8(RitualPredict.Outcome.No));
    }

    function test_Comparator_LTE() public {
        assertEq(uint8(_resolveWith(100, RitualPredict.Comparator.LTE, 100)), uint8(RitualPredict.Outcome.Yes));
        assertEq(uint8(_resolveWith(100, RitualPredict.Comparator.LTE, 101)), uint8(RitualPredict.Outcome.No));
    }

    // ────────────────────────────── payouts ─────────────────────────────

    function _resolvedYesMarket() internal returns (uint256 id) {
        id = _create();
        _bet(alice, id, true, 3 ether);
        _bet(carol, id, true, 1 ether);
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        _fire(id, 0);
    }

    function test_Claim_PaysAProportionalShareOfTheWholePool() public {
        uint256 id = _resolvedYesMarket();

        // pool = 5, winning pool = 4 → alice 3*5/4 = 3.75, carol 1*5/4 = 1.25
        uint256 aliceBefore = alice.balance;
        vm.expectEmit(true, true, false, true);
        emit WinningsClaimed(id, alice, 3.75 ether);
        vm.prank(alice);
        predict.claimWinnings(id);
        assertEq(alice.balance - aliceBefore, 3.75 ether);

        uint256 carolBefore = carol.balance;
        vm.prank(carol);
        predict.claimWinnings(id);
        assertEq(carol.balance - carolBefore, 1.25 ether);

        assertEq(address(predict).balance, 0, "the pool is fully distributed");
    }

    function test_Claim_RevertsForTheLosingSide() public {
        uint256 id = _resolvedYesMarket();
        vm.prank(bob);
        vm.expectRevert(RitualPredict.NothingToClaim.selector);
        predict.claimWinnings(id);
    }

    function test_Claim_RevertsOnASecondAttempt() public {
        uint256 id = _resolvedYesMarket();
        vm.prank(alice);
        predict.claimWinnings(id);

        vm.prank(alice);
        vm.expectRevert(RitualPredict.AlreadySettled.selector);
        predict.claimWinnings(id);
    }

    function test_Claim_RevertsBeforeResolution() public {
        uint256 id = _create();
        _bet(alice, id, true, 1 ether);
        vm.prank(alice);
        vm.expectRevert(RitualPredict.NotResolved.selector);
        predict.claimWinnings(id);
    }

    function test_Claim_RevertsOnAnInvalidMarket() public {
        uint256 id = _create();
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        _fire(id, 0); // no winning stake → Invalid

        vm.prank(bob);
        vm.expectRevert(RitualPredict.NotResolved.selector);
        predict.claimWinnings(id);
    }

    function test_Refund_ReturnsTheOriginalStakeAfterInvalidation() public {
        uint256 id = _create();
        _bet(alice, id, true, 2 ether);
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        http.setMode(MockHttpPrecompile.Mode.Reverts);

        _fire(id, 0);
        vm.roll(block.number + predict.RETRY_INTERVAL_BLOCKS());
        _fire(id, 1);
        vm.roll(block.number + predict.RETRY_INTERVAL_BLOCKS());
        _fire(id, 2);

        uint256 aliceBefore = alice.balance;
        vm.expectEmit(true, true, false, true);
        emit StakeRefunded(id, alice, 2 ether);
        vm.prank(alice);
        predict.claimRefund(id);
        assertEq(alice.balance - aliceBefore, 2 ether);

        vm.prank(bob);
        predict.claimRefund(id);
        assertEq(address(predict).balance, 0);
    }

    function test_Refund_RevertsOnAResolvedMarket() public {
        uint256 id = _resolvedYesMarket();
        vm.prank(alice);
        vm.expectRevert(RitualPredict.NotInvalid.selector);
        predict.claimRefund(id);
    }

    function test_Refund_RevertsForAnAccountWithNoStake() public {
        uint256 id = _create();
        _bet(bob, id, false, 1 ether);
        _rollPastResolve(id);
        _fire(id, 0); // Invalid: nobody backed the winning side

        vm.prank(alice);
        vm.expectRevert(RitualPredict.NothingToClaim.selector);
        predict.claimRefund(id);
    }

    function test_StakesOf_ReportsClaimableThroughEveryPhase() public {
        uint256 id = _create();
        _bet(alice, id, true, 3 ether);
        _bet(bob, id, false, 1 ether);

        (uint256 yes, uint256 no, bool alreadySettled, uint256 claimable) = predict
            .stakesOf(id, alice);
        assertEq(yes, 3 ether);
        assertEq(no, 0);
        assertFalse(alreadySettled);
        assertEq(claimable, 0, "nothing claimable while open");

        _rollPastResolve(id);
        _fire(id, 0);

        (, , , claimable) = predict.stakesOf(id, alice);
        assertEq(claimable, 4 ether, "3 * 4 / 3");

        vm.prank(alice);
        predict.claimWinnings(id);
        (, , alreadySettled, claimable) = predict.stakesOf(id, alice);
        assertTrue(alreadySettled);
        assertEq(claimable, 0);
    }

    // ───────────────────────── execution funding ────────────────────────

    function test_FundExecution_DepositsIntoTheContractsRitualWalletBalance() public {
        assertEq(predict.executionBalance(), 0);

        predict.fundExecution{value: 0.5 ether}(500_000);

        assertEq(predict.executionBalance(), 0.5 ether);
        assertEq(wallet.balanceOf(address(predict)), 0.5 ether);
        assertEq(wallet.lockUntil(address(predict)), block.number + 500_000);
    }

    function test_FundExecution_RevertsOnZeroValue() public {
        vm.expectRevert(RitualPredict.ZeroStake.selector);
        predict.fundExecution{value: 0}(500_000);
    }

    function test_FundExecution_AcceptsTopUpsFromAnyone() public {
        vm.prank(alice);
        predict.fundExecution{value: 1 ether}(1_000);
        assertEq(predict.executionBalance(), 1 ether);
    }
}
