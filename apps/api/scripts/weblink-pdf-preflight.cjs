#!/usr/bin/env node
/**
 * Weblink PDF readiness preflight (dependency-free, plain Node).
 *
 * Verifies that headless Chromium (Playwright) can actually launch on THIS
 * host — the exact runtime dependency of server-side Weblink PDF generation.
 * Run after provisioning or when `Generate PDF (Weblink)` fails with a
 * browser error. Exits 0 when ready, 1 otherwise, with remediation steps.
 *
 * Usage: node apps/api/scripts/weblink-pdf-preflight.cjs [--json]
 */
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const failures = [];
const notes = [];

function browsersDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  return path.join(os.homedir(), '.cache', 'ms-playwright');
}

function findBinary(dir, names) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of names) {
      const candidate = path.join(dir, entry.name, 'chrome-linux', name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        /* not executable here */
      }
    }
  }
  return null;
}

function expectedPlaywrightVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
    );
    return (
      pkg.dependencies?.playwright ?? pkg.devDependencies?.playwright ?? null
    );
  } catch {
    return null;
  }
}

async function main() {
  const json = process.argv.includes('--json');
  const dir = browsersDir();
  const shell = findBinary(dir, ['headless_shell', 'headless-shell']);
  const chrome = findBinary(dir, ['chrome', 'chromium', 'headless_shell']);
  const binary = shell ?? chrome;
  if (!binary) {
    failures.push(
      `No Chromium executable under ${dir}. Install the pinned Playwright browsers with: ` +
        `npx -y playwright@${expectedPlaywrightVersion() ?? '<version>'} install chromium ` +
        `(add --with-deps where the OS is supported; see DEPLOYMENT.md otherwise).`,
    );
  } else {
    notes.push(`browser=${binary}`);
    try {
      const out = execFileSync(binary, ['--version'], { timeout: 30_000 }).toString().trim();
      notes.push(`browser-version=${out}`);
    } catch (error) {
      failures.push(`Browser binary failed to report its version: ${error.message?.split('\n')[0] ?? error}`);
    }
    try {
      const ldd = execSync(`ldd "${binary}" 2>&1 || true`, { timeout: 30_000 }).toString();
      const missing = [...new Set(
        ldd.split('\n').filter((l) => l.includes('not found')).map((l) => l.trim().split(' ')[0]),
      )];
      if (missing.length > 0) {
        failures.push(
          `Missing shared libraries for ${path.basename(binary)}: ${missing.join(', ')}. ` +
            `Install the OS packages providing them (e.g. libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0 — names vary by distro).`,
        );
      } else {
        notes.push('shared-libraries=ok');
      }
    } catch (error) {
      failures.push(`ldd check failed: ${error.message?.split('\n')[0] ?? error}`);
    }
    if (failures.length === 0) {
      try {
        const html = execFileSync(
          binary,
          ['--headless', '--disable-gpu', '--no-first-run', '--dump-dom', 'about:blank'],
          { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
        ).toString();
        if (!html.includes('<html')) throw new Error('no HTML document produced');
        notes.push('launch-smoke-test=ok');
      } catch (error) {
        failures.push(
          `Browser launch smoke test failed: ${(error.message ?? String(error)).split('\n')[0]}. ` +
            `If this is a sandbox error, check unprivileged user namespaces on this host.`,
        );
      }
    }
  }
  const result = { ok: failures.length === 0, notes, failures };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const n of notes) console.log(`ok: ${n}`);
    for (const f of failures) console.log(`FAIL: ${f}`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`FAIL: preflight crashed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
