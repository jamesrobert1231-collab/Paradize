import { createHash } from 'node:crypto';

const statuses = new Set(['New inquiry', 'Guide sent', 'Follow-up allowed', 'Offer recommended', 'Interested', 'Purchased', 'Do not contact']);
const hash = text => createHash('sha256').update(text).digest('hex');
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Converts evidence only. CRM membership, writes, messaging and consent activation
// must be qualified separately; historical checkboxes never authorize dispatch.
export function inspectPipelineExport(bytes, expectedOrigin) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 4 * 1024 * 1024) throw new Error('Invalid export size');
  const origin = new URL(expectedOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== expectedOrigin) throw new Error('Expected an exact browser origin');
  const packet = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!packet || packet.version !== 1 || packet.origin !== expectedOrigin || packet.storageKey !== 'ovth-pipeline' || !iso(packet.capturedAt) || (packet.raw !== null && typeof packet.raw !== 'string')) throw new Error('Invalid export provenance');
  const receipt = { exportSha256: hash(bytes), origin: packet.origin, capturedAt: packet.capturedAt, owner: 'local-owner', activationGranted: false, dataCutoverComplete: false };
  if (packet.raw === null) return { ...receipt, state: 'key-absent', records: [], coverage: 'unknown' };
  const records = JSON.parse(packet.raw);
  if (!Array.isArray(records) || records.length > 10000) throw new Error('Invalid pipeline collection');
  const ids = new Set();
  const mapped = records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid contact');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id) || ids.has(record.id.toLowerCase())) throw new Error('Invalid or duplicate contact identifier');
    ids.add(record.id.toLowerCase());
    for (const field of ['firstName', 'email', 'problem']) if (typeof record[field] !== 'string' || record[field].length > 10000) throw new Error('Invalid contact text');
    if (typeof record.followUp !== 'boolean' || typeof record.promotions !== 'boolean' || !statuses.has(record.status) || !iso(record.createdAt)) throw new Error('Invalid consent or status');
    return {
      id: hash(JSON.stringify([expectedOrigin, 'ovth-pipeline', record.id])), originalId: record.id,
      original: record, recordSha256: hash(JSON.stringify(record)),
      followUpRecorded: record.followUp, promotionsRecorded: record.promotions,
      doNotContact: record.status === 'Do not contact', dispatchAllowed: false,
      consentEvidence: 'historical-browser-record-unverified',
    };
  });
  return { ...receipt, state: mapped.length ? 'records-present' : 'explicit-empty-array', coverage: 'one-origin-one-profile-snapshot', records: mapped };
}
