/**
 * Usage: node scripts/fetch-club-competitions.mjs "<club>" <date> [--all]
 * Par défaut : compétitions U14 / U16 uniquement.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCompetitionsForClubOnDate,
  normalizeClubName,
} from '../lib/athle-club.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const args = process.argv.slice(2);
const allCategories = args.includes('--all');
const positional = args.filter((a) => a !== '--all');
const club = positional[0];
const dateArg = positional[1];

if (!club || !dateArg) {
  console.error('Usage: node scripts/fetch-club-competitions.mjs "<club>" <date> [--all]');
  process.exit(1);
}

const result = await getCompetitionsForClubOnDate(dateArg, club, {
  youthCategories: allCategories ? false : undefined,
});

const slug = normalizeClubName(club).replace(/\s+/g, '-').slice(0, 40);
const outDir = join(root, 'output');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, `club-${slug}-${result.date}.json`);
await writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');

console.log(JSON.stringify({ ...result, outPath }, null, 2));
