#!/usr/bin/env node
/**
 * Builds the Codex of Ascension from data/classes.json:
 *   - index.html   (self-contained UI, data inlined from tools/template.html)
 *   - docs/*.md    (written progression, one file per class, plus an index)
 *
 * Usage: node tools/build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'classes.json');
const TEMPLATE_PATH = path.join(__dirname, 'template.html');
const DOCS_DIR = path.join(ROOT, 'docs');

const TIER = {
  1: { n: 'I', label: 'Initiate', lv: 1 },
  2: { n: 'II', label: 'Adept', lv: 10 },
  3: { n: 'III', label: 'Specialist', lv: 25 },
  4: { n: 'IV', label: 'Elite', lv: 40 },
  5: { n: 'V', label: 'Mythic', lv: 60 },
};

// Fixed topology every family must follow: suffix -> [tier, parentSuffix]
const TOPOLOGY = {
  t1: [1, null],
  t2a: [2, 't1'], t2b: [2, 't1'],
  t3a: [3, 't2a'], t3b: [3, 't2a'], t3c: [3, 't2b'], t3d: [3, 't2b'],
  t4a: [4, 't3a'], t4b: [4, 't3b'], t4c: [4, 't3c'], t4d: [4, 't3d'],
  t5a: [5, 't4a'], t5b: [5, 't4b'], t5c: [5, 't4c'], t5d: [5, 't4d'],
};

function fail(msg) { console.error('BUILD FAILED: ' + msg); process.exit(1); }

function validate(data) {
  const problems = [];
  const globalNames = new Map();
  if (!Array.isArray(data.families) || !data.families.length) fail('data.families missing or empty');
  for (const f of data.families) {
    const where = `family "${f.id}"`;
    for (const k of ['id', 'name', 'archetype', 'icon', 'tagline', 'description']) {
      if (!f[k] || typeof f[k] !== 'string') problems.push(`${where}: missing field "${k}"`);
    }
    if (!Array.isArray(f.nodes) || f.nodes.length !== Object.keys(TOPOLOGY).length) {
      problems.push(`${where}: expected ${Object.keys(TOPOLOGY).length} nodes, got ${f.nodes ? f.nodes.length : 0}`);
      continue;
    }
    const byId = new Map(f.nodes.map(n => [n.id, n]));
    for (const [suffix, [tier, parentSuffix]] of Object.entries(TOPOLOGY)) {
      const id = `${f.id}.${suffix}`;
      const n = byId.get(id);
      if (!n) { problems.push(`${where}: missing node ${id}`); continue; }
      const expectedParent = parentSuffix ? `${f.id}.${parentSuffix}` : null;
      if (n.tier !== tier) problems.push(`${id}: tier ${n.tier}, expected ${tier}`);
      if (n.level !== TIER[tier].lv) problems.push(`${id}: level ${n.level}, expected ${TIER[tier].lv}`);
      if ((n.parent || null) !== expectedParent) problems.push(`${id}: parent ${n.parent}, expected ${expectedParent}`);
      for (const k of ['name', 'role', 'lore', 'playstyle']) {
        if (!n[k] || typeof n[k] !== 'string') problems.push(`${id}: missing field "${k}"`);
      }
      if (!Array.isArray(n.abilities) || n.abilities.length < 3 || n.abilities.length > 4 ||
          n.abilities.some(a => !a.name || !a.desc)) {
        problems.push(`${id}: abilities must be 3-4 of {name, desc}`);
      }
      if (!Array.isArray(n.progressionSteps) || n.progressionSteps.length < 3 || n.progressionSteps.length > 5 ||
          n.progressionSteps.some(s => typeof s !== 'string' || !s.trim())) {
        problems.push(`${id}: progressionSteps must be 3-5 non-empty strings`);
      }
      const key = String(n.name).trim().toLowerCase();
      if (globalNames.has(key)) console.warn(`  warning: rank name "${n.name}" used by both ${globalNames.get(key)} and ${id}`);
      else globalNames.set(key, id);
    }
  }
  if (problems.length) fail('\n  ' + problems.join('\n  '));
}

function buildHtml(data) {
  const tpl = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const marker = '/*__DATA__*/null';
  if (!tpl.includes(marker)) fail(`template is missing the ${marker} marker`);
  // </script> inside the JSON payload would terminate the script tag early
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  fs.writeFileSync(path.join(ROOT, 'index.html'), tpl.replace(marker, json));
}

