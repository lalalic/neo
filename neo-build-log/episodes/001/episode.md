---
title: 给 Web ChatGPT 补一个 Skills 系统
description: Neo Build Log 001：用一个很小的 bootstrap，让 Web ChatGPT 动态发现本地 Skills，只加载匹配的 SKILL.md，再通过 MacDevBridge 落到真实本地执行。
---
# video
seed:2026091401
width:1080 height:1920 fps:30 layout:series
- audio src:assets/bgm/neo-build-log-001.mp3 volume:0.10 isBackground:true

## opening
layout:parallel
description:"约 3 秒。第一屏直接给冲突，不先讲品牌：我本地已经有一套 Skills，但新开的 Web ChatGPT 不会自己扫描它们。NEO BUILD LOG / 001 只做小号系列标识。Presenter 隐藏。"
- component duration:3 jsx:"<div style={{width:'100%',height:'100%',background:'#101820',color:'#f4f1e8',display:'flex',flexDirection:'column',justifyContent:'center',padding:88,boxSizing:'border-box',fontFamily:'sans-serif'}}><div style={{fontSize:28,color:'#9dc9b6',marginBottom:28}}>NEO BUILD LOG / 001</div><div style={{fontSize:34,color:'#e6ae92',marginBottom:18}}>我本地已经有一套 Skills</div><h1 style={{fontSize:78,lineHeight:1.05,margin:0}}>但 Web ChatGPT<br/>不会自己发现它们。</h1><p style={{fontSize:25,color:'#b5c5bf',marginTop:32}}>所以我给它补了一层：discover → load → execute</p></div>"
- script "我本地已经有一套自己的 Skills，但新开的 Web ChatGPT，并不会自己扫描它们。"

## gap
layout:parallel
description:"约 6 秒。最终主视觉使用真实录屏 `01-web-chat-gap`：新 Web ChatGPT context 与本地 skill directories 的对比。当前 storyboard 用占位卡。Presenter 进入右下角。"
- component duration:6 jsx:"<div style={{width:'100%',height:'100%',background:'#f0eee7',color:'#142c24',display:'flex',flexDirection:'column',justifyContent:'center',padding:92,boxSizing:'border-box',fontFamily:'sans-serif'}}><div style={{fontSize:28,color:'#587b6b'}}>THE GAP</div><h1 style={{fontSize:66,lineHeight:1.12}}>Chat 在云端。<br/>Skills 在我的 Mac。</h1><p style={{fontSize:28,lineHeight:1.4}}>必须录制：新 Web ChatGPT context + 真实本地 skill directories</p><p style={{fontSize:22,color:'#557066'}}>shot: 01-web-chat-gap</p></div>"
- script "问题很简单：Chat 在云端，而这些 Skills 在我的 Mac。新会话不会因为目录存在，就自动知道它们。"

## bootstrap
layout:parallel
description:"约 8 秒。最终主视觉使用 `02-bootstrap-contract`：真实 `web-chatgpt-skills.md`，高亮 MacDevBridge、dynamic discovery、按需加载、#skill-name。Presenter 遮挡关键行时淡出。"
- component duration:8 jsx:"<div style={{width:'100%',height:'100%',background:'#241f25',color:'#f4f1e8',display:'flex',flexDirection:'column',justifyContent:'center',padding:92,boxSizing:'border-box',fontFamily:'sans-serif'}}><div style={{fontSize:28,color:'#e6ae92'}}>最小 bootstrap</div><h1 style={{fontSize:62,lineHeight:1.1}}>不要把所有 Skill<br/>塞进 prompt。</h1><p style={{fontSize:28,lineHeight:1.45}}>只告诉它：去发现 → 选匹配项 → 再加载</p><p style={{fontSize:22,color:'#d0c5c7'}}>shot: 02-bootstrap-contract</p></div>"
- script "我不想把整个 Skill 库塞进每一个 prompt。我只给 Web ChatGPT 一份很小的 bootstrap：需要时去发现，然后只加载匹配的那一个。"

