import fs from 'fs';
import path from 'path';

const filePath = path.resolve('./src/config/itemCategories.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

export default {
  ...data,
  allResources() {
    return Object.values(data).flat();
  }
};
