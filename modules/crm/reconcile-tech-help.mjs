import { inspectPipelineExport } from '../tech-help/pipeline.mjs';

const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export function reconcileTechHelp(bytes, expectedOrigin, snapshot) {
  const imported = inspectPipelineExport(bytes, expectedOrigin);
  if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.contacts) || !Array.isArray(snapshot.suppressedEmails)) throw new Error('A complete CRM snapshot is required');
  if (snapshot.contacts.length > 100000 || snapshot.suppressedEmails.length > 100000) throw new Error('CRM snapshot exceeds reconciliation limit');
  const known = new Map(), contactIds = new Set();
  for (const contact of snapshot.contacts) {
    if (!contact || typeof contact.id !== 'string' || !contact.id || contactIds.has(contact.id) || (contact.email !== null && typeof contact.email !== 'string') || (contact.archivedAt !== null && (typeof contact.archivedAt !== 'string' || !Number.isFinite(Date.parse(contact.archivedAt))))) throw new Error('Invalid CRM contact snapshot');
    contactIds.add(contact.id);
    const key = emailKey(contact.email);
    if (key) { const rows = known.get(key) || []; rows.push(contact); known.set(key, rows); }
  }
  const suppressed = new Set(snapshot.suppressedEmails.map(email => {
    if (typeof email !== 'string' || !email.trim()) throw new Error('Invalid suppression snapshot');
    return emailKey(email);
  }));
  const groups = new Map();
  for (const record of imported.records) {
    const key = emailKey(record.original.email);
    const records = groups.get(key) || []; records.push(record); groups.set(key, records);
  }
  const proposals = imported.records.map(record => {
    const key = emailKey(record.original.email), siblings = groups.get(key), matches = known.get(key) || [];
    const reasons = [];
    if (!key || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) reasons.push('email-needs-review');
    if (siblings.length > 1) reasons.push('multiple-source-inquiries');
    if (matches.some(contact => contact.archivedAt === null)) reasons.push('existing-active-contact');
    if (matches.some(contact => contact.archivedAt !== null)) reasons.push('existing-archived-contact');
    if (suppressed.has(key)) reasons.push('existing-crm-suppression');
    if (siblings.some(row => row.doNotContact)) reasons.push('source-do-not-contact');
    return {
      sourceId: record.id, originalId: record.originalId, recordSha256: record.recordSha256,
      disposition: reasons.length ? 'review-required' : 'new-contact-candidate', reasons,
      matchingContactIds: matches.map(contact => contact.id).sort(),
      relatedSourceIds: siblings.map(row => row.id).sort(),
      historicalConsent: { followUp: record.followUpRecorded, promotions: record.promotionsRecorded },
      suppressionMustRemain: suppressed.has(key) || siblings.some(row => row.doNotContact),
      dispatchAllowed: false, writeAuthorized: false,
    };
  });
  return { exportSha256: imported.exportSha256, sourceState: imported.state, proposals, writesPerformed: 0, jobsScheduled: 0, dataCutoverComplete: false };
}
