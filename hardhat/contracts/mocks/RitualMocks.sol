// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Test-only stand-ins for the Ritual system contracts and precompiles.
 *
 * Tests `vm.etch` these runtime bytecodes at the canonical addresses in
 * `RitualChain.sol`, so `RitualPredict` runs completely unmodified: it still calls
 * 0x0801, 0x0803, the Scheduler and the RitualWallet by their real addresses.
 *
 * Because `vm.etch` copies code but not storage, nothing here may depend on a value
 * written by its own constructor. Counters therefore start at 0 and pre-increment.
 */

// ─────────────────────────── Scheduler ────────────────────────────

contract MockScheduler {
    struct Booking {
        bytes data;
        uint32 gas;
        uint32 startBlock;
        uint32 numCalls;
        uint32 frequency;
        uint32 ttl;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        uint256 value;
        address payer;
        bool cancelled;
    }

    uint256 private _callCounter;
    mapping(uint256 => Booking) private _bookings;
    mapping(address => bool) public approved;

    /// Set to make the next schedule() revert, exercising createMarket's failure path.
    bool public scheduleReverts;
    /// Set to make cancel() revert, proving a good resolution survives it.
    bool public cancelReverts;

    function setScheduleReverts(bool v) external {
        scheduleReverts = v;
    }

    function setCancelReverts(bool v) external {
        cancelReverts = v;
    }

    function approveScheduler(address schedulerContract) external {
        approved[schedulerContract] = true;
    }

    function schedule(
        bytes calldata data,
        uint32 gas,
        uint32 startBlock,
        uint32 numCalls,
        uint32 frequency,
        uint32 ttl,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint256 value,
        address payer
    ) external returns (uint256 callId) {
        require(!scheduleReverts, "scheduler down");

        callId = ++_callCounter;
        Booking storage b = _bookings[callId];
        b.data = data;
        b.gas = gas;
        b.startBlock = startBlock;
        b.numCalls = numCalls;
        b.frequency = frequency;
        b.ttl = ttl;
        b.maxFeePerGas = maxFeePerGas;
        b.maxPriorityFeePerGas = maxPriorityFeePerGas;
        b.value = value;
        b.payer = payer;
    }

    function cancel(uint256 callId) external {
        require(!cancelReverts, "cancel failed");
        _bookings[callId].cancelled = true;
    }

    /// 0 = unknown, 1 = active, 2 = cancelled.
    function getCallState(uint256 callId) external view returns (uint8) {
        if (_bookings[callId].startBlock == 0) return 0;
        return _bookings[callId].cancelled ? 2 : 1;
    }

    function booking(uint256 callId) external view returns (Booking memory) {
        return _bookings[callId];
    }

    function callCount() external view returns (uint256) {
        return _callCounter;
    }
}

// ────────────────────────── RitualWallet ──────────────────────────

contract MockRitualWallet {
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public lockUntil;

    function deposit(uint256 lockDuration) external payable {
        balanceOf[msg.sender] += msg.value;
        lockUntil[msg.sender] = block.number + lockDuration;
    }
}

// ──────────────────────── TEEServiceRegistry ──────────────────────

contract MockTEERegistry {
    address[] private _executors;

    /// An empty set makes pickServiceByCapability return found = false.
    function setExecutors(address[] calldata executors) external {
        delete _executors;
        for (uint256 i = 0; i < executors.length; i++) {
            _executors.push(executors[i]);
        }
    }

    function executorCount() external view returns (uint256) {
        return _executors.length;
    }

    /// Seed-dependent, like the real registry: a different seed can land on a
    /// different executor, which is what makes a retry worth attempting.
    function pickServiceByCapability(
        uint8,
        bool,
        uint256 seed,
        uint256
    ) external view returns (address teeAddress, bool found) {
        if (_executors.length == 0) return (address(0), false);
        return (_executors[seed % _executors.length], true);
    }
}

// ─────────────────────── HTTP precompile 0x0801 ───────────────────

contract MockHttpPrecompile {
    enum Mode {
        Ok, // well-formed response built from status/body/errorMessage
        Reverts, // precompile call itself fails
        Garbage, // undecodable envelope
        Unsettled // envelope present, actualOutput empty (simulation pass)
    }

    Mode public mode;
    uint16 public status;
    bytes public body;
    string public errorMessage;

    // Recorded from the last request, for assertions.
    address public lastExecutor;
    uint256 public lastTtl;
    string public lastUrl;
    uint8 public lastMethod;
    uint256 public callCount;

    function setOk(uint16 status_, bytes calldata body_) external {
        mode = Mode.Ok;
        status = status_;
        body = body_;
        errorMessage = "";
    }

    /// A 200 response the executor still marked as failed.
    function setExecutorError(string calldata message) external {
        mode = Mode.Ok;
        status = 200;
        body = "";
        errorMessage = message;
    }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        callCount += 1;

        // Decode only the leading fields of the 13-field HTTPCallRequest. The head
        // layout is identical, so a prefix decode is safe.
        (
            address executor,
            ,
            uint256 ttl,
            ,
            ,
            string memory url,
            uint8 method
        ) = abi.decode(
                input,
                (address, bytes[], uint256, bytes[], bytes, string, uint8)
            );
        lastExecutor = executor;
        lastTtl = ttl;
        lastUrl = url;
        lastMethod = method;

        if (mode == Mode.Reverts) revert("executor unreachable");
        if (mode == Mode.Garbage) return hex"deadbeef";
        if (mode == Mode.Unsettled) return abi.encode(input, bytes(""));

        bytes memory actualOutput = abi.encode(
            status,
            new string[](0),
            new string[](0),
            body,
            errorMessage
        );
        return abi.encode(input, actualOutput);
    }
}

// ──────────────────────── jq precompile 0x0803 ────────────────────

contract MockJqPrecompile {
    bool public reverts;
    /// Value handed back for a well-formed uint256 query.
    uint256 public value;
    function setValue(uint256 value_) external {
        reverts = false;
        value = value_;
    }

    function setReverts(bool v) external {
        reverts = v;
    }

    /// Reached through `staticcall`, so this must not write storage when it runs.
    fallback(bytes calldata input) external returns (bytes memory) {
        if (reverts) revert("jq failed");

        (, , uint8 outputType) = abi.decode(input, (string, string, uint8));
        // A wrong outputType returns ok = true with zero-length output on the real
        // precompile. Reproducing that is what makes RitualPredict's length check
        // load-bearing.
        if (outputType != 1) return "";

        return abi.encode(value);
    }
}
