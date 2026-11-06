// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title TapRush
/// @notice Reaction-speed game on Celo. Players pay a small G$ entry fee per round,
///         play 5 reaction tests, and the server-validated score (average reaction in
///         milliseconds, LOWER IS BETTER) is posted on-chain. The weekly top 10 is stored
///         on-chain; the top 3 split that week's G$ prize pool (50/30/20).
/// @dev    Scores are signed by a `verifier` key after off-chain validation. This protects
///         against tampered client submissions; it is not a full anti-bot system.
contract TapRush is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    uint256 public constant WEEK = 7 days;
    uint256 public constant TOP_N = 10;
    uint256 public constant MAX_TREASURY_BPS = 1_000; // 10% hard cap
    uint256 private constant BPS = 10_000;
    uint256 public constant MIN_SCORE_MS = 100;
    uint256 public constant MAX_SCORE_MS = 5_000;

    // ---------------------------------------------------------------- storage
    IERC20 public immutable gd; // G$ token
    uint64 public immutable genesis; // start of week 0

    address public verifier; // signs validated scores
    uint256 public entryFee; // in G$ wei (18 decimals)
    uint256 public treasuryBps; // share of each fee kept for the treasury
    uint256 public treasuryBalance;

    struct Round {
        address player;
        uint32 week;
        bool submitted;
    }

    struct Entry {
        address player;
        uint32 score; // ms, lower is better
    }

    uint256 public nextRoundId = 1;
    mapping(uint256 => Round) public rounds;

    mapping(uint32 => uint256) public pot; // week => G$ prize pool
    mapping(uint32 => bool) public finalized;
    mapping(uint32 => mapping(address => uint32)) public bestScore; // 0 = none
    mapping(uint32 => Entry[]) private _top; // sorted ascending by score
    mapping(uint32 => uint256) public roundsPlayed;
    mapping(uint32 => mapping(address => bool)) public claimed;

    // lifetime stats (useful for the GoodBuilders numeric goals)
    uint256 public totalRounds;
    uint256 public totalGdSpent;
    uint256 public totalGdPaidOut;
    uint256 public uniquePlayers;
    mapping(address => bool) public hasPlayed;

    // ---------------------------------------------------------------- events
    event RoundStarted(uint256 indexed roundId, address indexed player, uint32 indexed week);
    event ScoreSubmitted(uint256 indexed roundId, address indexed player, uint32 indexed week, uint32 score, bool newBest);
    event WeekFinalized(uint32 indexed week, uint256 distributed, uint256 rolledOver);
    event PrizeClaimed(uint32 indexed week, address indexed player, uint256 amount);
    event VerifierChanged(address indexed verifier);
    event EntryFeeChanged(uint256 entryFee);
    event TreasuryBpsChanged(uint256 bps);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event PotSeeded(uint32 indexed week, address indexed from, uint256 amount);

    // ---------------------------------------------------------------- errors
    error ZeroAddress();
    error BadFee();
    error BadBps();
    error NotRoundPlayer();
    error AlreadySubmitted();
    error UnknownRound();
    error BadSignature();
    error BadScore();
    error WeekNotOver();
    error AlreadyFinalized();
    error NotFinalized();
    error NothingToClaim();
    error AlreadyClaimed();
    error PreviousWeekOpen();

    constructor(address gdToken, address verifier_, uint256 entryFee_, uint256 treasuryBps_, address owner_)
        Ownable(owner_)
    {
        if (gdToken == address(0) || verifier_ == address(0)) revert ZeroAddress();
        if (entryFee_ == 0) revert BadFee();
        if (treasuryBps_ > MAX_TREASURY_BPS) revert BadBps();
        gd = IERC20(gdToken);
        genesis = uint64(block.timestamp);
        verifier = verifier_;
        entryFee = entryFee_;
        treasuryBps = treasuryBps_;
    }

    // ---------------------------------------------------------------- views
    function currentWeek() public view returns (uint32) {
        return uint32((block.timestamp - genesis) / WEEK);
    }

    function weekEnd(uint32 week) public view returns (uint256) {
        return uint256(genesis) + (uint256(week) + 1) * WEEK;
    }

    function getTop(uint32 week) external view returns (address[] memory players, uint32[] memory scores) {
        Entry[] storage t = _top[week];
        players = new address[](t.length);
        scores = new uint32[](t.length);
        for (uint256 i = 0; i < t.length; i++) {
            players[i] = t[i].player;
            scores[i] = t[i].score;
        }
    }

    /// @notice Prize owed to `player` for `week` (0 if not a winner or week not finalized).
    function prizeOf(uint32 week, address player) public view returns (uint256) {
        if (!finalized[week] || claimed[week][player]) return 0;
        Entry[] storage t = _top[week];
        uint256 n = t.length < 3 ? t.length : 3;
        for (uint256 i = 0; i < n; i++) {
            if (t[i].player == player) return _prizeForRank(week, i);
        }
        return 0;
    }

    // ---------------------------------------------------------------- gameplay
    /// @notice Pay the G$ entry fee and open a round. Caller must approve `entryFee` first.
    function startRound() external nonReentrant whenNotPaused returns (uint256 roundId) {
        uint256 fee = entryFee;
        uint32 week = currentWeek();

        gd.safeTransferFrom(msg.sender, address(this), fee);

        uint256 cut = (fee * treasuryBps) / BPS;
        treasuryBalance += cut;
        pot[week] += fee - cut;

        roundId = nextRoundId++;
        rounds[roundId] = Round({player: msg.sender, week: week, submitted: false});

        totalRounds++;
        totalGdSpent += fee;
        roundsPlayed[week]++;
        if (!hasPlayed[msg.sender]) {
            hasPlayed[msg.sender] = true;
            uniquePlayers++;
        }

        emit RoundStarted(roundId, msg.sender, week);
    }

    /// @notice Post a verifier-signed score for an open round.
    function submitScore(uint256 roundId, uint32 score, bytes calldata signature) external nonReentrant {
        Round storage r = rounds[roundId];
        if (r.player == address(0)) revert UnknownRound();
        if (r.player != msg.sender) revert NotRoundPlayer();
        if (r.submitted) revert AlreadySubmitted();
        if (score < MIN_SCORE_MS || score > MAX_SCORE_MS) revert BadScore();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(block.chainid, address(this), roundId, msg.sender, score))
        );
        if (ECDSA.recover(digest, signature) != verifier) revert BadSignature();

        r.submitted = true;
        uint32 week = r.week;
        // Scores always count toward the week the round was PAID in, so a round that
        // started right before midnight can't be lost, but a finalized week is closed.
        if (finalized[week]) revert AlreadyFinalized();

        uint32 prev = bestScore[week][msg.sender];
        bool newBest = prev == 0 || score < prev;
        if (newBest) {
            bestScore[week][msg.sender] = score;
            _updateTop(week, msg.sender, score, prev != 0);
        }
        emit ScoreSubmitted(roundId, msg.sender, week, score, newBest);
    }

    // ---------------------------------------------------------------- weekly payout
    /// @notice Close a finished week. Anyone may call. Unallocated prize (fewer than 3 winners) rolls over.
    function finalizeWeek(uint32 week) external nonReentrant {
        if (block.timestamp < weekEnd(week)) revert WeekNotOver();
        if (finalized[week]) revert AlreadyFinalized();
        if (week > 0 && !finalized[week - 1]) revert PreviousWeekOpen(); // keep rollovers ordered
        finalized[week] = true;

        uint256 total = pot[week];
        uint256 n = _top[week].length < 3 ? _top[week].length : 3;
        uint256 distributed;
        for (uint256 i = 0; i < n; i++) {
            distributed += _prizeForRank(week, i);
        }
        uint256 rolled = total - distributed;
        if (rolled > 0) {
            pot[week + 1] += rolled;
        }
        emit WeekFinalized(week, distributed, rolled);
    }

    /// @notice Winners pull their prize (pull-over-push avoids one bad recipient blocking others).
    function claimPrize(uint32 week) external nonReentrant {
        if (!finalized[week]) revert NotFinalized();
        if (claimed[week][msg.sender]) revert AlreadyClaimed();
        uint256 amount = prizeOf(week, msg.sender);
        if (amount == 0) revert NothingToClaim();
        claimed[week][msg.sender] = true;
        totalGdPaidOut += amount;
        gd.safeTransfer(msg.sender, amount);
        emit PrizeClaimed(week, msg.sender, amount);
    }

    /// @notice Anyone (funders, GoodBuilders sponsors) can add G$ to the current week's pot.
    function seedPot(uint256 amount) external nonReentrant {
        gd.safeTransferFrom(msg.sender, address(this), amount);
        uint32 week = currentWeek();
        pot[week] += amount;
        emit PotSeeded(week, msg.sender, amount);
    }

    // ---------------------------------------------------------------- admin
    function setVerifier(address v) external onlyOwner {
        if (v == address(0)) revert ZeroAddress();
        verifier = v;
        emit VerifierChanged(v);
    }

    function setEntryFee(uint256 fee) external onlyOwner {
        if (fee == 0) revert BadFee();
        entryFee = fee;
        emit EntryFeeChanged(fee);
    }

    function setTreasuryBps(uint256 bps) external onlyOwner {
        if (bps > MAX_TREASURY_BPS) revert BadBps();
        treasuryBps = bps;
        emit TreasuryBpsChanged(bps);
    }

    function withdrawTreasury(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        treasuryBalance -= amount; // reverts on underflow
        gd.safeTransfer(to, amount);
        emit TreasuryWithdrawn(to, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------- internals
    function _prizeForRank(uint32 week, uint256 rank) internal view returns (uint256) {
        uint256 total = pot[week];
        if (rank == 0) return (total * 50) / 100;
        if (rank == 1) return (total * 30) / 100;
        return (total * 20) / 100;
    }

    /// @dev Keep `_top[week]` sorted ascending, one entry per player, max TOP_N.
    ///      Ties keep the earlier achiever ahead.
    function _updateTop(uint32 week, address player, uint32 score, bool hadEntry) internal {
        Entry[] storage t = _top[week];

        // remove the player's old entry, if any
        if (hadEntry) {
            for (uint256 i = 0; i < t.length; i++) {
                if (t[i].player == player) {
                    for (uint256 j = i; j + 1 < t.length; j++) {
                        t[j] = t[j + 1];
                    }
                    t.pop();
                    break;
                }
            }
        }

        // find insertion index (after equal scores)
        uint256 idx = t.length;
        for (uint256 i = 0; i < t.length; i++) {
            if (score < t[i].score) {
                idx = i;
                break;
            }
        }
        if (idx >= TOP_N) return; // not good enough for the board

        t.push(Entry(address(0), 0)); // grow by one
        for (uint256 k = t.length - 1; k > idx; k--) {
            t[k] = t[k - 1];
        }
        t[idx] = Entry(player, score);

        if (t.length > TOP_N) t.pop();
    }
}
