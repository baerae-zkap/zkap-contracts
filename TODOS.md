# TODOS

## Cross-Platform ZK NAPI Binaries
**What:** Build and distribute linux-x64 NAPI binaries for ZK circuits (currently darwin-arm64 only)
**Why:** Enables ZK e2e tests on Linux CI runners and for external Linux/Windows contributors
**Pros:** Full cross-platform test coverage, CI can run ZK tests
**Cons:** Requires Rust cross-compilation setup, increases zk-assets download size
**Context:** zk-assets/*/napi/ only contains napi.darwin-arm64.node. setup-zk-download.sh pulls from Google Drive with no platform selection. The public repo documents this limitation and excludes ZK tests from CI.
**Depends on:** ZK circuit build toolchain (../zkup project)

## NatSpec Coverage for Public-Facing Contracts
**What:** Add @notice, @param, @return NatSpec annotations to all public/external functions in zero-coverage contracts
**Why:** Standard for auditable open-source Solidity. Block explorers render NatSpec for developer UX.
**Pros:** Better developer experience, more professional repo, block explorer integration
**Cons:** ~30 min of documentation work with CC
**Context:** Core contracts like ZkapAccount.sol already have good coverage (26 annotations). Gap is in: ZkapAccountFactory.sol, AccountKey.sol, PrimitiveAccountKey.sol, IPrimitiveAccountKey.sol, ManagerAccessControl.sol.
**Depends on:** Nothing
