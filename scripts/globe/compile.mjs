import {pathToFileURL, fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const target=resolve(root,'.build/globe');
process.chdir(target);
try {
  const {build}=await import(pathToFileURL(resolve(target,'node_modules/vite/dist/node/index.js')).href);
  await build({root:target});
  // Upstream's proxy config keeps timers alive. Vite build has fully resolved;
  // this disposable compilation process must not become a background service.
  process.exit(0);
} catch(error) {
  console.error(error); process.exit(1);
}
