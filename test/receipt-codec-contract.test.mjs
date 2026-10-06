import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mountReceiptHost} from '../adapters/harness/receipt-host.mjs';
import {createReceiptClient} from '../adapters/harness/receipt-client.mjs';
import {frameRemote,tick,bashRow} from './receipt-fixture.mjs';

// Both generated faces must satisfy the Gateway's strict input contract.
// A manual host whitelist does not permit SRC codecs in client $mount().
function hostFixture() {
  return mountReceiptHost({on(){return()=>{};},provide(){return()=>{};},typert:{register(){return()=>{};}}});
}
function strictInput(descriptor) {
  const codec=descriptor.parameters.find(parameter=>parameter.wire==='request').codec;
  assert.equal(codec.mode,'strict','generated Remote request must use a strict input codec');
  assert.equal(typeof codec.typeSymbol,'string');
  assert.ok(codec.typeSymbol.length>0);
  assert.equal(typeof codec.create,'function');
  const schema=codec.create();
  assert.equal(typeof schema?.parse,'function');
  assert.deepEqual(schema.parse({sessionId:'one'}),{sessionId:'one'});
  for(const request of [null,{},[],{sessionId:1},{sessionId:''},{sessionId:'one',output:'private'}]) {
    assert.throws(()=>schema.parse(request),'the boundary accepts only a valid session scope');
  }
  return codec;
}
test('host and client receipt inputs use matching strict scope codecs',async()=>{
  const host=hostFixture(),reader=createReceiptClient();
  try {
    const hostCodec=strictInput(host.descriptor),clientCodec=strictInput(reader.descriptor);
    assert.equal(hostCodec.typeSymbol,clientCodec.typeSymbol);
  } finally {host.dispose();await reader.dispose();}
});

test('actual rc.2 Gateway input guard admits the receipt stream before future exit-3 metadata',async t=>{
  const paths=process.env.DSH_REFERENCE_ROOT ? [process.env.DSH_REFERENCE_ROOT.replace(/\/$/,'')+'/dsh-api-gateway/lib/client.js'] : [];
  const path=paths.find(path=>fs.existsSync(path));
  if(!path){t.skip('read-only official rc.2 Gateway extraction unavailable');return;}
  const source=fs.readFileSync(path,'utf8');
  const input=source.match(/function requireStrictInputs\(descriptor\) \{[\s\S]*?\n\t\t\}/)?.[0];
  const codec=source.match(/function requireStrictCodec\(codec, endpoint, field\) \{[\s\S]*?\n\t\t\}/)?.[0];
  assert.ok(input&&codec,'official generated Remote input contract was located');
  const nativeGuard=Function('endpointOf',`${input}\n${codec}\nreturn requireStrictInputs;`)(descriptor=>`${descriptor.namespace}/${descriptor.method}`);
  const fixture=frameRemote(),mount=fixture.remote.$mount;
  fixture.remote.$mount=async contribution=>{
    for(const descriptor of contribution.descriptors)nativeGuard(descriptor);
    return mount(contribution);
  };
  const reader=createReceiptClient(fixture.ctx);
  try {
    reader.watch('one');await tick();
    assert.equal(reader.state.getSnapshot()?.baseline,true,'mount must open a native-compatible stream');
    fixture.send({type:'receipts',sessionId:'one',epoch:'epoch',rows:[bashRow({exitCode:3})]});
    await tick();
    assert.equal(reader.state.getSnapshot()?.rows[0]?.exitCode,3,'a future nonzero Bash outcome crosses the admitted metadata stream');
  } finally {await reader.dispose();}
});
