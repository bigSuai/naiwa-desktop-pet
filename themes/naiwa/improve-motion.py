from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter
import base64,json
H=Path(__file__).resolve().parent
P=H.parent.parent if H.name=='naiwa' else H.parent
T=P/'themes/naiwa'; A=T/'assets'; S=P/'assets/source/naiwa'

def svg(kind,state,frame):
 uri='data:image/png;base64,'+base64.b64encode((S/state/f'{frame:03}.png').read_bytes()).decode()
 drag=kind=='drag'; happy=kind in ('attention','double','double-jump','mini-happy')
 sleepy=kind in ('sleeping','dozing','mini-sleep','mini-enter-sleep')
 swing=8 if drag else 3.5 if happy else 1.8
 lift=6 if happy else 3 if drag else 1.2
 period=1.15 if drag else 1.5 if happy else 2.6
 leg=11 if drag else 5 if happy else 2
 css=f'''.float{{animation:float {period}s ease-in-out infinite}}.swing{{transform-origin:120px 68px;animation:swing {period*1.4}s ease-in-out infinite}}.elastic{{transform-origin:120px 200px;animation:elastic {period}s ease-in-out infinite}}.leg-l{{transform-origin:82px 132px;animation:leg {period*.65}s ease-in-out infinite alternate}}.leg-r{{transform-origin:105px 132px;animation:leg {period*.65}s ease-in-out infinite alternate-reverse}}.accent{{animation:accent {period}s ease-in-out infinite}}.note{{animation:accent 1.8s ease-in-out infinite reverse}}.ball{{transform-origin:120px 70px;animation:orbit 2.8s linear infinite}}@keyframes float{{0%,100%{{transform:translateY(0)}}50%{{transform:translateY(-{lift}px)}}}}@keyframes swing{{0%,100%{{transform:rotate(-{swing}deg)}}50%{{transform:rotate({swing}deg)}}}}@keyframes elastic{{0%,100%{{transform:scale(1,1)}}50%{{transform:scale(1.018,.982)}}}}@keyframes leg{{from{{transform:rotate(-{leg}deg)}}to{{transform:rotate({leg}deg)}}}}@keyframes accent{{0%,100%{{opacity:.45;transform:translateY(2px)}}50%{{opacity:1;transform:translateY(-4px)}}}}@keyframes orbit{{to{{transform:rotate(360deg)}}}}'''
 image=f'<image width="180" height="180" href="{uri}"/>'
 if sleepy:body=f'<g transform="translate(10 2) scale(1.2222)">{image}</g>'
 else:body=f'<g transform="translate(10 2) scale(1.2222)"><g class="leg-l" clip-path="url(#leg-l)">{image}</g><g class="leg-r" clip-path="url(#leg-r)">{image}</g><g clip-path="url(#torso)">{image}</g></g>'
 props=''
 if drag:props='<g class="accent" fill="#81c7dc"><path d="M61 57q-13 15-6 19t6-19Z"/><path d="M174 40q13 15 6 19t-6-19Z"/></g><g class="note" fill="none" stroke="#82cbb2" stroke-width="3" stroke-linecap="round"><path d="M42 105q-9 8 0 17M198 96q9 8 0 17"/></g>'
 elif kind in ('headphones','juggling'):
  props='<path d="M82 66a30 30 0 0 1 60 0" fill="none" stroke="#29433e" stroke-width="7"/><g fill="#81d4b3" stroke="#29433e" stroke-width="2"><rect x="78" y="59" width="10" height="22" rx="5"/><rect x="138" y="59" width="10" height="22" rx="5"/></g><g class="note" fill="#6fae94"><text x="180" y="83" font-size="23">♪</text><text x="42" y="115" font-size="17">♫</text></g>'
  if kind=='juggling':props+='<g class="ball"><circle cx="65" cy="58" r="7" fill="#ffd477"/><circle cx="170" cy="58" r="7" fill="#f1a3a5"/><circle cx="120" cy="15" r="7" fill="#81d4b3"/></g>'
 elif happy:props='<g class="accent" stroke="#80cdb1" stroke-width="3" stroke-linecap="round"><path d="M45 55v10m-5-5h10M190 85v10m-5-5h10"/></g><g class="note" fill="#ffd477"><circle cx="179" cy="36" r="4"/><circle cx="48" cy="111" r="3"/></g>'
 elif kind=='annoyed':props='<g class="accent" stroke="#d57e63" stroke-width="3" fill="none"><path d="M174 45q8 0 8-8m0 8q8 0 8 8m-8-8q0 8-8 8m8-8q0-8-8-8"/></g>'
 elif kind in ('waking','yawning'):props='<g class="note" fill="#8bb9ad"><text x="176" y="51" font-size="20">'+('☀' if kind=='waking' else 'z')+'</text></g>'
 elif sleepy:props='<g class="note" fill="#7fa99b"><text x="160" y="106" font-size="17">z</text><text x="181" y="83" font-size="20">z</text><text x="199" y="57" font-size="23">Z</text></g>'
 return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><title>Naiwa {kind} continuous motion</title><defs><clipPath id="torso"><rect width="180" height="136"/></clipPath><clipPath id="leg-l"><rect y="132" width="94" height="48"/></clipPath><clipPath id="leg-r"><rect x="94" y="132" width="86" height="48"/></clipPath></defs><style>{css}</style><ellipse cx="120" cy="222" rx="44" ry="4" fill="#29433e" opacity=".12"/><g class="float"><g class="swing"><g class="elastic">{body}</g></g></g>{props}</svg>'

