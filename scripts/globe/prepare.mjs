import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(root, 'vendor/upstream/bilawalsidhu/gods-eye-view');
const target = resolve(root, '.build/globe');
const pin = '759652207fd1279ece97f0f19af566feb9a82146';
if (execFileSync('git', ['rev-parse', 'HEAD'], {cwd: source, encoding:'utf8'}).trim() !== pin) throw Error('Unexpected upstream revision');
if (execFileSync('git', ['status', '--porcelain'], {cwd: source, encoding:'utf8'}).trim()) throw Error('Upstream must be clean');
const noticesOnly = process.argv.includes('--refresh-notices');
if (existsSync(target) && !noticesOnly) throw Error('Staging destination already exists; preserve it and review before regenerating.');
const files = execFileSync('git', ['ls-files', '-z'], {cwd: source, encoding:'utf8'}).split('\0').filter(Boolean);
const excluded = files.filter(p => p.startsWith('src/data/local_data/telegeography_submarine_cables/'));
if (!noticesOnly) {
for (const p of files.filter(p => !excluded.includes(p))) {
  mkdirSync(dirname(resolve(target,p)), {recursive:true}); copyFileSync(resolve(source,p), resolve(target,p));
}
const registryPath = resolve(target,'src/data/localLayers.js');
const registry = readFileSync(registryPath,'utf8');
if (!registry.includes("import submarineCablesLayer from './telegeographySubmarineCables.js';") || !registry.includes('  submarineCablesLayer,')) throw Error('Registry changed');
writeFileSync(registryPath, registry.replace("import submarineCablesLayer from './telegeographySubmarineCables.js';", '// PARADIZE: noncommercial cable layer excluded from this build.').replace('  submarineCablesLayer,',''));
// The overlay worker imports cable geometry utilities; keep those MIT functions
// but remove references to the excluded payloads, without inventing observations.
const cablePath = resolve(target,'src/data/telegeographySubmarineCables.js');
const cable = readFileSync(cablePath,'utf8');
writeFileSync(cablePath, cable.replace('./local_data/telegeography_submarine_cables/cable-geo.json','./local_data/paradize-empty.geojson').replace('./local_data/telegeography_submarine_cables/landing-point-geo.json','./local_data/paradize-empty.geojson'));
writeFileSync(resolve(target,'src/data/local_data/paradize-empty.geojson'), JSON.stringify({type:'FeatureCollection',features:[]}));
}
// Ship the exact notices alongside the distributable, not only source docs.
const notices = resolve(target,'public/licenses'); mkdirSync(notices,{recursive:true});
const escapeHtml = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
writeFileSync(resolve(notices,'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>PARADIZE Globe attribution</title><h1>PARADIZE Globe attribution</h1><p>Adapted from Gods Eye View by Bilawal Sidhu. The noncommercial cable dataset is excluded.</p>' + ['LICENSE','DATA_SOURCES.md','public/models/README.md'].map(p => '<h2>'+escapeHtml(p)+'</h2><pre style="white-space:pre-wrap">'+escapeHtml(readFileSync(resolve(source,p),'utf8'))+'</pre>').join('')+'</html>');
const indexPath = resolve(target,'index.html');
if (!readFileSync(indexPath,'utf8').includes('/licenses/index.html')) writeFileSync(indexPath, readFileSync(indexPath,'utf8').replace('</body>', '<a href="/licenses/index.html" target="_blank" rel="noopener" style="position:fixed;top:4px;right:4px;z-index:2147483647;background:#111;color:#fff;padding:6px;font:12px sans-serif">Source &amp; asset credits</a>\n</body>'));
for (const p of ['LICENSE','DATA_SOURCES.md','public/models/README.md']) copyFileSync(resolve(source,p),resolve(notices,p==='public/models/README.md'?'MODEL-ATTRIBUTION.md':p));
writeFileSync(resolve(notices,'PARADIZE-NOTICE.txt'), 'PARADIZE Globe: adapted from Gods Eye View by Bilawal Sidhu (MIT code). TeleGeography dataset and layer excluded. Model creator, source, license and modification notices retained in MODEL-ATTRIBUTION.md. ODbL datasets remain separate from PARADIZE private records. This is a local build candidate; live-provider and Unity qualification remain pending.\n');
writeFileSync(resolve(root,'docs/integrations/globe-build-inventory.json'),JSON.stringify({commit:pin,node:'24.14.0',excluded,models:files.filter(p=>p.startsWith('public/models/')),status:'prepared; runtime and live providers not qualified'},null,2)+'\n');
console.log('Prepared .build/globe; excluded '+excluded.length+' restricted dataset files; upstream preserved.');
