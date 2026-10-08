import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {J,sleep} from './cdp.mjs';

let capture=0;
// Follow the actual editor while its page settles. The native caret must make an
// on/off/on cycle at the insertion edge, with the surrounding text unchanged.
export async function checkIdeaCaret(page,root) {
  await page.front();
  const measure=()=>page.eval(`
    const e=${root}.querySelector('[contenteditable=true]'),s=getSelection(),r=e?.getBoundingClientRect(),c=e&&getComputedStyle(e);
    return {focused:document.activeElement===e&&document.hasFocus(),collapsed:!!s?.isCollapsed&&!!e?.contains(s.anchorNode),font:parseFloat(c?.fontSize),
      clip:r&&{x:r.x-3,y:r.y-3,width:r.width+6,height:r.height+6,scale:1}};`);
  const frames=[],states=[];
  for(let i=0;i<16&&frames.length<12;i++){
    await sleep(180);
    const state=await measure();
    if(!state.focused||!state.collapsed||!state.clip?.width||!state.clip.height)throw Error('empty idea editor must own focus and insertion point: '+J(state));
    const shot=await page.send('Page.captureScreenshot',{format:'png',clip:state.clip});
    const after=await measure();
    if(!after.focused||!after.collapsed)throw Error('empty idea editor lost its insertion point during caret observation');
    if(['x','y','width','height'].some(k=>Math.abs(state.clip[k]-after.clip[k])>.25))continue;
    states.push(state);frames.push(shot.data);
  }
  const result=await page.eval(`
    const frames=${J(frames)},states=${J(states)},images=[];
    for(const data of frames){
      const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
      const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
      images.push({w:img.width,h:img.height,p:ctx.getImageData(0,0,img.width,img.height).data});
    }
    const pairs=[];
    for(let a=0;a<images.length;a++)for(let b=a+1;b<images.length;b++){
      const base=images[a],next=images[b];if(base.w!==next.w||base.h!==next.h)continue;
      let x0=base.w,y0=base.h,x1=0,y1=0,lightA=0,lightB=0;
      for(let i=0;i<base.p.length;i+=4)if(base.p[i]!==next.p[i]||base.p[i+1]!==next.p[i+1]||base.p[i+2]!==next.p[i+2]){
        const x=i/4%base.w,y=Math.floor(i/4/base.w);
        x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);
        lightA+=base.p[i]+base.p[i+1]+base.p[i+2];lightB+=next.p[i]+next.p[i+1]+next.p[i+2];
      }
      const scale=base.w/states[a].clip.width;
      if(x1<=x0)continue;
      pairs.push({a,b,box:[x0,y0,x1,y1]});
      if(x1-x0>2*scale+1||y1-y0<states[a].font*scale*.5||Math.abs(x0-3*scale)>3*scale)continue;
      for(let c=b+1;c<images.length;c++){
        const again=images[c];if(again.w!==base.w||again.h!==base.h)continue;
        if(again.p.every((v,i)=>v===base.p[i]))return {visible:lightB>lightA?b:a,cycle:[a,b,c],box:[x0,y0,x1,y1]};
      }
    }
    return {failure:true,pairs};`);
  const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'shots');fs.mkdirSync(dir,{recursive:true});
  const prefix='idea-caret-'+(++capture);
  if(result.failure){
    fs.writeFileSync(path.join(dir,prefix+'-failure.json'),JSON.stringify({states,result},null,2));
    frames.forEach((data,i)=>fs.writeFileSync(path.join(dir,prefix+'-failure-'+i+'.png'),Buffer.from(data,'base64')));
    throw Error('native text caret does not blink at the start of the empty idea editor; captured '+frames.length+' stable frames');
  }
  fs.writeFileSync(path.join(dir,prefix+'.png'),Buffer.from(frames[result.visible],'base64'));
}
