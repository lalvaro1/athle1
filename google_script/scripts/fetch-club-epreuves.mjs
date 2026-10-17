/**
 * Usage: node scripts/fetch-club-epreuves.mjs <frmcompetition> "<club>"
 * Exemple: node scripts/fetch-club-epreuves.mjs 319050 "Ca Beglais"
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClubEpreuvesInCompetition } from '../lib/athle-epreuves.js';
import { normalizeClubName } from '../lib/athle-club.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const competitionId = process.argv[2];
const club = process.argv[3];
if (!competitionId || !club) {
  console.error('Usage: node scripts/fetch-club-epreuves.mjs <frmcompetition> "<club>"');
  process.exit(1);
}

const result = await getClubEpreuvesInCompetition(competitionId, club);
const slug = normalizeClubName(club).replace(/\s+/g, '-').slice(0, 30);
const outDir = join(root, 'output');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, `epreuves-${competitionId}-${slug}.json`);
await writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');

console.log(JSON.stringify({ ...result, outPath }, null, 2));
