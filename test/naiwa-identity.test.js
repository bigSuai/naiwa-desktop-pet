const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const icons=require('../src/settings-window-icon');
test('Naiwa window and taskbar use the dedicated same-character icon assets',()=>{
 const appDir=path.resolve(__dirname,'..');
 const png=path.join(appDir,'themes','naiwa','assets','naiwa-app-v2.png');
 const ico=path.join(appDir,'themes','naiwa','assets','naiwa-app-v2.ico');
 const existsSync=p=>p===png||p===ico;
 assert.equal(icons.getSettingsWindowIconPath({platform:'win32',appDir,isPackaged:false,existsSync}),png);
 assert.equal(icons.getWindowsShellIconPath({appDir,isPackaged:false,existsSync}),ico);
 assert.ok(fs.statSync(png).size>1000);assert.ok(fs.statSync(ico).size>1000);
});
test('packaged taskbar icon comes from the unpacked theme, outside asar',()=>{
 const resourcesPath=path.resolve('resources');
 const expected=path.join(resourcesPath,'app.asar.unpacked','themes','naiwa','assets','naiwa-app-v2.ico');
 assert.equal(icons.getWindowsShellIconPath({resourcesPath,isPackaged:true,existsSync:p=>p===expected}),expected);
});
test('drag uses a transparent animation with sufficient distinct timing slots',()=>{
 const root=path.resolve(__dirname,'../themes/naiwa');
 const theme=JSON.parse(fs.readFileSync(path.join(root,'theme.json'),'utf8'));
 const file=theme.reactions.drag.file;
 assert.match(file,/\.png$/);
 const data=fs.readFileSync(path.join(root,'assets',file));
 assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 const chunks=[];
 for(let offset=8;offset+12<=data.length;){
  const length=data.readUInt32BE(offset),type=data.toString('ascii',offset+4,offset+8);
  assert.ok(offset+12+length<=data.length,'PNG chunk must remain in bounds');
  chunks.push({type,bytes:data.subarray(offset+8,offset+8+length)});offset+=length+12;
 }
 const header=chunks.find(c=>c.type==='IHDR').bytes;
 assert.equal(header.readUInt32BE(0),240);assert.equal(header.readUInt32BE(4),240);
 assert.equal(header[9],6,'RGBA must preserve soft transparent edges');
 const animation=chunks.find(c=>c.type==='acTL');assert.ok(animation,'drag must actually be animated');
 assert.ok(animation.bytes.readUInt32BE(0)>=32,'retain meaningful intermediate frames');
 assert.equal(animation.bytes.readUInt32BE(4),0,'drag must loop while held');
 const controls=chunks.filter(c=>c.type==='fcTL');
 assert.equal(controls.length,animation.bytes.readUInt32BE(0));
 for(const c of controls){const numerator=c.bytes.readUInt16BE(20),denominator=c.bytes.readUInt16BE(22)||100;assert.ok(numerator/denominator<=.02,'drag cadence must reach at least 50fps');}
 assert.ok(data.length<5*1024*1024,'small desktop animation should decode without excessive memory');
});

test('original belly laugh remains reachable from completion, rapid clicks, mini happy and idle',()=>{
 const root=path.resolve(__dirname,'../themes/naiwa');
 const theme=JSON.parse(fs.readFileSync(path.join(root,'theme.json'),'utf8'));
 const expected='naiwa-classic-belly-laugh.png';
 assert.deepEqual(theme.states.attention,[expected]);
 assert.equal(theme.reactions.double.files[0],expected);
 assert.ok(theme.reactions.double.files.includes('naiwa-motion-jump.png'),'existing jump must remain available');
 assert.deepEqual(theme.miniMode.states['mini-happy'],[expected]);
 assert.ok(theme.idleAnimations.some(entry=>entry.file===expected));
 const bytes=fs.readFileSync(path.join(root,'assets',expected));
 let frames=0;
 for(let off=8;off+12<=bytes.length;){const n=bytes.readUInt32BE(off),type=bytes.toString('ascii',off+4,off+8);if(type==='acTL')frames=bytes.readUInt32BE(off+8);off+=n+12;}
 assert.ok(frames>=25,'the full source performance must be animated, not a one-frame SVG rig');
 const raw=path.resolve(__dirname,'../assets/source/naiwa/laugh-restoration-20261106/raw-target');
 assert.equal(fs.readdirSync(raw).filter(name=>name.endsWith('.png')).length,25,'original source poses must remain recoverable');
});
