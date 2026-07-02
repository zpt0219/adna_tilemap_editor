#!/usr/bin/env node

import { execSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 3000;
const APPS = ['reroll', 'tagger', 'refiner', 'autotile_mixer', 'pixel_editor'];

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

// Check if a force rebuild is requested via --build or -b
const forceBuild = process.argv.includes('--build') || process.argv.includes('-b');

function buildApps() {
  console.log('\n==================================================');
  console.log('🚀 Checking and building sub-apps...');
  console.log('==================================================');

  for (const app of APPS) {
    const appDir = path.join(ROOT, app);
    const distDir = path.join(appDir, 'dist');
    const needsBuild = forceBuild || !fs.existsSync(distDir);

    if (needsBuild) {
      console.log(`\n📦 Preparing [${app}]...`);
      
      // Clean registry in package-lock.json if it contains internal Tencent Cloud mirror
      const lockfilePath = path.join(appDir, 'package-lock.json');
      if (fs.existsSync(lockfilePath)) {
        let content = fs.readFileSync(lockfilePath, 'utf8');
        if (content.includes('mirrors.tencentyun.com/npm')) {
          console.log(`   Fixing Tencent Cloud registry URLs in package-lock.json for [${app}]...`);
          content = content.replaceAll('http://mirrors.tencentyun.com/npm/', 'https://registry.npmjs.org/');
          fs.writeFileSync(lockfilePath, content, 'utf8');
        }
      }

      // Ensure node_modules exists
      if (!fs.existsSync(path.join(appDir, 'node_modules'))) {
        console.log(`   Installing dependencies for [${app}]...`);
        execSync('npm install', { cwd: appDir, stdio: 'inherit' });
      }

      console.log(`   Building [${app}]...`);
      execSync('npm run build', { cwd: appDir, stdio: 'inherit' });
    } else {
      console.log(`✅ [${app}] is already built (dist/ exists).`);
    }
  }
  console.log('\n✨ All sub-apps are ready!\n');
}

// Perform builds
try {
  buildApps();
} catch (err) {
  console.error('\n❌ Build failed! Please resolve the issue and try again.');
  console.error(err);
  process.exit(1);
}

// Start HTTP Server
const server = http.createServer((req, res) => {
  // Parse URL
  let parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = parsedUrl.pathname;

  // Normalize pathname to prevent directory traversal
  pathname = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');

  // Redirect /app to /app/ to fix relative asset URLs
  for (const app of APPS) {
    if (pathname === `/${app}`) {
      res.writeHead(301, { 'Location': `/${app}/` });
      res.end();
      return;
    }
  }

  let filePath = '';
  let matchedApp = null;

  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(ROOT, 'server', 'index.html');
  } else {
    // Check which app the request belongs to
    for (const app of APPS) {
      if (pathname.startsWith(`/${app}/`)) {
        const relativePath = pathname.substring(`/${app}/`.length);
        filePath = path.join(ROOT, app, 'dist', relativePath);
        matchedApp = app;
        break;
      }
    }
    
    if (!matchedApp) {
      // Check if it's a file in the ROOT server folder
      filePath = path.join(ROOT, 'server', pathname);
    }
  }

  const serveFile = (pathToFile) => {
    fs.stat(pathToFile, (err, stats) => {
      if (err) {
        // SPA Fallback check: if it's inside an app directory and doesn't have an extension, serve its index.html
        if (matchedApp) {
          const appIndex = path.join(ROOT, matchedApp, 'dist', 'index.html');
          if (pathToFile !== appIndex) {
            return serveFile(appIndex);
          }
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
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
  console.log(`🎯 Local server is running at: http://localhost:${PORT}/`);
  console.log('   Press Ctrl+C to stop the server.');
  console.log('   To force rebuild all sub-apps, run with: --build or -b');
  console.log('==================================================\n');
});
