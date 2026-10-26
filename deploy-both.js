const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function cleanNextCache() {
  const nextDir = path.join(__dirname, '.next');
  if (fs.existsSync(nextDir)) {
    try {
      fs.rmSync(nextDir, { recursive: true, force: true });
      console.log('  ✓ Cleared .next build cache');
    } catch (e) {
      console.warn('  ⚠ Could not fully clear .next cache:', e.message);
    }
  }
}

function sleep(ms) {
  execSync(`ping 127.0.0.1 -n ${Math.ceil(ms / 1000) + 1} > nul 2>&1 || sleep ${ms / 1000}`, { shell: true, stdio: 'ignore' });
}

try {
  // Step 1: Build & deploy to GitHub Pages
  console.log('1. Building and deploying to GitHub Pages...');
  cleanNextCache();
  execSync('node build-gh.js', { stdio: 'inherit' });
  execSync('npx gh-pages -d out --nojekyll --dotfiles', { stdio: 'inherit' });
  console.log('✅ GitHub Pages deployment successful!');

  // Step 2: Clean cache, then build for Hostinger
  console.log('\n2. Building for Hostinger (no basePath)...');
  cleanNextCache();
  sleep(2000);
  execSync('node build-hostinger-static.js', { stdio: 'inherit' });

  // Step 3: Package into dist.zip
  console.log('\n3. Packaging Hostinger build into dist.zip...');
  if (process.platform === 'win32') {
    execSync('powershell "if (Test-Path dist.zip) { Remove-Item dist.zip }; Compress-Archive -Path out\\* -DestinationPath dist.zip -Force"', { stdio: 'inherit' });
  } else {
    execSync('zip -r dist.zip out/*', { stdio: 'inherit' });
  }
  console.log('✅ Frontend-only Hostinger build packaged in dist.zip. Athlete receiver APIs require npm run build:hostinger and Node.js hosting.');
  console.log('\n🎉 Both deployments prepared! Upload dist.zip to Hostinger and you are good to go!');
} catch (error) {
  console.error('❌ Deployment process failed:', error);
  process.exit(1);
}