## discovery
layout:parallel
description:"约 8 秒。最终主视觉使用 `03-dynamic-discovery`：在 Neo repo 真实运行 `.bin/list-web-chatgpt-skills`，输出只停留在少量真实条目。用 overlay 点出 name / description / absolute path。Presenter hide/fade。"
- component duration:8 jsx:"<div style={{width:'100%',height:'100%',background:'#dbe8df',color:'#142c24',display:'flex',flexDirection:'column',justifyContent:'center',padding:92,boxSizing:'border-box',fontFamily:'sans-serif'}}><div style={{fontSize:28,color:'#587b6b'}}>DYNAMIC DISCOVERY</div><h1 style={{fontSize:62,lineHeight:1.08}}>.bin/list-web-<br/>chatgpt-skills</h1><p style={{fontSize:28,lineHeight:1.35}}>name · description · SKILL.md path</p><p style={{fontSize:22,color:'#557066'}}>shot: 03-dynamic-discovery</p></div>"
- script "这个脚本每次从真实目录动态扫描。它不复制 Skill 内容，只返回 name、description 和 SKILL.md 的绝对路径。"

## load
layout:parallel
description:"约 8 秒。最终主视觉使用 `04-select-and-load`：从 discovery 输出选一个真实 skill，例如 markcut，再打开对应 SKILL.md。支持层可叠加 `bootstrap → discover → select → load one skill → execute`。"
- component duration:8 jsx:"<div style={{width:'100%',height:'100%',background:'#e8f0ed',color:'#142c24',display:'flex',flexDirection:'column',justifyContent:'center',padding:92,boxSizing:'border-box',fontFamily:'sans-serif'}}><div style={{fontSize:28,color:'#587b6b'}}>只加载需要的</div><h1 style={{fontSize:64,lineHeight:1.1}}>20 个 Skills？<br/>这次只读 1 个。</h1><p style={{fontSize:28,lineHeight:1.4}}>discover → select → SKILL.md</p><p style={{fontSize:22,color:'#557066'}}>shot: 04-select-and-load</p></div>"
- script "匹配任务以后，它只读那个 Skill 的约定。二十个 Skills 不需要一起进上下文，这次需要哪个，就加载哪个。"

## proof
layout:parallel
description:"约 10 秒。最终主视觉使用 `06-local-execution`：Web ChatGPT 选择 Skill 后通过 MacDevBridge 执行一个安全本地任务，必须停在可观察结果。本集可用 `markcut verify` 和 repo 文件变化作为递归证明。"
- component duration:10 jsx:"<div style={{width:'100%',height:'100%',background:'#101820',color:'#f4f1e8',display:'flex',flexDirection:'column',justifyContent:'center',padding:92,boxSizing:'border-box',fontFamily:'sans-serif'}}><div style={{fontSize:28,color:'#9dc9b6'}}>THE PAYOFF</div><h1 style={{fontSize:64,lineHeight:1.1}}>发现 Skill 还不够。<br/>它得真的做事。</h1><p style={{fontSize:28,lineHeight:1.4}}>Web ChatGPT → MacDevBridge → observable result</p><p style={{fontSize:22,color:'#b5c5bf'}}>shot: 06-local-execution</p></div>"
- script "发现 Skill 不是终点。真正的价值，是加载以后，它还能通过 MacDevBridge 把任务落到我的 Mac 上，而且最后必须有一个我看得见的结果。"

## payoff
layout:parallel
description:"约 7 秒。最终主视觉使用 `07-recursive-payoff`：真实 `neo-build-log/episodes/001/` 文件与成功的 Markcut verify 输出。先回收本集，再给下一集 hook。Presenter 回到右下角。"
- component duration:7 jsx:"<div style={{width:'100%',height:'100%',background:'#163b32',color:'#f4f1e8',display:'flex',flexDirection:'column',justifyContent:'center',padding:92,boxSizing:'border-box',fontFamily:'sans-serif'}}><div style={{fontSize:28,color:'#a9d2bd'}}>NEO BUILD LOG / 001</div><h1 style={{fontSize:62,lineHeight:1.1}}>最有意思的是：<br/>这一集本身<br/>就在用这套 workflow。</h1><p style={{fontSize:27,lineHeight:1.35}}>bootstrap → skill → Mac → build log</p><div style={{height:2,background:'#6b9482',margin:'30px 0'}}></div><p style={{fontSize:27,color:'#d7e7df'}}>下一集：怎么让本地执行过程不再是黑盒？</p><p style={{fontSize:21,color:'#b9d0c5'}}>shot: 07-recursive-payoff</p></div>"
- script "最有意思的是，这第一集本身就在用这套 workflow 被制作出来。下一步，我要解决另一个问题：本地 agent 真正在跑的时候，怎么让过程不再是黑盒。"
