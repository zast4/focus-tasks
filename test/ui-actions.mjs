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
