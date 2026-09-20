import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createEncryptedBackup, restoreEncryptedBackup } from './backup.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [command, input, downloadedArchive] = process.argv.slice(2);
if (command === 'prepare') {
  const root = path.resolve('.runtime/recovery', randomUUID());
  for (const name of ['source', 'archives', 'keys']) await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(path.join(root, 'source', 'fixture.json'), JSON.stringify({ synthetic: true, owner: 'fictional-owner', records: [{ id: 'fixture-1', uncertainty: 'unverified' }], paidUsage: 0 }));
  await fs.writeFile(path.join(root, 'source', 'README.txt'), 'Synthetic PARADIZE recovery fixture. No personal records or credentials.\n');
  const archivePath = path.join(root, 'archives', 'PARADIZE-synthetic-recovery.pzb');
  const keyPath = path.join(root, 'keys', 'synthetic.key');
  const summary = await createEncryptedBackup({ sourceDir: path.join(root, 'source'), archivePath, keyPath });
  const prepared = { root, archivePath, keyPath, summary, sha256: hash(await fs.readFile(archivePath)), syntheticOnly: true };
  const receipt = path.join(root, 'prepared.json');
  await fs.writeFile(receipt, JSON.stringify(prepared, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ receipt, archivePath, sha256: prepared.sha256, summary }));
} else if (command === 'verify' && input && downloadedArchive) {
  const prepared = JSON.parse(await fs.readFile(input, 'utf8'));
  const bytes = await fs.readFile(downloadedArchive);
  if (hash(bytes) !== prepared.sha256) throw new Error('Downloaded archive hash mismatch');
  const destinationDir = path.join(prepared.root, 'restored-' + randomUUID());
  const result = await restoreEncryptedBackup({ archivePath: downloadedArchive, keyPath: prepared.keyPath, destinationDir });
  for (const name of ['fixture.json', 'README.txt']) {
    if (!(await fs.readFile(path.join(destinationDir, name))).equals(await fs.readFile(path.join(prepared.root, 'source', name)))) throw new Error('Restored bytes differ');
  }
  const receipt = { verifiedAt: new Date().toISOString(), archiveSha256: prepared.sha256, downloadedArchive: path.resolve(downloadedArchive), result, freshDestinationRestore: true, syntheticOnly: true, productionRecoveryQualified: false, separateLocalKey: true, offDeviceKeyRecoveryQualified: false };
  await fs.writeFile(path.join(prepared.root, 'verified.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(receipt));
} else throw new Error('Usage: qualify-drive.mjs prepare | verify PREPARED_JSON DOWNLOADED_ARCHIVE');
