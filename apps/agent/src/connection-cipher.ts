import { createHash,createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { z } from 'zod';
export class ConnectionCipher {
  private readonly key:Buffer;
  constructor(token:string,purpose:string){this.key=createHash('sha256').update(`${purpose}\0${token}`).digest();}
  encrypt(secret:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const value=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),value:value.toString('base64')});}
  decrypt(raw:string){const value=z.object({iv:z.string(),tag:z.string(),value:z.string()}).parse(JSON.parse(raw));const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(value.iv,'base64'));decipher.setAuthTag(Buffer.from(value.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(value.value,'base64')),decipher.final()]).toString('utf8');}
}
