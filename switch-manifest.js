const fs = require('fs');

const target = process.argv[2];

if (!target || !['chrome', 'firefox'].includes(target)) {
  console.error('Please specify target browser: chrome or firefox');
  process.exit(1);
}

const sourceFile = `manifest-${target}.json`;
const targetFile = 'manifest.json';

try {
  fs.copyFileSync(sourceFile, targetFile);
  console.log(`Successfully switched to ${target} manifest`);
} catch (err) {
  console.error(`Error switching manifest: ${err.message}`);
  process.exit(1);
} 