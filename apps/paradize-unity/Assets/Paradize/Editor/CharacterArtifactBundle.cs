using System;
using System.IO;
using System.Collections.Generic;
namespace Paradize.Editor {
 public sealed class CharacterArtifactBundle {
  public readonly byte[] Blend, Fbx;
  CharacterArtifactBundle(byte[] blend,byte[] fbx){Blend=blend;Fbx=fbx;}
  struct Expected {public string name,hash;public long size;}
  public static CharacterArtifactBundle Read(string directory,CharacterWeightReference.Artifact[] artifacts){
   if(artifacts==null||artifacts.Length!=2)throw new InvalidDataException("CHARACTER_ARTIFACT_BUNDLE_INVALID");
   var seen=new HashSet<string>(StringComparer.Ordinal);var expected=new Expected[2];
   for(int i=0;i<2;i++){
    var artifact=artifacts[i];if(artifact==null)throw new InvalidDataException("CHARACTER_ARTIFACT_BUNDLE_INVALID");
    expected[i]=new Expected{name=artifact.path,size=artifact.bytes,hash=artifact.sha256};
    if((expected[i].name!="human-candidate.blend"&&expected[i].name!="human-candidate.fbx")||!seen.Add(expected[i].name)||expected[i].size<=0||expected[i].size>128L*1024*1024)
     throw new InvalidDataException("CHARACTER_ARTIFACT_BUNDLE_INVALID");
   }
   string root=Path.GetFullPath(directory);byte[] blend=null,fbx=null;
   foreach(var value in expected){var snapshot=CharacterArtifactIntegrity.ReadVerified(Path.Combine(root,value.name),value.size,value.hash);if(value.name=="human-candidate.blend")blend=snapshot;else fbx=snapshot;}
   return new CharacterArtifactBundle(blend,fbx);
  }
 }
}
