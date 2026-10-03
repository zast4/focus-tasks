import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const tool=new URL('../tools/audit-vault.mjs',import.meta.url);
function audit(fields){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'focus-vault-audit-'));
  try{
    fs.mkdirSync(path.join(root,'Задачи'));
    fs.writeFileSync(path.join(root,'Задачи/Private task title.md'),`---\ntype: задача\nuid: one\nstatus: open\n${fields}\n---\nPrivate description\n`);
    const out=spawnSync(process.execPath,[tool.pathname,root],{encoding:'utf8'});
    assert.equal(out.stderr,'');assert.ok(!out.stdout.includes('Private'));
    return {status:out.status,...JSON.parse(out.stdout)};
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('inventory accepts leap days and explicit datetime offsets',()=>{
  const out=audit('scheduled: 2028-02-29T23:59+03:00\ndue: 2028-03-01\ncompletedDate: 2028-02-29');
  assert.equal(out.status,0);assert.equal(out.counts.invalidDates,0);assert.equal(out.counts.tasks,1);
});
test('inventory rejects impossible days instead of JavaScript date rollover',()=>{
  const out=audit('scheduled: 2026-02-30\ndue: 2026-04-31\ncompletedDate: 2025-02-29');
  assert.equal(out.status,1);assert.equal(out.counts.invalidDates,3);
  assert.deepEqual(out.anomalies.map(x=>x.field),['scheduled','due','completedDate']);
});
test('inventory rejects a 24-hour datetime despite Date.parse accepting it',()=>{
  const out=audit('scheduled: 2026-10-03T24:00');
  assert.equal(out.status,1);assert.equal(out.counts.invalidDates,1);
});
