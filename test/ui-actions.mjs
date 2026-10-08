import {J,sleep,until} from './cdp.mjs';
export const focusRoot="app.workspace.getLeavesOfType('focus-tasks-view')[0].view.containerEl";
export async function guardFixture(page,mobile=false){
 const name=mobile?'focus-tasks-mobile':'focus-tasks-e2e';
 await page.eval(`if(app.vault.getName()!==${J(name)}||app.vault.adapter.getBasePath()!==${J('/Users/daniil/Projects/obsidian-focus-tasks/test/'+name)})throw Error('fixture guard');return true;`);
}
export async function clickUI(page,expr,mobile=false){
 await page.front();
 await page.eval(`const e=${expr};if(!e)throw Error('missing control: '+${J(expr)});e.scrollIntoView({block:'center',behavior:'instant'});return true;`);
 const summary=await page.eval(`const e=(${expr}).closest('.ft-category-picker')?.querySelector(':scope > .ft-category-total,:scope > .ft-steps-more'),r=e?.getBoundingClientRect();return r?.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null;`);
 if(summary){if(mobile)await page.tap(summary);else await page.mouse('mouseMoved',summary.x,summary.y,0);await sleep(120);}
 const xy=await until(()=>page.eval(`const e=${expr},r=e?.getBoundingClientRect(),p=r&&{x:r.left+r.width/2,y:r.top+r.height/2};return p&&r.width&&r.height&&e.contains(document.elementFromPoint(p.x,p.y))?p:false;`),'reachable control '+expr);
 if(mobile)await page.tap(xy,60,false);else await page.click(xy,0,false);
 await sleep(150);
}
export async function toggleProjectUI(page,expr,mobile=false){
 await guardFixture(page,mobile);
 const control=await page.eval(`const r=${expr};return r?.querySelector('.ft-steps-more')?'counter':r?.classList.contains('is-open')?'arrow':'menu';`);
 if(control!=='menu')return clickUI(page,`(${expr}).querySelector(${J(control==='counter'?'.ft-steps-more':'.ft-fold')})`,mobile);
 await page.front();await page.eval(`(${expr}).scrollIntoView({block:'center',behavior:'instant'});return true;`);
 await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return ![...p.views].some(v=>v.busy)&&(typeof __ftLast==='undefined'||Date.now()-__ftLast>700);`),'project menu view settled');
 if(mobile){await page.eval(`window.__ftProjectMenuReady=null;return true;`);await until(()=>page.eval(`const row=${expr},now=performance.now();if(!row?.isConnected)return false;if(window.__ftProjectMenuReady?.row!==row)window.__ftProjectMenuReady={row,at:now};return now-window.__ftProjectMenuReady.at>=650;`),'project row stable before long press');}
 const xy=await until(()=>page.eval(`const name=(${expr})?.querySelector('.ft-project-name'),n=name?.getBoundingClientRect(),p=n&&{x:n.left+n.width/2,y:n.top+n.height/2};return p&&name.contains(document.elementFromPoint(p.x,p.y))?p:false;`),'project menu target');
 if(mobile)await page.tap(xy,650,false);else await page.rightClick(xy,false);
 const menu="[...document.querySelectorAll('.menu-item')].find(e=>/^(Expand|Collapse) list$|^(Развернуть|Свернуть) список$/.test(e.textContent.trim()))";
 await until(()=>page.eval(`return !!(${menu});`),'project expansion menu');
 await clickUI(page,menu,mobile);
}
