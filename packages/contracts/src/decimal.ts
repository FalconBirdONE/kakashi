// Exact non-negative decimal arithmetic. External exponents are normalized before storage.
function parts(value: string): {n: bigint; scale: number} {
  if (value.length>160) throw new Error('INVALID_DECIMAL');
  const m=/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!m) throw new Error('INVALID_DECIMAL');
  const exponent=Number(m[3]??0);
  if (!Number.isInteger(exponent)||Math.abs(exponent)>30)throw new Error('INVALID_DECIMAL');
  let n=BigInt(m[1]!+(m[2]??'')),scale=(m[2]?.length??0)-exponent;
  if(scale<0){n*=10n**BigInt(-scale);scale=0;}
  if(scale>60)throw new Error('INVALID_DECIMAL');
  return {n,scale};
}
function format(n:bigint,scale:number):string {
  if(n<0n)throw new Error('NEGATIVE_DECIMAL');
  if(!scale)return String(n);
  const s=String(n).padStart(scale+1,'0'),f=s.slice(-scale).replace(/0+$/,'');
  return s.slice(0,-scale)+(f?'.'+f:'');
}
export const decimal=(value:string):string=>{const p=parts(value);return format(p.n,p.scale);};
export function addD(a:string,b:string):string {const x=parts(a),y=parts(b),s=Math.max(x.scale,y.scale);return format(x.n*10n**BigInt(s-x.scale)+y.n*10n**BigInt(s-y.scale),s);}
export function cmpD(a:string,b:string):number {const x=parts(a),y=parts(b),s=Math.max(x.scale,y.scale),d=x.n*10n**BigInt(s-x.scale)-y.n*10n**BigInt(s-y.scale);return d<0n?-1:d>0n?1:0;}

export const SQLITE_MAX_ATOMIC='9223372036854775807';
export function boundedAtomic(value: unknown): value is string {return typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)&&value.length<=19&&BigInt(value)<=BigInt(SQLITE_MAX_ATOMIC);}
