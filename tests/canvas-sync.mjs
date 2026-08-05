import assert from 'node:assert/strict'

const baseUrl=String(process.env.VIORA_TEST_BASE_URL||'http://127.0.0.1:4173/api').replace(/\/$/,'')
const token=String(process.env.VIORA_TEST_TOKEN||'')
if(!token)throw new Error('VIORA_TEST_TOKEN is required')
const headers={authorization:`Bearer ${token}`}
const request=async(path,options={})=>{const response=await fetch(`${baseUrl}${path}`,{...options,headers:{...headers,...(options.body?{'content-type':'application/json'}:{}),...options.headers}}),body=await response.json().catch(()=>null);return{status:response.status,body}}
const node=(id,title)=>({id,kind:'prompt',width:340,height:240,x:id*20,y:id*20,title,body:'',accent:'#64748b'})
const link=(from,to)=>({from,to,fromSide:'right',toSide:'left'})
const sync=(projectId,clientId,batchId,baseVersion,operations)=>request(`/projects/${projectId}/canvas/sync`,{method:'POST',body:JSON.stringify({clientId,batchId,baseVersion,operations})})

const created=await request('/projects',{method:'POST',body:JSON.stringify({name:`同步协议测试 ${Date.now()}`})
})
assert.equal(created.status,201)
const projectId=created.body.id
try{
  const initial=await request(`/projects/${projectId}/canvas`)
  assert.equal(initial.status,200)
  assert.equal(initial.body.version,1)

  const leaseA=await request(`/projects/${projectId}/canvas/id-block`,{method:'POST',body:JSON.stringify({count:100})})
  const leaseB=await request(`/projects/${projectId}/canvas/id-block`,{method:'POST',body:JSON.stringify({count:100})})
  assert.equal(leaseA.status,200)
  assert.equal(leaseB.status,200)
  assert.ok(Number.isSafeInteger(leaseA.body.start)&&Number.isSafeInteger(leaseA.body.end))
  assert.ok(leaseA.body.end<leaseB.body.start,'设备号段不得重叠')
  const deviceAId=leaseA.body.start,deviceBId=leaseB.body.start

  const parallel=await Promise.all([
    sync(projectId,'lease_device_a','batch_lease_a_0001',1,[{type:'node',action:'upsert',key:String(deviceAId),value:node(deviceAId,'号段 A')}]),
    sync(projectId,'lease_device_b','batch_lease_b_0001',1,[{type:'node',action:'upsert',key:String(deviceBId),value:node(deviceBId,'号段 B')}]),
  ])
  assert.ok(parallel.every(result=>result.status===200),'不同号段并发创建应自动合并')
  const afterParallel=await request(`/projects/${projectId}/canvas`)
  assert.deepEqual(afterParallel.body.nodes.map(item=>item.id).sort((x,y)=>x-y),[deviceAId,deviceBId].sort((x,y)=>x-y))

  const resetLeaseCanvas=await request(`/projects/${projectId}/canvas/clear`,{method:'POST',body:JSON.stringify({version:4})})
  assert.equal(resetLeaseCanvas.status,200)
  assert.equal(resetLeaseCanvas.body.version,4)

  const a=await sync(projectId,'client_device_a','batch_device_a_0001',4,[{type:'node',action:'upsert',key:'1',value:node(1,'A')}])
  assert.equal(a.status,200)
  assert.equal(a.body.version,5)
  assert.deepEqual(a.body.nodes.map(item=>item.id),[1])

  const duplicate=await sync(projectId,'client_device_a','batch_device_a_0001',1,[{type:'node',action:'upsert',key:'1',value:node(1,'A')}])
  assert.equal(duplicate.status,200)
  assert.equal(duplicate.body.version,5)
  assert.equal(duplicate.body.nodes.length,1)

  const b=await sync(projectId,'client_device_b','batch_device_b_0001',4,[{type:'node',action:'upsert',key:'2',value:node(2,'B')}])
  assert.equal(b.status,200)
  assert.equal(b.body.version,6)
  assert.deepEqual(b.body.nodes.map(item=>item.id).sort((x,y)=>x-y),[1,2])

  const sameRecordConflict=await sync(projectId,'client_device_c','batch_device_c_0001',4,[{type:'node',action:'upsert',key:'1',value:node(1,'C')}])
  assert.equal(sameRecordConflict.status,409)
  assert.equal(sameRecordConflict.body.error,'canvas_record_conflict')

  const connected=await sync(projectId,'client_device_a','batch_device_a_0002',6,[{type:'link',action:'upsert',key:'1:2:right:left',value:link(1,2)}])
  assert.equal(connected.status,200)
  assert.equal(connected.body.version,7)

  const dangling=await sync(projectId,'client_device_a','batch_device_a_0003',7,[{type:'node',action:'delete',key:'1'}])
  assert.equal(dangling.status,409)
  assert.equal(dangling.body.error,'canvas_reference_conflict')
  const afterRollback=await request(`/projects/${projectId}/canvas`)
  assert.equal(afterRollback.body.version,7)
  assert.equal(afterRollback.body.nodes.length,2)
  assert.equal(afterRollback.body.links.length,1)

  const deleted=await sync(projectId,'client_device_a','batch_device_a_0004',7,[{type:'link',action:'delete',key:'1:2:right:left'},{type:'node',action:'delete',key:'1'}])
  assert.equal(deleted.status,200)
  assert.equal(deleted.body.version,8)
  assert.deepEqual(deleted.body.nodes.map(item=>item.id),[2])

  const resurrection=await sync(projectId,'client_device_old','batch_device_old_0001',6,[{type:'node',action:'upsert',key:'1',value:node(1,'旧设备复活')}])
  assert.equal(resurrection.status,409)
  assert.equal(resurrection.body.error,'canvas_record_conflict')

  const cleared=await request(`/projects/${projectId}/canvas/clear`,{method:'POST',body:JSON.stringify({version:9})})
  assert.equal(cleared.status,200)
  assert.equal(cleared.body.version,9)

  const preClearWrite=await sync(projectId,'client_device_old','batch_device_old_0002',8,[{type:'node',action:'upsert',key:'9',value:node(9,'清空前离线新增')}])
  assert.equal(preClearWrite.status,409)
  assert.equal(preClearWrite.body.error,'canvas_reset_conflict')

  const invalidBase=await sync(projectId,'client_device_a','batch_device_a_0005',99,[{type:'node',action:'upsert',key:'3',value:node(3,'超前')}])
  assert.equal(invalidBase.status,409)

  const final=await request(`/projects/${projectId}/canvas`)
  assert.equal(final.status,200)
  assert.equal(final.body.version,9)
  assert.deepEqual(final.body.nodes,[])
  assert.deepEqual(final.body.links,[])
  console.log(JSON.stringify({ok:true,projectId,checks:20,finalVersion:final.body.version,leases:[[leaseA.body.start,leaseA.body.end],[leaseB.body.start,leaseB.body.end]]}))
}finally{
  const removed=await request(`/projects/${projectId}`,{method:'DELETE'})
  assert.equal(removed.status,204)
}
