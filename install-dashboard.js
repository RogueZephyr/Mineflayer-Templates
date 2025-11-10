#!/usr/bin/env node

// Simple install script for the Electron dashboard
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('📦 Installing Electron Dashboard dependencies...\n');

try {
  // Navigate to dashboard directory and install
  process.chdir(join(__dirname, 'dashboards', 'electron'));
  
  console.log('Running npm install in dashboards/electron...\n');
  execSync('npm install', { stdio: 'inherit' });
  
  console.log('\n✅ Dashboard dependencies installed successfully!\n');
  console.log('To start the dashboard, run:');
  console.log('  cd dashboards/electron');
  console.log('  npm run electron:dev\n');
  
} catch (err) {
  console.error('\n❌ Installation failed:', err.message);
  process.exit(1);
}
