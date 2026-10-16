#!/usr/bin/env node
// Exercise the real game functions with a seeded RNG and rendering/audio stubbed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const current = readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');

function game(source, seed = 1, fixedRandom) {
  const math = Object.create(Math);
  math.random = fixedRandom === undefined ? () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  } : () => fixedRandom;
  const element = () => ({
    getContext: () => ({}), addEventListener() {},
    classList: { toggle() {}, remove() {} }, style: {},
  });
  const elements = new Map();
  const window = { addEventListener() {} };
  const context = {
    window, Math: math, navigator: {}, localStorage: { getItem: () => null },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      querySelector: element, addEventListener() {},
    },
  };
  const boot = '  refreshBest();\n  resize();\n  requestAnimationFrame(frame);';
  assert.ok(source.includes(boot), 'Headless boot must match the real game');
  vm.runInNewContext(source.replace(boot, `
    Object.assign(window.__koala, {
      reset() { newGame(); state = 'play'; },
      spawnMoses, strike, collect, addRally, updateStampede, updateHud,
      readHud() { return { count: hud.count.textContent,
        ringOffset: Number(hud.ring.style.strokeDashoffset) }; },
      rules: { maxCharges: MAX_CHARGES,
        rallyPerCharge: typeof RALLY_PER_CHARGE === 'undefined' ? 100 : RALLY_PER_CHARGE },
    });
  `), context);
  const api = window.__koala;
  api.reset();
  return api;
}

function collectLeaves(api) {
  for (const it of api.g.pickups) {
    if (!it.taken && it.type === 'leaves') api.collect(it);
  }
}

function sweep(api, size, type = 'walker') {
  api.g.moses = [];
  api.g.pickups = [];
  for (let i = 0; i < size; i++) {
    api.spawnMoses(type, 80 + (i % 6) * 45, 300);
    // A boss already softened up enough for the stampede to finish him.
    if (type === 'boss') api.g.moses.at(-1).hp = 4;
  }
  const before = api.g.cuddled;
  api.stampede();
  for (let i = 0; i < 100; i++) api.updateStampede(1 / 60);
  collectLeaves(api); // Best case: every dropped leaf is collected for free.
  assert.equal(api.g.cuddled - before, size);
  // Discard expired visual effects between encounters.
  api.g.particles = [];
  api.g.texts = [];
  api.g.banners = [];
}

function consecutiveSweeps(source, size, seed) {
  const api = game(source, seed);
  let used = 0;
  while (api.g.charges > 0 && used < 100) {
    sweep(api, size);
    used++;
  }
  return used;
}

function manualKillsToCharge(source, chain, leaves) {
  const api = game(source, 1, 0.99); // No random leaf drops.
  api.g.charges = 0;
  let kills = 0;
  while (!api.g.charges && kills < 1000) {
    api.spawnMoses('walker', 200, 300);
    api.strike(api.g.moses.at(-1), kills % chain + 1);
    kills++;
    api.g.moses = [];
    if (leaves && kills % 4 === 0) api.collect({ type: 'leaves', x: 200, y: 300 });
  }
  return kills;
}

function report(source, label) {
  const api = game(source);
  api.addRally(10000);
  const bank = { charges: api.g.charges, overflow: api.g.rally };
  const rows = [6, 8, 10, 12, 20, 40].map(size => {
    const runs = Array.from({ length: 100 }, (_, seed) => consecutiveSweeps(source, size, seed));
    return {
      'Moseses per sweep': size,
      'mean consecutive uses': +(runs.reduce((a, b) => a + b, 0) / runs.length).toFixed(2),
      'runs reaching 100 uses': `${runs.filter(n => n === 100).length}/100`,
    };
  });
  console.log(`\n${label}: ${api.rules.rallyPerCharge} rally/use; bank ${bank.charges} + ${bank.overflow} rally overflow`);
  console.table(rows);
  console.log('Manual kills for a new use (no random drops):', {
    singles: manualKillsToCharge(source, 1, false),
    'perfect four-hit chains': manualKillsToCharge(source, 4, false),
    'four-hit chains + a leaf every four kills': manualKillsToCharge(source, 4, true),
  });
}

function check() {
  const api = game(current, 1, 0); // Force every eligible random drop.
  assert.equal(api.g.charges, 1, 'Keep the starting safety-net stampede');
  api.addRally(10000);
  assert.equal(api.g.charges, 2);
  assert.equal(api.g.rally, 0, 'A full bank must not hide a third charge');
  sweep(api, 40);
  assert.equal(api.g.charges, 1);
  assert.equal(api.g.rally, 0, 'Stampede kills and drops cannot refund charge');
  assert.equal(api.g.pickups.filter(it => it.type === 'leaves').length, 0);
  const score = api.g.score;
  sweep(api, 1, 'boss');
  assert.equal(api.g.charges, 0);
  assert.equal(api.g.rally, 0, 'A boss finished by a stampede cannot refund charge');
  assert.ok(api.g.score > score, 'Stampede boss kills still award score');
  assert.ok(api.g.pickups.some(it => it.type === 'flag'), 'Keep boss recruitment drops');
  assert.equal(api.g.pickups.filter(it => it.type === 'leaves').length, 0);

  api.reset();
  api.g.charges = 0;
  api.addRally(149);
  assert.equal(api.g.charges, 0);
  api.addRally(10);
  assert.equal(api.g.charges, 1);
  assert.equal(api.g.rally, 9, 'Keep partial progress while below the cap');
  api.addRally(1000);
  assert.equal(api.g.charges, 2);
  assert.equal(api.g.rally, 0, 'Discard overflow on reaching the cap');

  api.reset();
  api.g.charges = 0;
  api.spawnMoses('walker', 200, 300);
  api.strike(api.g.moses.at(-1), 4);
  assert.equal(api.g.rally, 15, 'Keep skill rewards for manual chain kills');
  assert.equal(api.g.pickups.length, 1, 'Manual kills still drop leaves');
  collectLeaves(api);
  assert.equal(api.g.rally, 40, 'Leaves give 25 rally');
  api.g.rally = 75;
  api.updateHud();
  assert.equal(api.readHud().ringOffset, 144.5, 'HUD uses the new 150-rally threshold');
  api.addRally(1000);
  api.updateHud();
  assert.equal(api.readHud().count, '2');
  assert.equal(api.readHud().ringOffset, 0, 'Full bank displays a full ring');
  api.stampede();
  api.updateHud();
  assert.equal(api.readHud().ringOffset, 289, 'Spending from full starts an empty meter');

  api.reset();
  api.g.charges = 0;
  api.spawnMoses('boss', 200, 300);
  api.strike(api.g.moses.at(-1), 1);
  assert.equal(api.g.rally, 4, 'Manual boss hits still charge rally');
  api.g.moses.at(-1).hp = 1;
  api.strike(api.g.moses.at(-1), 1);
  assert.equal(api.g.rally, 64, 'Manual boss finishes keep the boss reward');
  collectLeaves(api);
  assert.equal(api.g.rally, 89);
  console.log('\nBalance regression checks passed.');
}

const args = process.argv.slice(2);
const compareAt = args.indexOf('--compare-ref');
if (compareAt !== -1) {
  assert.ok(args[compareAt + 1], '--compare-ref needs a Git revision');
  const previous = execFileSync('git', ['show', `${args[compareAt + 1]}:public/game.js`], { cwd: root, encoding: 'utf8' });
  report(previous, args[compareAt + 1]);
}
report(current, 'Working tree');
if (args.includes('--check')) check();
