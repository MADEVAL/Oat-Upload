const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

fs.mkdirSync(dist, { recursive: true });

const files = [
  ['src/upload.css', 'dist/oat-upload.css'],
  ['src/upload.js', 'dist/oat-upload.js']
];

for (const [from, to] of files) {
  fs.copyFileSync(path.join(root, from), path.join(root, to));
}

esbuild.buildSync({
  entryPoints: [path.join(root, 'src/upload.css')],
  outfile: path.join(dist, 'oat-upload.min.css'),
  minify: true,
  bundle: true,
  logLevel: 'silent'
});

esbuild.buildSync({
  entryPoints: [path.join(root, 'src/upload.js')],
  outfile: path.join(dist, 'oat-upload.min.js'),
  minify: true,
  bundle: false,
  logLevel: 'silent'
});

for (const file of ['oat-upload.css', 'oat-upload.min.css', 'oat-upload.js', 'oat-upload.min.js']) {
  const size = fs.statSync(path.join(dist, file)).size;
  console.log(`${file}: ${size} bytes`);
}