// Check a report.json against the report contract: schema/report.schema.json
// plus the rules in src/lib/validate.ts. Prints every error and warning with
// its JSON path; exits 1 when there are errors.
//
//   node tools/check.mjs <report.json>
//
// The checker doesn't know whether the reel's real stats were given, so a
// missing performanceReview is not an error here; a present one is checked.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReportSchema, validateReport } from '../src/lib/validate.ts';

function main(file) {
    if (!file) {
        console.error('Usage: node tools/check.mjs <report.json>');
        return 1;
    }

    let report;
    try {
        report = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
        console.log(`ERROR /: not readable as JSON (${error.message})`);
        return 1;
    }

    // The schema sits next to this script's repo, wherever it is run from
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const { errors, warnings } = validateReport(report, loadReportSchema(root));
    for (const issue of errors) console.log(`ERROR ${issue.path || '/'}: ${issue.message}`);
    for (const issue of warnings) console.log(`WARN  ${issue.path || '/'}: ${issue.message}`);
    const tally = `${errors.length} error(s), ${warnings.length} warning(s)`;
    console.log(errors.length ? `${file}: ${tally}` : `${file}: OK (${tally})`);
    return errors.length ? 1 : 0;
}

// exitCode, not exit(): lets stdout drain when it is a pipe
process.exitCode = main(process.argv[2]);
