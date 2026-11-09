import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../components/'+name,import.meta.url),'utf8');
test('live workspace has only Studio transport and no legacy mutations or report fallback',()=>{
 const code=read('operations-workspace.tsx');
 assert.doesNotMatch(code,/\/api\/(?:state|contracts|requests|document-continue|document-retry|staff)/);
 assert.doesNotMatch(code,/DailyReportPanel|normalizeOperationsState|registeredOperationsContracts|studioReviewForJob/);
 assert.match(code,/\/api\/studio\/state\?session=/);
 assert.match(code,/\/api\/studio\/intake\?kind=/);
});
test('unknown provider cannot activate a legacy workspace',()=>{
 const code=read('connected-operations-workspace.tsx');
 assert.doesNotMatch(code,/'legacy'/);
 assert.match(code,/if\(!next\)throw Error\('studio_configuration_required'\)/);
});
