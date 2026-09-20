import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTechHelp } from './reconcile-tech-help.mjs';
const origin='https://help.example.test';
const contact={id:'83d8a6ef-9eaf-4c90-8459-cb6c05172649',firstName:'Synthetic',email:'Person@Example.test',problem:'Wi-Fi',followUp:true,promotions:false,status:'New inquiry',createdAt:'2026-09-15T00:00:00.000Z'};
const packet=records=>Buffer.from(JSON.stringify({version:1,origin,storageKey:'ovth-pipeline',capturedAt:contact.createdAt,raw:JSON.stringify(records)}));
const empty={complete:true,contacts:[],suppressedEmails:[],importMappings:[]};
test('a new contact is only a proposal; repeated reconciliation is deterministic',()=>{
  const bytes=packet([contact]);
  const first=reconcileTechHelp(bytes,origin,empty);
  assert.equal(first.proposals[0].disposition,'new-contact-candidate');
  assert.equal(first.proposals[0].writeAuthorized,false);
  assert.equal(first.proposals[0].dispatchAllowed,false);
  assert.equal(first.writesPerformed,0);
  assert.deepEqual(reconcileTechHelp(bytes,origin,empty),first);
});
test('case-insensitive active, archived and suppressed matches are all retained',()=>{
  const snapshot={...empty,contacts:[{id:'active',email:' person@example.test ',archivedAt:null},{id:'archived',email:'PERSON@example.test',archivedAt:contact.createdAt}],suppressedEmails:['Person@example.test']};
  const before=JSON.stringify(snapshot);
  const row=reconcileTechHelp(packet([contact]),origin,snapshot).proposals[0];
  assert.deepEqual(row.matchingContactIds,['active','archived']);
  assert.deepEqual(row.reasons,['existing-active-contact','existing-archived-contact','existing-crm-suppression']);
  assert.equal(row.suppressionMustRemain,true);
  assert.equal(JSON.stringify(snapshot),before);
});

test('mapped inquiry keeps its CRM identity when source email and consent change',()=>{
  const previous=reconcileTechHelp(packet([{...contact,status:'Do not contact'}]),origin,empty).proposals[0];
  const snapshot={...empty,contacts:[{id:'known-person',email:contact.email,archivedAt:null}],importMappings:[{sourceId:previous.sourceId,recordSha256:previous.recordSha256,contactId:'known-person',doNotContactRecorded:true}]};
  const before=JSON.stringify(snapshot);
  const row=reconcileTechHelp(packet([{...contact,email:'changed@example.test',promotions:true}]),origin,snapshot).proposals[0];
  assert.equal(row.previousImport.contactId,'known-person');
  assert.equal(row.previousImport.recordSha256,previous.recordSha256);
  assert.equal(row.sourceRevisionChanged,true);
  assert.ok(row.reasons.includes('source-revision-changed'));
  assert.ok(row.reasons.includes('mapped-contact-email-differs'));
  assert.equal(row.suppressionMustRemain,true);
  assert.equal(row.disposition,'review-required');
  assert.equal(row.writeAuthorized,false);assert.equal(row.dispatchAllowed,false);
  assert.equal(JSON.stringify(snapshot),before);
});

test('previously imported unchanged inquiry is never proposed as a new contact',()=>{
  const previous=reconcileTechHelp(packet([contact]),origin,empty).proposals[0];
  const snapshot={...empty,contacts:[{id:'known',email:null,archivedAt:null}],importMappings:[{sourceId:previous.sourceId,recordSha256:previous.recordSha256,contactId:'known',doNotContactRecorded:false}]};
  const row=reconcileTechHelp(packet([contact]),origin,snapshot).proposals[0];
  assert.equal(row.previousImport.contactId,'known');
  assert.equal(row.sourceRevisionChanged,false);
  assert.equal(row.disposition,'review-required');
});

