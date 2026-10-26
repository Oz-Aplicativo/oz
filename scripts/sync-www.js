const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'www');

const files = [
  'index.html',
  'reset-password.html',
  'privacy-policy.html',
  'terms-of-use.html',
  'manifest.webmanifest',
  'sw.js',
];
const dirs = ['css', 'js', 'images', 'icons'];

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const out = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, out);
    else copyFile(src, out);
  }
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

for (const file of files) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) copyFile(src, path.join(dest, file));
}
for (const dir of dirs) {
  const src = path.join(root, dir);
  if (fs.existsSync(src)) copyDir(src, path.join(dest, dir));
}

console.log('www pronto para o Capacitor');
