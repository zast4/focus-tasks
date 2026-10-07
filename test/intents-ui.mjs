import { J, sleep, until } from './cdp.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export async function checkIntentsUI(page, mobile=false) {
  const click=async expr=>{
    await page.front();
    await page.eval(`const e=${expr};e?.scrollIntoView({block:'center',behavior:'instant'});return true;`);await sleep(180);
    const hover=await page.eval(`const e=${expr},r=e?.getBoundingClientRect();if(!e||r.width)return null;const parent=e.closest('li.ft-task,.ft-area-title');if(!parent)return null;parent.scrollIntoView({block:'center',behavior:'instant'});const b=parent.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};`);
    if(hover&&!mobile){await page.front();await page.mouse('mouseMoved',hover.x,hover.y,0);await sleep(120);}
    const at=await until(()=>page.eval(`const e=${expr};if(!e)return false;e.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=e.matches('a')?[...e.getClientRects()].find(r=>r.width&&r.height):e.getBoundingClientRect();if(!b)return false;const point={x:b.left+b.width/2,y:b.top+b.height/2};const hit=document.elementFromPoint(point.x,point.y);return hit&&e.contains(hit)?point:false;`),'idea control is visible and uncovered: '+expr);
    if(mobile)await page.tap(at);else await page.click(at);
    await sleep(100);
  };
  const press=async expr=>{
    await page.front();await page.eval(`(${expr}).scrollIntoView({block:'center',behavior:'instant'});return true;`);await sleep(180);
    // Fixture writes and viewport changes may still deliver a queued metadata redraw.
    // Begin the gesture only after the actual row has remained connected for one debounce window.
    await page.eval(`window.__intentPressReady=null;return true;`);
    await until(()=>page.eval(`const row=${expr},now=performance.now();if(!row?.isConnected)return false;if(window.__intentPressReady?.row!==row)window.__intentPressReady={row,at:now};return now-window.__intentPressReady.at>=600;`),'row settled before touch gesture');
    const point=await until(()=>page.eval(`const e=${expr};if(!e)return false;const b=e.getBoundingClientRect(),p={x:b.left+b.width/2,y:b.top+b.height/2},hit=document.elementFromPoint(p.x,p.y);return hit&&e.contains(hit)?p:false;`),'long press point');
    await page.touch('touchStart',[point]);await sleep(750);await page.touch('touchEnd',[]);await sleep(180);
  };
  const root="app.workspace.activeLeaf.view.containerEl";
  const viewport=await page.eval(`return {width:innerWidth,height:innerHeight};`);
  const area=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='Ideas UI')`;
  const list=`[...${root}.querySelectorAll('.ft-intent-list-row')].find(e=>e.querySelector('.ft-link')?.textContent==='UI List')`;
  const row=title=>`[...${root}.querySelectorAll('li.ft-task')].find(e=>e.querySelector(':scope > .ft-text')?.textContent===${J(title)})`;
  const words={'📔 Ideas':['📔 Ideas','📔 Замыслы'],'Move to backlog':['Move to backlog','Перенести в отложку'],'Delete list':['Delete list','Удалить список'],'Delete area':['Delete area','Удалить область'],'Reorder':['Reorder','Переставить']};
  const menu=title=>`[...document.querySelectorAll('.menu-item')].find(e=>${J(words[title]||[title])}.some(t=>e.textContent.includes(t)))`;
  await page.eval(`if(!['focus-tasks-e2e','focus-tasks-mobile'].includes(app.vault.getName()))throw Error('test vault guard');const p=app.plugins.plugins['focus-tasks'];window.__intentUITaskCount=p.tasks().length;delete p.data.opened['intents:Ideas UI'];p.saveFolds();await p.createArea('Ideas UI');await app.commands.executeCommandById('focus-tasks:open');p.app.saveLocalStorage('focus-tasks-all','1');p.data.opened['area:Ideas UI']=true;p.saveFolds();p.refresh();return true;`);
  await until(()=>page.eval(`return !!(${area});`),'idea area visible');
  if(await page.eval(`return !!${root}.querySelector('.ft-intents-toggle,.ft-intent-card');`))throw Error('old card interface remains');
  if(await page.eval(`return !!(${area}).querySelector('.ft-intents');`))throw Error('ideas opened without area command');
  if(mobile)await click(`(${area}).querySelector(':scope > .ft-area-title .ft-more')`);
  else {const at=await page.eval(`const e=(${area}).querySelector(':scope > .ft-area-title');e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};`);await page.rightClick(at);}
  await until(()=>page.eval(`return !!(${menu('📔 Ideas')});`),'area ideas menu');
  await click(menu('📔 Ideas'));await until(()=>page.eval(`return !!(${area}).querySelector('.ft-intents');`),'ideas opened per area');
  await click(`(${area}).querySelector('.ft-intents-add:not(.ft-loose-idea-add)')`);
  await until(()=>page.eval(`return !!document.querySelector('.modal input.ft-input');`),'new list editor');await sleep(mobile?400:100);
  await click(`document.querySelector('.modal input.ft-input')`);await page.type('UI List');await click(`document.querySelector('.modal button.mod-cta')`);
  await until(()=>page.eval(`return !!(${list});`),'list created');
  if(!await page.eval(`return (${list}).querySelector('.ft-project-icon')?.textContent==='📔';`))throw Error('wrong list emoji');
  await click(`(${list}).querySelector('.ft-plus')`);
  await until(()=>page.eval(`return !!${root}.querySelector('[contenteditable=true]');`),'ordinary inline entry');
  await page.type('UI First action');await page.key('Enter');
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].read().intentTasks.some(x=>x.text==='UI First action');`),'inline entry persisted');await page.key('Escape');
  await until(()=>page.eval(`return !!(${row('UI First action')});`),'ordinary idea row');
  if(!await page.eval(`const e=${row('UI First action')};return !!e.querySelector('input[type=checkbox]')&&!!e.querySelector('.ft-date');`))throw Error('idea is not an ordinary task row');
  if(!await page.eval(`return app.plugins.plugins['focus-tasks'].tasks().length===__intentUITaskCount;`))throw Error('inline entry leaked into normal tasks');
  // The shared editor and date shortcut keep the row in its list.
  if(mobile){await click(`(${list}).querySelector('.ft-steps-more')`);await until(()=>page.eval(`return !(${list}).classList.contains('is-open');`),'single-entry list folded');await click(`(${list}).querySelector('.ft-steps-more')`);await until(()=>page.eval(`return (${list}).classList.contains('is-open');`),'single-entry list reopened');}
  await click(`(${row('UI First action')}).querySelector('.ft-text')`);await until(()=>page.eval(`return !!${root}.querySelector('[contenteditable=true]');`),'editing entry');
  await page.key('Meta+1');
  if(!await page.eval(`return !!${root}.querySelector('[contenteditable=true]')&&app.plugins.plugins['focus-tasks'].tasks().length===__intentUITaskCount;`))throw Error('date shortcut promoted or displaced the idea');
  const originalUid=await page.eval(`return app.plugins.plugins['focus-tasks'].read().intentTasks.find(x=>x.text==='UI First action').uid;`);
  await page.key('Meta+d');
  await until(()=>page.eval(`const v=app.workspace.activeLeaf.view.renderer,e=${root}.querySelector('[contenteditable=true]'),task=e&&v.items.get(e.closest('li.ft-task'))?.task;return app.plugins.plugins['focus-tasks'].read().intentTasks.filter(x=>x.text==='UI First action').length===2&&task&&task.uid!==${J(originalUid)};`),'duplicate starts editing');
  // CDP does not invoke Electron's native Select All menu accelerator.
  await page.eval(`const e=${root}.querySelector('[contenteditable=true]');e.focus();getSelection().selectAllChildren(e);return true;`);await page.type('UI Copy action');await page.key('Enter');await page.key('Escape');
  await until(()=>page.eval(`return !!(${row('UI Copy action')});`),'copy renamed');
  if(!await page.eval(`const v=app.workspace.activeLeaf.view.renderer,r=v.rows().map(([,x])=>x.text);return r.indexOf('UI Copy action')<r.indexOf('UI First action');`))throw Error('duplicate is not above original');
  // Completion uses the same checkbox and the same reversible completed shelf.
  await click(`(${row('UI Copy action')}).querySelector('input')`);
  await until(()=>page.eval(`return !!(${area}).querySelector('.ft-intents .ft-page-done');`),'completed list shelf');
  await click(`(${area}).querySelector('.ft-intents .ft-page-done')`);
  await until(()=>page.eval(`return !!(${area}).querySelector('.ft-intents .ft-done input');`),'completed idea visible');
  await click(`(${area}).querySelector('.ft-intents .ft-done input')`);
  await until(()=>page.eval(`return !!(${row('UI Copy action')});`),'checkbox returns idea to list');
  // Body search must reveal a hidden list in the plugin.
  await page.eval(`const p=app.plugins.plugins['focus-tasks'],x=p.read().intentTasks.find(x=>x.text==='UI Copy action');await p.processOwned(x.file,raw=>raw+${J('\nBody needle for idea list')});await p.setOpen('intents:Ideas UI',false);p.refresh();return true;`);
  await until(()=>page.eval(`return !(${area}).querySelector('.ft-intents');`),'ideas hidden');
  await page.eval(`await app.workspace.activeLeaf.view.renderer.find();return true;`);
  await until(()=>page.eval(`return !!document.querySelector('.prompt-input');`),'common search');
  await click(`document.querySelector('.prompt-input')`);await page.type('Body needle');
  await until(()=>page.eval(`return [...document.querySelectorAll('.suggestion-item')].some(e=>e.textContent.includes('UI Copy action'));`),'entry body search');
  await page.key('Enter');await until(()=>page.eval(`return !!(${row('UI Copy action')});`),'search opens correct list');
  // The shared task menu makes promotion explicit, preserving the original identity.
  const uid=await page.eval(`return app.plugins.plugins['focus-tasks'].read().intentTasks.find(x=>x.text==='UI Copy action').uid;`);
  await until(()=>page.eval(`const v=app.workspace.activeLeaf.view.renderer;return v&&!v.editing&&!document.querySelector('.prompt-input')&&!${root}.querySelector('[contenteditable=true]');`),'list ready after search');
  if(mobile)await press(`(${row('UI Copy action')}).querySelector('.ft-text')`);
  else {const at=await page.eval(`const e=${row('UI Copy action')};e.scrollIntoView({block:'center',behavior:'instant'});const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};`);await page.rightClick(at);}
  await until(()=>page.eval(`return !!(${menu('Move to backlog')});`),'explicit promotion menu');await click(menu('Move to backlog'));
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().some(x=>x.uid===${J(uid)}&&!x.date);`),'promoted item in backlog');
  await page.eval(`await app.plugins.plugins['focus-tasks'].txTail;return true;`);await page.key('Meta+z');
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].read().intentTasks.some(x=>x.uid===${J(uid)});`),'promotion Undo returns same item');
  // Lists reuse the shared fold and drag order. Both rows remain accessible when reopened.
  await click(`(${list}).querySelector(${J(mobile ? '.ft-steps-more' : '.ft-fold')})`);await until(()=>page.eval(`return !(${list}).classList.contains('is-open');`),'list folded');
  await click(`(${list}).querySelector('.ft-steps-more')`);await until(()=>page.eval(`return (${list}).classList.contains('is-open');`),'list reopened');
  for(const width of mobile?[320,390,430]:[620,1000]){
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:mobile?2:1,mobile});
    await page.eval(`const e=${root}.querySelector('.focus-tasks-view');e.style.fontSize='26px';return true;`);await sleep(150);
    const bad=await page.eval(`const rows=[...(${area}).querySelectorAll('.ft-intents li.ft-task')];return rows.filter(e=>{const b=e.getBoundingClientRect();return b.width&&(b.left<0||b.right>innerWidth+1||e.scrollWidth>e.clientWidth+2);}).length;`);
    if(bad)throw Error('intent list geometry overflows at '+width);
    if(mobile && !await page.eval(`const a=${row('UI First action')},b=${row('UI Copy action')};return Math.abs(a.querySelector('.ft-box').getBoundingClientRect().left-b.querySelector('.ft-box').getBoundingClientRect().left)<1;`))throw Error('mobile checkbox columns disagree');
  }
  await page.send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:mobile?2:1,mobile});
  await page.eval(`const e=${root}.querySelector('.focus-tasks-view');e.style.fontSize='';return true;`);
  // Drag an actual row into a second list with the same desktop/touch machinery.
  const secondUid=await page.eval(`const p=app.plugins.plugins['focus-tasks'],list=await p.createIntentList('UI List Two','Ideas UI');await p.createTask('UI other list item',{area:list.area,projectFile:list.file,project:list.file.basename,intentList:true,listUid:list.uid},null);p.refresh();return list.uid;`);
  await until(()=>page.eval(`return !![...${root}.querySelectorAll('.ft-intent-list-row')].find(e=>e.getAttribute('data-intent-id')===${J(secondUid)});`),'second list visible');
  if(mobile){
    const point=await page.eval(`const e=${row('UI First action')};e.scrollIntoView({block:'center',behavior:'instant'});const b=e.querySelector('.ft-text').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};`);
    await press(`(${row('UI First action')}).querySelector('.ft-text')`);await until(()=>page.eval(`return !!(${menu('Reorder')});`),'touch row menu');await click(menu('Reorder'));
    await until(()=>page.eval(`return !!${root}.querySelector('.focus-tasks-view.ft-reordering');`),'touch drag mode');
  } else {
    const point=await page.eval(`const e=${row('UI First action')};e.scrollIntoView({block:'center',behavior:'instant'});const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};`);
    await page.front();await page.mouse('mouseMoved',point.x,point.y,0);await sleep(120);
  }
  const points=await page.eval(`const v=app.workspace.activeLeaf.view.renderer,a=${row('UI First action')},b=[...${root}.querySelectorAll('.ft-intent-list-row')].find(e=>e.getAttribute('data-intent-id')===${J(secondUid)}),s=v.scroller;
    const ab=a.getBoundingClientRect(),bb=b.getBoundingClientRect(),sr=s.getBoundingClientRect();s.scrollTop+=(Math.min(ab.top,bb.top)+Math.max(ab.bottom,bb.bottom))/2-(sr.top+sr.height/2);
    const grip=a.querySelector('.ft-grip').getBoundingClientRect(),target=b.getBoundingClientRect();return {from:{x:grip.left+grip.width/2,y:grip.top+grip.height/2},to:{x:target.left+target.width*0.7,y:target.top+target.height/2}};`);
  if(mobile){await page.touch('touchStart',[points.from]);for(let i=1;i<=14;i++){await page.touch('touchMove',[{x:points.from.x+(points.to.x-points.from.x)*i/14,y:points.from.y+(points.to.y-points.from.y)*i/14}]);await sleep(25);}await page.touch('touchEnd',[]);}
  else await page.drag(points.from,points.to);
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].read().intentTasks.find(x=>x.uid===${J(originalUid)})?.listUid===${J(secondUid)};`),'row dragged into second list');
  if(!await page.eval(`return app.plugins.plugins['focus-tasks'].tasks().length===__intentUITaskCount;`))throw Error('drag promoted an idea implicitly');
  if(mobile)await click(`document.querySelector('.ft-reorder-done')`);
  await page.eval(`await app.plugins.plugins['focus-tasks'].txTail;return true;`);await page.key('Meta+z');
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].read().intentTasks.find(x=>x.uid===${J(originalUid)})?.listUid!==${J(secondUid)};`),'drag Undo restores list membership');
  // Deleting a list is confirmed; Undo restores its entries and identities together.
  const at=await page.eval(`const e=(${list}).querySelector('.ft-project-name');e.scrollIntoView({block:'center',behavior:'instant'});const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};`);
  if(mobile)await press(`(${list}).querySelector('.ft-project-name')`);else await page.rightClick(at);
  await until(()=>page.eval(`return !!(${menu('Delete list')});`),'list deletion menu');await click(menu('Delete list'));
  await until(()=>page.eval(`return !!document.querySelector('.modal button.mod-warning');`),'list deletion confirmation');await click(`document.querySelector('.modal button.mod-warning')`);
  await until(()=>page.eval(`return !(${list});`),'list removed');
  await click(`[...document.querySelectorAll('.notice .ft-undo')].at(-1)`);await until(()=>page.eval(`return !!(${list})&&!!(${row('UI First action')});`),'list and rows restored by Undo');
  // Exercise the actual backup operator in this disposable native vault.
  const material='Context\n- Operator first\n  - Nested explanation\n- ~~Operator history~~\n- [[UI Link source]]';
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.ensureFolder('Notes');await app.vault.create('Notes/UI Link source.md','Original reference');return true;`);
  const fixture=await page.eval(`const p=app.plugins.plugins['focus-tasks'],card=await p.createIntent('UI operator source',${J(material)},'Ideas UI');return {vault:app.vault.adapter.getBasePath(),uid:card.uid,raw:card.raw,path:card.file.path};`);
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].read().intents.some(x=>x.uid===${J(fixture.uid)});`),'operator source indexed');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'focus-intent-lists-test-')),map=path.join(scratch,'map.json'),backup=path.join(scratch,'backup');
  fs.writeFileSync(map,JSON.stringify([{uid:fixture.uid,area:'Ideas UI',beforeHash:crypto.createHash('sha256').update(fixture.raw).digest('hex')}]));
  const tool=new URL('../tools/convert-intent-lists.mjs',import.meta.url).pathname;
  try {
    const args=[tool,'--vault',fixture.vault,'--map',map];
    const plan=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));
    if(plan.lists!==1||plan.entries!==3)throw Error('operator plan mismatch');
    const result=JSON.parse(execFileSync(process.execPath,[...args,'--execute','--backup',backup],{encoding:'utf8'}));
    if(result.lists!==1||result.entries!==3)throw Error('operator apply mismatch');
    if(fs.readFileSync(path.join(backup,'sources',fixture.path),'utf8')!==fixture.raw)throw Error('operator backup lost original');
    const after=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));
    if(after.lists||after.entries)throw Error('repeat operator plan creates duplicates');
    if(!await page.eval(`return app.vault.adapter.getBasePath()===${J(fixture.vault)};`))throw Error('operator closed its native window');
    await until(()=>page.eval(`return !!(${row('UI Link source')});`),'linked note entry rendered');
    await page.eval(`window.__intentLinkLeaf=app.workspace.activeLeaf;return true;`);
    await click(`(${row('UI Link source')}).querySelector('.ft-text a.internal-link')`);
    await until(()=>page.eval(`return app.workspace.activeLeaf.view.file?.path==='Notes/UI Link source.md';`),'linked note opens its original source');
    await page.eval(`app.workspace.setActiveLeaf(__intentLinkLeaf,{focus:true});return true;`);
    const inventory=await page.eval(`const p=app.plugins.plugins['focus-tasks'];return {lists:p.read().intents.filter(x=>x.area==='Ideas UI').map(x=>x.uid).sort(),entries:p.read().intentTasks.filter(x=>x.area==='Ideas UI').map(x=>x.uid).sort()};`);
    if(mobile)await click(`(${area}).querySelector(':scope > .ft-area-title .ft-more')`);
    else {const point=await page.eval(`const e=(${area}).querySelector(':scope > .ft-area-title');e.scrollIntoView({block:'center',behavior:'instant'});const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};`);await page.rightClick(point);}
    await click(menu('Delete area'));await until(()=>page.eval(`return !!document.querySelector('.modal button.mod-warning');`),'area delete confirmation');
    if(!await page.eval(`const text=document.querySelector('.modal').textContent;return /3/.test(text)&&/6/.test(text);`))throw Error('area confirmation omits idea lists or entries');
    await click(`document.querySelector('.modal button.mod-warning')`);
    await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return !p.notes().some(x=>x.area==='Ideas UI')&&!p.read().intents.some(x=>x.area==='Ideas UI')&&!p.read().intentTasks.some(x=>x.area==='Ideas UI');`),'area and its idea contents removed');
    if(!await page.eval(`return !!app.vault.getAbstractFileByPath('Notes/UI Link source.md');`))throw Error('area deletion removed a linked source note');
    await click(`[...document.querySelectorAll('.notice .ft-undo')].at(-1)`);
    await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return JSON.stringify(p.read().intents.filter(x=>x.area==='Ideas UI').map(x=>x.uid).sort())===${J(JSON.stringify(inventory.lists))}&&JSON.stringify(p.read().intentTasks.filter(x=>x.area==='Ideas UI').map(x=>x.uid).sort())===${J(JSON.stringify(inventory.entries))};`),'area lists and entries restored in one Undo');
    const focusUid=await page.eval(`const p=app.plugins.plugins['focus-tasks'],task=await p.createTask('UI Focus control',{area:'Ideas UI',project:null},'2000-01-01');p.refresh();return task.uid;`);
    await until(()=>page.eval(`return !!${root}.querySelector('.ft-focus-title');`),'Focus control visible');
    await click(`${root}.querySelector('.ft-focus-title')`);
    await until(()=>page.eval(`return !${root}.querySelector('.ft-intents');`),'Focus hides private ideas');
    if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'];return p.read().intents.filter(x=>x.area==='Ideas UI').length===3&&p.read().intentTasks.filter(x=>x.area==='Ideas UI').length===6;`))throw Error('Focus discarded idea data');
    await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.remove(p.tasks().find(x=>x.uid===${J(focusUid)}));return true;`);
  } finally {fs.rmSync(scratch,{recursive:true,force:true});}
}