test('historical do-not-contact survives an inquiry disappearing from a later export',()=>{
  const previous=reconcileTechHelp(packet([contact]),origin,empty).proposals[0];
  const snapshot={...empty,contacts:[{id:'known',email:contact.email,archivedAt:null}],importMappings:[{sourceId:previous.sourceId,recordSha256:previous.recordSha256,contactId:'known',doNotContactRecorded:true}]};
  const next={...contact,id:'83d8a6ef-9eaf-4c90-8459-cb6c05172648',promotions:true};
  const row=reconcileTechHelp(packet([next]),origin,snapshot).proposals[0];
  assert.equal(row.previousImport,null);
  assert.equal(row.suppressionMustRemain,true);
  assert.ok(row.reasons.includes('historical-source-do-not-contact'));
});

test('missing, duplicate, orphaned and malformed import mappings fail closed',()=>{
  const previous=reconcileTechHelp(packet([contact]),origin,empty).proposals[0];
  const mapping={sourceId:previous.sourceId,recordSha256:previous.recordSha256,contactId:'known',doNotContactRecorded:false};
  const snapshot={...empty,contacts:[{id:'known',email:contact.email,archivedAt:null}]};
  for(const mappings of [undefined,[mapping,mapping],[{...mapping,contactId:'missing'}],[{...mapping,doNotContactRecorded:'false'}],[{...mapping,recordSha256:'bad'}]]){
    assert.throws(()=>reconcileTechHelp(packet([contact]),origin,{...snapshot,importMappings:mappings}));
  }
});

test('current opt-out follows explicit contact mappings across different source emails',()=>{
  const second={...contact,id:'83d8a6ef-9eaf-4c90-8459-cb6c05172648',email:'other@example.test'};
  const previous=reconcileTechHelp(packet([contact,second]),origin,empty).proposals;
  const snapshot={...empty,contacts:[{id:'known',email:contact.email,archivedAt:null}],importMappings:previous.map(row=>({sourceId:row.sourceId,recordSha256:row.recordSha256,contactId:'known',doNotContactRecorded:false}))};
  const result=reconcileTechHelp(packet([{...contact,status:'Do not contact'},second]),origin,snapshot);
  assert.ok(result.proposals.every(row=>row.suppressionMustRemain));
  assert.ok(result.proposals[1].currentDoNotContactSourceIds.includes(previous[0].sourceId));
});

test('existing suppression on the mapped contact remains after source email changes',()=>{
  const previous=reconcileTechHelp(packet([contact]),origin,empty).proposals[0];
  const snapshot={...empty,contacts:[{id:'known',email:contact.email,archivedAt:null}],suppressedEmails:[contact.email],importMappings:[{sourceId:previous.sourceId,recordSha256:previous.recordSha256,contactId:'known',doNotContactRecorded:false}]};
  const row=reconcileTechHelp(packet([{...contact,email:'changed@example.test'}]),origin,snapshot).proposals[0];
  assert.equal(row.suppressionMustRemain,true);assert.ok(row.reasons.includes('existing-crm-suppression'));
});
test('multiple inquiries retain distinct choices and any do-not-contact blocks the group',()=>{
  const second={...contact,id:'83d8a6ef-9eaf-4c90-8459-cb6c05172648',promotions:true,followUp:false,status:'Do not contact'};
  const result=reconcileTechHelp(packet([contact,second]),origin,empty);
  assert.equal(result.proposals.length,2);
  assert.notDeepEqual(result.proposals[0].historicalConsent,result.proposals[1].historicalConsent);
  for(const row of result.proposals){assert.equal(row.suppressionMustRemain,true);assert.equal(row.relatedSourceIds.length,2);assert.equal(row.disposition,'review-required');}
});
test('incomplete or ambiguous snapshots are rejected',()=>{
  assert.throws(()=>reconcileTechHelp(packet([contact]),origin,{...empty,complete:false}));
  assert.throws(()=>reconcileTechHelp(packet([contact]),origin,{...empty,contacts:[{id:'a',email:contact.email}]}));
});
