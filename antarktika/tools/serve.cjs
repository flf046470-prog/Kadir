// Minimal static server for Game/ (same files the iOS scheme handler serves).
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', 'ios', 'Antarktika', 'Game');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
module.exports = function serve(port = 8765) {
  const srv = http.createServer((req, res) => {
    const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[/\\]+/, '') || 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
};
