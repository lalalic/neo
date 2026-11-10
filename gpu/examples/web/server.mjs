import {createServer} from 'node:http';
const port=Number(process.env.NEO_GPU_APP_PORT||7860);
const server=createServer((req,res)=>{
  if(req.url==='/api/time'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({time:new Date().toISOString(),service:'neo-gpu-web-demo'}));return;
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:18px system-ui;max-width:600px;margin:10vh auto"><h1>Neo GPU Web mode</h1><p>Container user interface is running.</p><p>When hosted on a GPU, the session ends after one hour by default.</p><p>UTC now: ${new Date().toISOString()}</p></body></html>`);
});
server.listen(port,'127.0.0.1',()=>console.log('demo web UI on',port));
