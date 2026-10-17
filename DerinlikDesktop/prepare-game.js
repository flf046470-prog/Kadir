// Builds the offline game page (no CDN, fonts inlined) into app/index.html for the desktop shell.
// Needs Python 3 and `npm install` in ../DerinlikWeb (esbuild, three, @fontsource).
const { execFileSync } = require('child_process');
const path = require('path');

const web = path.join(__dirname, '..', 'DerinlikWeb');
const out = path.join(__dirname, 'app', 'index.html');
const python = process.platform === 'win32' ? 'python' : 'python3';
execFileSync(python, [path.join(web, 'build.py'), '--offline', '--out', out], { stdio: 'inherit' });
