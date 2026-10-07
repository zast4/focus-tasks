import {J,sleep,until} from './cdp.mjs';

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
 const ensure=async(kind,on)=>{await until(()=>page.eval(`return !!(${header()});`),'project header');if(await page.eval(`return (${category(kind)}).getAttribute('aria-pressed')==='true';`)!==on)await click(category(kind),true);await until(()=>page.eval(`return (${category(kind)}).getAttribute('aria-pressed')===${J(String(on))};`),'category '+kind+' '+on);};
 const create=async(expr,title,kind)=>{
  await click(expr);await until(()=>page.eval(`return !!${root}.querySelector('[contenteditable=true]');`),'category editor');
  if(!await page.eval(`const e=${root}.querySelector('[contenteditable=true]');return !!e.closest(${J(kind==='backlog'?'.ft-later-steps,.ft-future-block':kind==='focus'?'.ft-project-empty-focus':'.ft-project-intents')});`))throw Error('draft escaped its '+kind+' list');
  await page.type(title);await page.key('Enter');await page.key('Escape');
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'],t=[...p.tasks(),...p.read().intentTasks].find(t=>t.text===${J(title)});if(!t||t.area!==__ecc.area)return false;return ${J(kind)}==='intents'?!!t.intent&&p.projectIntentLists(app.vault.getAbstractFileByPath(__ecc.path)).some(l=>p.intentEntries(l).some(x=>x.uid===t.uid)):!t.intent&&p.projectFile(t)?.path===__ecc.path&&t.date===(${J(kind)}==='focus'?__ecc.day:null);`),'correct category note '+title);
 };
 await until(()=>page.eval(`const r=${header()};return !!r&&r.querySelectorAll('button[data-ft-category]').length===3&&r.querySelector('.ft-focus-chip .ft-supplement-count').textContent==='1'&&r.querySelector('.ft-later-chip .ft-supplement-count').textContent==='0'&&r.querySelector('.ft-intents-chip .ft-supplement-count').textContent==='0';`),'all three categories on Focus-only project');
 await ensure('backlog',true);
 await create(`(${area()}).querySelector('.ft-later-steps [data-ft-project-category=backlog]')`,'ECC Backlog','backlog');
 const seed=`[...(${area()}).querySelectorAll('li.ft-task')].find(e=>e.querySelector('.ft-text')?.textContent==='ECC Seed Focus')`;
 await click(`(${seed}).querySelector('input[type=checkbox]')`);
 await until(()=>page.eval(`return (${header()}).querySelector('.ft-focus-chip .ft-supplement-count').textContent==='0';`),'Focus empty after completion');
 await ensure('focus',false);await ensure('focus',true);
 await create(`(${area()}).querySelector('.ft-project-empty-focus [data-ft-project-category=focus]')`,'ECC New Focus','focus');
 await ensure('intents',true);
 await create(`(${area()}).querySelector('.ft-project-intents .ft-intents-add')`,'ECC Idea','intents');
 await until(()=>page.eval(`return [...(${header()}).querySelectorAll('.ft-supplement-count')].map(x=>x.textContent).join(',')==='1,1,1';`),'independent populated categories');
 // A project note has the same zero categories and creation semantics, even with a future day.
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],area={name:__ecc.area,note:p.notes().find(n=>!n.project&&n.area===__ecc.area).file},file=await p.createProject(area,'ECC Future page');await p.setProjectDate(file,__ecc.future);__ecc.path=file.path;const text=await app.vault.read(file);if(!text.includes('focus-tasks'))await app.vault.append(file,${J('\n```focus-tasks\n```\n')});await app.workspace.getLeaf('tab').openFile(file,{state:{mode:'preview'}});return true;`);
 root="[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.ft-page')].find(e=>e.getBoundingClientRect().width>0)";header=()=>`(${root})?.querySelector(':scope > .ft-area-title')`;
 await until(()=>page.eval(`return (${header()})?.querySelectorAll('button[data-ft-category]').length===3;`),'visible project note offers all empty categories');
 await ensure('focus',true);
 await create(`${root}.querySelector('.ft-project-empty-focus [data-ft-project-category=focus]')`,'ECC Future project Focus','focus');
 await ensure('backlog',true);
 await create(`${root}.querySelector('.ft-future-block [data-ft-project-category=backlog]')`,'ECC Future project Backlog','backlog');
 await ensure('intents',true);
 await create(`${root}.querySelector('.ft-project-intents .ft-intents-add')`,'ECC Future project Idea','intents');
 if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'],file=app.vault.getAbstractFileByPath(__ecc.path),area=p.notes().find(n=>n.file===file)?.area,scope=p.scopeTasks((await p.collect(false,true)).find(a=>a.name===area),file.path);return p.classify(file).date===__ecc.future&&scope.focus.length===1&&scope.backlog.length===1;`))throw Error('project day changed or swallowed an explicit task category');
 await page.eval(`await app.plugins.plugins['focus-tasks'].openView();delete window.__ecc;return true;`);
}
