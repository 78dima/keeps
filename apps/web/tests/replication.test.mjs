import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createRxDatabase } from 'rxdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { compareEdits, resolveEdit } from '../src/lib/sync-protocol.ts';

// Load the actual production TypeScript with its RPC dependency injected. No network or production data.
async function moduleFromSource(path, overrides = {}) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const resolved = output.replace(/from (['"])([^'"]+)\1/g, (_all, _quote, name) => {
        const location = overrides[name] || (name.startsWith('.') ? new URL(`../src/lib/${name.slice(2)}.ts`, import.meta.url).href : import.meta.resolve(name));
        return `from ${JSON.stringify(location)}`;
    });
    return import(`data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`);
}
process.env.NODE_ENV = 'production';
const { noteSchema, configureCollections, noteConflictHandler } = await moduleFromSource('../src/lib/db.ts');
const { createSyncHandlers } = await moduleFromSource('../src/lib/replication.ts', {
    './supabase': 'data:text/javascript,export const supabase = {};',
});
const owner = '81219b1c-cd19-490a-ab00-000000000001';
const version = (minutes, uuid) => ({ updatedAt: `2026-01-01T10:${minutes}:00.000Z`, editId: `00000000-0000-0000-0000-${String(uuid).padStart(12,'0')}` });
const snakeVersion = row => ({ updatedAt: row.updated_at, editId: row.edit_id });
function server() {
    const rows = new Map(); let revision = 0;
    return { rows, rpc: async (name, args) => {
        if (name === 'sync_push') {
            const accepted = args.documents.map(doc => {
                assert.equal(doc.user_id, owner);
                const old = rows.get(doc.id);
                if (!old || compareEdits(snakeVersion(doc), snakeVersion(old)) > 0) {
                    rows.set(doc.id, { ...doc, sort_at:doc.sort_at||doc.updated_at,was_sent_once:old?.was_sent_once||false,sync_revision: String(++revision), is_reminder_sent: old?.is_reminder_sent || false });
                }
                return { ...rows.get(doc.id) };
            });
            return { data: { rows: accepted, server_time: new Date().toISOString() }, error: null };
        }
        assert.equal(name, 'sync_pull');
        const page = [...rows.values()].filter(row => BigInt(row.sync_revision) > BigInt(args.after_revision))
            .sort((a,b) => Number(a.sync_revision)-Number(b.sync_revision)).slice(0,args.page_size);
        return { data: { rows: page.map(row => ({...row})), server_time: new Date().toISOString() }, error: null };
    }};
}
async function device(remote, label) {
    const db = await createRxDatabase({ name:`sync${label}${crypto.randomUUID().replaceAll('-','')}`, storage:getRxStorageMemory(), multiInstance:false });
    await db.addCollections({ notes:{ schema:noteSchema, conflictHandler:noteConflictHandler }});
    const connect = () => replicateRxCollection({ collection:db.notes, replicationIdentifier:`test-${label}`,
        ...createSyncHandlers('notes',owner,0,remote), live:true, waitForLeadership:false, retryTime:30 });
    return { db, connect };
}
async function settled(replication) {
    let timer;
    try { await Promise.race([replication.awaitInSync(),new Promise((_,reject)=> { timer=setTimeout(()=>reject(new Error('Sync timed out')),5000); })]); }
    finally { clearTimeout(timer); }
}
const document = id => ({ id, userId:owner, title:'initial', content:'body', color:null,
    isPinned:false,isArchived:false,isDeleted:false,syncDeleted:false,isReminderSent:false,reminderDate:null,tags:[],
    createdAt:'2026-01-01T09:00:00.000Z', ...version('00',1) });

