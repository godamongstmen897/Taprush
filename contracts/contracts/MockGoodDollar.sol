// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TESTNET ONLY. Stand-in for G$ (18 decimals) so the game can be tested on
///         Celo Sepolia, where the real G$ token does not exist. Never deploy to mainnet.
contract MockGoodDollar is ERC20 {
    constructor() ERC20("Mock GoodDollar", "G$") {}

    /// @dev Open faucet, capped per call so test wallets can play.
    function faucet() external {
        _mint(msg.sender, 10_000 ether);
    }
}
