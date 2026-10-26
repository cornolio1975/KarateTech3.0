const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('Building project for Hostinger deployment (no basePath)...');

const apiDir = path.join(__dirname, 'src', 'app', 'api');
const tempApiDir = path.join(__dirname, 'src', '_api_temp');
let movedApi = false;

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

function cleanDevTypeValidators() {
  const nextDevDir = path.join(__dirname, '.next', 'dev');
  const nextTypesDir = path.join(__dirname, '.next', 'types');
  for (const generatedTypeDir of [nextDevDir, nextTypesDir]) {
    if (fs.existsSync(generatedTypeDir)) {
      fs.rmSync(generatedTypeDir, { recursive: true, force: true });
    }
  }
}

cleanNextCache();

let buildError = null;

function moveApiDirForBuild() {
  if (fs.existsSync(tempApiDir) && !fs.existsSync(apiDir)) {
    fs.renameSync(tempApiDir, apiDir);
    return;
  }

  if (!fs.existsSync(apiDir)) {
    return;
  }

  try {
    fs.renameSync(apiDir, tempApiDir);
    return;
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      console.warn('  ⚠ Rename blocked by Windows file lock; using copy-and-remove fallback.');
      fs.cpSync(apiDir, tempApiDir, { recursive: true, force: true });
      fs.rmSync(apiDir, { recursive: true, force: true });
      return;
    }
    throw error;
  }
}

function restoreApiDir() {
  if (!fs.existsSync(tempApiDir)) {
    return;
  }

  try {
    if (fs.existsSync(apiDir)) {
      fs.rmSync(apiDir, { recursive: true, force: true });
    }
    fs.renameSync(tempApiDir, apiDir);
  } catch (error) {
    console.warn('  ⚠ Could not restore API directory with rename; copying back instead.', error.message);
    if (fs.existsSync(apiDir)) {
      fs.rmSync(apiDir, { recursive: true, force: true });
    }
    fs.cpSync(tempApiDir, apiDir, { recursive: true, force: true });
    fs.rmSync(tempApiDir, { recursive: true, force: true });
  }
}

try {
  moveApiDirForBuild();
  cleanDevTypeValidators();

  execSync('npx next build', {
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_PUBLIC_BASE_PATH: ''
    }
  });

  // Create a zip of the 'out' folder for easy upload to Hostinger
  console.log('Build completed. Packaging /out into dist.zip...');
  if (fs.existsSync('dist.zip')) {
    try {
      fs.unlinkSync('dist.zip');
    } catch (e) {
      console.warn('Warning: Could not delete old dist.zip, proceeding with -Force overwrite.');
    }
  }
  if (process.platform === 'win32') {
    execSync('powershell "Compress-Archive -Path out\\* -DestinationPath dist.zip -Force"', { stdio: 'inherit' });
  } else {
    execSync('zip -r dist.zip out/*', { stdio: 'inherit' });
  }
  console.log('✅ dist.zip updated successfully for Hostinger deployment!');
} catch (error) {
  buildError = error;
  console.error('Build failed:', error);
} finally {
  restoreApiDir();
  if (buildError) {
    process.exit(1);
  }
}

