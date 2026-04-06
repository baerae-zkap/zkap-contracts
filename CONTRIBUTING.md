# Contributing to zkap-contracts

Thank you for your interest in contributing to ZKAP!

## Getting Started

### Prerequisites

- Node.js >= 18
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`)
- Git

### Setup

```bash
git clone https://github.com/baerae-zkap/zkap-contracts.git
cd zkap-contracts
npm install
npx hardhat compile
```

### Running Tests

```bash
# Unit tests (Hardhat)
npm run test:unit

# Fuzz tests (Foundry)
npm run test:foundry

# Core e2e tests
npm run test:e2e

# All CI tests (unit + foundry + core e2e)
npm run test:ci

# ZK e2e tests (requires macOS ARM64 + ZK assets, see README)
npm run test:e2e:zk
```

### Environment Variables

Copy `.env.example` to `.env` and fill in values as needed:

```bash
cp .env.example .env
```

For local development and unit tests, the default values in `.env.example` are sufficient. You only need real credentials for testnet deployments or manual OAuth tests.

## Development Workflow

1. Fork the repository
2. Create a feature branch from `develop`: `git checkout -b feat/your-feature develop`
3. Make your changes
4. Ensure all tests pass: `npm run test:ci`
5. Ensure linting passes: `npm run lint:sol`
6. Submit a pull request to `develop`

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Update documentation if applicable
- Follow existing code style and naming conventions
- Add NatSpec comments for new public/external contract functions

## Branch Conventions

- `main` — stable releases
- `develop` — active development

## Solidity Style

- Use Solidity 0.8.x
- Follow [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- Add SPDX license identifiers to all `.sol` files
- Use NatSpec for public/external functions

## Security

If you discover a security vulnerability, please follow our [Security Policy](SECURITY.md). Do NOT open a public issue.

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](LICENSE)), unless the contribution modifies files with a different SPDX identifier.
