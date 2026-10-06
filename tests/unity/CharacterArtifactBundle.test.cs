using System;
using System.IO;
using System.Security.Cryptography;
using Paradize.Editor;
public static class CharacterArtifactBundleTests {
 static string Hash(byte[] data){using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(data)).Replace("-","").ToLowerInvariant();}
 static void Reject(Action action){bool failed=false;try{action();}catch(InvalidDataException){failed=true;}if(!failed)throw new Exception("Invalid bundle accepted");}
 public static int Run(string directory){
  if(Directory.Exists(directory))throw new Exception("Fresh fixture directory required");Directory.CreateDirectory(directory);
  var blend=new byte[]{1,2,3};var fbx=new byte[]{4,5,6};
  string blendPath=Path.Combine(directory,"human-candidate.blend"),fbxPath=Path.Combine(directory,"human-candidate.fbx");File.WriteAllBytes(blendPath,blend);File.WriteAllBytes(fbxPath,fbx);
  var a=new CharacterWeightReference.Artifact{path="human-candidate.blend",bytes=3,sha256=Hash(blend)};var b=new CharacterWeightReference.Artifact{path="human-candidate.fbx",bytes=3,sha256=Hash(fbx)};
  var snapshot=CharacterArtifactBundle.Read(directory,new[]{a,b});if(snapshot.Blend[0]!=1||snapshot.Fbx[0]!=4)throw new Exception("Bundle contents incorrect");
  var reversed=CharacterArtifactBundle.Read(directory,new[]{b,a});if(reversed.Blend[0]!=1||reversed.Fbx[0]!=4)throw new Exception("Bundle order changes identity");
  Reject(()=>CharacterArtifactBundle.Read(directory,new[]{a,a}));Reject(()=>CharacterArtifactBundle.Read(directory,new[]{a}));Reject(()=>CharacterArtifactBundle.Read(directory,null));
  string original=b.path;b.path="../human-candidate.fbx";Reject(()=>CharacterArtifactBundle.Read(directory,new[]{a,b}));b.path=original;
  b.bytes=128L*1024*1024+1;Reject(()=>CharacterArtifactBundle.Read(directory,new[]{a,b}));b.bytes=3;
  File.WriteAllBytes(fbxPath,new byte[]{7,8,9});Reject(()=>CharacterArtifactBundle.Read(directory,new[]{a,b}));if(snapshot.Fbx[0]!=4)throw new Exception("Source replacement changes snapshot");
  return 9;
 }
}
