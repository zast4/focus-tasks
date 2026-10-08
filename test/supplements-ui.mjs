import {J,sleep,until} from './cdp.mjs';
import {focusRoot as root,guardFixture,clickUI,toggleProjectUI} from './ui-actions.mjs';
export async function checkSupplementsUI(page,mobile=false){
 await guardFixture(page,mobile);
 const area=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='Supplements UI')`;
 const row=`(${area}).querySelector('li[data-ft-project-path="'+__sup.project+'"]')`;
 const click=expr=>clickUI(page,expr,mobile);
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],name='Supplements UI',note=await p.createArea(name);window.__sup={area:name};return true;`);
 await until(()=>page.eval(`return !!app.plugins.plugins['focus-tasks'].notes().find(n=>n.area===__sup.area);`),'supplement area indexed');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],a={name:__sup.area,note:p.notes().find(n=>n.area===__sup.area).file},f=await p.createProject(a,'SUP Project');__sup.project=f.path;await p.createTask('SUP Focus',{area:a.name,project:f.basename,projectFile:f},moment().format('YYYY-MM-DD'));await p.createTask('SUP Backlog',{area:a.name,project:f.basename,projectFile:f,noDate:true},null);await p.createTask('SUP Loose Focus',{area:a.name},moment().format('YYYY-MM-DD'));await p.createTask('SUP Loose Backlog',{area:a.name,noDate:true},null);await p.createTask('SUP Loose Idea',{area:a.name,intentLoose:true},null);const list=await p.ensureProjectIntentList(f);await p.createTask('SUP Project Idea',{area:a.name,projectFile:list.file,intentList:true,listUid:list.uid},null);p.setEverything(false);delete p.data.folded['area:'+a.name];for(const k of ['future:'+a.name,'intents:'+a.name,'steps:'+f.path,'project-header:'+f.path,'project-intents:'+f.path])delete p.data.opened[k];await p.saveFolds();await p.openView();p.refresh();return true;`);
 await until(()=>page.eval(`return !!(${row})?.querySelector('.ft-steps-more')&&!!(${area})?.querySelector('.ft-category-total');`),'compact project and area controls');
 if(!await page.eval(`const more=(${row}).querySelector('.ft-steps-more');return Number(more.getAttribute('aria-label').match(/\\d+/)?.[0])===Number(more.textContent.slice(1));`))throw Error('project counter explanation omits its Backlog tasks');
 const immutable=await page.eval(`const p=app.plugins.plugins['focus-tasks'],files=[...p.tasks().filter(t=>t.text.startsWith('SUP ')),...p.read().intentTasks.filter(t=>t.text.startsWith('SUP '))].map(t=>t.file);return await Promise.all(files.map(async f=>[f.path,await app.vault.read(f)]));`);
 // All four area configurations keep Focus visible and do not expand their project previews.
 for(const kind of ['backlog','intents','backlog','intents']){
  await click(`(${area}).querySelector(':scope > .ft-area-title [data-ft-category="${kind}"]')`);
  await until(()=>page.eval(`return [...(${area}).querySelectorAll('.ft-text')].some(e=>e.textContent==='SUP Focus');`),'Focus survives area '+kind);
  if(!await page.eval(`return [...(${area}).querySelectorAll('li.ft-project-row:not(.ft-intent-list-row)')].every(r=>!r.classList.contains('is-open'))&&(${area}).querySelector(':scope > .ft-area-title .ft-focus-chip').tagName==='SPAN';`))throw Error('area choice expands projects or exposes a Focus toggle');
 }
 const nameBox=()=>page.eval(`const r=(${row}).querySelector('.ft-project-name').getBoundingClientRect();return {left:r.left,top:r.top};`);
 const aligned=async()=>{if(mobile)return;const result=await page.eval(`const row=${row},old=row.style.fontSize;try{for(const size of [old,'32px']){row.style.fontSize=size;const n=row.querySelector('.ft-project-name').getBoundingClientRect(),c=row.querySelector('.ft-steps-more').getBoundingClientRect();if(Math.abs(n.top+n.height/2-c.top-c.height/2)>1)return {size,name:n.toJSON(),counter:c.toJSON()};}return null;}finally{row.style.fontSize=old;}`);if(result)throw Error('project counter is off the caption centre: '+JSON.stringify(result));};
 await aligned();
 const before=await nameBox();
 if(!mobile){const pos=await page.eval(`const r=(${row}).querySelector('.ft-steps-more').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};`);await page.mouse('mouseMoved',pos.x,pos.y,0);await sleep(180);const after=await nameBox();if(Math.abs(before.left-after.left)>1||Math.abs(before.top-after.top)>1)throw Error('hovering +N shifts the project caption');}
 if(!mobile){await page.eval(`(${row}).querySelector('.ft-steps-more').focus();return true;`);await page.key('Enter');}else await click(`(${row}).querySelector('.ft-steps-more')`);
 await until(()=>page.eval(`return (${row})?.classList.contains('is-open')&&!!(${area}).querySelector('.ft-later-steps');`),'direct +N expands Focus and Backlog');
 await aligned();
 if(!mobile){const after=await nameBox();if(Math.abs(before.left-after.left)>1||Math.abs(before.top-after.top)>1)throw Error('expanding the project shifts its caption');}
 if(!await page.eval(`const a=${area},r=${row};return r.querySelectorAll('button[data-ft-category]').length===2&&!r.querySelector('.ft-focus-chip')&&[...a.querySelectorAll('.ft-text')].filter(e=>e.textContent==='SUP Backlog').length===1&&!a.querySelector('.ft-later-steps .ft-project-category-add');`))throw Error('project has redundant buttons, duplicated tasks or filled Backlog helper');
 for(let i=0;i<2;i++)await click(`(${row}).querySelector('.ft-later-chip')`);
 if(!mobile){await page.eval(`(${row}).querySelector('.ft-intents-chip').focus();app.plugins.plugins['focus-tasks'].refresh();return true;`);await until(()=>page.eval(`return document.activeElement===(${row}).querySelector('.ft-intents-chip');`),'project category restores keyboard focus through redraw');}
 await click(`(${row}).querySelector('.ft-intents-chip')`);
 await until(()=>page.eval(`return [...(${area}).querySelectorAll('.ft-text')].some(e=>e.textContent==='SUP Project Idea');`),'project Ideas open');
 await click(`(${row}).querySelector('.ft-steps-more')`);
 const collapsed=()=>page.eval(`const a=${area},r=${row},p=app.plugins.plugins['focus-tasks'];return !r?.classList.contains('is-open')&&!r?.querySelector('[data-ft-category]')&&!a.querySelector('.ft-later-steps')&&!p.isShown('project-header:'+__sup.project,true);`);
 await until(collapsed,'collapse returns compact +N without retained Backlog');
 // Mobile headers deliberately omit the checkbox-column arrow; their counter folds them.
 if(!mobile){
   await click(`(${row}).querySelector('.ft-steps-more')`);
   await until(()=>page.eval(`return (${row})?.classList.contains('is-open');`),'reopen for arrow collapse');
   await click(`(${row}).querySelector('.ft-fold')`);
   await until(collapsed,'the fold arrow restores the same compact overview');
 }
 for(const [file,body] of immutable)if(await page.eval(`return await app.vault.read(app.vault.getAbstractFileByPath(${J(file)}));`)!==body)throw Error('view changes mutated '+file);
 // A Backlog-only area has just the Ideas supplement after expanding a project.
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],note=await p.createArea('SUP Queue');__sup.queueArea='SUP Queue';const f=await p.createProject({name:__sup.queueArea,note},'SUP Queue project');__sup.queue=f.path;await p.createTask('SUP Queue task',{area:__sup.queueArea,project:f.basename,projectFile:f,noDate:true},null);p.data.opened['backlog-steps:'+f.path]=false;p.setEverything(true);await p.saveFolds();p.refresh();return true;`);
 const queue=`${root}.querySelector('li[data-ft-project-path="'+__sup.queue+'"]')`;
 await until(()=>page.eval(`return !!(${queue})?.querySelector('.ft-text');`),'Backlog-only project');
 if(await page.eval(`return !!(${queue}).querySelector('.ft-steps-more');`))throw Error('single Backlog task displays a redundant counter');
 await toggleProjectUI(page,queue,mobile);
 if(!await until(()=>page.eval(`const r=${queue};return r?.classList.contains('is-open')&&r.querySelectorAll('button[data-ft-category]').length===1&&!!r.querySelector('.ft-intents-chip')&&!r.querySelector('.ft-focus-chip,.ft-later-chip');`),'Backlog project only offers Ideas'))throw Error('Backlog project has redundant controls');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'];for(const name of [__sup.area,__sup.queueArea]){const a=(await p.collect(true)).find(a=>a.name===name);if(a)await p.removeArea(a);}delete window.__sup;p.setEverything(false);p.refresh();return true;`);
}
