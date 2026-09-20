import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTechHelp } from './reconcile-tech-help.mjs';
const origin='https://help.example.test';
const contact={id:'83d8a6ef-9eaf-4c90-8459-cb6c05172649',firstName:'Synthetic',email:'Person@Example.test',problem:'Wi-Fi',followUp:true,promotions:false,status:'New inquiry',createdAt:'2026-09-15T00:00:00.000Z'};
const packet=records=>Buffer.from(JSON.stringify({version:1,origin,storageKey:'ovth-pipeline',capturedAt:contact.createdAt,raw:JSON.stringify(records)}));
const empty={complete:true,contacts:[],suppressedEmails:[]};
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
  const snapshot={complete:true,contacts:[{id:'active',email:' person@example.test ',archivedAt:null},{id:'archived',email:'PERSON@example.test',archivedAt:contact.createdAt}],suppressedEmails:['Person@example.test']};
  const before=JSON.stringify(snapshot);
  const row=reconcileTechHelp(packet([contact]),origin,snapshot).proposals[0];
  assert.deepEqual(row.matchingContactIds,['active','archived']);
  assert.deepEqual(row.reasons,['existing-active-contact','existing-archived-contact','existing-crm-suppression']);
  assert.equal(row.suppressionMustRemain,true);
  assert.equal(JSON.stringify(snapshot),before);
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
