/**
 * Usage: node scripts/fetch-clubs.mjs <frmcompetition> [frmcompetition...]
 * Exemple: node scripts/fetch-clubs.mjs 319050
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClubsForCompetition } from '../lib/athle-results.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('Usage: node scripts/fetch-clubs.mjs <ID compétition> [...]');
  process.exit(1);
}

for (const id of ids) {
  const result = await getClubsForCompetition(id);
  const outDir = join(root, 'output');
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `clubs-${id}.json`);
  await writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(
    JSON.stringify(
      {
        competitionId: result.competitionId,
        title: result.title,
        count: result.count,
        clubs: result.clubs,
        outPath,
      },
      null,
      2,
    ),
  );
}
