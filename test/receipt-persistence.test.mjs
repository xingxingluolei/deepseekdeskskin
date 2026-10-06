import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {mountReceiptHost} from '../adapters/harness/receipt-host.mjs';
const publicRoot=process.env.DSH_REFERENCE_ROOT?.replace(/\/$/,'')+'/';
test('actual rc.2 persistence vocabulary accepts the saved session after receipt observation',t=>{
 if(!process.env.DSH_REFERENCE_ROOT||!fs.existsSync(publicRoot+'dsh-session-persistence/lib/index.js')){t.skip('readonly public rc.2 extraction unavailable');return;}
 const source=fs.readFileSync(publicRoot+'dsh-session-persistence/lib/index.js','utf8'),sessionSource=fs.readFileSync(publicRoot+'dsh-session/lib/index.js','utf8');
 const known=Function('return '+sessionSource.match(/const KNOWN_SESSION_EVENT_TYPES = (new Set\(\[[\s\S]*?\]\));/)[1])();
 const body=source.match(/function validateStoredEvents\(meta, events, location\) \{[\s\S]*?\n\treturn events;\n\}/)[0];
 // Execute the exact native fail-closed vocabulary guard. Envelope adoption is
 // an identity here: these hand-built native records already passed fixtures;
 // this regression is about foreign event type persistence, not envelopes.
 class Unsupported extends Error{}
 const validate=Function('KNOWN_SESSION_EVENT_TYPES','unsupported','adoptSessionEvent','SessionFormatUnsupportedError','SessionPersistenceCorruptionError','return '+body)(known,message=>new Unsupported(message),event=>event,Unsupported,Error);
 const events=[],callbacks=new Map();const session={id:'one',append(type,data){const event={type,seq:events.length,time:1,data};events.push(event);callbacks.get('session/event')?.(session,event);return event;}};
 const host=mountReceiptHost({on(name,fn){callbacks.set(name,fn);return()=>callbacks.delete(name);},provide(){return()=>{};},typert:{register(){return()=>{};}}});
 session.append('turn/start',{turn:1});session.append('tool/call',{turn:1,step:1,callId:'bash',name:'bash',arguments:'{}'});
 callbacks.get('tools/result')({name:'bash',callId:'bash',rootCallId:'bash',agent:{id:'one',session}},Object.freeze({isError:false,value:Object.freeze({kind:'foreground',exitCode:3,timedOut:false,signal:null,aborted:false})}));
 assert.doesNotThrow(()=>validate({id:'one'},JSON.parse(JSON.stringify(events))),'saving/reopening must not fail on an unknown required receipt event');
 assert.equal(events.length,2,'observing tool outcomes must append no durable session event');host.dispose();
});
