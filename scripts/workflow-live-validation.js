// Opt-in real Codex + Blender graph executions. Stops on the first usage limit.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { Runner, exportCode } from '../src/runner.js';
import { WorkflowEngine, workflowPreset, fileHash, hash } from '../src/workflow.js';
import { workflowOperations } from '../src/workflow-operations.js';
import { authorizeBase } from '../src/base-model.js';
import { blenderCall } from '../src/blender.js';
import { runProcess } from '../src/codex.js';
const output=path.resolve(process.env.GEN3D_WORKFLOW_LIVE_OUTPUT || '.gen3d/workflow-live-validation');fs.mkdirSync(output,{recursive:true});
const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const env={...process.env,GEN3D_BLENDER_PORT:String(port)};
const bridge=spawn(env.GEN3D_BLENDER_BIN || 'blender',['--background','--factory-startup','--disable-autoexec','--python',path.resolve('blender/gen3d_bridge.py'),'--','--serve'],{env,stdio:'ignore'});
const data=fs.mkdtempSync(path.join(output,'data-')), store=new Store(data,{env}),runner=new Runner(store,{env}),engine=new WorkflowEngine(store,runner,workflowOperations(store,runner));
const report={realBlender:true,codexUsed:true,dataDirectory:path.basename(data),checks:[],runs:[],startedAt:new Date().toISOString(),limitation:'Focused image-input object and representative simple rigged/expression base; no live text image generation, broad humanoid corpus, or subjective quality claim. Human gates are disabled for these harness runs and covered separately in browser/API tests.'};
const checkpoints={input:false,concept:false,multiView:false,preview:false};
const png=file=>'data:image/png;base64,'+fs.readFileSync(file).toString('base64');
function record(p,r){report.runs.push({projectId:p.id,runId:r.id,status:r.status,error:r.error,graphRevision:r.graphRevision,parentRunId:r.parentRunId,parentCheckpointId:r.parentCheckpointId,reusedNodes:Object.entries(r.nodes).filter(([,s])=>s.reusedFrom).map(([id])=>id),checkpoints:r.checkpoints.map(c=>({id:c.id,nodeId:c.nodeId,type:c.type,files:c.files})),candidate:p.versions.at(-1),activity:p.activity.filter(e=>e.type==='blender_operation').length});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
async function run(p,input={}){engine.start(p.id,input,'web');const timer=setInterval(()=>console.log(JSON.stringify({project:p.name,status:p.workflowRuns.at(-1).status,operations:p.activity.filter(e=>e.type==='blender_operation').length})),20000);try{await runner.pending;}finally{clearInterval(timer);}const r=p.workflowRuns.at(-1);record(p,r);if(r.status!=='completed')throw new Error(`${p.name}: ${r.status}: ${r.error}`);return r;}
try{
  const deadline=Date.now()+15000;
  while(true){try{await blenderCall('get_scene_info',{}, {port,timeout:1000});break;}catch(e){if(Date.now()>deadline||bridge.exitCode!==null)throw e;await new Promise(resolve=>setTimeout(resolve,250));}}
  const login=await runProcess(env.GEN3D_CODEX_BIN || 'codex',['login','status'],{env,timeout:15000});assert.match(login,/ChatGPT/);
  // Character fixture comes from the separate real preservation check.
  const character=path.resolve('.gen3d/workflow-blender-check/character.blend');assert.ok(fs.existsSync(character),'Run test:workflow-blender first');
  const sourceHash=fileHash(character),referenceDir=path.join(output,'character-reference');fs.mkdirSync(referenceDir,{recursive:true});
  await blenderCall('execute_code',{code:`import bpy\nbpy.ops.wm.open_mainfile(filepath=${JSON.stringify(path.resolve('.gen3d/workflow-blender-check/edited.blend'))}, use_scripts=False)\n`+exportCode(referenceDir,{})},{port});
  const object=store.create({name:'Live object graph',mode:'image',image:png(path.resolve('docs/validation/issue10/prop/concept-1/concept.png')),profile:'object',prompt:'Build the small stylized teal cabinet with orange knobs and feet shown in the image. Use a small useful mesh model with materials. Keep this validation bounded and finish through Blender MCP.',checkpoints},'web');
  const objectRun=await run(object);assert.ok(store.canExport(object.id,object.versions[0].id));report.checks.push('real object preset generated GLB, scene and preview');
  const objectBefore=hash(objectRun),objectCandidate=hash(object.versions[0]),modelCp=objectRun.checkpoints.find(c=>c.nodeId==='model');
  const branch=await run(object,{runId:objectRun.id,checkpointId:modelCp.id});assert.equal(branch.nodes.model.reusedFrom,objectRun.id);assert.equal(hash(objectRun),objectBefore);assert.equal(hash(object.versions[0]),objectCandidate);assert.equal(object.versions.length,2);report.checks.push('object fork reused model checkpoint, published a separate candidate and kept original run/candidate intact');
  if(runner.usageLimited)throw new Error('Usage limit; no further Codex actions');
  const baseAsset=await store.library.import({name:'character.blend',data:fs.readFileSync(character).toString('base64')});
  const humanoid=store.create({name:'Live humanoid base edit',workflowType:'humanoid',mode:'image',image:png(path.join(referenceDir,'preview.png')),profile:'character',prompt:'The app has loaded the COMPLETE base character. Make ONLY Hair mesh coordinates 15 percent wider along local X, matching the wider hair cap in the image. Use vertex coordinate edits, not object scale, and preserve all Hair UVs/materials and all other objects, rig, skin weights, Smile expression and hierarchy. Do not create new parts or alter pose. Keep this bounded: inspect then make the targeted Hair edit and finish. Set the requested reference camera direction without reorienting the character.',checkpoints},'web');
  await authorizeBase(store,humanoid.id,{assetId:baseAsset.id,scope:{editableObjects:['Hair']}},'web');
  const first=await run(humanoid);const v=humanoid.versions[0];assert.equal(v.preservation.passed,true);assert.equal(v.preservation.roundtrip.passed,true);assert.equal(fileHash(character),sourceHash);report.checks.push('real Codex edited copied complete base with rig/weights/Smile/UV/material protection and reopened GLB');
  const firstBefore=hash(first),candidateBefore=hash(v),baseCp=first.checkpoints.find(c=>c.nodeId==='base');
  const graph=structuredClone(humanoid.workflow);graph.nodes.find(n=>n.type==='edit').settings.instructions='For this branch only, make Hair mesh local X coordinates 25 percent wider than the unchanged base instead of 15 percent. Preserve every protected feature.';engine.saveGraph(humanoid.id,graph,'web');
  const fork=await run(humanoid,{runId:first.id,checkpointId:baseCp.id});assert.equal(fork.nodes.base.reusedFrom,first.id);assert.equal(hash(first),firstBefore);assert.equal(hash(humanoid.versions[0]),candidateBefore);assert.equal(fileHash(character),sourceHash);assert.equal(humanoid.versions[1].preservation.passed,true);report.checks.push('humanoid fork reused unchanged complete-base checkpoint and executed altered downstream edit without overwriting original candidate/source');
  report.sourceSha256=sourceHash;report.sourceUnchanged=fileHash(character)===sourceHash;report.status='passed';
}catch(e){report.status=runner.usageLimited?'usage-limit':'failed';report.error=e.message;console.error(e.message);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));if(bridge.exitCode===null){bridge.kill();await once(bridge,'exit');}console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,output}));}
