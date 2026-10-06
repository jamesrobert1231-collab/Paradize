using System;
using System.IO;
using Paradize.Editor;
public static class CharacterWeightReferenceTests {
 static CharacterWeightReference Fixture(){
  var roles=new[]{"body","clothing","footwear","hair","eyes"};var meshes=new CharacterWeightReference.Mesh[5];
  for(int i=0;i<5;i++)meshes[i]=new CharacterWeightReference.Mesh{role=roles[i],name=roles[i],vertexCount=1,vertices=new[]{new CharacterWeightReference.Vertex{position=new CharacterWeightReference.Position(),weights=new[]{new CharacterWeightReference.Weight{bone="Hips",value=1}}}}};
  return new CharacterWeightReference{schemaVersion=1,profile="makehuman-dressed-weight-reference-v1",coordinateSpace="Blender-world-Z-up",generatorSha256=new string('a',64),deformBones=new[]{"Hips"},meshes=meshes,artifacts=new[]{new CharacterWeightReference.Artifact{path="human-candidate.blend",bytes=1,sha256=new string('b',64)},new CharacterWeightReference.Artifact{path="human-candidate.fbx",bytes=1,sha256=new string('c',64)}}};
 }
 public static int Run(){
  Fixture().Validate();
  Action<CharacterWeightReference>[] changes={
   r=>r.schemaVersion=2,r=>r.runtimeQualified=true,r=>r.sourceWeightsAdjusted=true,
   r=>r.artifacts[0].path="../source.blend",r=>r.artifacts[1].path=r.artifacts[0].path,
   r=>r.meshes[1].role=r.meshes[0].role,r=>r.meshes[1].name=r.meshes[0].name,
   r=>r.meshes[0].vertexCount=2,r=>r.meshes[0].vertices[0].position=null,
   r=>r.meshes[0].vertices[0].position.x=float.PositiveInfinity,
   r=>r.meshes[0].vertices[0].weights[0].value=float.NaN,
   r=>r.meshes[0].vertices[0].weights[0].value=.5f,
   r=>r.meshes[0].vertices[0].weights[0].bone="Unknown",
   r=>r.deformBones=new[]{"Hips","Hips"}
  };
  foreach(var change in changes){var r=Fixture();change(r);bool rejected=false;try{r.Validate();}catch(InvalidDataException){rejected=true;}if(!rejected)throw new Exception("Invalid reference accepted");}
  return changes.Length+1;
 }
}
