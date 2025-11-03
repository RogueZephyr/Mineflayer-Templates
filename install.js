#!/usr/bin/env node

import { spawn } from 'child_process';
import { platform } from 'os';

console.log('🚀 Installing Mineflayer BasicBot dependencies...\n');

const isWindows = platform() === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';

const install = spawn(npmCommand, ['install'], {
  stdio: 'inherit',
  shell: true
});

install.on('error', (error) => {
  console.error('❌ Installation failed:', error.message);
  process.exit(1);
});

install.on('close', (code) => {
  if (code === 0) {
    console.log('\n✅ All dependencies installed successfully!');
    console.log('\n📝 Quick start:');
    console.log('   1. Configure your bot in src/config/config.json');
    console.log('   2. Run: npm start');
    console.log('\n📚 Available commands:');
    console.log('   npm start     - Start bot with auto-restart (dev mode)');
    console.log('   npm run dev   - Start bot once (production mode)');
    console.log('\n🤖 Happy botting!');
  } else {
    console.error(`❌ Installation failed with code ${code}`);
    process.exit(code);
  }
});
