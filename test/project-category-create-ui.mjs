import {J,sleep,until} from './cdp.mjs';
import {toggleProjectUI} from './ui-actions.mjs';
import {setTaskDayUI} from './project-membership-ui.mjs';
import {checkIdeaDraft} from './intents-ui.mjs';

export async function checkProjectCategoryCreateUI(page,mobile=false){
 const expected=mobile?'focus-tasks-mobile':'focus-tasks-e2e';
 await page.eval(`if(app.vault.getName()!==${J(expected)}||app.vault.adapter.getBasePath()!==${J('/Users/daniil/Projects/obsidian-focus-tasks/test/'+expected)})throw Error('fixture guard');const p=app.plugins.plugins['focus-tasks'],name='Category creation UI',af=await p.createArea(name),area={name,note:af},file=await p.createProject(area,'ECC Focus project'),day=new Date().toLocaleDateString('en-CA'),seed=await p.createTask('ECC Seed Focus',{area:name,project:file.basename,projectFile:file},day);window.__ecc={area:name,path:file.path,seed:seed.uid,day,future:new Date(Date.now()+30*86400000).toLocaleDateString('en-CA')};p.setEverything(false);delete p.data.folded['area:'+name];delete p.data.opened['future:'+name];delete p.data.opened['intents:'+name];p.data.opened['project-focuson:'+file.path]=true;delete p.data.opened['project-focusoff:'+file.path];delete p.data.opened['later:'+file.path];p.data.opened['pagefold:'+file.path]=true;delete p.data.opened['project-intents:'+file.path];await p.saveFolds();await p.openView();p.refresh();return true;`);
 let root="app.workspace.getLeavesOfType('focus-tasks-view')[0].view.containerEl";
 const area=()=>`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='Category creation UI')`;
 let header=()=>`[...(${area()}).querySelectorAll('.ft-project-row')].find(e=>e.querySelector('.ft-project-name .ft-link')?.textContent==='ECC Focus project')`;
 const click=async(expr,category=false)=>{
  await page.front();
  await page.eval(`for(const v of app.plugins.plugins['focus-tasks'].views)v.releasePin?.();const e=${expr};if(!e)throw Error('missing target');(e.closest('.ft-category-picker')||e.closest('.ft-category-host')||e).scrollIntoView({block:'center',behavior:'instant'});return true;`);await sleep(180);
  if(category&&!await page.eval(`return (${expr}).closest('.ft-category-picker').classList.contains('is-open');`)){
   const r=await page.eval(`const e=(${expr}).closest('.ft-category-picker').querySelector(':scope > .ft-category-total,:scope > .ft-steps-more'),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(!r.width||!r.height||!e.contains(document.elementFromPoint(x,y)))throw Error('category counter is not reachable');return {x,y};`);
   if(mobile)await page.tap(r);else await page.mouse('mouseMoved',r.x,r.y,0);await sleep(200);
  }
  const at=await page.eval(`const e=${expr},r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(!r.width||!r.height||!e.contains(document.elementFromPoint(x,y)))throw Error('target clipped or covered: '+${J(expr)}+' hit='+document.elementFromPoint(x,y)?.className+' rect='+JSON.stringify({x,y,w:r.width,h:r.height}));return {x,y};`);
  if(mobile)await page.tap(at);else await page.click(at);await sleep(140);
 };
 const category=kind=>`(${header()}).querySelector('.ft-${kind==='backlog'?'later':kind}-chip')`;
 const ensure=async(kind,on)=>{if(kind==='focus')return;await until(()=>page.eval(`return !!(${header()});`),'project header');if(await page.eval(`return (${category(kind)}).getAttribute('aria-pressed')==='true';`)!==on)await click(category(kind),true);await until(()=>page.eval(`return (${category(kind)}).getAttribute('aria-pressed')===${J(String(on))};`),'category '+kind+' '+on);};
 const create=async(expr,title,kind)=>{
  await click(expr);await until(()=>page.eval(`return !!${root}.querySelector('[contenteditable=true]');`),'category editor');
  if(!await page.eval(`const e=${root}.querySelector('[contenteditable=true]');return !!e.closest(${J(kind==='backlog'?'.ft-later-steps,.ft-future-block':'.ft-project-intents')});`))throw Error('draft escaped its '+kind+' list');
  if(kind==='intents'){
   if(await page.eval(`const e=${expr};return !!e?.getBoundingClientRect().height;`))throw Error('the empty project idea helper remains visible beside its first draft');
   await checkIdeaDraft(page,root,mobile?'Новый замысел':'New idea');
   await page.key('Escape');
   await until(()=>page.eval(`return !${root}.querySelector('[contenteditable=true]')&&!!(${expr})?.getBoundingClientRect().height;`),'cancel restores the empty project idea helper');
   await click(expr);await until(()=>page.eval(`return !!${root}.querySelector('[contenteditable=true]');`),'reopened first project idea draft');
  }
  await page.type(title);await page.key('Enter');await page.key('Escape');
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'],t=[...p.tasks(),...p.read().intentTasks].find(t=>t.text===${J(title)});if(!t||t.area!==__ecc.area)return false;return ${J(kind)}==='intents'?!!t.intent&&p.projectIntentLists(app.vault.getAbstractFileByPath(__ecc.path)).some(l=>p.intentEntries(l).some(x=>x.uid===t.uid)):!t.intent&&p.projectFile(t)?.path===__ecc.path&&t.date===(${J(kind)}==='focus'?__ecc.day:null);`),'correct category note '+title);
  if(kind==='intents')await until(()=>page.eval(`const row=[...${root}.querySelectorAll('li.ft-task')].find(e=>e.querySelector('.ft-text')?.textContent===${J(title)});return !!row&&!row.closest('.ft-project-intents').querySelector('.ft-intents-add');`),'first saved project idea removes its add helper');
 };
 const promote=async title=>{
  const row=`[...${root}.querySelectorAll('li.ft-task:not(.ft-project-row)')].find(e=>e.querySelector('.ft-text')?.textContent===${J(title)})`;
  await until(()=>page.eval(`return !!(${row});`),'Backlog task to date');
  await setTaskDayUI(page,row,await page.eval(`return __ecc.day;`),mobile);
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().find(t=>t.text===${J(title)})?.date===__ecc.day;`),'dated task enters Focus');
  await until(()=>page.eval(`const e=${row};return !!e&&!e.closest('.ft-later-steps,.ft-future-block')&&!document.querySelector('.ft-picker')&&!${root}.querySelector('[contenteditable=true]');`),'dated task is visibly in Focus before adding another Backlog task');
  if(await page.eval(`return !!${root}.querySelector('.ft-project-category-add[data-ft-project-category=focus],.ft-project-empty-focus');`))throw Error('redundant Add to Focus remains');
 };
 const taskRow=title=>`[...${root}.querySelectorAll('li.ft-task:not(.ft-project-row)')].find(e=>e.querySelector('.ft-text')?.textContent===${J(title)})`;
 const noBacklogPrompt=async()=>{
  if(await page.eval(`return !!${root}.querySelector('.ft-project-category-add[data-ft-project-category=backlog]')||[...${root}.querySelectorAll('.ft-empty-add,.ft-no-step')].some(e=>/Add to Backlog|Добавить в отложку/.test(e.textContent));`))throw Error('project still offers Add to Backlog');
 };
 const backlogFromFocus=async(title,after,day=null)=>{
  await click(`(${taskRow(after)}).querySelector('.ft-text')`);
  await until(()=>page.eval(`return !!${root}.querySelector('[contenteditable=true]');`),'edit the last Focus task');
  await page.key('Enter');
  await until(()=>page.eval(`const e=${root}.querySelector('[contenteditable=true]');return !!e&&!e.textContent&&!e.closest('.ft-later-steps,.ft-future-block');`),'Enter creates the next Focus step');
  await page.type(title);await page.key('Enter');await page.key('Escape');
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'],t=p.tasks().find(t=>t.text===${J(title)});return !!t&&p.projectFile(t)?.path===__ecc.path&&t.date===__ecc.day&&!!(${taskRow(title)});`),'new Focus step retains its project and today');
  if(day)await setTaskDayUI(page,taskRow(title),day,mobile);
  else{
   await click(`(${taskRow(title)}).querySelector('.ft-date')`);
   await until(()=>page.eval(`return !!document.querySelector('.ft-picker');`),'calendar for the new Focus step');
   await click("[...document.querySelectorAll('.ft-picker-foot button')].find(e=>/^(Clear date|Убрать дату)$/.test(e.textContent))");
  }
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'],t=p.tasks().find(t=>t.text===${J(title)}),e=${taskRow(title)};return !!t&&t.date===${J(day)}&&p.projectFile(t)?.path===__ecc.path&&!!e?.closest('.ft-later-steps,.ft-future-block')&&!document.querySelector('.ft-picker');`),'changing the date moves the new step into project Backlog');
  await noBacklogPrompt();
 };
 await until(()=>page.eval(`return !!(${header()})?.querySelector('.ft-text');`),'compact Focus-only project');
 if(await page.eval(`return !!(${header()}).querySelector('.ft-steps-more');`))throw Error('single-step project displays a redundant counter');
 await toggleProjectUI(page,header(),mobile);
 await until(()=>page.eval(`const r=${header()};return !!r&&r.querySelectorAll('button[data-ft-category]').length===2&&!r.querySelector('.ft-focus-chip')&&r.querySelector('.ft-later-chip .ft-supplement-count').textContent==='0'&&r.querySelector('.ft-intents-chip .ft-supplement-count').textContent==='0';`),'all three categories on Focus-only project');
 await ensure('backlog',true);
 await noBacklogPrompt();
 await backlogFromFocus('ECC Backlog','ECC Seed Focus');
 const seed=`[...(${area()}).querySelectorAll('li.ft-task')].find(e=>e.querySelector('.ft-text')?.textContent==='ECC Seed Focus')`;
 await click(`(${seed}).querySelector('input[type=checkbox]')`);
 await until(()=>page.eval(`return (${header()})?.getAttribute('data-ft-project-bucket')==='backlog';`),'project leaves Focus after completion');
 if(await page.eval(`return !!${root}.querySelector('.ft-project-category-add[data-ft-project-category=focus],.ft-project-empty-focus');`))throw Error('empty Focus offers an unwanted creation button');
 await promote('ECC Backlog');
 await ensure('intents',true);
 await create(`(${area()}).querySelector('.ft-project-intents .ft-intents-add')`,'ECC Idea','intents');
 const ideaRow=`[...${root}.querySelectorAll('li.ft-task:not(.ft-project-row)')].find(e=>e.querySelector('.ft-text')?.textContent==='ECC Idea')`;
 const original=await page.eval(`const p=app.plugins.plugins['focus-tasks'],entry=p.read().intentTasks.find(t=>t.text==='ECC Idea'),list=p.projectIntentLists(app.vault.getAbstractFileByPath(__ecc.path)).find(l=>p.intentEntries(l).some(t=>t.uid===entry.uid));return {uid:entry.uid,listUid:list.uid,listPath:list.file.path,listRaw:await app.vault.read(list.file)};`);
 const deleteLastIdea=async()=>{
  await page.front();await page.eval(`(${ideaRow}).scrollIntoView({block:'center',behavior:'instant'});__ecc.stable=null;return true;`);
  await until(()=>page.eval(`const e=${ideaRow},now=performance.now();if(!e?.isConnected)return false;if(__ecc.stable?.el!==e)__ecc.stable={el:e,at:now};return now-__ecc.stable.at>650;`),'last project idea stable before opening its menu');
  const at=await page.eval(`const e=(${ideaRow}).querySelector('.ft-text'),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};`);
  if(mobile)await page.tap(at,650,false);else await page.rightClick(at,false);
  const menu=`[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.trim()===${J(mobile?'Удалить':'Delete')})`;
  await until(()=>page.eval(`return !!(${menu});`),'delete last project idea menu');await click(menu);
  await until(()=>page.eval(`return !app.plugins.plugins['focus-tasks'].read().intentTasks.some(t=>t.uid===${J(original.uid)});`),'last project idea deleted');
  await until(()=>page.eval(`return !(${ideaRow})&&!!(${area()}).querySelector('.ft-project-intents .ft-intents-add');`),'empty project idea block redrawn');
  const empty=await page.eval(`const b=(${area()}).querySelector('.ft-project-intents');return {children:b.children.length,lists:b.querySelectorAll('.ft-project-row').length,add:b.querySelectorAll('.ft-intents-add').length};`);
  if(empty.children!==1||empty.lists||empty.add!==1)throw Error('deleting the last project idea must leave only Add an idea, without a default list: '+J(empty));
  if(await page.eval(`return await app.vault.read(app.vault.getAbstractFileByPath(${J(original.listPath)}));`)!==original.listRaw)throw Error('deleting an entry changed its private idea list');
 };
 await deleteLastIdea();
 await click(`[...document.querySelectorAll('.notice .ft-undo')].at(-1)`);
 await until(()=>page.eval(`return !!(${ideaRow})&&app.plugins.plugins['focus-tasks'].read().intentTasks.some(t=>t.uid===${J(original.uid)});`),'Undo restores the same project idea');
 if(await page.eval(`return !!(${area()}).querySelector('.ft-project-intents .ft-intents-add,.ft-project-intents .ft-project-row');`))throw Error('Undo reintroduced the filled-list prompt or default private header');
 await deleteLastIdea();
 await create(`(${area()}).querySelector('.ft-project-intents .ft-intents-add')`,'ECC Replacement idea','intents');
 if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'],lists=p.projectIntentLists(app.vault.getAbstractFileByPath(__ecc.path));return lists.length===1&&lists[0].uid===${J(original.listUid)}&&p.intentEntries(lists[0]).some(t=>t.text==='ECC Replacement idea'&&t.uid!==${J(original.uid)});`))throw Error('adding after deletion replaced or duplicated the private idea list');
 await until(()=>page.eval(`return [...(${header()}).querySelectorAll('.ft-supplement-count')].map(x=>x.textContent).join(',')==='0,1';`),'dated task and private idea retain independent categories');
 // A project note has the same zero categories and creation semantics, even with a future day.
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],area={name:__ecc.area,note:p.notes().find(n=>!n.project&&n.area===__ecc.area).file},file=await p.createProject(area,'ECC Future page');await p.frontOwned(file,fm=>fm.scheduled=__ecc.future);__ecc.path=file.path;const text=await app.vault.read(file);if(!text.includes('focus-tasks'))await app.vault.append(file,${J('\n```focus-tasks\n```\n')});await app.workspace.getLeaf('tab').openFile(file,{state:{mode:'preview'}});return true;`);
 root="[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.ft-page')].find(e=>e.getBoundingClientRect().width>0)";header=()=>`(${root})?.querySelector(':scope > .ft-area-title')`;
 await until(()=>page.eval(`return (${header()})?.querySelectorAll('button[data-ft-category]').length===2;`),'visible project note offers Backlog and Ideas');
 if(await page.eval(`return !!${root}.querySelector('.ft-project-category-add[data-ft-project-category=focus],.ft-project-empty-focus');`))throw Error('project page offers an unwanted Add to Focus');
 await ensure('backlog',true);
 await noBacklogPrompt();
 await click(`${root}.querySelector('.ft-page-add')`);
 await until(()=>page.eval(`return !!${root}.querySelector('[contenteditable=true]');`),'empty project first-step editor');
 await page.type('ECC Future project Backlog');await page.key('Enter');await page.key('Escape');
 await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'],t=p.tasks().find(t=>t.text==='ECC Future project Backlog');return !!t&&t.date===null&&p.projectFile(t)?.path===__ecc.path&&!!(${taskRow('ECC Future project Backlog')});`),'empty project retains its ordinary first-step creation');
 await promote('ECC Future project Backlog');
 await noBacklogPrompt();
 await backlogFromFocus('ECC Future project Backlog 2','ECC Future project Backlog',await page.eval('return __ecc.future;'));
 await ensure('intents',true);
 await create(`${root}.querySelector('.ft-project-intents .ft-intents-add')`,'ECC Future project Idea','intents');
 if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'],file=app.vault.getAbstractFileByPath(__ecc.path),area=p.notes().find(n=>n.file===file)?.area,scope=p.scopeTasks((await p.collect(false,true)).find(a=>a.name===area),file.path);return p.classify(file).date===__ecc.future&&scope.focus.length===1&&scope.backlog.length===1;`))throw Error('project day changed or swallowed an explicit task category');
 await page.eval(`await app.plugins.plugins['focus-tasks'].openView();delete window.__ecc;return true;`);
}
