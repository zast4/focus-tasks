import {J,until} from './cdp.mjs';
import {focusRoot as root,guardFixture,clickUI} from './ui-actions.mjs';

export async function checkAreaEmptyUI(page,mobile=false){
 await guardFixture(page,mobile);
 await page.eval(`const p=app.plugins.plugins['focus-tasks'];window.__emptyAreas={};
  for(const kind of ['Empty','Loose','Project','Future','Ideas']){
   const name='Empty area UI '+kind,note=await p.createArea(name);__emptyAreas[kind]={name,note:note.path};
   if(kind==='Loose')for(const title of ['EA Loose one','EA Loose two'])await p.createTask(title,{area:name,noDate:true},null);
   if(kind==='Project'){const file=await p.createProject({name,note},'EA Backlog project');for(const title of ['EA Project one','EA Project two'])await p.createTask(title,{area:name,project:file.basename,projectFile:file,noDate:true},null);}
   if(kind==='Future')await p.createTask('EA Future task',{area:name},moment().add(1,'day').format('YYYY-MM-DD'));
   p.data.opened['area:'+name]=true;delete p.data.opened['futureoff:'+name];delete p.data.opened['intents:'+name];
  }
  await p.saveFolds();p.setEverything(true);await p.openView();p.refresh();return true;`);
 await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].notes().some(n=>!n.project&&n.area===__emptyAreas.Ideas.name);`),'idea area indexed');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],name=__emptyAreas.Ideas.name,list=await p.createIntentList('EA Idea list',name);await p.createTask('EA Private idea',{area:name,project:list.file.basename,projectFile:list.file,intentList:true,listUid:list.uid},null);p.refresh();return true;`);
 const area=kind=>`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent===__emptyAreas[${J(kind)}].name)`;
 await until(()=>page.eval(`return Object.keys(__emptyAreas).every(kind=>[...${root}.querySelectorAll('.ft-area')].some(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent===__emptyAreas[kind].name));`),'empty-area matrix rendered');
 await until(()=>page.eval(`return (${area('Ideas')}).querySelector('.ft-intents-chip .ft-supplement-count')?.textContent==='1';`),'area idea count indexed');
 for(const [kind,text] of [['Loose','EA Loose one'],['Project','EA Project one'],['Future','EA Future task']]){
  await until(()=>page.eval(`return [...(${area(kind)}).querySelectorAll('.ft-text')].some(e=>e.textContent===${J(text)});`),kind+' backlog rendered');
  if(await page.eval(`return !!(${area(kind)}).querySelector(':scope > .ft-empty-add');`))throw Error(kind+' area has a misleading Empty prompt above its tasks');
  await clickUI(page,`(${area(kind)}).querySelector('.ft-later-chip')`,mobile);
  await until(()=>page.eval(`return !(${area(kind)}).querySelector(':scope > .ft-future-block');`),kind+' backlog folded');
  if(await page.eval(`return !!(${area(kind)}).querySelector(':scope > .ft-empty-add');`))throw Error(kind+' area claims to be empty after folding its backlog');
  await clickUI(page,`(${area(kind)}).querySelector('.ft-later-chip')`,mobile);
  await until(()=>page.eval(`return !!(${area(kind)}).querySelector(':scope > .ft-future-block');`),kind+' backlog reopened');
 }
 if(await page.eval(`return !!(${area('Ideas')}).querySelector(':scope > .ft-empty-add');`))throw Error('Ideas-only area has a misleading Empty prompt');
 await clickUI(page,`(${area('Ideas')}).querySelector('.ft-intents-chip')`,mobile);
 await until(()=>page.eval(`return [...(${area('Ideas')}).querySelectorAll('.ft-text')].some(e=>e.textContent==='EA Private idea');`),'area idea displayed');
 if(await page.eval(`return !!(${area('Ideas')}).querySelector(':scope > .ft-empty-add');`))throw Error('Ideas-only area claims to be empty with visible ideas');
 const empty=`(${area('Empty')}).querySelector(':scope > .ft-empty-add')`;
 if(!await page.eval(`return !!(${empty})?.getBoundingClientRect().width;`))throw Error('truly empty area lost its creation prompt');
 await clickUI(page,empty,mobile);
 await until(()=>page.eval(`return !!${root}.querySelector('.is-editing');`),'empty area inline editor');
 await page.type('EA First task');await page.key('Enter');
 await until(()=>page.eval(`const t=app.plugins.plugins['focus-tasks'].tasks().find(t=>t.text==='EA First task');return t?.area===__emptyAreas.Empty.name&&!t.date&&!t.project;`),'first undated area task saved');
 await until(()=>page.eval(`return !!${root}.querySelector('.ft-draft-row .is-editing');`),'next area draft ready');await page.key('Escape');
 await until(()=>page.eval(`return !${root}.querySelector('.is-editing');`),'empty follow-up draft cancelled');
 if(await page.eval(`return !!(${area('Empty')}).querySelector(':scope > .ft-empty-add');`))throw Error('filled area keeps its Empty prompt');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'];for(const {name} of Object.values(__emptyAreas)){const area=(await p.collect(true)).find(a=>a.name===name);await p.removeArea(area);}delete window.__emptyAreas;p.setEverything(false);p.refresh();return true;`);
}
