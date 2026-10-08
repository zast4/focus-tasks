import {J,sleep,until} from './cdp.mjs';
import {focusRoot as root,guardFixture,toggleProjectUI} from './ui-actions.mjs';

export async function setTaskDayUI(page,row,iso,mobile=false){
 const tap=async expr=>{const point=await until(()=>page.eval(`const e=${expr},r=e?.getBoundingClientRect(),p=r&&{x:r.left+r.width/2,y:r.top+r.height/2};return p&&r.width&&e.contains(document.elementFromPoint(p.x,p.y))?p:null;`),'calendar target');if(mobile)await page.tap(point,60,false);else await page.click(point,0,false);};
 await page.front();
 const point=await page.eval(`const e=${row};e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};`);
 await sleep(180);if(!mobile)await page.mouse('mouseMoved',point.x,point.y,0);
 const hiddenDate=mobile&&await page.eval(`const e=(${row}).querySelector('.ft-date');return !e?.getBoundingClientRect().height;`);
 if(hiddenDate){
  await page.eval(`window.__ftDateMenuReady=null;return true;`);
  await until(()=>page.eval(`const row=${row},now=performance.now();if(!row?.isConnected)return false;if(window.__ftDateMenuReady?.row!==row)window.__ftDateMenuReady={row,at:now};return now-window.__ftDateMenuReady.at>=650;`),'task stable before date menu');
  const target=await until(()=>page.eval(`const e=(${row}).querySelector('.ft-text'),r=e?.getBoundingClientRect(),p=r&&{x:r.left+r.width/2,y:r.top+r.height/2};return p&&e.contains(document.elementFromPoint(p.x,p.y))?p:false;`),'undated task menu target');
  await page.tap(target,650,false);
  const menu="[...document.querySelectorAll('.menu-item')].find(e=>/^(Date|Дата)…$/.test(e.textContent.trim()))";
  await until(()=>page.eval(`return !!(${menu});`),'undated task Date action');
  await tap(menu);
 }else await tap(`(${row}).querySelector('.ft-date')`);
 await until(()=>page.eval(`return !!document.querySelector('.ft-picker-input');`),'task calendar');
 await tap("document.querySelector('.ft-picker-input')");
 const text=iso.slice(8)+'.'+iso.slice(5,7)+'.'+iso.slice(2,4);
 await page.eval(`document.querySelector('.ft-picker-input').select();return true;`);await page.type(text);
 if(await page.eval(`return document.querySelector('.ft-picker-input')?.value;`)!==text)throw Error('calendar did not receive the replacement date');
 await tap("document.querySelector('.ft-picker-save')");
}

export async function checkProjectMembershipUI(page,mobile=false){
 await guardFixture(page,mobile);
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],name='Project membership UI',note=await p.createArea(name),file=await p.createProject({name,note},'PM Moves'),day=moment().format('YYYY-MM-DD'),tomorrow=moment().add(1,'day').format('YYYY-MM-DD');
  window.__pm={name,path:file.path,day,tomorrow,uids:{}};
  await p.frontOwned(file,fm=>{fm.scheduled=moment().add(30,'day').format('YYYY-MM-DD');});__pm.projectText=await app.vault.read(file);
  for(const title of ['PM First','PM Last Focus','PM Undated']){const t=await p.createTask(title,{area:name,project:file.basename,projectFile:file,noDate:title==='PM Undated'},title==='PM Undated'?null:day);__pm.uids[title]=t.uid;}
  await p.createTask('PM Area today',{area:name},day);
  p.data.order.tasks['project:'+file.basename]=['PM First','PM Last Focus','PM Undated'].map(t=>__pm.uids[t]);
  p.setEverything(false);delete p.data.folded['area:'+name];delete p.data.opened['future:'+name];await p.saveFolds();await p.openView();p.refresh();return true;`);
 const area=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='Project membership UI')`;
 const project=`(${area})?.querySelector('li.ft-project-row[data-ft-project-path="'+__pm.path+'"]')`;
 const task=title=>`[...(${area}).querySelectorAll('li.ft-task:not(.ft-project-row)')].find(e=>e.querySelector('.ft-text')?.textContent===${J(title)})`;
 const bucket=async(kind)=>{
  await until(()=>page.eval(`const area=${area},rows=[...area.querySelectorAll('li.ft-project-row')].filter(e=>e.getAttribute('data-ft-project-path')===__pm.path);return rows.length===1&&rows[0].getAttribute('data-ft-project-bucket')===${J(kind)};`),'project in '+kind);
  if(await page.eval(`return !!${root}.querySelector('.ft-project-category-add[data-ft-project-category="focus"],.ft-project-empty-focus');`))throw Error('project offers redundant Add to Focus');
 };
 const date=async(title,which)=>{
  await until(()=>page.eval(`return !!(${task(title)})?.querySelector('.ft-date');`),'task date '+title);
  await setTaskDayUI(page,task(title),await page.eval(`return __pm[${J(which)}];`),mobile);
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().find(t=>t.uid===__pm.uids[${J(title)}])?.date===__pm[${J(which)}];`),'task date saved '+title);
 };
 await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return Object.values(__pm.uids).every(uid=>p.tasks().some(t=>t.uid===uid))&&!!(${project})?.querySelector('.ft-steps-more');`),'indexed Focus project and expansion counter');
 await toggleProjectUI(page,project,mobile);
 await until(()=>page.eval(`return (${project})?.classList.contains('is-open')&&!!(${task('PM First')});`),'expanded Focus project');
 await date('PM First','tomorrow');
 await bucket('focus');
 if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'],area=(await p.collect(false,true)).find(a=>a.name===__pm.name),r=area.rows.find(r=>r.kind==='project'&&r.project.file.path===__pm.path);return r.project.date===__pm.tomorrow&&r.steps.some(t=>t.uid===__pm.uids['PM Last Focus']);`))throw Error('first task day hides another due step or gives the project its own date');
 await date('PM Last Focus','tomorrow');
 await bucket('backlog');
 await until(()=>page.eval(`return ['PM First','PM Last Focus','PM Undated'].every(title=>!!(${area}).querySelector('li.ft-task:not(.ft-project-row) .ft-text')&&[...(${area}).querySelectorAll('.ft-text')].some(e=>e.textContent===title));`),'all deferred steps remain visible');
 await page.key('Meta+z');await bucket('focus');
 await date('PM Last Focus','tomorrow');await bucket('backlog');
 await date('PM First','day');await bucket('focus');
 if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'];return await app.vault.read(app.vault.getAbstractFileByPath(__pm.path))===__pm.projectText&&['PM First','PM Last Focus','PM Undated'].every(title=>p.tasks().filter(t=>t.uid===__pm.uids[title]).length===1);`))throw Error('moving project buckets changed its note or task identities');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.removeArea((await p.collect(true)).find(a=>a.name===__pm.name));delete window.__pm;p.refresh();return true;`);
}
