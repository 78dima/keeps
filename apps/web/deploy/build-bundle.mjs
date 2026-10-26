// Build a deployable web artifact without copying local secrets or doing npm builds on the VPS.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = process.cwd();
const sync = JSON.parse(fs.readFileSync('apps/android/android/app/src/main/assets/sync-config.json','utf8'));
const config = JSON.parse(fs.readFileSync('apps/web/deploy/public-config.json','utf8'));
function command(program,args,env=process.env) {
    const result=spawnSync(program,args,{stdio:'inherit',env});
    if(result.status !== 0) throw new Error(`${program} failed (${result.status})`);
}
command('npm',['run','build','--workspace=@monokeep/web'],{
    ...process.env, NEXT_PUBLIC_SUPABASE_URL:sync.url, NEXT_PUBLIC_SUPABASE_ANON_KEY:sync.publishableKey,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY:config.vapidPublicKey,
});
const destination=path.join(root,'dist/web-bundle');
fs.rmSync(destination,{recursive:true,force:true}); fs.mkdirSync(destination,{recursive:true});
for(const [source,target] of [
    ['apps/web/.next/standalone','standalone'],['apps/web/.next/static','static'],['apps/web/public','public'],
]) fs.cpSync(source,path.join(destination,target),{recursive:true});
fs.copyFileSync('apps/web/deploy/Dockerfile.bundle',path.join(destination,'Dockerfile'));
fs.writeFileSync(path.join(destination,'revision.txt'),(process.env.GITHUB_SHA || 'local-review')+'\n');
command('tar',['-czf','dist/monokeep-web.tar.gz','-C',destination,'.']);
const digest=createHash('sha256').update(fs.readFileSync('dist/monokeep-web.tar.gz')).digest('hex');
fs.writeFileSync('dist/monokeep-web.tar.gz.sha256',digest+'  monokeep-web.tar.gz\n');
console.log('Prepared dist/monokeep-web.tar.gz');
