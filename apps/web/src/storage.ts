export function readSession(key:string){try{return sessionStorage.getItem(key);}catch{return null;}}
export function writeSession(key:string,value:string|null){try{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,value);return true;}catch{return false;}}
export function tryClearInterviewDrafts(id:string){try{const keys:string[]=[];for(let index=0;index<sessionStorage.length;index++){const key=sessionStorage.key(index);if(key?.startsWith(`answer-${id}-`))keys.push(key);}for(const key of keys)sessionStorage.removeItem(key);}catch{}}
