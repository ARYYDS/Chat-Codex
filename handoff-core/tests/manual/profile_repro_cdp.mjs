import fs from 'node:fs/promises';
import runtimeConfig from '../../lib/runtime-config.js';
const { loadConfig, option } = runtimeConfig;
if (process.argv.includes('--help')) { console.log('profile_repro_cdp.mjs ACTION QUESTION TARGET_ID --run-dir PATH [--port PORT]'); process.exit(0); }
const config = loadConfig();
const port = Number(option('--port') || config.cdpPorts[0]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const base = 'http://127.0.0.1:' + port;
const dir = option('--run-dir');
if (!dir) throw new Error('Explicit --run-dir required');
await fs.mkdir(dir, { recursive: true });
async function rpc(url,method,params={}) {
  const ws=new WebSocket(url);
  return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.close();reject(new Error('Timeout '+method));},15000);
    ws.onopen=()=>ws.send(JSON.stringify({id:1,method,params}));
    ws.onerror=()=>{clearTimeout(timer);reject(new Error('Socket error'));};
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id!==1)return;clearTimeout(timer);ws.close();m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);};
  });
}
async function ev(tab,expression){const r=await rpc(tab.webSocketDebuggerUrl,'Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const tabs=await fetch(base+'/json/list').then(r=>r.json());
const selected=process.argv[4];
const tab=tabs.find(t=>t.type==='page'&&t.url.startsWith('https://chatgpt.com')&&(!selected||t.id===selected));
if(!tab)throw new Error('ChatGPT tab absent');
const action=process.argv[2]||'inspect';
if(action==='close-worker'){
 for(const t of tabs.filter(t=>t.type==='page'&&t.url.startsWith('https://chatgpt.com'))){if(await ev(t,`!!document.querySelector('button[aria-label="Stop answering"], [data-testid="stop-button"], [data-testid="composer-stop-btn"]')`))throw new Error('Still generating');}
 const v=await fetch(base+'/json/version').then(r=>r.json());await rpc(v.webSocketDebuggerUrl,'Browser.close');console.log('Closed test worker gracefully');
}else if(action==='new-tab'){
 const fresh=await fetch(base+'/json/new?https://chatgpt.com/',{method:'PUT'}).then(r=>r.json());
 await fs.writeFile(dir+'/second-tab.json',JSON.stringify(fresh,null,2)); console.log(JSON.stringify(fresh));
}else if(action==='inspect'){
 console.log(JSON.stringify(await ev(tab,`({url:location.href,body:document.body.innerText.slice(-18000),editors:[...document.querySelectorAll('[contenteditable]')].map(e=>({id:e.id,role:e.getAttribute('role')})),buttons:[...document.querySelectorAll('button')].map(e=>({text:e.innerText,label:e.getAttribute('aria-label'),testid:e.getAttribute('data-testid')}))})`)));
}else if(action==='clear-cloned-draft'){
 const draft=await ev(tab,`document.querySelector('#prompt-textarea')?.innerText`);
 if(draft?.trim()!=='gpt')throw new Error('Unexpected cloned draft');
 await fs.writeFile(dir+'/cloned-draft.txt',draft);
 await ev(tab,`document.querySelector('#prompt-textarea').focus()`);
 await rpc(tab.webSocketDebuggerUrl,'Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
 await rpc(tab.webSocketDebuggerUrl,'Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
 await rpc(tab.webSocketDebuggerUrl,'Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
 await rpc(tab.webSocketDebuggerUrl,'Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
 console.log(JSON.stringify(await ev(tab,`document.querySelector('#prompt-textarea').innerText`)));
}else if(action==='fill'){
 const prompt=await fs.readFile(dir+'/question-'+process.argv[3]+'.txt','utf8');
 const state=await ev(tab,`(()=>{const e=document.querySelector('#prompt-textarea');if(!e||e.innerText.trim())throw Error('Composer absent or nonempty');e.focus();return true;})()`);
 await rpc(tab.webSocketDebuggerUrl,'Input.insertText',{text:prompt});
 console.log(JSON.stringify(await ev(tab,`({text:document.querySelector('#prompt-textarea').innerText,buttons:[...document.querySelectorAll('button')].filter(e=>e.getAttribute('data-testid')?.includes('send')).map(e=>({testid:e.getAttribute('data-testid'),disabled:e.disabled}))})`)));
}else if(action==='send'){
 console.log(JSON.stringify(await ev(tab,`(()=>{const b=document.querySelector('button[data-testid="send-button"]');if(!b||b.disabled)throw Error('Send unavailable');b.click();return {clicked:true,url:location.href};})()`)));
}else if(action==='result'){
 const result=await ev(tab,`({url:location.href,stop:!!document.querySelector('[data-testid="stop-button"], [data-testid="composer-stop-btn"], button[aria-label="Stop streaming"], button[aria-label="Stop answering"]'),messages:[...document.querySelectorAll('[data-message-author-role]')].map(e=>({role:e.getAttribute('data-message-author-role'),text:e.innerText,links:[...e.querySelectorAll('a[href]')].map(a=>({text:a.innerText,url:a.href}))})),copyButtons:[...document.querySelectorAll('button[aria-label="Copy response"]')].length})`);
 await fs.writeFile(dir+'/web-result-'+process.argv[3]+'.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}else if(action==='copy-answer'){
 await rpc(tab.webSocketDebuggerUrl,'Page.bringToFront');
 const pos=await ev(tab,`(()=>{const b=[...document.querySelectorAll('button[aria-label="Copy response"]')];if(b.length!==1)throw Error('Expected one completed answer');b[0].scrollIntoView({block:'center'});const r=b[0].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await rpc(tab.webSocketDebuggerUrl,'Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',clickCount:1});
 await rpc(tab.webSocketDebuggerUrl,'Input.dispatchMouseEvent',{type:'mouseReleased',...pos,button:'left',clickCount:1});
 console.log('Clicked native Copy response');
}else if(action==='reload-completed'){
 if(await ev(tab,`!!document.querySelector('button[aria-label="Stop answering"], [data-testid="stop-button"], [data-testid="composer-stop-btn"]')`))throw new Error('Still generating');
 await rpc(tab.webSocketDebuggerUrl,'Page.reload');console.log('Reloaded completed conversation without resending');
}else if(action==='answer-dom'){
 console.log(JSON.stringify(await ev(tab,`({answers:[...document.querySelectorAll('[data-message-author-role="assistant"]')].map(e=>({text:e.textContent,html:e.innerHTML.slice(0,18000)})),buttons:[...document.querySelectorAll('button')].filter(e=>/copy/i.test((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('data-testid')||''))).map(e=>({label:e.getAttribute('aria-label'),testid:e.getAttribute('data-testid'),text:e.innerText}))})`)));
}else if(action==='screenshot'){
 const r=await rpc(tab.webSocketDebuggerUrl,'Page.captureScreenshot',{format:'png'});await fs.writeFile(dir+'/web-'+process.argv[3]+'.png',Buffer.from(r.data,'base64'));console.log('Screenshot saved');
}