def main():
 A.mkdir(parents=True,exist_ok=True)
 im=Image.open(S/'target/008.png').convert('RGBA')
 # At 16px a close-up stays legible; the full-body silhouette is too narrow.
 left,top,right,bottom=im.getbbox();side=right-left+10;cx=(left+right)//2
 im=im.crop((cx-side//2,max(0,top-3),cx-side//2+side,max(0,top-3)+side))
 im=im.resize((240,240),Image.Resampling.LANCZOS)
 im=im.filter(ImageFilter.UnsharpMask(radius=.65,percent=110,threshold=2))
 master=Image.new('RGBA',(256,256));master.alpha_composite(im,((256-im.width)//2,(256-im.height)//2))
 master.save(A/'naiwa-app-v2.png');master.save(A/'naiwa-app-v2.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
 master.resize((64,64),Image.Resampling.LANCZOS).save(A/'naiwa-tray-v2.png')
 flash=master.copy();d=ImageDraw.Draw(flash);d.ellipse((184,12,242,70),fill='#f1916e',outline='white',width=7);flash.resize((64,64),Image.Resampling.LANCZOS).save(A/'naiwa-tray-flash-v2.png')
 template=master.copy();template.putdata([(0,0,0,a) for r,g,b,a in template.getdata()]);template.resize((64,64),Image.Resampling.LANCZOS).save(A/'naiwa-trayTemplate-v2.png')
 rigs={'drag':('target',8),'attention':('target',8),'double':('target',8),'double-jump':('target',10),'annoyed':('target',15),'headphones':('idle',0),'juggling':('idle',0),'yawning':('target',0),'waking':('target',17),'click-left':('target',1),'click-right':('target',16),'mini-happy':('target',8),'sleeping':('error',3),'dozing':('error',1),'mini-sleep':('error',3),'mini-enter-sleep':('error',1)}
 replacements={}
 for kind,(state,frame) in rigs.items():
  name=f'naiwa-{kind}-smooth.svg';(A/name).write_text(svg(kind,state,frame),encoding='utf8');replacements[f'naiwa-{kind}.png']=name
 (A/'naiwa-about-hero.svg').write_text(svg('attention','target',8),encoding='utf8')
 theme=json.loads((T/'theme.json').read_text(encoding='utf8'))
 def walk(x):
  if isinstance(x,dict):return {replacements.get(k,k):walk(v) for k,v in x.items()}
  if isinstance(x,list):return [walk(v) for v in x]
  return replacements.get(x,x) if isinstance(x,str) else x
 theme=walk(theme);theme['version']='1.1.0';theme['description']='奶蛙：连续弹性动作、表情包姿态和统一应用图标'
 (T/'theme.json').write_text(json.dumps(theme,ensure_ascii=False,indent=2),encoding='utf8')
 report={'continuousRigs':rigs,'technique':'Native continuous CSS transforms, independent leg/body curves. No optical-flow morphing across pose cuts. Actual frame pacing depends on display/compositor.','source':'180x180 transparent MIT stills. Remaining states use APNG.','dragPeriodSeconds':1.15,'icons':'Dedicated multiresolution ICO and PNG names avoid old icon cache paths.'}
 (T/'continuous-motion.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')

 # Keep generated documentation in sync when build-theme.py is rerun.
 files=[]
 def collect(x):
  if isinstance(x,dict):
   for v in x.values():collect(v)
  elif isinstance(x,list):
   for v in x:collect(v)
  elif isinstance(x,str) and x.startswith('naiwa-') and x.endswith(('.svg','.png')) and x not in files:files.append(x)
 collect(theme)
 cards=''.join('<figure><img src="assets/'+f+'"><figcaption>'+f+'</figcaption></figure>' for f in files)
 (T/'preview.html').write_text('<!doctype html><meta charset="utf-8"><title>Naiwa motion preview</title><style>body{font:14px system-ui;background:#dbe5df;color:#29433e}main{display:flex;flex-wrap:wrap}figure{width:240px;margin:8px;text-align:center}img{width:220px;height:220px}figcaption{font-size:11px}</style><h1>奶蛙连续动作</h1><p>SVG 连续运动，其他状态保留 APNG。实际流畅度取决于显示器与合成器。</p><main>'+cards+'</main>',encoding='utf8')
 (T/'README.md').write_text('# 奶蛙 Naiwa 1.1\n\n16 种动作使用连续 CSS 身体、双腿、弹性曲线；避免站立到摔倒的原画跳变及光流形变。实际刷新跟随显示器和 Chromium 合成器，无固定运行帧率承诺。其他状态保留 30 fps APNG，原图 180×180。\n\n窗口、任务栏、托盘及关于页使用同一主形象。原主题、原图标与作者署名保留。兼容标识和配置路径不变。\n\n复现：python themes/naiwa/build-theme.py；只更新连续动作和图标：python themes/naiwa/improve-motion.py。preview.html 显示当前绑定；旧 APNG 留作恢复，validator 的未引用文件提示包含这些旧文件及 UI 图标。许可见 THIRD-PARTY-NOTICES.md。\n',encoding='utf8')

 print('continuous rigs',len(rigs),'icons generated')
if __name__=='__main__':main()
