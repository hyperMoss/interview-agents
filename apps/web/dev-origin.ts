import type { Plugin } from 'vite';
const loopback=new Set(['localhost','127.0.0.1','[::1]']);
export function canonicalDevLocation(input:{origin:string;host:string|undefined;url:string|undefined;method:string|undefined;accept:string|undefined}) {
  const target=new URL(input.origin);
  if(!loopback.has(target.hostname)||input.method!=='GET'||!input.accept?.includes('text/html'))return null;
  const path=input.url??'/';
  if(path.startsWith('/api'))return null;
  let current:URL;
  try{current=new URL(`http://${input.host??''}`);}catch{return null;}
  if(!loopback.has(current.hostname)||current.port!==target.port||current.host===target.host)return null;
  if(!path.startsWith('/')||path.startsWith('//'))return null;
  return target.origin+path;
}
export function canonicalDevOrigin(origin:string):Plugin {
  return{name:'canonical-local-origin',apply:'serve',configureServer(server){
    server.middlewares.use((req,res,next)=>{
      const location=canonicalDevLocation({origin,host:req.headers.host,url:req.url,method:req.method,accept:req.headers.accept});
      if(!location){next();return;}
      res.statusCode=307;res.setHeader('Location',location);res.setHeader('Cache-Control','no-store');res.end();
    });
  }};
}