function asciiTree(f) {
  const n = suffix => f.nodes.find(x => x.id === `${f.id}.${suffix}`);
  const tag = suffix => { const x = n(suffix); return `${x.name} (Lv ${x.level})`; };
  const chain = (a, b, c) => `${tag(a)} → ${tag(b)} → ${tag(c)}`;
  return [
    tag('t1'),
    `├── ${tag('t2a')}`,
    `│   ├── ${chain('t3a', 't4a', 't5a')}`,
    `│   └── ${chain('t3b', 't4b', 't5b')}`,
    `└── ${tag('t2b')}`,
    `    ├── ${chain('t3c', 't4c', 't5c')}`,
    `    └── ${chain('t3d', 't4d', 't5d')}`,
  ].join('\n');
}

function familyDoc(f) {
  const lines = [];
  lines.push(`# ${f.icon} ${f.name}`);
  lines.push('');
  lines.push(`> *${f.tagline}*`);
  lines.push('');
  lines.push(`**Archetype:** ${f.archetype}`);
  lines.push('');
  lines.push(f.description);
  lines.push('');
  lines.push('## The Tree');
  lines.push('');
  lines.push('```text');
  lines.push(asciiTree(f));
  lines.push('```');
  for (let tier = 1; tier <= 5; tier++) {
    const t = TIER[tier];
    lines.push('');
    lines.push(`## Tier ${t.n} — ${t.label} (Level ${t.lv})`);
    for (const n of f.nodes.filter(x => x.tier === tier)) {
      const parent = n.parent ? f.nodes.find(x => x.id === n.parent) : null;
      lines.push('');
      lines.push(`### ${n.name}`);
      lines.push('');
      lines.push(`**Role:** ${n.role}${parent ? ` · **Advances from:** ${parent.name}` : ''}`);
      lines.push('');
      lines.push(`*${n.lore}*`);
      lines.push('');
      lines.push(`**Playstyle.** ${n.playstyle}`);
      lines.push('');
      lines.push(n.tier === 1 ? '**Taking the first step:**' : `**The road to ${n.name}:**`);
      lines.push('');
      n.progressionSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
      lines.push('');
      lines.push('**Abilities granted:**');
      lines.push('');
      for (const a of n.abilities) lines.push(`- **${a.name}** — ${a.desc}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function docsIndex(data) {
  const lines = ['# The Codex of Ascension — Written Progression', ''];
  lines.push('Every class, every rank, every step — the full written progression behind [the interactive codex](../index.html).');
  lines.push('');
  lines.push('| Origin | Archetype | Tagline |');
  lines.push('|---|---|---|');
  for (const f of data.families) {
    lines.push(`| ${f.icon} [${f.name}](./${f.id}.md) | ${f.archetype} | *${f.tagline}* |`);
  }
  lines.push('');
  lines.push('Each origin holds 15 ranks across 5 tiers — Initiate (Lv 1), Adept (Lv 10), Specialist (Lv 25), Elite (Lv 40), Mythic (Lv 60) — branching into 4 mythic destinies.');
  lines.push('');
  return lines.join('\n');
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
validate(data);
buildHtml(data);
fs.mkdirSync(DOCS_DIR, { recursive: true });
for (const f of data.families) fs.writeFileSync(path.join(DOCS_DIR, `${f.id}.md`), familyDoc(f));
fs.writeFileSync(path.join(DOCS_DIR, 'README.md'), docsIndex(data));

const nNodes = data.families.reduce((a, f) => a + f.nodes.length, 0);
console.log(`OK: built index.html and docs/ for ${data.families.length} families, ${nNodes} ranks.`);
