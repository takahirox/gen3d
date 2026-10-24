// Reopen an existing live validation bundle with current preservation code.
// This consumes no Codex allowance and never modifies the saved scene/GLB.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runProcess } from '../src/codex.js';
import { fileHash } from '../src/workflow.js';
import { validateArtifacts } from '../src/runner.js';
const input=path.resolve(process.env.GEN3D_WORKFLOW_ARTIFACT_INPUT || '.gen3d/workflow-live-validation');
const output=path.resolve(process.env.GEN3D_WORKFLOW_ARTIFACT_OUTPUT || '.gen3d/workflow-artifact-check');
fs.mkdirSync(output,{recursive:true});
const live=JSON.parse(fs.readFileSync(path.join(input,'report.json'),'utf8')), cases=[];
for(const r of live.runs){
  const root=path.join(input,live.dataDirectory,r.projectId), v=r.candidate;
  const blend=path.join(root,v.artifacts.blend),glb=path.join(root,v.artifacts.glb);
  const metrics=validateArtifacts(path.dirname(blend));
  cases.push({runId:r.runId,projectId:r.projectId,versionId:v.id,blend,glb,metrics,base:v.editableBase?path.join(root,v.editableBase.blend):null,scope:v.editableBase?.scope,hashes:{blend:fileHash(blend),glb:fileHash(glb)}});
}
const script=path.join(output,'check.py');
fs.writeFileSync(script,`import bpy, sys, json, os
sys.path.insert(0, ${JSON.stringify(path.resolve('blender'))})
import preservation as p
cases=json.loads(${JSON.stringify(JSON.stringify(cases))})
results=[]
for i,c in enumerate(cases):
    result={'runId':c['runId'], 'metrics':c['metrics'], 'hashes':c['hashes']}
    if c['base']:
        p.open_base(c['base'])
        baseline=os.path.join(${JSON.stringify(output)}, str(i)+'-baseline.json')
        p.write(baseline,p.snapshot())
        result['preservation']=p.validate(baseline,c['scope'],c['blend'],c['glb'],os.path.join(${JSON.stringify(output)},str(i)+'-preservation.json'))
    else:
        bpy.ops.wm.open_mainfile(filepath=c['blend'], use_scripts=False)
        scene_meshes=sum(o.type=='MESH' for o in bpy.context.scene.objects)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=c['glb'], disable_bone_shape=True)
        result['reopened']={'sceneMeshes':scene_meshes,'glbMeshes':sum(o.type=='MESH' for o in bpy.context.scene.objects),'materials':len(bpy.data.materials)}
        assert result['reopened']['glbMeshes'] > 0
    results.append(result)
p.write(os.path.join(${JSON.stringify(output)},'report.json'),{'realBlender':True,'codexUsed':False,'cases':results})
`);
await runProcess(process.env.GEN3D_BLENDER_BIN || 'blender',['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',script],{timeout:180000});
for(const c of cases){assert.equal(fileHash(c.blend),c.hashes.blend);assert.equal(fileHash(c.glb),c.hashes.glb);}
console.log(JSON.stringify({realBlender:true,codexUsed:false,cases:cases.length,sourceArtifactsUnchanged:true,output}));
