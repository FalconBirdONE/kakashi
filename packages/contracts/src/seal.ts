import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
export function seal(value:unknown,keyHex:string,context:string):string {
  if(!/^[a-f0-9]{64}$/i.test(keyHex))throw new Error('INVALID_STORAGE_KEY');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),iv);
  cipher.setAAD(Buffer.from(context));
  const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
}
export function unseal<T>(value:string,keyHex:string,context:string):T {
  const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),bytes.subarray(0,12));
  decipher.setAAD(Buffer.from(context));decipher.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')) as T;
}
