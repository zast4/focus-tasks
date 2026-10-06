#!/usr/bin/env node
// Explicit conversion of approved cards into lists. A mapping file carries private routing.
// Default is read-only. Backups and journals never belong to the public plugin repository.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'yaml';
import { Page, J, sleep } from '../test/cdp.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const vault=path.resolve(arg('vault',path.join(process.env.HOME,'vaults/Vault'))),name=path.basename(vault);
const mapFile=arg('map',null),execute=process.argv.includes('--execute');
if(!mapFile)throw Error('--map requires a private JSON array of {uid,area,beforeHash}');
const mapping=JSON.parse(fs.readFileSync(mapFile,'utf8'));
if(!Array.isArray(mapping)||new Set(mapping.map(x=>x.uid)).size!==mapping.length)throw Error('invalid or duplicate routing mapping');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
const note=text=>{const m=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);if(!m)throw Error('missing note properties');return {fm:parse(m[1]),body:text.slice(m[0].length)};};
let page;
for(const target of await Page.list()){
  const candidate=await Page.connect(p=>p.id===target.id);
  if(await candidate.eval(`return app.vault.getName()===${J(name)}&&app.vault.adapter.getBasePath()===${J(vault)};`)){page=candidate;break;}
  candidate.ws.close();
}
if(!page)throw Error('requested native vault not open');
try{
  const snapshot=await page.eval(`const p=app.plugins.plugins['focus-tasks'];if(!p?.convertIntentCard)throw Error('list build is not loaded');
    if([...p.views].some(v=>v.editing||v.held))throw Error('editor or drag is active');
    const all=(await p.intentCards()).filter(x=>!x.legacy),cards=all.filter(x=>!x.isList);
    return {areas:p.notes().filter(n=>!n.project).map(n=>n.area),folder:p.tasksFolder,
      available:all.map(x=>({uid:x.uid,path:x.file.path})),
      tasks:app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(p.tasksFolder+'/')).map(f=>f.path),
      cards:cards.map(x=>({uid:x.uid,path:x.file.path,title:x.title,raw:x.raw,parsed:p.parseIntentListBody(x.body)}))};`);
  for(const m of mapping) {
    const matches=snapshot.available.filter(x=>x.uid===m.uid);
    if(matches.length!==1||(m.path&&matches[0].path!==m.path))throw Error('approved source is missing or ambiguous: '+m.uid);
  }
  const planned=snapshot.cards.map(c=>{
    const m=mapping.find(m=>m.uid===c.uid);if(!m||!snapshot.areas.includes(m.area))throw Error('card has no approved existing area: '+c.title);
    if(m.beforeHash!==sha(c.raw))throw Error('source changed after routing: '+c.title);
    return {...c,area:m.area};
  });
  if(!execute){console.log(JSON.stringify({lists:planned.length,entries:planned.reduce((n,c)=>n+c.parsed.items.length,0),sources:planned.map(c=>({title:c.title,area:c.area,entries:c.parsed.items.length}))}));}
  else{
    const backup=path.resolve(arg('backup',path.join(process.env.HOME,'backups','focus-tasks-lists-'+new Date().toISOString().replace(/[:.]/g,'-'))));
    if(backup===vault||backup.startsWith(vault+path.sep)||fs.existsSync(backup))throw Error('backup must be a fresh directory outside vault');
    fs.mkdirSync(backup,{recursive:true,mode:0o700});
    const originals=Object.fromEntries(snapshot.tasks.map(f=>[f,sha(fs.readFileSync(path.join(vault,f)))]));
    const report={vault,backup,started:new Date().toISOString(),originalTaskHashes:originals,sources:planned.map(c=>({path:c.path,uid:c.uid,area:c.area,beforeHash:sha(c.raw)})),completed:[]};
    const save=()=>{const dest=path.join(backup,'report.json'),tmp=dest+'.tmp';fs.writeFileSync(tmp,JSON.stringify(report,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,dest);};
    for(const c of planned){
      if(fs.readFileSync(path.join(vault,c.path),'utf8')!==c.raw)throw Error('source changed before backup');
      const dest=path.join(backup,'sources',c.path);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest,c.raw,{mode:0o600});
      if(sha(fs.readFileSync(dest))!==sha(c.raw))throw Error('backup verification failed');
    }
    const settings=path.join(vault,'.obsidian/plugins/focus-tasks/data.json');
    if(fs.existsSync(settings))fs.copyFileSync(settings,path.join(backup,'plugin-data.json'));
    save();
    for(const c of planned){
      try{
        const r=await page.eval(`if(app.vault.getName()!==${J(name)}||app.vault.adapter.getBasePath()!==${J(vault)})throw Error('vault changed');
          const p=app.plugins.plugins['focus-tasks'];if([...p.views].some(v=>v.editing||v.held))throw Error('editor or drag is active');
          const card=(await p.intentCards()).find(x=>x.uid===${J(c.uid)});if(!card)throw Error('card vanished');
          const r=await p.convertIntentCard(card,${J(c.area)});return {list:{uid:r.list.uid,path:r.list.file.path},entries:r.entries.map(x=>({uid:x.uid,path:x.file.path}))};`);
        const list=note(fs.readFileSync(path.join(vault,c.path),'utf8'));
        if(list.fm.type!=='список замыслов'||list.fm.uid!==c.uid||list.fm.intentArea!==c.area||list.body!==c.parsed.description||r.entries.length!==c.parsed.items.length)throw Error('list verification failed');
        for(let i=0;i<r.entries.length;i++){
          const entry=note(fs.readFileSync(path.join(vault,r.entries[i].path),'utf8')),expected=c.parsed.items[i];
          if(entry.fm.uid!==r.entries[i].uid||entry.fm.type!=='замысел'||entry.fm.intentListUid!==c.uid||entry.fm.intentArea!==c.area||entry.fm.title!==expected.text||entry.body!==expected.body||entry.fm.status!==(expected.done?'done':'open')||entry.fm.area||entry.fm.projects)throw Error('entry verification failed');
        }
        report.completed.push({source:c.path,title:c.title,area:c.area,...r,afterHash:sha(fs.readFileSync(path.join(vault,c.path)))});save();await sleep(200);
      }catch(error){report.failure={source:c.path,error:String(error)};save();throw error;}
    }
    for(const [file,hash] of Object.entries(originals))if(!fs.existsSync(path.join(vault,file))||sha(fs.readFileSync(path.join(vault,file)))!==hash)throw Error('original task file changed: '+file);
    // Bulk conversion is backed up separately; do not make Cmd+Z undo a hidden service operation.
    const sources=report.completed.map(x=>x.source),created=report.completed.flatMap(x=>x.entries.map(e=>e.path));
    await page.eval(`const p=app.plugins.plugins['focus-tasks'],sources=new Set(${J(sources)}),created=new Set(${J(created)});
      p.history=(p.history||[]).filter(e=>!(e.snap?.some(x=>sources.has(x.path))&&e.snap?.some(x=>x.text===null&&created.has(x.path))));return true;`);
    report.finished=new Date().toISOString();save();console.log(JSON.stringify({lists:report.completed.length,entries:report.completed.reduce((n,c)=>n+c.entries.length,0),originalTaskFilesUnchanged:Object.keys(originals).length,report:path.join(backup,'report.json')}));
  }
}finally{page.ws.close();}
