import {sleep,until} from './cdp.mjs';
import {focusRoot as root,guardFixture,toggleProjectUI} from './ui-actions.mjs';
export async function checkProjectCaptionUI(page){
 await guardFixture(page,true);
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],name='Caption gesture UI',note=await p.createArea(name),file=await p.createProject({name,note},'CAP Project');await p.createTask('CAP Task',{area:name,project:file.basename,projectFile:file},moment().format('YYYY-MM-DD'));window.__cap={area:name,file:file.path};p.setEverything(false);delete p.data.folded['area:'+name];await p.saveFolds();await p.openView();p.refresh();return true;`);
 const row=`${root}.querySelector('li[data-ft-project-path="'+__cap.file+'"]')`;
 await until(()=>page.eval(`return !!(${row})?.querySelector('.ft-project-name .ft-link');`),'single project caption');
 const before=await page.eval(`return await app.vault.read(app.vault.getAbstractFileByPath(__cap.file));`);
 await page.front();await page.eval(`(${row}).scrollIntoView({block:'center',behavior:'instant'});return true;`);
 const xy=await until(()=>page.eval(`const e=(${row}).querySelector('.ft-project-name .ft-link'),r=e.getBoundingClientRect(),p={x:r.left+r.width/2,y:r.top+r.height/2};return e.contains(document.elementFromPoint(p.x,p.y))?p:false;`),'caption tap target');
 await page.touch('touchStart',[xy]);
 await page.eval(`app.plugins.plugins['focus-tasks'].refresh();return true;`);
 await sleep(80);await page.touch('touchEnd',[]);
 await until(()=>page.eval(`const leaf=app.workspace.activeLeaf;return leaf.view.file?.path===__cap.file&&[...leaf.view.containerEl.querySelectorAll('.block-language-focus-tasks')].some(e=>e.getBoundingClientRect().width&&e.querySelector('.ft-page-name')?.textContent==='CAP Project');`),'caption tap opens its rendered project page after refresh');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.openView();p.refresh();return true;`);
 await until(()=>page.eval(`return app.workspace.activeLeaf.view.getViewType()==='focus-tasks-view'&&!!(${row})?.getBoundingClientRect().width;`),'caption returns to visible Focus');
 await toggleProjectUI(page,row,true);
 if(!await page.eval(`const r=${row};return app.workspace.activeLeaf.view.getViewType()==='focus-tasks-view'&&r.classList.contains('is-open')&&!r.querySelector('.ft-steps-more')&&r.querySelectorAll('button[data-ft-category]').length===2;`))throw Error('caption hold navigates or hides empty categories');
 await toggleProjectUI(page,row,true);
 await until(()=>page.eval(`return !(${row}).classList.contains('is-open');`),'single-step caption folds without a count');
 if(await page.eval(`return await app.vault.read(app.vault.getAbstractFileByPath(__cap.file));`)!==before)throw Error('caption gestures modified the project note');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],a=(await p.collect(true)).find(a=>a.name===__cap.area);await p.removeArea(a);delete window.__cap;p.refresh();return true;`);
}
