#!/usr/bin/env node

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
};

// Start HTTP Server
const server = http.createServer((req, res) => {
  let parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = parsedUrl.pathname;

  // Normalize pathname to prevent directory traversal
  pathname = path.normalize(pathname).replace(/\\/g, '/').replace(/^(\.\.[\/\\])+/, '');

  if (pathname === '/wang_tiles') {
    res.writeHead(301, { 'Location': '/wang_tiles/' });
    res.end();
    return;
  }

  let filePath = '';
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(ROOT, 'server', 'index.html');
  } else if (pathname.startsWith('/wang_tiles/')) {
    const relativePath = pathname.substring('/wang_tiles/'.length);
    filePath = path.join(ROOT, 'wang_tiles', relativePath);
  } else {
    filePath = path.join(ROOT, 'server', pathname);
  }

  const serveFile = (pathToFile) => {
    fs.stat(pathToFile, (err, stats) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found (Sub-apps are developed independently in their own repositories)');
        return;
      }

      if (stats.isDirectory()) {
        const indexFile = path.join(pathToFile, 'index.html');
        return serveFile(indexFile);
      }

      fs.readFile(pathToFile, (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('500 Internal Server Error');
          return;
        }

        const ext = path.extname(pathToFile).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
  };

  serveFile(filePath);
});

server.listen(PORT, () => {
  console.log('==================================================');
  console.log(`🎯 Adna Portal is running at: http://localhost:${PORT}/`);
  console.log(`   - Landing Page: http://localhost:${PORT}/`);
  console.log(`   - Wang Tiles:   http://localhost:${PORT}/wang_tiles/`);
  console.log('   Press Ctrl+C to stop the server.');
  console.log('==================================================\n');
});
