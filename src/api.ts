let csrf='';
export class ApiError extends Error { status:number; data:any; constructor(status:number,data:any){super([data.error ?? 'Request failed.',...(Array.isArray(data.errors)?data.errors:[])].join('\n'));this.status=status;this.data=data;} }
export async function api(path:string,method='GET',body?:unknown):Promise<any> {
 if(method!=='GET'&&!csrf){const res=await fetch('/api/csrf',{signal:AbortSignal.timeout(8000)});if(!res.ok)throw new Error('Server unavailable.');csrf=(await res.json()).token;}
 const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
 let data;try{data=await response.json();}catch{throw new Error('Server unavailable. Your path is kept on this device.');}
 if(!response.ok){if(response.status===403)csrf='';throw new ApiError(response.status,data);}return data;
}
export async function uploadMedia(file:File){
 if(!csrf){const r=await fetch('/api/csrf');if(!r.ok)throw Error('Server unavailable.');csrf=(await r.json()).token;}
 const data=new FormData();data.append('file',file);
 const r=await fetch('/api/admin/media',{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':csrf},body:data,signal:AbortSignal.timeout(300000)});
 const result=await r.json();if(!r.ok){if(r.status===403)csrf='';throw new ApiError(r.status,result);}return result;
}
