import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'vendor/assets/makehuman-core');
const output = path.join(root, '.build/characters');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(path.join(source, 'base.obj'));
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'provenance.json')));
if (digest(bytes) !== manifest.files['base.obj'].sha256) throw new Error('Source mesh differs from reviewed asset');
const vertices = [], uv = [], faces = [];
let group = '';
for (const line of bytes.toString('utf8').split(/\r?\n/)) {
  if (line.startsWith('v ')) vertices.push(line);
  else if (line.startsWith('vt ')) uv.push(line);
  else if (line.startsWith('g ')) group = line.slice(2).trim();
  else if (line.startsWith('f ') && group === 'body') {
    const corners = line.slice(2).trim().split(/\s+/).map(value => {
      const [v, t] = value.split('/').map(Number);
      if (!Number.isInteger(v) || v < 1 || v > vertices.length || !Number.isInteger(t) || t < 1 || t > uv.length) throw new Error('Unsupported mesh indexing');
      return [v, t];
    });
    if (corners.length < 3 || corners.length > 4) throw new Error('Unexpected polygon');
    faces.push(corners);
  }
}
if (faces.length < 1000) throw new Error('Incomplete body mesh');
const selectedVertices = [...new Set(faces.flat().map(c => c[0]))].sort((a,b)=>a-b);
const selectedUv = [...new Set(faces.flat().map(c => c[1]))].sort((a,b)=>a-b);
const vMap = new Map(selectedVertices.map((v,i)=>[v,i+1]));
const tMap = new Map(selectedUv.map((v,i)=>[v,i+1]));
const text = ['# MakeHuman core body; CC0; see vendor/assets/makehuman-core/provenance.json',
  ...selectedVertices.map(i=>vertices[i-1]), ...selectedUv.map(i=>uv[i-1]), 'g body',
  ...faces.map(f=>'f '+f.map(([v,t])=>`${vMap.get(v)}/${tMap.get(t)}`).join(' ')), ''].join('\n');
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'body.obj'),text);
const report = { sourceCommit: manifest.commit, sourceSha256: digest(bytes), outputSha256: digest(text),
  vertices:selectedVertices.length, polygons:faces.length, triangles:faces.reduce((n,f)=>n+f.length-2,0),
  removed:'All helper and joint geometry; unused vertices and UV coordinates',
  retained:'Body topology and UV coordinates', qualification:'Geometry preparation only; clothing, skin, rig and visual approval pending', activated:false };
fs.writeFileSync(path.join(output,'preparation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
