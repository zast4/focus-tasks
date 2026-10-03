import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
test('staging a test build preserves running code, rollback and user settings',()=>{
  const vault=fs.mkdtempSync(path.join(os.tmpdir(),'focus-delivery-'));
  try{
    const plugin=path.join(vault,'.obsidian/plugins/focus-tasks');fs.mkdirSync(plugin,{recursive:true});
    fs.writeFileSync(path.join(plugin,'main.js'),'running stable code');fs.writeFileSync(path.join(plugin,'data.json'),'private order and folds');
    fs.writeFileSync(path.join(plugin,'build.json'),'old build identity');
    const stable=path.join(vault,'Internals/FocusTasks/stable');fs.mkdirSync(stable,{recursive:true});fs.writeFileSync(path.join(stable,'main.js'),'rollback code');
    execFileSync(process.execPath,['tools/deliver.mjs','--mode','test','--stage-only','--vault',vault],{stdio:'pipe'});
    assert.equal(fs.readFileSync(path.join(plugin,'main.js'),'utf8'),'running stable code');
    assert.equal(fs.readFileSync(path.join(plugin,'data.json'),'utf8'),'private order and folds');
    assert.equal(fs.readFileSync(path.join(plugin,'build.json'),'utf8'),'old build identity');
    assert.equal(fs.readFileSync(path.join(stable,'main.js'),'utf8'),'rollback code');
    for(const name of ['main.js','styles.css','manifest.json','build.json'])assert.ok(fs.existsSync(path.join(vault,'Internals/FocusTasks/test',name)));
    assert.equal(JSON.parse(fs.readFileSync(path.join(vault,'Internals/FocusTasks/test/build.json'),'utf8')).mode,'test');
  }finally{fs.rmSync(vault,{recursive:true,force:true});}
});
