import {J,sleep,until} from './cdp.mjs';
export async function checkListCompletionUI(page,mobile=false){
 const root=`(window.__lcScoped?[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.focus-tasks-view')].find(x=>x.getBoundingClientRect().width):app.workspace.getLeavesOfType('focus-tasks-view')[0].view.containerEl)`;
 const row=key=>`[...${root}.querySelectorAll('.ft-intent-list-row')].find(e=>e.getAttribute('data-intent-id')===__lc[${J(key)}].uid&&e.getBoundingClientRect().width)`;
 const click=async (expr,refreshWhilePressed=false)=>{
  await page.front();await page.eval(`if(!window.__lcScoped)await app.plugins.plugins['focus-tasks'].openView();return true;`);const trigger=await page.eval(`const e=${expr};e?.scrollIntoView({block:'center',behavior:'instant'});const picker=e?.closest('.ft-category-picker');if(picker&&!picker.classList.contains('is-open')){const r=picker.querySelector(':scope > .ft-category-total,:scope > .ft-steps-more').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};}if(!${mobile})e?.closest('.ft-hover-host')?.focus();return null;`);if(trigger){if(mobile)await page.tap(trigger,60,false);else await page.mouse('mouseMoved',trigger.x,trigger.y,0);}await sleep(250);
  const at=await until(()=>page.eval(`const e=${expr},r=e?.getBoundingClientRect();if(!r?.width)return false;const at={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(at.x,at.y);return e.contains(hit)?at:false;`),'list control '+expr);
  if(refreshWhilePressed){
   if(!mobile)await page.mouse('mouseMoved',at.x,at.y,0);
   await page.eval(`window.__lcPressed=${expr};return true;`);
   if(mobile)await page.touch('touchStart',[at]);else await page.mouse('mousePressed',at.x,at.y);
   let retained;
   try{
    await page.eval(`app.plugins.plugins['focus-tasks'].refresh();return true;`);await sleep(400);
    retained=await page.eval(`return __lcPressed.isConnected;`);
   }finally{
    if(mobile)await page.touch('touchEnd',[]);else await page.mouse('mouseReleased',at.x,at.y,0);
    await page.eval(`delete window.__lcPressed;return true;`);
   }
   if(!retained)throw Error('refresh removed a checkbox before its click was delivered');
  }else if(mobile)await page.tap(at,60,false);else await page.click(at,0,false);
  await sleep(350);
 };
 const status=key=>page.eval(`return app.plugins.plugins['focus-tasks'].intentOf(app.vault.getAbstractFileByPath(__lc[${J(key)}].path))?.done;`);
 await page.eval(`if(app.vault.getName()!==${J(mobile?'focus-tasks-mobile':'focus-tasks-e2e')})throw Error('fixture guard');const p=app.plugins.plugins['focus-tasks'];const file=await p.createArea('List completion UI');window.__lc={area:file.path};return true;`);
 await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return p.notes().some(n=>n.area==='List completion UI');`),'area metadata');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],area={name:'List completion UI',note:app.vault.getAbstractFileByPath(__lc.area)};await p.createTask('LC Anchor',{area:area.name},moment().format('YYYY-MM-DD'));const empty=await p.createIntentList('LC Empty',area.name),active=await p.createIntentList('LC Active',area.name),entry=await p.createTask('LC Possibility',{area:area.name,project:active.file.basename,projectFile:active.file,intentList:true,listUid:active.uid},null),project=await p.createProject(area,'LC Project'),bound=await p.createIntentList('LC Bound',area.name);Object.assign(__lc,{project:project.path,empty:{path:empty.file.path,uid:empty.uid},active:{path:active.file.path,uid:active.uid},bound:{path:bound.file.path,uid:bound.uid},entry:entry.uid});return true;`);
 await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return !!p.classify(app.vault.getAbstractFileByPath(__lc.project))?.project&&['empty','active','bound'].every(k=>p.intentOf(app.vault.getAbstractFileByPath(__lc[k].path))?.isList);`),'project and list metadata');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.bindIntentList(p.intentOf(app.vault.getAbstractFileByPath(__lc.bound.path)),app.vault.getAbstractFileByPath(__lc.project));p.setEverything(false);delete p.data.folded['area:List completion UI'];p.data.opened['intents:List completion UI']=true;await p.saveFolds();const leaf=await p.openView();await leaf.view.renderer.rerendered();return true;`);
 await until(()=>page.eval(`return !!(${row('empty')})?.querySelector('input[type=checkbox]');`),'empty list checkbox');
 await click(`(${row('empty')}).querySelector('input[type=checkbox]')`,true);await until(()=>status('empty'),'empty list completed');
 if(await page.eval(`return !!(${row('empty')});`))throw Error('completed list remains in active rows');
 if(!await page.eval(`return !!(${row('empty')});`))await click(`[...${root}.querySelectorAll('.ft-area')].find(a=>a.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='List completion UI').querySelector('.ft-intent-lists-done')`);
 await until(()=>page.eval(`return !!(${row('empty')})?.classList.contains('ft-done');`),'completed list in private Done');
 await click(`(${row('empty')}).querySelector('input[type=checkbox]')`);await until(async()=>!await status('empty'),'completed list reopened');
 await click(`((${row('active')}).querySelector('input[type=checkbox]')||(${row('active')}).nextElementSibling?.querySelector('input[type=checkbox]'))`);
 await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].read().intentTasks.find(t=>t.uid===__lc.entry)?.status==='done';`),'last possibility checked');
 await until(()=>page.eval(`return !!(${row('active')})?.querySelector('input[aria-label="${mobile?'Завершить список':'Complete list'}"]');`),'empty list completion replaces the entry checkbox');
 await click(`(${row('active')}).querySelector('input[aria-label="${mobile?'Завершить список':'Complete list'}"]')`);await until(()=>status('active'),'exhausted list completed');
 // The same empty-list checkbox is present under a project's Ideas and in its own note.
 await page.eval(`const p=app.plugins.plugins['focus-tasks'];delete p.data.opened['intents:List completion UI'];await p.saveFolds();p.refresh();await app.workspace.getLeavesOfType('focus-tasks-view')[0].view.renderer.rerendered();return true;`);
 const boundProject=`${root}.querySelector('li[data-ft-project-path="'+__lc.project+'"]')`;
 await until(()=>page.eval(`return !!(${boundProject})?.querySelector('.ft-steps-more');`),'bound project direct +N');
 if(!await page.eval(`return (${boundProject}).classList.contains('is-open');`))await click(`(${boundProject}).querySelector('.ft-steps-more')`);
 await click(`(${boundProject}).querySelector('.ft-intents-chip')`);
 await until(()=>page.eval(`return !!(${row('bound')})?.querySelector('input[type=checkbox]');`),'bound empty list checkbox');
 await click(`(${row('bound')}).querySelector('input[type=checkbox]')`);await until(()=>status('bound'),'bound list completed');
 await page.eval(`window.__lcScoped=true;const f=app.vault.getAbstractFileByPath(__lc.project),leaf=app.workspace.getLeaf('tab');await leaf.openFile(f,{state:{mode:'preview'}});app.workspace.revealLeaf(leaf).catch(e=>console.warn('fixture reveal',e));app.workspace.setActiveLeaf(leaf,{focus:true});return true;`);
 await until(()=>page.eval(`return !!${root}.querySelector('.ft-page');`),'project scoped view without an empty category popup');
 if(!await page.eval(`return !!${root}.querySelector('.ft-intent-lists-done')||${root}.querySelector('.ft-intents-chip')?.getAttribute('aria-pressed')==='true';`))await click(`${root}.querySelector('.ft-intents-chip')`);
 await until(()=>page.eval(`return !!${root}.querySelector('.ft-intent-lists-done');`),'bound completed list shelf in project note');
 if(!await page.eval(`return !!(${row('bound')});`))await click(`${root}.querySelector('.ft-intent-lists-done')`);
 await click(`(${row('bound')}).querySelector('input[type=checkbox]')`);await until(async()=>!await status('bound'),'bound list reopened in project note');
 await page.eval(`const f=app.vault.getAbstractFileByPath(__lc.empty.path);await app.vault.process(f,raw=>raw.includes(${J('```focus-tasks')})?raw:raw+${J('\n```focus-tasks\n```\n')});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(f,{state:{mode:'preview'}});app.workspace.revealLeaf(leaf).catch(e=>console.warn('fixture reveal',e));app.workspace.setActiveLeaf(leaf,{focus:true});return true;`);
 await until(()=>page.eval(`return !!${root}.querySelector('.ft-intent-page input[aria-label="${mobile?'Завершить список':'Complete list'}"]');`),'own private list page');
 await click(`${root}.querySelector('.ft-intent-page input[aria-label="${mobile?'Завершить список':'Complete list'}"]')`,true);await until(()=>status('empty'),'own list checkbox survives refresh');
 await click(`${root}.querySelector('.ft-intent-page input[aria-label="${mobile?'Завершить список':'Complete list'}"]')`,true);await until(async()=>!await status('empty'),'own list reopens after refresh');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'];return [...p.views].find(v=>app.workspace.activeLeaf.view.containerEl.contains(v.containerEl)&&v.containerEl.getBoundingClientRect().width>0)?.revealIntent({kind:'intent',uid:__lc.active.uid});`);
 await until(()=>page.eval(`return !!document.querySelector('.ft-found.ft-done[data-intent-id="'+__lc.active.uid+'"]');`),'search reveals a completed list without reopening it');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'];const area=(await p.collect(true)).find(a=>a.name==='List completion UI');await p.removeArea(area);delete window.__lc;delete window.__lcScoped;await p.openView();return true;`);
}
