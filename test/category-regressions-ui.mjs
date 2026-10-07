import {J,sleep,until} from './cdp.mjs';

export async function checkCategoryRegressionsUI(page,mobile=false){
 const root="app.workspace.getLeavesOfType('focus-tasks-view')[0].view.containerEl";
 const area=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='Category regressions')`;
 const project=`[...(${area}).querySelectorAll('.ft-project-row:not(.ft-intent-list-row)')].find(e=>e.querySelector('.ft-project-name .ft-link')?.textContent==='CR Stable project caption')`;
 const backlogProject=`[...(${area}).querySelectorAll('.ft-project-row:not(.ft-intent-list-row)')].find(e=>e.querySelector('.ft-project-name .ft-link')?.textContent==='CR Backlog-only project')`;
 const picker=`(${project}).querySelector('.ft-category-picker')`;
 const click=async at=>mobile?page.tap(at,60,false):page.click(at,0,false);
 const point=async expr=>until(()=>page.eval(`const e=${expr},r=e?.getBoundingClientRect(),p=r&&{x:r.left+r.width/2,y:r.top+r.height/2};return p&&r.width&&r.height&&e.contains(document.elementFromPoint(p.x,p.y))?p:false;`),'reachable regression control '+expr);
 const hover=async expr=>{await page.front();await page.eval(`document.activeElement?.blur();for(const v of app.plugins.plugins['focus-tasks'].views)v.closeCategoryPicker?.();return true;`);const at=await point(expr);if(mobile)await page.tap(at,60,false);else await page.mouse('mouseMoved',at.x,at.y,0);await sleep(220);if(!await page.eval(`return !!(${expr}).closest('.ft-category-picker')?.classList.contains('is-open');`))throw Error('count replacement moved away from its hover/tap target: '+expr+' '+JSON.stringify({at,detail:await page.eval(`const e=${expr},r=e?.getBoundingClientRect();return {rect:r?.toJSON(),hit:document.elementFromPoint(${at.x},${at.y})?.className};`)}));};
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

 // Opening/closing area Backlog must keep the actual pressed target beneath the pointer.
 await page.eval(`const h=(${area}).querySelector('.ft-area-title'),p=app.plugins.plugins['focus-tasks'],v=[...p.views].find(v=>v.containerEl.contains(h)),s=v.scroller;s.scrollTop+=h.getBoundingClientRect().top-s.getBoundingClientRect().top-28;return true;`);
 await hover(`(${area}).querySelector('.ft-category-total')`);
 const focus=`(${area}).querySelector('.ft-later-chip')`,focusAt=await point(focus);
 for(const on of [true,false,true,false]){
   await click(focusAt);
   await until(()=>page.eval(`return (${focus}).getAttribute('aria-pressed')===${J(String(on))};`),'Focus toggled '+on);
   await sleep(160);
   if(!await page.eval(`const b=${focus},r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(${focusAt.x},${focusAt.y}))&&Math.abs(r.top+r.height/2-${focusAt.y})<=1;`))throw Error('category toggle moved away from the pointer');
 }
 await sleep(1250);
 const tail=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='CR After')`;
 await page.eval(`document.activeElement?.blur();for(const v of app.plugins.plugins['focus-tasks'].views)v.closeCategoryPicker?.();const h=(${tail}).querySelector('.ft-area-title'),v=[...app.plugins.plugins['focus-tasks'].views].find(v=>v.containerEl.contains(h)),s=v.scroller;s.scrollTop+=h.getBoundingClientRect().top-s.getBoundingClientRect().top-28;return true;`);
 await hover(`(${tail}).querySelector('.ft-category-total')`);
 const tailFocus=`(${tail}).querySelector('.ft-later-chip')`,tailAt=await point(tailFocus);
 for(const on of [true,false,true,false]){
   await click(tailAt);await until(()=>page.eval(`return (${tailFocus}).getAttribute('aria-pressed')===${J(String(on))};`),'tail Focus '+on);await sleep(on?160:1400);
   if(!await page.eval(`return (${tailFocus}).contains(document.elementFromPoint(${tailAt.x},${tailAt.y}));`))throw Error('last area toggle jumps when its content shrinks below the viewport');
 }
 await sleep(1250);
 await scrollTo(project);
 await click(await point(`(${project}).querySelector('.ft-steps-more')`));
 await until(()=>page.eval(`return !!(${picker})?.querySelector('.ft-later-chip');`),'expanded project categories');
 if(mobile&&!await page.eval(`const r=${project},caption=r.querySelector('.ft-mobile-project-caption'),buttons=[...r.querySelectorAll('button[data-ft-category]')];return !!caption&&buttons.length===2&&buttons.every(b=>caption.contains(b)&&b.isConnected&&b.getBoundingClientRect().width>0&&b.getBoundingClientRect().height>0);`))throw Error('expanded mobile header drops its category controls');
 if(!await page.eval(`const g=${picker}.querySelector('.ft-supplement-switch'),buttons=[...g.querySelectorAll('button[data-ft-category]')];return !g.hasAttribute('aria-label')&&buttons.length===2&&!g.querySelector('.ft-focus-chip')&&buttons.every(b=>!b.hasAttribute('aria-label')&&!!b.title&&document.getElementById(b.getAttribute('aria-labelledby'))?.textContent===b.title);`))throw Error('category tooltips duplicate or accessible names are missing');
 const laterAt=await point(`${picker}.querySelector('.ft-later-chip')`);
 for(const on of [false,true,false,true]){
   await click(laterAt);await until(()=>page.eval(`return (${picker}).querySelector('.ft-later-chip').getAttribute('aria-pressed')===${J(String(on))};`),'project Backlog '+on);
   if(!await page.eval(`return (${picker}).querySelector('.ft-later-chip').contains(document.elementFromPoint(${laterAt.x},${laterAt.y}));`))throw Error('project category moves away from the pointer');
 }
 if(!mobile){
   const gap=await page.eval(`const a=${picker}.querySelector('.ft-later-chip').getBoundingClientRect(),b=${picker}.querySelector('.ft-intents-chip').getBoundingClientRect();return {x:(a.right+b.left)/2,y:a.top+a.height/2};`);
   await page.mouse('mouseMoved',gap.x,gap.y,0);await sleep(800);
   if(await page.eval(`return [...document.querySelectorAll('.tooltip')].some(e=>e.textContent.includes('Focus, backlog and ideas'));`))throw Error('group tooltip appears between icons');
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
