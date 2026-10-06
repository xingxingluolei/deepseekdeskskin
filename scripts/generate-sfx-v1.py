from pathlib import Path
import hashlib,json,math,wave,zipfile
import numpy as np
from scipy.signal import butter,sosfiltfilt,resample_poly

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/audio/ui-v1'
SR=48000
RNG=np.random.default_rng(20261005)

def zeros(d):return np.zeros((round(d*SR),2),dtype=np.float64)
def place(dst,src,start,amp=1,pan=0):
    if src.ndim==1:
        angle=(pan+1)*math.pi/4
        src=np.column_stack([src*np.cos(angle),src*np.sin(angle)])
    i=round(start*SR);n=min(len(src),len(dst)-i)
    if n>0:dst[i:i+n]+=src[:n]*amp

def edge(x,attack=.008,release=.06):
    y=x.copy();a=min(round(attack*SR),len(y));r=min(round(release*SR),len(y))
    y[:a]*=np.sin(np.linspace(0,np.pi/2,a))**2
    y[-r:]*=np.cos(np.linspace(0,np.pi/2,r))**2
    return y

def bell(f,d=.6,decay=.16):
    t=np.arange(round(d*SR))/SR;y=np.zeros_like(t)
    for ratio,level,tau in [(1,1,1),(2.008,.2,.59),(3.91,.045,.32),(6.05,.009,.19)]:
        y+=level*np.sin(2*np.pi*f*ratio*t+.002*np.sin(2*np.pi*4*t))*np.exp(-t/(decay*tau))
    return edge(y,.006,.06)

def wood(f=235,d=.13):
    t=np.arange(round(d*SR))/SR
    y=(np.sin(2*np.pi*f*t)*np.exp(-t/.024)+.29*np.sin(2*np.pi*f*2.83*t)*np.exp(-t/.012))
    return edge(y,.003,.03)

def velvet(f,d=.44,decay=.15):
    t=np.arange(round(d*SR))/SR
    return edge((np.sin(2*np.pi*f*t)+.10*np.sin(2*np.pi*f*2*t)+.025*np.sin(2*np.pi*f*3*t))*np.exp(-t/decay),.012,.09)

def noise(d,lo=500,hi=4200):
    y=RNG.standard_normal(round(d*SR));sos=butter(3,[lo,hi],btype='bandpass',fs=SR,output='sos')
    y=sosfiltfilt(sos,y);y/=np.sqrt(np.mean(y*y))
    return y

def rustle(d=.40,weight=1,lo=650,hi=4200):
    t=np.arange(round(d*SR))/SR
    slow=RNG.uniform(.30,1,10)
    mod=np.interp(np.linspace(0,9,len(t)),np.arange(10),slow)
    return edge(noise(d,lo,hi)*np.sin(np.pi*t/d)**1.5*mod*weight,.024,.08)

def sweep(f0,f1,d=.3):
    t=np.arange(round(d*SR))/SR
    freq=f0+(f1-f0)*(3*(t/d)**2-2*(t/d)**3)
    return edge(np.sin(2*np.pi*np.cumsum(freq)/SR)*np.sin(np.pi*t/d)**2,.025,.055)

def room(y):
    dry=y.copy()
    for sec,gain in [(.037,.045),(.071,.026),(.127,.012)]:
        n=round(sec*SR)
        if n<len(y):y[n:]+=dry[:-n,::-1]*gain
    return y

def clean(y,peak):
    y=room(y);y-=np.mean(y,axis=0)
    for c in range(2):y[:,c]=edge(y[:,c],.007,.095)
    m=np.max(np.abs(y));y*=10**(peak/20)/m
    y=np.vstack([zeros(.018),y,zeros(.055)])
    return np.round(y*32767).astype('<i2')

