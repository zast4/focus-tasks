// Native operator acceptance. Run sequentially after the other Obsidian UI suites.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {Page,J,until} from './cdp.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname),vault=path.join(root,'test/focus-tasks-e2e');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ft-intent-operator-'));let page;
const run=args=>{const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout.slice(-1400));return r.stdout.trim();};
try {
  run(['test/e2e.mjs','--keep','--match','^commands are registered$']);
  page=await Page.connect(p=>p.title.includes('focus-tasks-e2e'));
  assert.ok(page);assert.equal(await page.eval(`return app.vault.getName();`),'focus-tasks-e2e');
  const raw='---\nkeep: yes\n---\nIntro\n## TODO\n- [ ] Possibility\n- [x] History\n\n```focus-tasks\n```\n';
  await page.eval(`if(!app.vault.getAbstractFileByPath('Notes'))await app.vault.createFolder('Notes');await app.vault.create('Notes/Source.md',${J(raw)});return true;`);
  await until(()=>page.eval(`return !!app.metadataCache.getFileCache(app.vault.getAbstractFileByPath('Notes/Source.md'))?.headings?.length;`),'operator source indexed');
  const args=['tools/migrate-todo-to-intents.mjs','--vault',vault];
  assert.equal(JSON.parse(run(args)).blocks,1);assert.equal(fs.readFileSync(path.join(vault,'Notes/Source.md'),'utf8'),raw);
  const summary=JSON.parse(run([...args,'--execute','--backup',path.join(temp,'backup')]));assert.equal(summary.cards,1);
  const report=JSON.parse(fs.readFileSync(summary.report,'utf8'));assert.equal(report.completed.length,1);
  assert.equal(fs.readFileSync(path.join(temp,'backup/sources/Notes/Source.md'),'utf8'),raw);
  assert.equal(fs.statSync(path.join(temp,'backup')).mode&0o777,0o700);assert.equal(fs.statSync(summary.report).mode&0o777,0o600);
  assert.equal(JSON.parse(run(args)).blocks,0);assert.equal((await Page.list()).filter(p=>p.title.includes('focus-tasks-e2e')).length,1,'operator closed the native vault');
  assert.equal(await page.eval(`return app.plugins.plugins['focus-tasks'].tasks().length;`),0);
  assert.ok(fs.readFileSync(path.join(vault,'Notes/Source.md'),'utf8').endsWith('```focus-tasks\n```\n'));
  console.log('all native migration operator checks passed');
}finally{
  if(page){assert.equal(await page.eval(`return app.vault.getName();`),'focus-tasks-e2e');await page.close();}
  const main=await Page.connect(p=>!p.title.includes('focus-tasks-e2e'));
  if(main){await main.eval(`require('electron').ipcRenderer.sendSync('vault-remove',${J(vault)});return true;`);main.ws.close();}
  fs.rmSync(vault,{recursive:true,force:true});fs.rmSync(temp,{recursive:true,force:true});
}
