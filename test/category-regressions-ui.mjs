import {J,sleep,until} from './cdp.mjs';

export async function checkCategoryRegressionsUI(page,mobile=false){
 const root="app.workspace.getLeavesOfType('focus-tasks-view')[0].view.containerEl";
 const area=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='Category regressions')`;
 const project=`[...(${area}).querySelectorAll('.ft-project-row:not(.ft-intent-list-row)')].find(e=>e.querySelector('.ft-project-name .ft-link')?.textContent==='CR Stable project caption')`;
 const backlogProject=`[...(${area}).querySelectorAll('.ft-project-row:not(.ft-intent-list-row)')].find(e=>e.querySelector('.ft-project-name .ft-link')?.textContent==='CR Backlog-only project')`;
 const picker=`(${project}).querySelector('.ft-category-picker')`;
 const click=async at=>mobile?page.tap(at):page.click(at);
 const point=async expr=>page.eval(`const e=${expr},r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};`);
 const hover=async expr=>{const at=await point(expr);if(mobile)await page.tap(at);else await page.mouse('mouseMoved',at.x,at.y,0);await sleep(220);if(!await page.eval(`return !!(${expr}).closest('.ft-category-picker')?.classList.contains('is-open');`))throw Error('count replacement moved away from its hover/tap target: '+expr+' '+JSON.stringify({at,detail:await page.eval(`const e=${expr},r=e?.getBoundingClientRect();return {rect:r?.toJSON(),hit:document.elementFromPoint(${at.x},${at.y})?.className};`)}));};
 const scrollTo=async expr=>{
   // A real scroll releases the pressed-control pin before programmatic positioning.
   const box=await page.eval(`const v=[...app.plugins.plugins['focus-tasks'].views].find(v=>v.containerEl===${root}.querySelector('.focus-tasks-view')),r=v.scroller.getBoundingClientRect();return {x:r.left+4,y:r.top+r.height/2};`);
   if(mobile)await page.swipe(box,{x:box.x,y:box.y-60},4);else await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:box.x,y:box.y,deltaX:0,deltaY:1});
   await sleep(200);
   await until(async()=>{await page.eval(`(${expr}).scrollIntoView({block:'center',behavior:'instant'});return true;`);await sleep(100);return page.eval(`const r=(${expr}).getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;`);},'regression target visible');
 };
 await page.front();
 await page.eval(`const name=app.vault.getName();if(!['focus-tasks-e2e','focus-tasks-mobile'].includes(name)||app.vault.adapter.basePath!=='/Users/daniil/Projects/obsidian-focus-tasks/test/'+name)throw Error('fixture guard');window.__cr={};const p=app.plugins.plugins['focus-tasks'];for(const name of ['CR Before','Category regressions','CR After'])__cr[name]=await p.createArea(name);return true;`);
 await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].notes().some(n=>n.area==='Category regressions');`),'regression area metadata');
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],day=moment().format('YYYY-MM-DD'),a={name:'Category regressions',note:__cr['Category regressions']};const f=await p.createProject(a,'CR Stable project caption');__cr.project=f.path;for(let i=0;i<2;i++)await p.createTask('CR Focus '+i,{area:a.name,project:f.basename,projectFile:f},day);for(let i=0;i<2;i++)await p.createTask('CR Backlog '+i,{area:a.name,project:f.basename,projectFile:f},null);const backlogFile=await p.createProject(a,'CR Backlog-only project');for(let i=0;i<2;i++)await p.createTask('CR Only later '+i,{area:a.name,project:backlogFile.basename,projectFile:backlogFile},null);__cr.idea=await p.createTask('CR Editable idea',{area:a.name,intentLoose:true,noDate:true},null);for(const name of ['CR Before','CR After'])for(let i=0;i<20;i++)await p.createTask(name+' task '+i,{area:name},day);p.setEverything(false);p.data.order.areas=['CR Before',a.name,...p.data.order.areas.filter(n=>!['CR Before',a.name,'CR After'].includes(n)),'CR After'];p.data.opened['intents:'+a.name]=true;p.data.opened['intent-loose-steps:'+a.name]=true;for(const name of ['CR Before',a.name,'CR After'])delete p.data.folded['area:'+name];await p.saveFolds();await p.openView();p.refresh();return true;`);
 await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return p.tasks().filter(t=>t.text.startsWith('CR ')).length===46&&p.read().intentTasks.some(t=>t.uid===__cr.idea.uid);`),'all regression fixtures indexed');
 await page.eval(`const v=[...app.plugins.plugins['focus-tasks'].views].find(v=>v.containerEl===${root}.querySelector('.focus-tasks-view'));await v.rerendered();return true;`);
 await until(()=>page.eval(`return !!(${area})?.querySelector('.ft-idea-mark')&&!!(${project});`),'regression fixtures rendered');
 await sleep(1250); // Earlier scenarios may still hold a pressed-control pin.

 // Closing/reopening Focus must keep the actual pressed target beneath the pointer.
 await page.eval(`const h=(${area}).querySelector('.ft-area-title'),p=app.plugins.plugins['focus-tasks'],v=[...p.views].find(v=>v.containerEl.contains(h)),s=v.scroller;s.scrollTop+=h.getBoundingClientRect().top-s.getBoundingClientRect().top-28;return true;`);
 await hover(`(${area}).querySelector('.ft-category-total')`);
 const focus=`(${area}).querySelector('.ft-focus-chip')`,focusAt=await point(focus);
 for(const on of [false,true,false,true]){
   await click(focusAt);
   await until(()=>page.eval(`return (${focus}).getAttribute('aria-pressed')===${J(String(on))};`),'Focus toggled '+on);
   await sleep(160);
   if(!await page.eval(`const b=${focus},r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(${focusAt.x},${focusAt.y}))&&Math.abs(r.top+r.height/2-${focusAt.y})<=1;`))throw Error('category toggle moved away from the pointer');
 }
 await sleep(1250);
 const tail=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='CR After')`;
 await page.eval(`document.activeElement?.blur();for(const v of app.plugins.plugins['focus-tasks'].views)v.closeCategoryPicker?.();const h=(${tail}).querySelector('.ft-area-title'),v=[...app.plugins.plugins['focus-tasks'].views].find(v=>v.containerEl.contains(h)),s=v.scroller;s.scrollTop+=h.getBoundingClientRect().top-s.getBoundingClientRect().top-28;return true;`);
 await hover(`(${tail}).querySelector('.ft-category-total')`);
 const tailFocus=`(${tail}).querySelector('.ft-focus-chip')`,tailAt=await point(tailFocus);
 for(const on of [false,true,false,true]){
   await click(tailAt);await until(()=>page.eval(`return (${tailFocus}).getAttribute('aria-pressed')===${J(String(on))};`),'tail Focus '+on);await sleep(on?160:1400);
   if(!await page.eval(`return (${tailFocus}).contains(document.elementFromPoint(${tailAt.x},${tailAt.y}));`))throw Error('last area toggle jumps when its content shrinks below the viewport');
 }
 await sleep(1250);
 await page.eval(`document.activeElement?.blur();for(const v of app.plugins.plugins['focus-tasks'].views)v.closeCategoryPicker?.();return true;`);
 await scrollTo(project);
 await page.mouse('mouseMoved',1,1,0);await sleep(220);
 const before=await page.eval(`const r=(${project}).querySelector('.ft-project-name .ft-link').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};`);
 await hover(`${picker}.querySelector('.ft-steps-more,.ft-category-total')`);
 const after=await page.eval(`const r=(${project}).querySelector('.ft-project-name .ft-link').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};`);
 if(Math.abs(before.x-after.x)>1||Math.abs(before.y-after.y)>1)throw Error('project caption shifts on count hover: '+JSON.stringify({before,after}));
 if(!mobile)for(const width of [340,220]){
   await page.eval(`document.activeElement?.blur();for(const v of app.plugins.plugins['focus-tasks'].views){v.releasePin?.();v.closeCategoryPicker?.();}const root=${root};root.style.width=${J(String(width))}+'px';return true;`);
 await scrollTo(project);
   await page.mouse('mouseMoved',1,1,0);await sleep(200);
   const rect=await page.eval(`const r=(${project}).querySelector('.ft-project-name .ft-link').getBoundingClientRect();return {x:r.x,y:r.y};`);
   await hover(`${picker}.querySelector('.ft-steps-more,.ft-category-total')`);
   if(!await page.eval(`const r=(${project}).querySelector('.ft-project-name .ft-link').getBoundingClientRect();return Math.abs(r.x-${rect.x})<=1&&Math.abs(r.y-${rect.y})<=1;`))throw Error('project caption shifts in '+width+'px pane');
 }
 if(!mobile){await page.eval(`document.activeElement?.blur();for(const v of app.plugins.plugins['focus-tasks'].views)v.closeCategoryPicker?.();${root}.style.removeProperty('width');return true;`);await scrollTo(project);await hover(`${picker}.querySelector('.ft-steps-more,.ft-category-total')`);}
 if(!await page.eval(`const picker=${picker},g=picker.querySelector('.ft-supplement-switch'),buttons=[...g.querySelectorAll('button[data-ft-category]')];return !g.hasAttribute('aria-label')&&!picker.querySelector('.ft-steps-more,.ft-category-total').hasAttribute('aria-label')&&buttons.every(b=>!b.hasAttribute('aria-label')&&!!b.title&&document.getElementById(b.getAttribute('aria-labelledby'))?.textContent===b.title);`))throw Error('category tooltips duplicate or accessible names are missing');
 if(!mobile){
   await hover(`${picker}.querySelector('.ft-focus-chip')`);await sleep(800);
   if(await page.eval(`return [...document.querySelectorAll('.tooltip')].some(e=>e.getBoundingClientRect().width&&getComputedStyle(e).opacity!=='0'&&/Focus|Фокус/.test(e.textContent));`))throw Error('Obsidian tooltip duplicates the native category tooltip');
   const gap=await page.eval(`const a=${picker}.querySelector('.ft-focus-chip').getBoundingClientRect(),b=${picker}.querySelector('.ft-later-chip').getBoundingClientRect();return {x:(a.right+b.left)/2,y:a.top+a.height/2,separation:b.left-a.right};`);
   if(Math.abs(gap.separation)>1)throw Error('category hit targets have an empty gap');
   await page.mouse('mouseMoved',gap.x,gap.y,0);await sleep(800);
   if(await page.eval(`return [...document.querySelectorAll('.tooltip')].some(e=>e.getBoundingClientRect().width&&getComputedStyle(e).opacity!=='0'&&/Focus, backlog|Фокус, отложка/.test(e.textContent));`))throw Error('group tooltip appears between category buttons');
 }

 // The parent's Backlog is visible: a local close hides children, keeps its header/control.
 await page.eval(`document.activeElement?.blur();for(const v of app.plugins.plugins['focus-tasks'].views)v.closeCategoryPicker?.();(${area}).querySelector('.ft-area-title').scrollIntoView({block:'center',behavior:'instant'});return true;`);
 await hover(`(${area}).querySelector('.ft-category-total')`);
 await click(await point(`(${area}).querySelector('.ft-area-title .ft-later-chip')`));
 try{await until(()=>page.eval(`return !!(${backlogProject})?.querySelector('.ft-later-chip');`),'parent backlog enabled');}catch(error){throw Error(error.message+' '+JSON.stringify(await page.eval(`const a=${area};return {buttons:[...a.querySelectorAll(':scope>.ft-area-title [data-ft-category]')].map(b=>({kind:b.dataset.ftCategory,pressed:b.getAttribute('aria-pressed')})),projects:[...a.querySelectorAll('.ft-project-row')].map(e=>({name:e.querySelector('.ft-link')?.textContent,classes:e.className})),leaf:app.workspace.activeLeaf.view.getViewType()};`)));}
 await sleep(1250);
 await page.eval(`document.activeElement?.blur();for(const v of app.plugins.plugins['focus-tasks'].views)v.closeCategoryPicker?.();return true;`);
 await scrollTo(backlogProject);
 const backlogPicker=`(${backlogProject}).querySelector('.ft-category-picker')`;
 await hover(`${backlogPicker}.querySelector('.ft-steps-more,.ft-category-total')`);
 const later=`${backlogPicker}.querySelector('.ft-later-chip')`,laterAt=await point(later);
 for(const on of [false,true,false,true]){
   await click(laterAt);await until(()=>page.eval(`return !!(${backlogProject})&&(${later}).getAttribute('aria-pressed')===${J(String(on))}&&[...(${area}).querySelectorAll('.ft-text')].some(e=>e.textContent==='CR Only later 0')===${on};`),'local project backlog '+on);
   if(!await page.eval(`return (${later}).contains(document.elementFromPoint(${laterAt.x},${laterAt.y}));`)){const detail=await page.eval(`const b=${later},row=${backlogProject};return {button:b.getBoundingClientRect().toJSON(),row:row.className,caption:row.querySelector('.ft-mobile-project-caption')?.getBoundingClientRect().toJSON(),font:getComputedStyle(row.querySelector('.ft-project-name')).fontSize};`);throw Error('project backlog control moved: '+JSON.stringify({point:laterAt,on,detail}));}
 }
 await sleep(1250);
 if(await page.eval(`return !!(${area}).querySelector('.ft-loose-idea-add');`))throw Error('redundant area Add idea remains');
 const idea=`[...(${area}).querySelectorAll('li.ft-idea-task')].find(e=>e.querySelector('.ft-text')?.textContent==='CR Editable idea')`;
 await scrollTo(idea);
 await click(await point(`(${idea}).querySelector('.ft-text')`));
 await until(()=>page.eval(`return !!${root}.querySelector('.ft-idea-editor[contenteditable=true]');`),'idea editing');
 if(!await page.eval(`const edit=${root}.querySelector('.ft-idea-editor[contenteditable=true]'),row=edit.closest('li'),mark=row.querySelector('.ft-idea-mark');return !!mark?.getBoundingClientRect().width&&!mark.isContentEditable&&!edit.contains(mark);`))throw Error('idea lamp disappears or becomes editable');
 await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4});
 if(!await page.eval(`return getSelection().toString()==='CR Editable idea';`))throw Error('browser Select All did not select the idea text');
 await page.type('CR Edited idea');
 if(!await page.eval(`return !!${root}.querySelector('.ft-idea-editor[contenteditable=true]')?.closest('li').querySelector('.ft-idea-mark')?.getBoundingClientRect().width;`))throw Error('selecting/replacing idea text removes the lamp');
 await page.key('Enter');await page.key('Escape');
 await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].read().intentTasks.some(t=>t.uid===__cr.idea.uid&&t.text==='CR Edited idea');`),'idea save preserves identity and clean title');
}
