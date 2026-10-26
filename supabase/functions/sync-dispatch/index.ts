// FCM carries only an account-scoped wake-up hint. Notes never travel through Firebase.
// Invoked by the database cron with X-Sync-Secret. This function verifies that secret itself.
const api = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
let access: { token: string; expires: number } | undefined;

async function db(path: string, init: RequestInit = {}) {
    const response = await fetch(`${api}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!response.ok) throw new Error(`Database request failed: ${response.status}`);
    return response.status === 204 ? null : response.json();
}
function base64url(bytes: Uint8Array) {
    return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
}
async function googleToken(account: { client_email: string; private_key: string }) {
    if (access && access.expires > Date.now() + 60000) return access.token;
    const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
    const now = Math.floor(Date.now()/1000);
    const unsigned = `${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:account.client_email,
        scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
    const pem = account.private_key.replace(/-----[^-]+-----|\s/g,'');
    const key = await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),
        {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned));
    const response = await fetch('https://oauth2.googleapis.com/token',{method:'POST',
        body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${base64url(new Uint8Array(signature))}`})});
    if (!response.ok) throw new Error(`FCM authentication failed: ${response.status}`);
    const result = await response.json();
    access = {token:result.access_token,expires:Date.now()+result.expires_in*1000};
    return access.token;
}
function sameSecret(actual: string, expected: string) {
    const a=new TextEncoder().encode(actual), b=new TextEncoder().encode(expected);
    let difference=a.length^b.length;
    for(let i=0;i<Math.max(a.length,b.length);i++) difference|=(a[i]||0)^(b[i]||0);
    return difference===0;
}
Deno.serve(async request => {
    if (request.method !== 'POST') return new Response('Method not allowed',{status:405});
    try {
        // Vault keeps Firebase credentials on the server. Only service_role can call this RPC.
        const settings = await db('rpc/sync_dispatch_config',{method:'POST',body:'{}'});
        if (!settings?.dispatch_secret || !sameSecret(request.headers.get('x-sync-secret')||'',settings.dispatch_secret))
            return new Response('Unauthorized',{status:401});
        if (!settings.firebase_service_account) return new Response('FCM is not configured',{status:503});
        const account=JSON.parse(settings.firebase_service_account);
        const token=await googleToken(account);
        const signals=await db('sync_signals?select=user_id,revision&order=updated_at&limit=100');
        let sent=0;
        for (const signal of signals) {
            const devices=await db(`sync_devices?select=device_id,fcm_token&user_id=eq.${signal.user_id}`);
            let complete=true;
            for (const device of devices) {
                const response=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,{
                    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
                    body:JSON.stringify({message:{token:device.fcm_token,data:{type:'sync',user_id:signal.user_id},
                        android:{priority:'normal',collapse_key:'monokeep-sync',ttl:'86400s'}}}),
                });
                if (response.ok) { sent++; continue; }
                const body=await response.json();
                const invalid=body.error?.details?.some((d: {errorCode?:string})=>d.errorCode==='UNREGISTERED');
                if (invalid) {
                    // Token rotation may race this request: remove only the token we actually sent to.
                    await db(`sync_devices?user_id=eq.${signal.user_id}&device_id=eq.${device.device_id}&fcm_token=eq.${encodeURIComponent(device.fcm_token)}`,{method:'DELETE'});
                } else complete=false; // keep queued for cron retry; never log tokens or note contents
            }
            if (complete) await db(`sync_signals?user_id=eq.${signal.user_id}&revision=eq.${signal.revision}`,{method:'DELETE'});
        }
        return Response.json({sent});
    } catch {
        return new Response('Dispatch failed; queued signals will be retried',{status:503});
    }
});
