import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Use absolute path from this file's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const filePath = path.join(__dirname, 'itemCategories.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

export default {
  ...data,
  allResources() {
    return Object.values(data).flat();
  }
};
