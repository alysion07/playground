#!/usr/bin/env node
// Root build orchestrator:
// 1. copy gallery (index.html + site/) into dist/
// 2. build each registered toy and copy its dist into dist/<subpath>/
//
// Run:  npm run build  (or node build.mjs)

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST = join(ROOT, 'dist');

const TOYS = [
  {
    name: 'metaball',
    dir: 'metaball-playground',
    base: '/metaball/',
  },
  {
    name: 'slime',
    dir: 'slime-tower',
    base: '/slime/',
  },
  {
    name: 'erosion',
    dir: 'erosion-sculptor',
    base: '/erosion/',
  },
  {
    name: 'fillet',
    dir: 'fillet-studio',
    base: '/fillet/',
  },
];

function log(msg) {
  process.stdout.write(`\x1b[36m▶\x1b[0m ${msg}\n`);
}

function run(cmd, opts) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function cleanDist() {
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
}

function copyGallery() {
  log('copying gallery (index.html + site/)');
  cpSync(join(ROOT, 'index.html'), join(DIST, 'index.html'));
  const siteDir = join(ROOT, 'site');
  if (existsSync(siteDir) && statSync(siteDir).isDirectory()) {
    cpSync(siteDir, join(DIST, 'site'), { recursive: true });
  }
}

function buildToy(toy) {
  const toyDir = join(ROOT, toy.dir);
  if (!existsSync(toyDir)) {
    log(`skip: ${toy.name} (missing dir)`);
    return;
  }
  log(`installing deps for: ${toy.name}`);
  run('npm install --no-audit --no-fund --prefer-offline', { cwd: toyDir });
  log(`building toy: ${toy.name} (base=${toy.base})`);
  run('npm run build', {
    cwd: toyDir,
    env: { ...process.env, BASE_PATH: toy.base },
  });
  const fromDist = join(toyDir, 'dist');
  const toDist = join(DIST, toy.name);
  if (!existsSync(fromDist)) {
    throw new Error(`[build.mjs] ${toy.name} produced no dist/ at ${fromDist}`);
  }
  cpSync(fromDist, toDist, { recursive: true });
  log(`  → ${resolve(toDist)}`);
}

function main() {
  cleanDist();
  copyGallery();
  for (const toy of TOYS) buildToy(toy);
  log(`done. dist/ ready at ${resolve(DIST)}`);
}

main();
