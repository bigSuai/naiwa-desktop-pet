const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const prefs=require('../src/prefs');
const {listThemesWithMetadata}=require('../src/theme-metadata');
test('fresh and reset preference snapshots default to Naiwa',()=>{
 assert.equal(prefs.getDefaults().theme,'naiwa');
 assert.equal(prefs.validate({}).theme,'naiwa');
});
test('explicit selections survive controller persistence and reload',async(t)=>{
 const fs=require('node:fs'),os=require('node:os');
 const {createSettingsController}=require('../src/settings-controller');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'naiwa-default-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const prefsPath=path.join(temp,'prefs.json');
 const controller=createSettingsController({prefsPath,injectedDeps:{activateTheme:(themeId,variantId)=>({themeId,variantId})}});
 t.after(()=>controller.dispose());
 for(const theme of ['clawd','calico','cloudling']){
  assert.equal((await controller.applyCommand('setThemeSelection',{themeId:theme})).status,'ok');
  const reloaded=createSettingsController({prefsPath});
  assert.equal(reloaded.get('theme'),theme);reloaded.dispose();
 }
});
test('Naiwa is first and marked default while original builtin themes remain',()=>{
 const themes=listThemesWithMetadata({builtinThemesDir:path.resolve(__dirname,'../themes'),assetsSvgDir:path.resolve(__dirname,'../assets/svg')});
 assert.equal(themes[0].id,'naiwa');assert.equal(themes[0].isDefault,true);
 for(const id of ['clawd','calico','cloudling'])assert.ok(themes.some(t=>t.id===id));
 assert.equal(themes.filter(t=>t.isDefault).length,1);
});
