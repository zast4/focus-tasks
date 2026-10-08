import {J,sleep,until} from './cdp.mjs';
import {focusRoot as root,guardFixture,clickUI,toggleProjectUI} from './ui-actions.mjs';
import {fileURLToPath} from 'node:url';

export async function checkWaitingProjectUI(page,mobile=false){
 await guardFixture(page,mobile);
 const click=expr=>clickUI(page,expr,mobile);
 const header=(key,waiting)=>`[...${root}.querySelectorAll('li.ft-project-row')].find(e=>e.getAttribute('data-ft-project-path')===__wp[${J(key)}]&&!!e.closest('.ft-waiting')===${waiting})`;
 const menu=label=>`[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.trim()===${J(label)})`;
 const point=async expr=>{
  await page.front();await page.eval(`const e=${expr};if(!e)throw Error('missing Waiting control');e.scrollIntoView({block:'center',behavior:'instant'});return true;`);await sleep(250);
  return until(()=>page.eval(`const e=${expr},r=e?.getBoundingClientRect(),p=r&&{x:r.left+r.width/2,y:r.top+r.height/2};return p&&r.width&&e.contains(document.elementFromPoint(p.x,p.y))?p:false;`),'visible Waiting control');
 };
 const taskMenu=async expr=>{
  await point(expr);
  await page.eval('window.__wpStable=null;return true;');
  await until(()=>page.eval(`const e=${expr},now=performance.now();if(!e?.isConnected)return false;if(window.__wpStable?.el!==e)window.__wpStable={el:e,at:now};return now-window.__wpStable.at>650;`),'Waiting task row stable before pressing');
  const at=await point(expr);if(mobile)await page.tap(at,650,false);else await page.rightClick(at,false);
 };
 const send=async key=>{
  await taskMenu(`(${header(key,false)}).querySelector('.ft-text')||(${header(key,false)}).nextElementSibling?.querySelector('.ft-text')`);
  await until(()=>page.eval(`return !!(${menu(mobile?'Жду…':'Waiting…')});`),'send first step to Waiting menu');await click(menu(mobile?'Жду…':'Waiting…'));
  await until(()=>page.eval(`return !!document.querySelector('.ft-picker-input');`),'Waiting return calendar');
  await click("document.querySelector('.ft-picker-input')");await page.eval("document.querySelector('.ft-picker-input').select();return true;");
  await page.type(await page.eval("return moment().add(3,'days').format('DD.MM.YY');"));await click("document.querySelector('.ft-picker-save')");
 };
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],name='Waiting project UI',note=await p.createArea(name),singleName='Waiting single UI',singleNote=await p.createArea(singleName),today=moment().format('YYYY-MM-DD');window.__wp={name,singleName,shown:p.waitingShown(),uids:{}};
 for(const key of ['Single','Group']){const parent=key==='Single'?{name:singleName,note:singleNote}:{name,note};const file=await p.createProject(parent,'WP '+key);__wp[key]=file.path;const first=await p.createTask('WP '+key+' first',{area:parent.name,project:file.basename,projectFile:file},today);__wp.uids[key]=first.uid;if(key==='Group'){const next=await p.createTask('WP Next',{area:name,project:file.basename,projectFile:file},today);__wp.next=next.uid;__wp.nextPath=next.file.path;__wp.nextRaw=await app.vault.cachedRead(next.file);p.data.order.tasks['project:'+file.basename]=[first.uid,next.uid];}p.data.opened['fresh:'+file.path]=today;}
 await p.createTask('WP Anchor',{area:name},today);const reply=await p.createTask('WP Reply',{area:name},moment().add(5,'days').format('YYYY-MM-DD'));await p.setWaiting(reply,true,moment().add(5,'days').format('YYYY-MM-DD'));p.setEverything(false);p.setWaitingShown(false);delete p.data.folded['area:'+name];delete p.data.folded['area:'+singleName];await p.saveFolds();await p.openView();p.refresh();return true;`);
 try{
  await until(()=>page.eval(`return !!(${header('Single',false)})?.querySelector('.ft-text');`),'single-step project preview');
  await toggleProjectUI(page,header('Single',false),mobile);
  await send('Single');
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'],t=p.tasks().find(t=>t.uid===__wp.uids.Single);return t?.status==='waiting'&&t.date===moment().add(3,'days').format('YYYY-MM-DD')&&!(${header('Single',false)});`),'single project leaves Focus with its Waiting first step');
  await click(`${root}.querySelector('.ft-waiting-toggle')`);
  await until(()=>page.eval(`const h=${header('Single',true)};return h?.querySelector('.ft-project-name')?.textContent.includes('WP Single')&&h.querySelector('.ft-text')?.textContent==='WP Single first'&&!h.querySelector('.ft-project-tag,.ft-steps-more,.ft-no-step');`),'Waiting has a normal single project preview without zero counters or empty prompts');
  if(await page.eval(`return [...${root}.querySelectorAll('.ft-area:not(.is-rest)')].some(a=>a.querySelector(':scope > .ft-area-title .ft-link')?.textContent===__wp.singleName);`))throw Error('a retained project header keeps an empty Waiting-only area in Focus');
  await click(`${root}.querySelector('.ft-all-toggle')`);
  const rest=`[...${root}.querySelectorAll('.ft-area.is-rest')].find(a=>a.querySelector(':scope > .ft-area-title .ft-link')?.textContent===__wp.singleName)`;
  await until(()=>page.eval(`return !!(${rest});`),'Waiting-only area in All');
  if(!await page.eval(`return app.plugins.plugins['focus-tasks'].isShown('area:'+__wp.singleName,true);`))await click(`(${rest}).querySelector(':scope > .ft-area-title .ft-caret')`);
  await until(()=>page.eval(`const h=[...${root}.querySelectorAll('.ft-area.is-rest li.ft-project-row')].find(h=>h.getAttribute('data-ft-project-path')===__wp.Single);return h?.querySelector('.ft-text')?.textContent==='WP Single first'&&!h.querySelector('.ft-no-step,.ft-steps-more');`),'All keeps the Waiting-only project as a real preview');
  await click(`${root}.querySelector('.ft-all-toggle')`);
  await taskMenu(`(${header('Single',true)}).querySelector('.ft-text')`);await click(menu(mobile?'Взять обратно':'Take it back'));
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return !!(${header('Single',false)})&&!(${header('Single',true)})&&p.tasks().find(t=>t.uid===__wp.uids.Single)?.date===moment().format('YYYY-MM-DD');`),'taking first step back returns its same project to Focus');
  if(mobile)await send('Group');
  else{
   const from=await point(`(${header('Group',false)}).querySelector('.ft-grip')`);
   await page.mouse('mousePressed',from.x,from.y,1);await page.mouse('mouseMoved',from.x+15,from.y+10,1);
   const target=`[...${root}.querySelectorAll('.ft-waiting-area-title')].find(e=>e.textContent.includes(__wp.name))`;
   await page.eval(`(${target}).scrollIntoView({block:'center',behavior:'instant'});return true;`);await sleep(120);const to=await point(target);
   for(let i=1;i<=8;i++){await page.mouse('mouseMoved',from.x+(to.x-from.x)*i/8,from.y+(to.y-from.y)*i/8,1);await sleep(25);}
   if(!await page.eval(`const v=app.workspace.getLeavesOfType('focus-tasks-view')[0].view.renderer;return v.held&&(${target}).classList.contains('ft-drop-into');`)){await page.mouse('mouseReleased',from.x,from.y,0);throw Error('native project drag missed the Waiting section');}
   await page.mouse('mouseReleased',to.x,to.y,0);
  }
  await until(()=>page.eval(`return !!(${header('Group',true)})&&!(${header('Group',false)});`),'first Waiting step moves the entire multi-step project');
  await toggleProjectUI(page,header('Group',true),mobile);
  await until(()=>page.eval(`const h=${header('Group',true)},steps=h?.nextElementSibling;return h?.classList.contains('is-open')&&steps?.classList.contains('ft-steps')&&steps.querySelectorAll('li.ft-task').length===2&&steps.textContent.includes('WP Group first')&&steps.textContent.includes('WP Next')&&!steps.querySelector('.ft-project-tag')&&!h.parentElement.querySelector('.ft-project-empty-focus');`),'Waiting project expands to its own indented steps');
  if(!await page.eval(`return await app.vault.cachedRead(app.vault.getAbstractFileByPath(__wp.nextPath))===__wp.nextRaw;`))throw Error('Waiting move changed another project step');
  if(!await page.eval(`const h=${header('Group',true)},next=[...h.nextElementSibling.querySelectorAll('li.ft-task')].find(e=>e.querySelector('.ft-text')?.textContent==='WP Next');return next.querySelector('.ft-date')?.textContent.trim()===${J(mobile?'сегодня':'today')};`))throw Error('an open sibling date is incorrectly labelled as a Waiting return date');
  if(mobile&&!await page.eval(`const h=${header('Group',true)},counter=h.querySelector('.ft-steps-more').getBoundingClientRect(),name=h.querySelector('.ft-project-name').getBoundingClientRect();return counter.right<=name.left+1;`))throw Error('Waiting phone expansion is not left of the project name');
  for(const key of ['Group','next']) {
   await toggleProjectUI(page,header('Group',true),mobile);
   if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'];return p.openTask(${J(key)}==='Group'?__wp.uids.Group:__wp.next);`))throw Error('UID link did not reveal a step inside the Waiting project');
   await until(()=>page.eval(`const v=app.workspace.activeLeaf.view.renderer,uid=${J(key)}==='Group'?__wp.uids.Group:__wp.next,row=v.rows().find(([,x])=>x.uid===uid)?.[0];return row?.closest('.ft-waiting')&&row.classList.contains('is-selected');`),'UID link selects the actual Waiting project step');
  }
  await page.shot(fileURLToPath(new URL('./shots/waiting-project-'+(mobile?'phone':'desktop')+'.png',import.meta.url)));
  await page.key('Meta+z');
  await until(()=>page.eval(`return !!(${header('Group',false)})&&!(${header('Group',true)})&&app.plugins.plugins['focus-tasks'].tasks().find(t=>t.uid===__wp.uids.Group)?.status==='open';`),'Undo restores the project with the same first step');
 }finally{
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];if([...p.views].some(v=>v.editing))throw Error('Waiting fixture still editing');for(const name of [__wp.name,__wp.singleName]){const a=(await p.collect(true)).find(a=>a.name===name);await p.removeArea(a);}p.setWaitingShown(__wp.shown);delete window.__wp;delete window.__wpStable;return true;`);
 }
}
