// Independent read-only inventory. No task contents or names in stdout.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'yaml';
const root=path.resolve(process.argv[2] || '.');
const configPath=path.join(root,'.obsidian/plugins/focus-tasks/data.json');
const settings=fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath,'utf8')).settings || {} : {};
const folder=path.resolve(root,settings.tasksFolder || 'Задачи');
if(!folder.startsWith(root+path.sep) || !fs.existsSync(folder))throw new Error('Missing task folder');
const counts={files:0,tasks:0,foreign:0,badYaml:0,noUid:0,duplicateUids:0,status:{},undated:0,timed:0,described:0,recurring:0,tasknotesReminders:0,timeEntries:0,noArea:0,multipleProjects:0,invalidDates:0};
const uids=new Set(), anomalies=[];
const anonymous=p=>crypto.createHash('sha256').update(p).digest('hex').slice(0,12);
function validDate(value){
  const raw=String(value), m=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(raw);
  if(!m || !Number.isFinite(Date.parse(raw)))return false;
  const day=new Date(0);day.setUTCFullYear(+m[1],+m[2]-1,+m[3]);
  return day.getUTCFullYear()===+m[1] && day.getUTCMonth()===+m[2]-1 && day.getUTCDate()===+m[3]
    && (m[4]===undefined || (+m[4]<24 && +m[5]<60 && (m[6]===undefined || +m[6]<60)));
}
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,entry.name);
    if(entry.isDirectory())walk(p);
    else if(entry.isFile() && entry.name.endsWith('.md')){
      counts.files++;
      const text=fs.readFileSync(p,'utf8');
      const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(text);
      let fm;
      try{fm=match && parse(match[1],{maxAliasCount:100});}catch{counts.badYaml++;anomalies.push({file:anonymous(p),reason:'bad-yaml'});continue;}
      if(!fm || !['task','задача'].includes(String(fm.type).trim().toLowerCase())){counts.foreign++;continue;}
      counts.tasks++;
      const status=String(fm.status || 'open');counts.status[status]=(counts.status[status] || 0)+1;
      if(!fm.uid){counts.noUid++;anomalies.push({file:anonymous(p),reason:'no-uid'});}
      else if(uids.has(String(fm.uid))){counts.duplicateUids++;anomalies.push({file:anonymous(p),reason:'duplicate-uid'});}else uids.add(String(fm.uid));
      if(!fm.scheduled)counts.undated++;else{
        const raw=String(fm.scheduled);
        if(/T\d{2}:\d{2}/.test(raw))counts.timed++;
      }
      for(const field of ['scheduled','due','completedDate'])if(fm[field] && !validDate(fm[field])){
        counts.invalidDates++;anomalies.push({file:anonymous(p),reason:'invalid-date',field});
      }
      if(text.slice(match[0].length).trim())counts.described++;
      if(fm.recurrence)counts.recurring++;
      if(fm.reminders?.length)counts.tasknotesReminders++;
      if(fm.timeEntries?.length)counts.timeEntries++;
      if(!fm.area)counts.noArea++;
      if(Array.isArray(fm.projects) && fm.projects.length>1)counts.multipleProjects++;
    }
  }
}
walk(folder);
console.log(JSON.stringify({counts,anomalies},null,2));
if(counts.badYaml || counts.duplicateUids || counts.invalidDates)process.exitCode=1;
