import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareEdits, resolveEdit, newEdit, calibrateClock } from '../src/lib/sync-protocol.ts';
const edit = (time, id, title) => ({ updatedAt: `2026-01-01T10:${time}:00.000Z`, editId:id, title });
test('older offline snapshot cannot beat a later edit; a still newer offline edit wins', () => {
    const phone=edit('00','a','phone'), web=edit('05','b','web'), later=edit('10','c','later');
    assert.equal(resolveEdit(phone,web),web);
    assert.equal(resolveEdit(later,web),later);
});
test('equal timestamps converge regardless of arrival order', () => {
    const a=edit('05','a','a'), b=edit('05','b','b');
    assert.equal(resolveEdit(a,b),b); assert.equal(resolveEdit(b,a),b);
});
test('a tombstone is versioned and repeated sends preserve the original version', () => {
    const local=edit('00','a','draft'), deleted={...edit('10','b','deleted'),syncDeleted:true};
    assert.equal(resolveEdit(local,deleted),deleted);
    assert.equal(compareEdits(deleted,{...deleted}),0);
});
test('equal edit versions accept server reminder delivery metadata', () => {
    const a={...edit('05','a','note'),isReminderSent:false}, b={...a,isReminderSent:true};
    assert.equal(resolveEdit(a,b).isReminderSent,true);
});
test('clock calibration affects new edits only and a backward clock keeps local order', () => {
    const before=newEdit(); const original=before.updatedAt;
    calibrateClock(new Date(Date.now()-60000).toISOString(),Date.now());
    const next=newEdit(before.updatedAt);
    assert.ok(Date.parse(next.updatedAt)>Date.parse(before.updatedAt));
    assert.equal(before.updatedAt,original); assert.notEqual(next.editId,before.editId);
});

test('Taipei reminder survives web edit without an eight-hour shift or lost seconds', async () => {
    const { localDateTimeInput, dateFromInput } = await import('../src/lib/date-input.ts');
    const timezone = process.env.TZ;
    process.env.TZ = 'Asia/Taipei';
    try {
        const instant = '2026-10-27T02:00:27.123Z';
        assert.equal(localDateTimeInput(instant),'2026-10-27T10:00');
        assert.equal(dateFromInput(localDateTimeInput(instant),instant).toISOString(),instant);
        assert.equal(dateFromInput('2026-10-27T11:00',instant).toISOString(),'2026-10-27T03:00:00.000Z');
    } finally { if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone; }
});
