"""Reproducible 30 fps transparent APNG Clawd theme. No network at build time."""
from pathlib import Path
import json, math, shutil, hashlib
import numpy as np
import cv2
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent.parent if ROOT.name == 'naiwa' else ROOT.parent
OUT = PROJECT / 'themes' / 'naiwa'
ASSETS = OUT / 'assets'
SOURCE = PROJECT/'assets/source/naiwa' if ROOT.name in ('scripts','naiwa') else ROOT/'voice-reference/assets/pet'
FPS, COUNT, SIZE = 30, 90, 240
INK, MINT, GOLD = '#29433e', '#81d4b3', '#ffd477'

def interpolate(folder):
    src = [np.array(Image.open(p).convert('RGBA')) for p in sorted((SOURCE/folder).glob('*.png'))]
    # Mirror time, so the loop never jumps from the last pose to the first.
    src = src + src[-2:0:-1]
    flows=[]
    for a,b in zip(src,src[1:]+src[:1]):
        ga=cv2.cvtColor(a[:,:,:3],cv2.COLOR_RGB2GRAY)
        gb=cv2.cvtColor(b[:,:,:3],cv2.COLOR_RGB2GRAY)
        flows.append((cv2.calcOpticalFlowFarneback(ga,gb,None,.5,3,19,4,5,1.2,0),cv2.calcOpticalFlowFarneback(gb,ga,None,.5,3,19,4,5,1.2,0)))
    yy,xx=np.mgrid[:180,:180].astype(np.float32)
    frames=[]
    for i in range(COUNT):
        pos=i*len(src)/COUNT; k=int(pos)%len(src); t=pos-int(pos)
        a,b=src[k],src[(k+1)%len(src)]; f,g=flows[k]
        # Warp alpha along with colour. Premultiplication prevents dark fringes.
        def warp(im,flow,amount):
            z=im.astype(np.float32)/255; z[:,:,:3]*=z[:,:,3:4]
            return cv2.remap(z,xx-flow[:,:,0]*amount,yy-flow[:,:,1]*amount,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
        z=warp(a,f,t)*(1-t)+warp(b,g,1-t)*t
        z[:,:,:3]/=np.maximum(z[:,:,3:4],1/255)
        frames.append(Image.fromarray(np.uint8(np.clip(z*255,0,255))).resize((220,220),Image.Resampling.LANCZOS))
    return frames

def badge(d,text,x,y,fill=MINT):
    d.rounded_rectangle((x,y,x+38,y+30),9,fill=fill,outline=INK,width=2)
    d.text((x+10,y+8),text,fill=INK,stroke_width=0)

def render(base,kind,i):
    t=i/COUNT; s=math.sin(t*math.tau); c=math.cos(t*math.tau)
    canvas=Image.new('RGBA',(SIZE,SIZE))
    # A small soft grounded shadow, never a rectangular background.
    d=ImageDraw.Draw(canvas); d.ellipse((75,217,170,226),fill=(27,53,43,35))
    frog=base.copy(); angle=0; x=10; y=2
    if kind in ('sleeping','mini-sleep','dozing','mini-enter-sleep'): y+=round(s*1.5)
    elif kind in ('attention','double','double-jump','mini-happy'): angle=s*4; y-=round(abs(s)*(18 if kind=='double-jump' else 7))
    elif kind in ('error','annoyed'): x+=round(math.sin(t*math.tau*3)*3)
    elif kind in ('drag','click-left','click-right'): angle=s*7
    elif kind in ('carrying','patrol','mini-crabwalk'): x+=round(s*12); y-=round(abs(s)*3)
    elif kind=='collapsing': angle=math.sin(t*math.pi)**2*12
    else: y+=round(s*1.5)
    if kind=='click-left': x-=round(abs(s)*6)
    if kind=='click-right': x+=round(abs(s)*6)
    if kind.startswith('mini-'):
        frog=frog.resize((210,210),Image.Resampling.LANCZOS); x=35+round(s*2); y=12
        if kind=='mini-enter': x+=round((1-c)*18)
        if kind=='mini-peek': angle=-5+3*s; x-=8
        if kind=='mini-crabwalk': x+=round(s*14)
    if angle: frog=frog.rotate(angle,Image.Resampling.BICUBIC)
    canvas.alpha_composite(frog,(x,y)); d=ImageDraw.Draw(canvas)
    if kind in ('working','mini-working','building'):
        d.rounded_rectangle((58,143,143,193),6,fill='#41615a',outline=INK,width=3)
        d.rounded_rectangle((64,149,137,184),3,fill='#b7ead5')
        for k in range(3):
            w=20+int((i*2+k*13)%37); d.line((72,157+k*8,72+w,157+k*8),fill='#337467',width=3)
        d.polygon([(53,193),(148,193),(159,204),(43,204)],fill='#7ba89b',outline=INK)
        if kind=='building':
            for k in range(3): d.rounded_rectangle((158,192-k*26,191,214-k*26),4,fill=[MINT,GOLD,'#f29b7f'][k],outline=INK,width=2)
    if kind in ('thinking','reading','bubble','debugger'):
        if kind=='reading':
            d.polygon([(78,143),(112,150),(148,139),(148,182),(112,192),(78,185)],fill='#f5edd2',outline=INK)
            d.line((112,150,112,190),fill=INK,width=2)
            for k in range(3):d.line((84,154+k*9,105,159+k*9),fill='#8da090',width=2)
        else:
            d.ellipse((138,18+int(s*3),206,72+int(s*3)),fill='#f6f8eb',outline=INK,width=2)
            for k in range(3):d.ellipse((151+k*15,43-int(math.sin(t*math.tau-k)*3),157+k*15,49-int(math.sin(t*math.tau-k)*3)),fill=INK)
            d.ellipse((131,73,139,81),fill='#f6f8eb')
            if kind=='debugger':
                d.ellipse((148,100,183,135),fill=(170,230,215,150),outline=INK,width=4)
                d.line((179,131,197,149),fill=INK,width=6)
    if kind in ('juggling','headphones'):
        d.arc((75,39,133,98),180,360,fill=INK,width=7)
        d.rounded_rectangle((73,62,83,87),4,fill=MINT,outline=INK,width=2)
        d.rounded_rectangle((125,62,135,87),4,fill=MINT,outline=INK,width=2)
        for k,col in enumerate([MINT,GOLD,'#f19f9c']):
            a=t*math.tau+k*math.tau/3; bx=120+math.cos(a)*68; by=83+math.sin(a)*33
            d.ellipse((bx-8,by-8,bx+8,by+8),fill=col,outline=INK,width=2)
    if kind=='sweeping':
        bx=174+round(s*14); d.line((145,119,bx,202),fill='#986b47',width=7)
        d.polygon([(bx-10,190),(bx+10,190),(bx+20,213),(bx-19,213)],fill=GOLD,outline=INK)
        for k in range(4):d.ellipse((168+k*10,214+int(math.sin(t*math.tau+k)*3),171+k*10,217+int(math.sin(t*math.tau+k)*3)),fill='#b8c9ba')
    if kind=='carrying':
        d.rounded_rectangle((81,131,151,181),3,fill='#d1a16c',outline='#815d3e',width=3)
        d.rectangle((109,132,120,180),fill='#edd0a1'); d.line((81,145,151,145),fill='#815d3e',width=2)
    if kind in ('notification','mini-alert','annoyed','error'):
        badge(d,'!' if kind!='error' else 'X',164,37+int(s*4),'#ffa58e' if kind in ('error','annoyed') else GOLD)
    if kind in ('attention','mini-happy','double','double-jump'):
        for k,col in enumerate([MINT,GOLD,'#f5a5ad',MINT,GOLD]):
            px=38+k*40; py=36+((i*2+k*21)%95); d.line((px,py,px+4,py+7),fill=col,width=4)
    if kind in ('sleeping','mini-sleep','dozing','mini-enter-sleep'):
        for k in range(3):
            xx=160+k*15; yy=113-k*25-int(s*4); d.text((xx,yy),'z' if k==0 else 'Z',fill='#5c9487',stroke_width=1)
    if kind in ('yawning','waking'): badge(d,'...' if kind=='yawning' else '*',164,36,GOLD)
    if kind=='mini-peek':
        wx=180+int(s*4); d.arc((wx,76,wx+25,104),210,330,fill=MINT,width=4)
    # Subpixel breathing remains continuous even during held source poses.
    # Avoid integer-only positioning, which produces repeated frames at 30 Hz.
    return canvas.transform(canvas.size,Image.Transform.AFFINE,(1,0,.8*s,0,1,.8*c),Image.Resampling.BICUBIC)

def main():
    ASSETS.mkdir(parents=True,exist_ok=True)
    originals=PROJECT/'assets/source/naiwa'; originals.mkdir(parents=True,exist_ok=True)
    if SOURCE.resolve()!=originals.resolve():
        for state in ('idle','listen','target','busy','error'):
            shutil.copytree(SOURCE/state,originals/state,dirs_exist_ok=True)
        shutil.copy2(ROOT/'voice-reference/LICENSE',originals/'UPSTREAM-LICENSE.txt')
        shutil.copy2(SOURCE/'ASSET-NOTICE.md',originals/'ASSET-NOTICE.md')
    base={s:interpolate(s) for s in ('idle','listen','target','busy','error')}
    states={'idle':'idle','yawning':'busy','dozing':'error','collapsing':'error','thinking':'listen','working':'idle','juggling':'busy','sweeping':'idle','error':'error','attention':'target','notification':'listen','carrying':'idle','sleeping':'error','waking':'busy','building':'idle','headphones':'busy','reading':'idle','bubble':'listen','patrol':'idle','debugger':'listen','drag':'busy','click-left':'listen','click-right':'listen','annoyed':'busy','double':'target','double-jump':'target','mini-idle':'idle','mini-alert':'listen','mini-happy':'target','mini-enter':'idle','mini-peek':'listen','mini-working':'idle','mini-crabwalk':'idle','mini-enter-sleep':'error','mini-sleep':'error'}
    report={}
    for kind,source in states.items():
        frames=[render(b,kind,i) for i,b in enumerate(base[source])]
        # APNG stores rational 1/30-second delays (unlike GIF's 10 ms units).
        frames[0].save(ASSETS/f'naiwa-{kind}.png',save_all=True,append_images=frames[1:],duration=1000/FPS,loop=0,disposal=0,blend=0,optimize=False)
        report[kind]={'source':source,'frames':COUNT,'fps':FPS,'durationSeconds':3,'motion':'bidirectional optical-flow interpolation; original art 8 fps'}
        print(kind,flush=True)
    theme=json.loads((PROJECT/'themes/clawd/theme.json').read_text(encoding='utf8'))
    theme.update(name='奶蛙 Naiwa',author='Naiwa adaptation; upstream Codex Voice Input contributors',version='1.0.0',description='真实奶蛙 · 35 套状态动画 · 30 fps 透明 APNG',license='MIT for upstream animation frames; see THIRD-PARTY-NOTICES.md',viewBox={'x':0,'y':0,'width':240,'height':240})
    theme['layout']={'contentBox':{'x':60,'y':36,'width':120,'height':186},'marginBox':{'x':35,'y':15,'width':180,'height':215},'centerX':120,'baselineY':222,'visibleHeightRatio':.775,'baselineBottomRatio':.075}
    theme['eyeTracking']={'enabled':False,'states':[]}
    file=lambda k:f'naiwa-{k}.png'
    theme['states']={s:[file(s)] for s in theme['states']}
    theme['sleepSequence']={'mode':'full'}
    theme['workingTiers']=[{'minSessions':n,'file':file(s)} for n,s in [(3,'building'),(2,'headphones'),(1,'working')]]
    theme['jugglingTiers']=[{'minSessions':n,'file':file(s)} for n,s in [(2,'juggling'),(1,'headphones')]]
    theme['idleAnimations']=[{'file':file(s),'duration':6000} for s in ['patrol','bubble','reading']]
    hints={'building':'building','typing':'working','juggling':'juggling','conducting':'juggling','debugger':'debugger','thinking':'thinking'}
    theme['displayHintMap']={f'clawd-working-{k}.svg':file(v) for k,v in hints.items()}
    theme['displayHintMap'].update({'clawd-headphones-groove.svg':file('headphones'),'clawd-idle-reading.svg':file('reading'),'clawd-idle-bubble.svg':file('bubble')})
    theme['updateVisuals']={'checking':file('debugger')}
    theme['hitBoxes']={'default':{'x':62,'y':38,'w':115,'h':184},'sleeping':{'x':46,'y':120,'w':150,'h':103},'wide':{'x':40,'y':30,'w':170,'h':195}}
    theme['fileHitBoxes']={file('working'):{'x':45,'y':38,'w':130,'h':184}}
    theme['wideHitboxFiles']=[file('error'),file('notification')]
    theme['sleepingHitboxFiles']=[file('sleeping'),file('collapsing')]
    theme['reactions']={k:{'file':file(v),'duration':3000} for k,v in [('drag','drag'),('clickLeft','click-left'),('clickRight','click-right'),('annoyed','annoyed')]}
    theme['reactions']['double']={'files':[file('double'),file('double-jump')],'duration':3000}
    theme['miniMode']['states']={s:[file(s)] for s in theme['miniMode']['states']}
    theme['miniMode']['glyphFlips']={}
    theme['objectScale']={'widthRatio':1,'heightRatio':1,'offsetX':0,'offsetY':0}
    (OUT/'theme.json').write_text(json.dumps(theme,ensure_ascii=False,indent=2),encoding='utf8')
    (OUT/'animation-manifest.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    shutil.copy2(originals/'UPSTREAM-LICENSE.txt',OUT/'UPSTREAM-LICENSE.txt')
    (OUT/'THIRD-PARTY-NOTICES.md').write_text('# 奶蛙素材来源\n\nAnimation frames: https://github.com/liaosongjie/Codex-Voice-Input/tree/1737c34388a24330f526fc522bbd458c46d3e78c/assets/pet\n\nThe upstream ASSET-NOTICE.md explicitly distributes its derived PNG frames under MIT. See UPSTREAM-LICENSE.txt. Original character rights remain with their respective owners; this notice does not grant trademark or character rights.\n\nMeme research: https://github.com/AkihaZhang/naiwa-meme-pack . No separately restricted meme artwork is bundled.\n\nAdaptations: optical-flow interpolation, transparent APNG encoding, drawn task props and reactions. No generated laugh audio is enabled.\n',encoding='utf8')
    (OUT/'README.md').write_text('# 奶蛙 Naiwa\n\n35 套独立透明动画，所有状态与 Mini Mode 均有奶蛙素材。原图 180×180；输出画布 240×240，30 fps、每循环 90 帧 / 3 秒。光流插帧改善连续性，不代表 30 fps 原生拍摄。\n\n保留原 Clawd / Calico / Cloudling；在 Settings → Theme 选择「奶蛙 Naiwa」即可恢复切换。真实素材的眼睛与身体已烘焙在画面中，因此关闭鼠标眼球跟踪；拖动、点击、权限气泡和会话状态功能保留。\n\n复现：安装已有 Python Pillow / NumPy / OpenCV 后，从项目运行 `python themes/naiwa/build-theme.py`；需保留 assets/source/naiwa。\n',encoding='utf8')
    sheet=Image.new('RGB',(7*240,5*265),'#e2ebe6'); draw=ImageDraw.Draw(sheet)
    for i,(kind,source) in enumerate(states.items()):
        frame=render(base[source][24],kind,24); xy=((i%7)*240,(i//7)*265)
        sheet.paste(frame,xy,frame);draw.text((xy[0]+12,xy[1]+242),kind,fill=INK)
    sheet.save(OUT/'preview-contact-sheet.png')
    # Local preview uses the exact same runtime files, with no network requests.
    cards=''.join(f'<figure><img src="assets/{file(k)}"><figcaption>{k}</figcaption></figure>' for k in states)
    (OUT/'preview.html').write_text('<!doctype html><html lang="zh"><meta charset="utf-8"><title>奶蛙 · 全状态预览</title><style>body{font:16px system-ui;background:#e2ebe6;color:#29433e;margin:32px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}figure{margin:0;text-align:center;border:1px solid #bfd0c5;border-radius:16px}img{width:200px;height:200px}figcaption{padding:10px}</style><h1>奶蛙 · 全状态预览</h1><p>35 套透明动画 · 30 fps 光流插帧 · 90 帧 / 3 秒；原始素材为 8 fps。</p><main>'+cards+'</main></html>',encoding='utf8')

if __name__=='__main__':
    main()
    import runpy
    runpy.run_path(str(Path(__file__).with_name('improve-motion.py')),run_name='__main__')
