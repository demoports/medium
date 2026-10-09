// Optional zero-dependency local server. Any static HTTP server also works.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.mp3':'audio/mpeg','.md':'text/plain','.asm':'text/plain'};
const port=Number(process.env.PORT||4771);
http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const path=resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!path.startsWith(root+sep)&&path!==resolve(root,'index.html')){res.writeHead(403);res.end();return;}
  const info=await stat(path);if(!info.isFile())throw new Error('not found');
  const headers={'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache','Accept-Ranges':'bytes'};
  let start=0,end=info.size-1,status=200;
  if(req.headers.range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
   if(match&&(match[1]||match[2])){
    start=match[1]?Number(match[1]):Math.max(0,info.size-Number(match[2]));
    end=match[1]&&match[2]?Math.min(Number(match[2]),end):end;
    if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}
    status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
   }
  }
  headers['Content-Length']=Math.max(0,end-start+1);res.writeHead(status,headers);
  if(req.method==='HEAD'||!info.size)res.end();
  else createReadStream(path,{start,end}).on('error',error=>res.destroy(error)).pipe(res);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Medium: http://127.0.0.1:${port}`));
