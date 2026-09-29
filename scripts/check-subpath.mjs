import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from '@playwright/test';

const prefix='/event-timetable-maker/';
const dist=path.resolve('dist');
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end();return;}
  const relative=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html';
  const file=path.resolve(dist,relative);
  if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
  const data=await readFile(file);
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.map':'application/json'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime});res.end(data);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}${prefix}`;
const fallback=path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1187/chrome-mac/Chromium.app/Contents/MacOS/Chromium');
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync(fallback)?fallback:undefined);
let browser;
try{
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const page=await browser.newPage();const errors=[],failed=[];
 page.on('pageerror',err=>errors.push(err.message));page.on('response',res=>{if(res.status()>=400)failed.push([res.url(),res.status()]);});
 await page.goto(url);
 await page.getByRole('button',{name:'예시로 체험하기',exact:true}).click();
 await page.getByRole('button',{name:'자동배정 초안 만들기',exact:true}).click();
 await page.getByRole('button',{name:'이 초안 적용',exact:true}).waitFor();
 const complete=await page.locator('.preview-box').innerText();
 if(!complete.includes('complete')||!complete.includes('부족 0인분'))throw new Error('Subpath Worker did not produce complete valid schedule: '+complete);
 await page.getByRole('button',{name:'이 초안 적용',exact:true}).click();
 await page.locator('.save-state').filter({hasText:'저장 완료'}).waitFor();
 await page.reload();
 await page.locator('.event-open').filter({hasText:'가상 가을 축제'}).click();
 await page.getByRole('navigation').getByRole('button',{name:'04배치표'}).click();
 if(await page.locator('.assignment').count()===0)throw new Error('Saved assignments did not survive refresh');
 if(errors.length||failed.length)throw new Error(JSON.stringify({errors,failed}));
 await mkdir('docs/qa',{recursive:true});
 const result={testedAt:new Date().toISOString(),mount:prefix,html:true,assets:true,worker:true,refresh:true,indexedDB:true,pageErrors:errors,failedResponses:failed,publicDeployment:false};
 await writeFile('docs/qa/subpath-result.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();server.close();}
