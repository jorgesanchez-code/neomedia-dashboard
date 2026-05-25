const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const required = [
  '../index.html',
  '../assets/app.js',
  '../assets/firebase-init.js',
  '../assets/styles.css',
  'index.html',
  'assets/app.js',
  'assets/firebase-init.js',
  'assets/styles.css',
  '../api/ai.js'
];

for (const file of required) {
  const fullPath = path.resolve(publicDir, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`Missing required file: ${fullPath}`);
    process.exit(1);
  }
}

for (const file of [
  path.join(root, 'assets/app.js'),
  path.join(root, 'assets/firebase-init.js'),
  path.join(publicDir, 'assets/app.js'),
  path.join(publicDir, 'assets/firebase-init.js'),
  path.join(root, 'api/ai.js')
]) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    console.error(`Syntax check failed for ${file}:`);
    console.error(String(error.stderr || error.message));
    process.exit(1);
  }
}

const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
for (const asset of ['assets/styles.css', 'assets/firebase-init.js', 'assets/app.js']) {
  if (!html.includes(asset)) {
    console.error(`index.html does not reference ${asset}`);
    process.exit(1);
  }
}

const rootHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const asset of ['assets/styles.css', 'assets/firebase-init.js', 'assets/app.js']) {
  if (!rootHtml.includes(asset)) {
    console.error(`root index.html does not reference ${asset}`);
    process.exit(1);
  }
}

console.log('Build check passed');
