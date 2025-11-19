// Quick CLI validation test
import ConfigLoader from './src/core/ConfigLoader.js';
import ServerRegistry from './src/utils/ServerRegistry.js';

console.log('=== CLI Config Test ===\n');

// Test 1: Server registry
const registry = new ServerRegistry();
console.log('1. Testing server add with version...');
const added = registry.upsert({ alias: 'clitest', host: 'test.local', port: 12345, version: '1.18.2' });
console.log(`   ✓ Added: ${added.alias} -> ${added.host}:${added.port} (${added.version})`);
console.log(`   Expected version: 1.18.2, Got: ${added.version}`);
console.log(`   ${added.version === '1.18.2' ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 2: Config override
console.log('2. Testing config override...');
const result = await ConfigLoader.loadConfig('./src/config/config.json', {
  host: 'override.test',
  port: 54321,
  version: '1.17.1'
});
if (result.success) {
  console.log(`   ✓ Config loaded with override`);
  console.log(`   Host: ${result.config.host} (expected: override.test)`);
  console.log(`   Port: ${result.config.port} (expected: 54321)`);
  console.log(`   Version: ${result.config.version} (expected: 1.17.1)`);
  const pass = result.config.host === 'override.test' && 
               result.config.port === 54321 && 
               result.config.version === '1.17.1';
  console.log(`   ${pass ? '✓ PASS' : '✗ FAIL'}\n`);
} else {
  console.log(`   ✗ FAIL: ${result.error}\n`);
}

// Test 3: Server retrieval
console.log('3. Testing server retrieval...');
const retrieved = registry.get('clitest');
if (retrieved && retrieved.version === '1.18.2') {
  console.log(`   ✓ Retrieved: ${retrieved.alias} with correct version ${retrieved.version}`);
  console.log('   ✓ PASS\n');
} else {
  console.log('   ✗ FAIL: Could not retrieve or version mismatch\n');
}

// Cleanup
registry.remove('clitest');
console.log('=== All Tests Complete ===');
