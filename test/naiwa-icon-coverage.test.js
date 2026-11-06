const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
// Decode the real RGBA PNG payload from each ICO entry, including PNG row filters.
function visibleBounds(ico,size){
 let offset;
 for(let i=0;i<ico.readUInt16LE(4);i++){
  const e=6+16*i;
  if((ico[e]||256)===size)offset=ico.readUInt32LE(e+12);
 }
 assert.ok(offset,'missing native icon size '+size);
 const png=ico.subarray(offset);assert.equal(png.subarray(1,4).toString(),'PNG');
 let width,height;const chunks=[];
 for(let p=8;p+12<=png.length;){
  const length=png.readUInt32BE(p),type=png.toString('ascii',p+4,p+8),data=png.subarray(p+8,p+8+length);p+=12+length;
  if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);assert.equal(data[9],6);}
  if(type==='IDAT')chunks.push(data);if(type==='IEND')break;
 }
 const raw=zlib.inflateSync(Buffer.concat(chunks)),stride=width*4;
 let prev=Buffer.alloc(stride),pos=0,minX=width,maxX=-1,minY=height,maxY=-1;
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){
  const filter=raw[pos++],row=Buffer.alloc(stride);
  for(let x=0;x<stride;x++){
   const a=x>=4?row[x-4]:0,b=prev[x],c=x>=4?prev[x-4]:0;
   const prediction=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
   row[x]=(raw[pos++]+prediction)&255;
  }
  for(let x=0;x<width;x++)if(row[x*4+3]>=32){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  prev=row;
 }
 return {width:maxX-minX+1,height:maxY-minY+1};
}
test('native 16/24/32px Naiwa ICO frames fill at least 75% of the icon box',()=>{
 const ico=fs.readFileSync(path.resolve(__dirname,'../themes/naiwa/assets/naiwa-app-v2.ico'));
 for(const size of [16,24,32]){
  const box=visibleBounds(ico,size);
  assert.ok(box.width>=size*.75,`${size}px visible width ${box.width} is too small`);
  assert.ok(box.height>=size*.75,`${size}px visible height ${box.height} is too small`);
 }
});
