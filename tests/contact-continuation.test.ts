import { describe, expect, it } from 'vitest';
import { continueApprovedContacts } from '../apps/web/src/contact-continuation';
import type { CareerContactView } from '../packages/contracts/src/career';
type Row = Pick<CareerContactView,'id'|'state'|'updatedAt'>;
const row=(id:string,state:Row['state']='failed'):Row=>({id,state,updatedAt:'v1'});
describe('programmatic continuation of frozen approved contacts',()=>{
  it('waits for each result, skips confirmed contacts and excludes later records',async()=>{
    let rows=[row('done','confirmed'),row('a'),row('b')];const events:string[]=[];
    const result=await continueApprovedContacts({signal:new AbortController().signal,
      read:async()=>rows.map(r=>({...r})),
      retry:async r=>{events.push(`retry:${r.id}`);const current=rows.find(x=>x.id===r.id)!;current.state='queued';rows.push(row('later'));},
      wait:async()=>{const current=rows.find(r=>r.state==='queued')!;events.push(`confirm:${current.id}`);current.state='confirmed';},
    });
    expect(events).toEqual(['retry:a','confirm:a','retry:b','confirm:b']);expect(result).toEqual({completed:2,reason:'completed'});
  });
  for(const state of ['failed','unknown','cancelled'] as const)it(`stops on ${state} without submitting the next target`,async()=>{
    const rows=[row('a'),row('b')];const sent:string[]=[];
    const result=await continueApprovedContacts({signal:new AbortController().signal,read:async()=>rows.map(r=>({...r})),retry:async r=>{sent.push(r.id);rows[0]!.state=state;},wait:async()=>{}});
    expect(sent).toEqual(['a']);expect(result.reason).toBe(state);
  });
  it('does not retry when another actor changed a snapshot',async()=>{
    let reads=0;let calls=0;
    const result=await continueApprovedContacts({signal:new AbortController().signal,read:async()=>[{...row('a'),updatedAt:++reads===1?'v1':'v2'}],retry:async()=>{calls++;},wait:async()=>{}});
    expect(calls).toBe(0);expect(result.reason).toBe('changed');
  });
  it('does not submit when an unknown or in-flight record exists',async()=>{
    for(const state of ['unknown','queued','dispatching'] as const){let calls=0;
      const result=await continueApprovedContacts({signal:new AbortController().signal,read:async()=>[row('a'),row('other',state)],retry:async()=>{calls++;},wait:async()=>{}});
      expect(calls).toBe(0);expect(result.reason).toBe('blocked');
    }
  });
  it('stops subsequent work when the page exits during an active effect',async()=>{
    const controller=new AbortController();let calls=0;const rows=[row('a'),row('b')];
    const result=await continueApprovedContacts({signal:controller.signal,read:async()=>rows,retry:async()=>{calls++;controller.abort();},wait:async()=>{}});
    expect(calls).toBe(1);expect(result.reason).toBe('cancelled');
  });
  it('times out without submitting another record or resending the active one',async()=>{
    let clock=0,calls=0;const rows=[row('a'),row('b')];
    const result=await continueApprovedContacts({signal:new AbortController().signal,read:async()=>rows,retry:async()=>{calls++;rows[0]!.state='dispatching';},wait:async()=>{clock+=10;},now:()=>clock,timeoutMs:10});
    expect(calls).toBe(1);expect(result.reason).toBe('timeout');expect(rows[0]!.state).toBe('dispatching');
  });
});
