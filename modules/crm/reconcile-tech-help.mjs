import { inspectPipelineExport } from '../tech-help/pipeline.mjs';

const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export function reconcileTechHelp(bytes, expectedOrigin, snapshot) {
  const imported = inspectPipelineExport(bytes, expectedOrigin);
  if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.contacts) || !Array.isArray(snapshot.suppressedEmails) || !Array.isArray(snapshot.importMappings)) throw new Error('A complete CRM snapshot including import mappings is required');
  if (snapshot.contacts.length > 100000 || snapshot.suppressedEmails.length > 100000 || snapshot.importMappings.length > 100000) throw new Error('CRM snapshot exceeds reconciliation limit');
  const known = new Map(), contactIds = new Set(), contactsById = new Map();
  for (const contact of snapshot.contacts) {
    if (!contact || typeof contact.id !== 'string' || !contact.id || contactIds.has(contact.id) || (contact.email !== null && typeof contact.email !== 'string') || (contact.archivedAt !== null && (typeof contact.archivedAt !== 'string' || !Number.isFinite(Date.parse(contact.archivedAt))))) throw new Error('Invalid CRM contact snapshot');
    contactIds.add(contact.id);
    contactsById.set(contact.id, contact);
    const key = emailKey(contact.email);
    if (key) { const rows = known.get(key) || []; rows.push(contact); known.set(key, rows); }
  }
  const suppressed = new Set(snapshot.suppressedEmails.map(email => {
    if (typeof email !== 'string' || !email.trim()) throw new Error('Invalid suppression snapshot');
    return emailKey(email);
  }));
  const mappings = new Map(), historicalRestrictions = new Map();
  for (const mapping of snapshot.importMappings) {
    if (!mapping || typeof mapping.sourceId !== 'string' || !/^[a-f0-9]{64}$/.test(mapping.sourceId) ||
        typeof mapping.recordSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(mapping.recordSha256) ||
        typeof mapping.contactId !== 'string' || !contactsById.has(mapping.contactId) ||
        typeof mapping.doNotContactRecorded !== 'boolean' || mappings.has(mapping.sourceId)) throw new Error('Invalid or ambiguous import mapping');
    mappings.set(mapping.sourceId, mapping);
    if (mapping.doNotContactRecorded) {
      const ids = historicalRestrictions.get(mapping.contactId) || [];
      ids.push(mapping.sourceId); historicalRestrictions.set(mapping.contactId, ids);
    }
  }
  const groups = new Map(), currentRestrictions = new Map();
  for (const record of imported.records) {
    const key = emailKey(record.original.email);
    const records = groups.get(key) || []; records.push(record); groups.set(key, records);
    if (record.doNotContact) {
      const mapping = mappings.get(record.id);
      const ids = new Set([...(known.get(key) || []).map(contact => contact.id), ...(mapping ? [mapping.contactId] : [])]);
      for (const id of ids) {
        const sources = currentRestrictions.get(id) || [];
        sources.push(record.id); currentRestrictions.set(id, sources);
      }
    }
  }
  const proposals = imported.records.map(record => {
    const key = emailKey(record.original.email), siblings = groups.get(key), matches = known.get(key) || [];
    const mapping = mappings.get(record.id), mappedContact = mapping ? contactsById.get(mapping.contactId) : null;
    const relatedContactIds = new Set([...matches.map(contact => contact.id), ...(mapping ? [mapping.contactId] : [])]);
    const historicalSourceIds = [...new Set([...relatedContactIds].flatMap(id => historicalRestrictions.get(id) || []))].sort();
    const currentSourceIds = [...new Set([...siblings.filter(row => row.doNotContact).map(row => row.id), ...[...relatedContactIds].flatMap(id => currentRestrictions.get(id) || [])])].sort();
    const crmSuppression = suppressed.has(key) || (!!mappedContact && suppressed.has(emailKey(mappedContact.email)));
    const sourceRevisionChanged = !!mapping && mapping.recordSha256 !== record.recordSha256;
    const reasons = [];
    if (!key || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) reasons.push('email-needs-review');
    if (siblings.length > 1) reasons.push('multiple-source-inquiries');
    if (matches.some(contact => contact.archivedAt === null)) reasons.push('existing-active-contact');
    if (matches.some(contact => contact.archivedAt !== null)) reasons.push('existing-archived-contact');
    if (crmSuppression) reasons.push('existing-crm-suppression');
    if (currentSourceIds.length) reasons.push('source-do-not-contact');
    if (mapping) reasons.push('existing-import-mapping');
    if (sourceRevisionChanged) reasons.push('source-revision-changed');
    if (mappedContact && emailKey(mappedContact.email) !== key) reasons.push('mapped-contact-email-differs');
    if (historicalSourceIds.length) reasons.push('historical-source-do-not-contact');
    return {
      sourceId: record.id, originalId: record.originalId, recordSha256: record.recordSha256,
      disposition: reasons.length ? 'review-required' : 'new-contact-candidate', reasons,
      matchingContactIds: matches.map(contact => contact.id).sort(),
      relatedSourceIds: siblings.map(row => row.id).sort(),
      previousImport: mapping ? { contactId: mapping.contactId, recordSha256: mapping.recordSha256, doNotContactRecorded: mapping.doNotContactRecorded } : null,
      sourceRevisionChanged, historicalDoNotContactSourceIds: historicalSourceIds,
      currentDoNotContactSourceIds: currentSourceIds,
      historicalConsent: { followUp: record.followUpRecorded, promotions: record.promotionsRecorded },
      suppressionMustRemain: crmSuppression || currentSourceIds.length > 0 || historicalSourceIds.length > 0,
      dispatchAllowed: false, writeAuthorized: false,
    };
  });
  return { exportSha256: imported.exportSha256, sourceState: imported.state, proposals, writesPerformed: 0, jobsScheduled: 0, dataCutoverComplete: false };
}
