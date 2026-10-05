#!/usr/bin/env node
// Explicit bulk operation. Default is a read-only plan; --execute writes private backups first.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'yaml';
import { Page, J, sleep } from '../test/cdp.mjs';
const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const vault=path.resolve(arg('vault',path.join(process.env.HOME,'vaults/Vault')));
const name=path.basename(vault),execute=process.argv.includes('--execute');
const code=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8');
const end=code.indexOf('class IntentModal',code.indexOf('function todoBlocks('));
const helpers=Function(code.slice(code.indexOf('function todoBlocks('),end)+';return {todoBlocks,intentProse};')();
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
let page;
for(const target of await Page.list()) {
  const candidate=await Page.connect(p=>p.id===target.id);
  if(await candidate.eval(`return app.vault.getName()===${J(name)}&&app.vault.adapter.getBasePath()===${J(vault)};`)){page=candidate;break;}candidate.ws.close();
}
if(!page)throw Error('requested native vault not open');
try {
  const sources=await page.eval(`const p=app.plugins.plugins['focus-tasks'];if(!p?.migrateTodoFile)throw Error('idea build is not loaded');
    if([...p.views].some(v=>v.editing||v.held))throw Error('an editor or drag is active');const out=[];
    for(const f of app.vault.getMarkdownFiles()){const cache=app.metadataCache.getFileCache(f);if(!p.todoEligible(f,cache?.frontmatter)||!cache?.headings?.some(h=>/^TODO\\b/i.test(h.heading)))continue;
      out.push({path:f.path,raw:await app.vault.read(f)});}return out;`);
  const plan=sources.map(s=>({...s,blocks:helpers.todoBlocks(s.raw)})).filter(s=>s.blocks.length);
  if(!execute){console.log(JSON.stringify({files:plan.length,blocks:plan.reduce((n,s)=>n+s.blocks.length,0),sources:plan.map(s=>({path:s.path,blocks:s.blocks.map(b=>({heading:b.heading,empty:!b.body.trim()}))}))}));}
  else {
    const backup=path.resolve(arg('backup',path.join(process.env.HOME,'backups','focus-tasks-intents-'+new Date().toISOString().replace(/[:.]/g,'-'))));
    if(backup.startsWith(vault+path.sep)||fs.existsSync(backup))throw Error('backup must be a fresh directory outside the vault');
    fs.mkdirSync(backup,{recursive:true,mode:0o700});
    const report={vault,backup,started:new Date().toISOString(),sources:plan.map(s=>({path:s.path,beforeHash:sha(s.raw)})),completed:[]};
    const save=()=>{const f=path.join(backup,'report.json'),tmp=f+'.tmp';fs.writeFileSync(tmp,JSON.stringify(report,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,f);};
    for(const s of plan){if(fs.readFileSync(path.join(vault,s.path),'utf8')!==s.raw)throw Error('source changed before backup: '+s.path);const f=path.join(backup,'sources',s.path);fs.mkdirSync(path.dirname(f),{recursive:true,mode:0o700});fs.writeFileSync(f,s.raw,{mode:0o600});if(sha(fs.readFileSync(f))!==sha(s.raw))throw Error('backup verification failed');}save();
    for(const s of plan){
      try {
        const r=await page.eval(`const p=app.plugins.plugins['focus-tasks'],f=app.vault.getAbstractFileByPath(${J(s.path)});if(app.vault.getName()!==${J(name)}||app.vault.adapter.getBasePath()!==${J(vault)}||!f)throw Error('vault/source changed');return await p.migrateTodoFile(f,${J(s.raw)});`);
        let expected=s.raw;for(const b of [...s.blocks].reverse())expected=expected.slice(0,b.start)+expected.slice(b.end);
        if(r.after!==expected||fs.readFileSync(path.join(vault,s.path),'utf8')!==expected)throw Error('source verification failed');
        for(let i=0;i<s.blocks.length;i++){const b=s.blocks[i],m=r.moved[i];if(!b.body.trim()){if(!m.empty)throw Error('empty block mismatch');continue;}
          const text=fs.readFileSync(path.join(vault,m.path),'utf8'),match=text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);if(!match)throw Error('missing card properties');const fm=parse(match[1]),body=text.slice(match[0].length);
          if(fm.type!=='замысел'||fm.uid!==m.uid||body!==helpers.intentProse(b.body)||fm.sourceHeading!==b.heading)throw Error('card verification failed');}
        report.completed.push({...r,before:undefined,after:undefined,afterHash:sha(expected)});save();await sleep(180);
      }catch(error){report.failure={source:s.path,error:String(error)};save();throw error;}
    }
    report.finished=new Date().toISOString();save();console.log(JSON.stringify({files:report.completed.length,cards:report.completed.flatMap(r=>r.moved).filter(m=>!m.empty).length,empty:report.completed.flatMap(r=>r.moved).filter(m=>m.empty).length,report:path.join(backup,'report.json')}));
  }
}finally{page.ws.close();}
