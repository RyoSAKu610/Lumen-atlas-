/** Validate every data file against its schema and cross-references. Exit code 1 on errors. */
import { loadGameData } from '../src/data/load';

const { data, diagnostics } = loadGameData();
const errors = diagnostics.filter((d) => d.severity === 'error');
const warnings = diagnostics.filter((d) => d.severity === 'warning');

for (const d of diagnostics) {
  const tag = d.severity === 'error' ? 'ERROR  ' : 'warning';
  console.log(`${tag} ${d.file} :: ${d.path} :: ${d.message}`);
}
if (data) {
  console.log(
    `OK — region ${data.region.id}, ${data.species.length} species, ${Object.keys(data.art.creatures).length} creature looks, ` +
      `${Object.keys(data.narration.templates).length} narration templates, ${data.shots.shots.length} shots ` +
      `(${warnings.length} warning(s)).`,
  );
} else {
  console.log(`FAILED — ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
