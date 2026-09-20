import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const source=resolve(root,'vendor/upstream/bilawalsidhu/gods-eye-view');
const stage=resolve(root,'.build/globe');
assert.equal(process.versions.node,'24.14.0');
assert.equal(existsSync(resolve(stage,'src/data/local_data/telegeography_submarine_cables')),false);
assert(!readFileSync(resolve(stage,'src/data/localLayers.js'),'utf8').includes('submarineCablesLayer'));
assert.equal(readFileSync(resolve(stage,'package-lock.json'),'utf8'),readFileSync(resolve(source,'package-lock.json'),'utf8'));
for(const [a,b] of [['LICENSE','LICENSE'],['DATA_SOURCES.md','DATA_SOURCES.md'],['public/models/README.md','MODEL-ATTRIBUTION.md']]) {
 assert.deepEqual(readFileSync(resolve(source,a)),readFileSync(resolve(stage,'dist/licenses',b)));
}
function walk(p){return readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(p,e.name)):[resolve(p,e.name)]);}
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const excluded=new Set(walk(resolve(source,'src/data/local_data/telegeography_submarine_cables')).map(hash));
for(const p of walk(resolve(stage,'dist'))) assert(!excluded.has(hash(p)),`Excluded data found: ${p}`);
assert(existsSync(resolve(stage,'dist/index.html')));
assert(readFileSync(resolve(stage,'dist/index.html'),'utf8').includes('/licenses/index.html'));
assert(readFileSync(resolve(stage,'dist/licenses/index.html'),'utf8').includes('CC BY 4.0'));
console.log('PASS: qualified Node, unchanged dependency lock, excluded cable payloads and registry, retained exact notices, built index.');
