// Repairs only an unquoted title in a done, explicitly archived task. Dry-run by default.
// Backup first; preserve every byte outside that one title line.
import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'yaml';
export function repair(text) {
  const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(text);
  if(!match)return null;
  try{parse(match[1]);return null;}catch{}
  const line=/^title: (.+)$/m.exec(match[1]);
  if(!line || /^["']/.test(line[1]) || !/:\s|:$/.test(line[1]))return null;
  const raw=line[1].replace(/\r$/,'');
  const front=match[0].replace(/^title: .+$/m,'title: '+JSON.stringify(raw)+(line[1].endsWith('\r')?'\r':''));
  const next=front+text.slice(match[0].length);
  let fm;
  try{fm=parse(front.replace(/^\uFEFF?---\r?\n/,'').replace(/\r?\n---$/,''));}catch{return null;}
  if(fm.status!=='done' || !fm.uid || !['task','задача'].includes(fm.type) || !(Array.isArray(fm.tags)?fm.tags:[fm.tags]).some(t=>String(t).replace(/^#/,'')==='archived'))return null;
  if(fm.title!==raw)throw new Error('Title changed');
  return next;
}

if(process.argv[1] && path.resolve(process.argv[1])===new URL(import.meta.url).pathname){
  const root=path.resolve(process.argv[2] || '.');
  const archive=path.join(root,'Задачи/Архив');
  const targets=[];
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile()&&entry.name.endsWith('.md')){const before=fs.readFileSync(file,'utf8');const after=repair(before);if(after)targets.push({file,before,after});}}}
  walk(archive);
  const execute=process.argv.includes('--execute');
  const index=process.argv.indexOf('--backup');
  if(execute){
    if(index<0 || !process.argv[index+1])throw new Error('An external backup folder is required');
    const backup=path.resolve(process.argv[index+1]);
    if(backup.startsWith(root+path.sep))throw new Error('Backup must be outside the vault');
    fs.mkdirSync(backup,{recursive:true});
    for(const item of targets){const target=path.join(backup,path.relative(root,item.file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,item.before,{flag:'wx'});}
    let changed=0;
    for(const item of targets){if(fs.readFileSync(item.file,'utf8')!==item.before)throw new Error('File changed since scan');fs.writeFileSync(item.file,item.after);changed++;}
    console.log(JSON.stringify({execute:true,backedUp:targets.length,changed}));
  }else console.log(JSON.stringify({execute:false,candidates:targets.length}));
}
