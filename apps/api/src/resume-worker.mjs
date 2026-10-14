import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

let input='';for await(const chunk of process.stdin)input+=chunk;
try{
  const {filename,bytes}=JSON.parse(input);const data=Buffer.from(bytes,'base64');const warnings=[];
  let text;
  if(/\.pdf$/i.test(filename)){
    if(data.subarray(0,5).toString()!=='%PDF-')throw new Error('invalid format');
    const parser=new PDFParse({data});try{const result=await parser.getText({first:20});text=result.text;if(result.total>20)warnings.push('仅提取前 20 页，请检查是否缺少重要经历。');}finally{await parser.destroy();}
  }else if(/\.docx$/i.test(filename)){
    if(data.readUInt32LE(0)!==0x04034b50)throw new Error('invalid format');
    let expanded=0;let document=false;
    for(let offset=0;offset+46<data.length;offset++){
      if(data.readUInt32LE(offset)!==0x02014b50)continue;
      const size=data.readUInt32LE(offset+24);expanded+=size;if(size>16*1024*1024||expanded>32*1024*1024)throw new Error('document expands too far');
      const nameLength=data.readUInt16LE(offset+28),extraLength=data.readUInt16LE(offset+30),commentLength=data.readUInt16LE(offset+32);
      if(data.subarray(offset+46,offset+46+nameLength).toString()==='word/document.xml')document=true;
      offset+=45+nameLength+extraLength+commentLength;
    }
    if(!document)throw new Error('invalid document');
    text=(await mammoth.extractRawText({buffer:data})).value;
  }else text=new TextDecoder('utf-8',{fatal:true}).decode(data);
  text=text.replace(/\u0000/g,'').trim();if(text.length<20)throw new Error('no useful text');
  if(text.length>64000){text=text.slice(0,64000);warnings.push('预览最多 64000 字，请对照原文件检查。');}
  if(text.length>16000)warnings.push('提交简历最多 16000 字，请保留与岗位相关的经历。');
  process.stdout.write(JSON.stringify({filename,text,warnings}));
}catch{process.exitCode=1;}