def write(name,y):
    path=OUT/name
    with wave.open(str(path),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(y.tobytes())
    return path

SPECS=[];AUDIO={}
def add(id,label,desc,group,y,peak=-15,enabled=False,recommendation='同类动作限频，避免频繁打扰。'):
    pcm=clean(y,peak);AUDIO[id]=pcm;path=write(id+'.wav',pcm);a=pcm.astype(float)/32768
    SPECS.append(dict(id=id,label=label,description=desc,group=group,file=id+'.wav',durationSeconds=round(len(pcm)/SR,3),peakDbfs=round(20*np.log10(np.max(np.abs(a))),2),rmsDbfs=round(20*np.log10(np.sqrt(np.mean(a*a))),2),truePeakDbfs=round(20*np.log10(np.max(np.abs(resample_poly(a,4,1,axis=0)))),2),enabledSuggestion=enabled,recommendation=recommendation,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))

OUT.mkdir(parents=True,exist_ok=True)
y=zeros(1.2)
place(y,rustle(.55,.05,900,4300),.02,pan=-.25)
for t,f,v,p in [(.08,659.255,.48,-.18),(.25,783.991,.40,.0),(.47,1046.50,.33,.18)]:place(y,bell(f,.64,.21),t,v,p)
add('greeting','开场 · 晶光轻启','一缕轻风托起三枚上行水晶音，配合转头微笑。','core',y,-14,True,'仅新对话第一次发送，随微笑时机播放一次。')
y=zeros(.67);place(y,bell(523.251,.55,.12),.03,.40,-.08);place(y,bell(783.991,.4,.10),.16,.13,.1)
add('thinking','思考 · 水滴微光','两层轻微水滴般的清音，短促而不连续催促。','status',y,-20)
y=zeros(1.02)
for t,d,p in [(.055,.16,-.12),(.25,.20,.0),(.50,.15,.1),(.70,.18,.17)]:
    place(y,rustle(d,.20,1100,3900),t,.50,p)
place(y,wood(310,.08),.047,.035,-.1);place(y,wood(270,.08),.87,.025,.1)
add('writing','写入 · 笔尖轻写','四段柔和的纸上短笔触，配合执笔书写。','tool',y,-19,False,'进入 Write/Edit 后轻响一次；连续写入应限频。')
y=zeros(.92);place(y,rustle(.49,.35,500,3500),.06,.65,-.12);place(y,rustle(.23,.13,1000,4500),.4,.50,.14);place(y,wood(170,.13),.59,.08)
add('reading','查阅 · 轻翻一页','纸张掀起、翻过，再轻轻落下。','tool',y,-19)
y=zeros(.92);place(y,rustle(.42,.06,1100,4300),.02,.60,-.15);place(y,bell(739.989,.44,.13),.12,.31,-.13);place(y,bell(1108.73,.5,.16),.35,.23,.16)
add('searching','搜索 · 发现线索','两枚间隔清晰的亮点音，从寻找落到发现。','tool',y,-18)
y=zeros(.66)
for t,f,p in [(.045,330,-.12),(.16,390,.0),(.28,450,.12)]:place(y,wood(f,.1),t,.25,p)
place(y,velvet(523.251,.3,.10),.30,.11,.14)
add('executing','命令执行 · 轻触按键','三个柔和木质按键，末尾附一枚低亮度确认音。','tool',y,-19)
y=zeros(.99);place(y,rustle(.29,.16,500,3500),.03,.45,-.3);place(y,bell(587.33,.45,.13),.12,.35,-.2);place(y,bell(880,.50,.17),.37,.32,.25)
add('delegating','任务分派 · 递出卡片','薄纸滑出，清音从左侧递向右侧。','tool',y,-17)
y=zeros(1.04)
for t,f,p in [(.06,587.33,-.38),(.19,739.99,.38),(.40,880,0)]:place(y,bell(f,.49,.16),t,.3,p)
add('parallel','并行协作 · 双线汇合','两侧交错的轻清音，随后在中间汇合。','status',y,-18)
y=zeros(1.72)
place(y,rustle(.52,.24,220,2400),.035,.80,-.2);place(y,wood(160,.2),.46,.3,-.1)
place(y,rustle(.35,.19,350,2800),.68,.72,.15);place(y,wood(205,.16),.97,.21,.12)
place(y,bell(783.991,.45,.13),1.14,.08,.16)
add('compacting','整理上下文 · 书本归位','书脊轻擦、两次落架声，最后一枚微光表示归整。','core',y,-17,True,'整理开始时播放一次，不随整理耗时循环。')
y=zeros(.99);place(y,rustle(.36,.10,750,3100),.04,.50,-.12);place(y,sweep(610,440,.23),.09,.1,-.12);place(y,bell(659.255,.5,.14),.38,.22,.15)
add('retrying','重试 · 回旋再启','轻轻回旋后重新抬起的清音。','status',y,-19,False,'同一任务多次重试应设冷却时间。')
y=zeros(1.3)
for t,f,v,p in [(.045,523.251,.48,-.15),(.20,659.255,.38,.0),(.39,783.991,.38,.14)]:place(y,bell(f,.73,.25),t,v,p)
place(y,velvet(261.626,.75,.21),.39,.10,0)
add('complete','完成 · 温柔落定','三个上行和声音符，尾音温暖落定。','core',y,-13,True,'每轮真实成功完成一次；打开历史对话不播放。')
y=zeros(1.12)
place(y,bell(659.255,.46,.16),.04,.40,-.1);place(y,bell(880,.59,.20),.40,.32,.12)
add('waiting','等待确认 · 轻声叩门','一前一后的轻敲清音，留出等待回应的空隙。','core',y,-14,True,'每个新确认请求一次，不循环催促。')
y=zeros(1.15)
place(y,velvet(392,.55,.17),.06,.46,-.06);place(y,velvet(329.628,.68,.22),.32,.44,.08);place(y,bell(659.255,.52,.14),.33,.035,.08)
add('error','出错 · 柔和下行','两枚温暖下行音，表达需要检查，没有尖锐警报。','core',y,-14,True,'仅新发生的失败播一次，同一错误去重。')
y=zeros(1.13)
for t,f,p in [(.06,440,-.13),(.25,554.365,0),(.47,659.255,.13)]:place(y,bell(f,.48,.14),t,.30,p)
add('connecting','连接中 · 星点连起','三个间隔渐进的亮点，提示连接开始。','status',y,-19,False,'每次连接尝试只播一次，重连需限频。')
y=zeros(1.17);place(y,bell(659.255,.43,.12),.05,.32,-.13);place(y,velvet(440,.49,.17),.28,.29,0);place(y,velvet(293.665,.48,.16),.51,.24,.13)
add('disconnected','连接中断 · 光点暂歇','三枚逐渐降低的音符，轻柔收住。','status',y,-16)
y=zeros(.72);place(y,wood(300,.12),.05,.16);place(y,bell(587.33,.5,.14),.13,.14)
add('queued','排队 · 卡片入列','一声轻触和短清音，表示任务已排入。','status',y,-20)
y=zeros(.84);place(y,velvet(392,.55,.15),.04,.35);place(y,wood(190,.16),.38,.08)
add('stopped','已停止 · 轻轻收束','低柔的短音加轻落点，结束当前动作。','status',y,-18)
y=zeros(.92);place(y,velvet(523.251,.48,.14),.04,.28,-.1);place(y,velvet(523.251,.46,.13),.35,.20,.1)
add('paused','已暂停 · 双点停留','两次同音轻点，平静暂停而非错误。','status',y,-19)
y=zeros(1.26)
for t,f,p in [(.05,587.33,-.1),(.34,587.33,.1),(.60,698.456,0)]:place(y,velvet(f,.53,.17),t,.30,p)
add('blocked','需要介入 · 请留意','两声柔和呼唤后轻抬一音，等待你介入。','status',y,-15)

previews={}
for key,ids in [('core',['greeting','compacting','complete','waiting','error','writing']),('all',[x['id'] for x in SPECS])]:
    parts=[];order=[];at=0
    for idx,id in enumerate(ids):
        pcm=AUDIO[id];order.append({'id':id,'startSeconds':round(at/SR,3),'durationSeconds':round(len(pcm)/SR,3)})
        parts.append(pcm);at+=len(pcm)
        if idx<len(ids)-1:
            gap=np.zeros((round(.72*SR),2),dtype='<i2');parts.append(gap);at+=len(gap)
    file='preview-'+key+'.wav';write(file,np.concatenate(parts));previews[key]={'file':file,'durationSeconds':round(at/SR,3),'order':order}
manifest={'title':'澄蓝 · 非人声音效试听','version':'ui-v1','created':'2026-10-05','sampleRate':SR,'channels':2,'format':'PCM signed 16-bit WAV','method':'原创程序合成；无语音、无外部采样、无录音素材。','previews':previews,'archive':'deepseekdeskskin-sfx-v1.zip','items':SPECS}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
lines=['# DeepSeekDeskSkin · 非人声音效 v1','','2026-10-05 · 原创程序合成；无语音、无外部采样、无录音素材。','48 kHz / 16-bit / 双声道 WAV。只有素材与试听，尚未接入客户端自动播放。','','## 文件对照','','| 文件 | 状态 | 长度 | 声音 |','| --- | --- | --- | --- |']
for x in SPECS:lines.append(f"| {x['file']} | {x['label']} | {x['durationSeconds']:.3f}s | {x['description']} |")
lines+=['','核心串听：开场 → 整理书架 → 完成 → 等待确认 → 出错 → 写字，各段间隔 0.72 秒。','完整串听按上表顺序播放。manifest.json 含时间轴、峰值、均方根电平和 SHA-256。','','建议只默认开启开场、完成、确认、出错；工具动作按偏好开启并限频。音量还受系统和播放设备影响。','来源：本项目 scripts/generate-sfx-v1.py；滤波噪声模拟纸张/摩擦，衰减振荡器模拟水晶/木质声。','声音没有声带或人声采样，不宣称是实物录音。','']
(OUT/'README.md').write_text('\n'.join(lines))
with zipfile.ZipFile(OUT/'deepseekdeskskin-sfx-v1.zip','w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(OUT.iterdir()):
        if p.suffix in ['.wav','.json','.md']:z.write(p,'deepseekdeskskin-sfx-v1/'+p.name)
print(json.dumps({'count':len(SPECS),'durationCore':previews['core']['durationSeconds'],'durationAll':previews['all']['durationSeconds'],'archiveBytes':(OUT/'deepseekdeskskin-sfx-v1.zip').stat().st_size,'items':[{k:x[k] for k in ['id','durationSeconds','peakDbfs','rmsDbfs','truePeakDbfs']} for x in SPECS]},ensure_ascii=False,indent=2))