test('actual RxDB engines and production RPC handlers converge after both orders of offline edits', {timeout:20000}, async () => {
    const remote=server(), phone=await device(remote,'phone'), web=await device(remote,'web');
    let p=phone.connect(), w=web.connect();
    try {
        await web.db.notes.insert(document('shared'));
        await settled(w); p.reSync(); await settled(p);
        assert.equal((await phone.db.notes.findOne('shared').exec()).title,'initial');
        await p.cancel();
        await (await phone.db.notes.findOne('shared').exec()).incrementalPatch({title:'phone offline older',...version('01',2)});
        await (await web.db.notes.findOne('shared').exec()).incrementalPatch({title:'web newer',...version('05',3)});
        await settled(w); p=phone.connect(); await settled(p);
        assert.equal((await phone.db.notes.findOne('shared').exec()).title,'web newer');
        await p.cancel();
        await (await phone.db.notes.findOne('shared').exec()).incrementalPatch({title:'phone offline newest',...version('10',4)});
        await (await web.db.notes.findOne('shared').exec()).incrementalPatch({title:'web intermediate',...version('08',5)});
        await settled(w); p=phone.connect(); await settled(p); w.reSync(); await settled(w);
        assert.equal((await web.db.notes.findOne('shared').exec()).title,'phone offline newest');
        assert.equal(remote.rows.get('shared').updated_at,version('10',4).updatedAt);
        await p.cancel();
        await (await phone.db.notes.findOne('shared').exec()).incrementalPatch({title:'stale offline',...version('11',6)});
        await (await web.db.notes.findOne('shared').exec()).incrementalPatch({syncDeleted:true,isDeleted:true,...version('15',7)});
        await settled(w); p=phone.connect(); await settled(p);
        assert.equal((await phone.db.notes.findOne('shared').exec()).syncDeleted,true);
    } finally { await p.cancel(); await w.cancel(); await phone.db.remove(); await web.db.remove(); }
});

test('production pull handler pages through more than one batch and refuses a different owner', async () => {
    const remote=server();
    for(let n=1;n<=125;n++) remote.rows.set(String(n),{
        id:String(n),user_id:owner,title:'test',content:'',color:null,is_pinned:false,is_archived:false,is_deleted:false,
        sync_deleted:false,is_reminder_sent:false,reminder_date:null,tags:[],created_at:'2026-01-01T09:00:00Z',
        updated_at:version('00',1).updatedAt,edit_id:version('00',1).editId,sync_revision:String(n),was_sent_once:true,
    });
    const h=createSyncHandlers('notes',owner,0,remote);
    const a=await h.pull.handler(undefined,100), b=await h.pull.handler(a.checkpoint,100);
    assert.equal(a.documents.length+b.documents.length,125);
    assert.equal(b.checkpoint.revision,'125');
    assert.equal(a.documents[0].wasSentOnce,true);
    assert.equal('syncRevision' in a.documents[0],false);
    remote.rows.get('1').user_id='another-owner';
    await assert.rejects(()=>h.pull.handler(undefined,100),/Wrong sync owner/);
});


test('production v5 schema migrates in place and preserves an exact local recovery copy', {timeout:15000}, async () => {
    const storage=getRxStorageMemory();
    const name=`migration${crypto.randomUUID().replaceAll('-','')}`;
    const oldSchema=JSON.parse(JSON.stringify(noteSchema)); oldSchema.version=0;
    for(const key of ['editId','sortAt','reminderEnabled','reminderVersion']) delete oldSchema.properties[key];
    const old=await createRxDatabase({name,storage,multiInstance:false});
    await old.addCollections({notes:{schema:oldSchema}});
    const legacy={...document('legacy'),title:'Unsent local draft',wasSentOnce:true}; delete legacy.editId;
    await old.notes.insert(legacy); await old.close();
    const db=await createRxDatabase({name,storage,multiInstance:false});
    try {
        await configureCollections(db);
        const migrated=await db.notes.findOne('legacy').exec();
        assert.equal(migrated.title,'Unsent local draft');
        assert.equal(migrated.updatedAt,legacy.updatedAt);
        assert.equal(migrated.sortAt,legacy.updatedAt);
        const copy=await db.migration_backup.findOne('legacy').exec();
        assert.equal(copy.userId,owner);
        assert.equal(JSON.parse(copy.snapshot).title,'Unsent local draft');
    } finally { await db.remove(); }
});
