/**
 * CLI — compétitions athle.fr sur une plage de dates.
 * Usage: node scripts/fetch-competition-ids.mjs [YYYY-MM-DD] [YYYY-MM-DD]
 * Sans arguments : hier → aujourd'hui.

 */



import { writeFile, mkdir } from 'node:fs/promises';

import { join, dirname } from 'node:path';

import { fileURLToPath } from 'node:url';

import {

  getCompetitionsForDateRange,

  isoLocalDate,

  yesterdayAndTodayRange,

} from '../lib/athle-calendar.js';



const __dirname = dirname(fileURLToPath(import.meta.url));

const root = join(__dirname, '..');



async function main() {

  const args = process.argv.slice(2);

  let dateFrom;

  let dateTo;

  if (args.length >= 2) {

    dateFrom = args[0];

    dateTo = args[1];

  } else {

    const { from, to } = yesterdayAndTodayRange();

    dateFrom = isoLocalDate(from);

    dateTo = isoLocalDate(to);

  }



  const result = await getCompetitionsForDateRange(dateFrom, dateTo);



  const outDir = join(root, 'output');

  await mkdir(outDir, { recursive: true });

  const outPath = join(outDir, 'competition-ids.json');

  await writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');



  console.log(

    JSON.stringify(

      {

        dateFrom: result.dateFrom,

        dateTo: result.dateTo,

        count: result.count,

        resultsIds: result.resultsIds,

        outPath,

      },

      null,

      2,

    ),

  );

}



main().catch((e) => {

  console.error(e);

  process.exit(1);

});


