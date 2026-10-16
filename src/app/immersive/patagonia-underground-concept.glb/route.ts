import {brotliDecompressSync} from "node:zlib";
export const runtime="nodejs";
export async function GET(request:Request){
 try{
  const fragments=await Promise.all([1,2,3].map(async n=>{
   const url=new URL("/immersive/ar-model.part"+n,request.url);
   const r=await fetch(url,{cache:"force-cache"});
   if(!r.ok)throw new Error("Missing AR model fragment");
   return Buffer.from(await r.arrayBuffer());
  }));
  const bytes=brotliDecompressSync(Buffer.concat(fragments));
  if(bytes.toString("utf8",0,4)!=="glTF")throw new Error("Invalid model header");
  return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"model/gltf-binary","Cache-Control":"public, max-age=3600, s-maxage=86400"}});
 }catch{return new Response("Model temporarily unavailable",{status:503});}
}
