module.exports = {
  skipFiles: [
    // Utilities and external libraries
    'Utils',
    'Token',
    'exp',
    'SimpleEntryPoint.sol',
    // Test helper contracts
    'test',
    'paymaster/misc', // exclude all test-only contracts
    // External cryptographic libraries
    'AccountKey/Primitive/PKI/Secp256r1/Secp256r1.sol',
    // Abstract contracts (cannot be tested directly)
    'AccountKey/Primitive/AccountKey.sol',
  ],
  // CI: summary only, local: full table
  istanbulReporter: process.env.CI
    ? ['text-summary', 'lcov', 'json-summary']
    : ['text', 'lcov', 'json-summary'],
  // Coverage thresholds - automatically fail if below
  statements: 95,
  branches: 95,
  functions: 95,
  lines: 95,
};
