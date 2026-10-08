import {J,until} from './cdp.mjs';
import {focusRoot as root,guardFixture,toggleProjectUI} from './ui-actions.mjs';
import {setTaskDayUI} from './project-membership-ui.mjs';

export async function checkMobileCaptionUI(page){
 await guardFixture(page,true);
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],name='Mobile caption UI',note=await p.createArea(name),file=await p.createProject({name,note},'Readable project caption'),day=moment().format('YYYY-MM-DD');window.__mc={name,path:file.path,day};const first=await p.createTask('MC First',{area:name,project:file.basename,projectFile:file},day),undated=await p.createTask('MC Undated',{area:name,project:file.basename,projectFile:file,noDate:true},null);__mc.uid=undated.uid;p.data.order.tasks['project:'+file.basename]=[first.uid,undated.uid];p.setEverything(false);delete p.data.folded['area:'+name];await p.saveFolds();await p.openView();p.refresh();return true;`);
 const header=`[...${root}.querySelectorAll('li.ft-project-row')].find(e=>e.getAttribute('data-ft-project-path')===__mc.path)`;
 const row=`[...${root}.querySelectorAll('li.ft-task:not(.ft-project-row)')].find(e=>e.querySelector('.ft-text')?.textContent==='MC Undated')`;
 await until(()=>page.eval(`return !!(${header})?.querySelector('.ft-steps-more');`),'phone project expansion');
 const assertLayout=async(date)=>{
  try{await until(()=>page.eval(`const h=${header},r=${row},e=h?.querySelector('.ft-steps-more'),name=h?.querySelector('.ft-project-name'),meta=r?.querySelector('.ft-mobile-meta');return !!e&&!!name&&!!meta&&e.getBoundingClientRect().right<=name.getBoundingClientRect().left+1&&((meta.getBoundingClientRect().height>0)===${date})&&!h.querySelector('.ft-plus');`),'left expansion and '+(date?'real':'absent')+' scheduling metadata');}
  catch(error){throw Error(error.message+': '+J(await page.eval(`const h=${header},r=${row};return {counter:h?.querySelector('.ft-steps-more')?.getBoundingClientRect().toJSON(),name:h?.querySelector('.ft-project-name')?.getBoundingClientRect().toJSON(),row:!!r,meta:r?.querySelector('.ft-mobile-meta')?.outerHTML,date:app.plugins.plugins['focus-tasks'].tasks().find(t=>t.uid===__mc.uid)?.date};`)));}
 };
 await toggleProjectUI(page,header,true);await assertLayout(false);
 await setTaskDayUI(page,row,await page.eval('return __mc.day;'),true);
 await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().find(t=>t.uid===__mc.uid)?.date===__mc.day;`),'Date menu saved scheduling');
 await assertLayout(true);
 await page.key('Meta+z');
 await until(()=>page.eval(`const tasks=app.plugins.plugins['focus-tasks'].tasks().filter(t=>t.uid===__mc.uid);return tasks.length===1&&!tasks[0].date;`),'Undo restores the same undated task');
 await assertLayout(false);
 await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.removeArea((await p.collect(true)).find(a=>a.name===__mc.name));delete window.__mc;p.refresh();return true;`);
}
