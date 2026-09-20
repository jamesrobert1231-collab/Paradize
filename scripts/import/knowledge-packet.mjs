import fs from 'node:fs';
import { importDocument } from '../../services/sunny-local/knowledge.mjs';

const [packetFile, directory] = process.argv.slice(2);
if (!packetFile || !directory || fs.statSync(packetFile).size > 16 * 1024 * 1024) throw new Error('Invalid import packet');
const packet = JSON.parse(fs.readFileSync(packetFile, 'utf8').replace(/^\uFEFF/, ''));
const extraction = packet.extraction ?? 'main-document-paragraphs-only';
if (!['main-document-paragraphs-only', 'utf8-text-verbatim'].includes(extraction)) throw new Error('Unsupported extraction');
const originalBytes = Buffer.from(packet.originalBase64, 'base64');
if (originalBytes.toString('base64') !== packet.originalBase64) throw new Error('Invalid original encoding');
const result = importDocument(directory, { source: packet.source, title: packet.title, text: packet.text, originalBytes });
console.log(JSON.stringify({ ...result, extraction, originalPreserved: true, dataCutover: false }));
