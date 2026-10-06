using System;
using System.IO;
using System.Collections.Generic;
namespace Paradize.Editor {
 [Serializable] public sealed class CharacterWeightReference {
  [Serializable] public sealed class Artifact {public string path;public long bytes;public string sha256;}
  [Serializable] public sealed class Position {public float x,y,z;}
  [Serializable] public sealed class Weight {public string bone;public float value;}
  [Serializable] public sealed class Vertex {public Position position;public Weight[] weights;}
  [Serializable] public sealed class Mesh {public string role,name;public int vertexCount;public Vertex[] vertices;}
  public int schemaVersion;public string profile,coordinateSpace,generatorSha256;
  public Artifact[] artifacts;public string[] deformBones;public Mesh[] meshes;
  public bool runtimeQualified,sourceWeightsAdjusted;
  static void Require(bool value){if(!value)throw new InvalidDataException("CHARACTER_WEIGHT_REFERENCE_INVALID");}
  static bool Finite(float value){return !float.IsNaN(value)&&!float.IsInfinity(value);}
  static bool Name(string value){if(string.IsNullOrEmpty(value)||value.Length>256)return false;foreach(char c in value)if(char.IsControl(c))return false;return true;}
  static bool Hash(string value){if(value==null||value.Length!=64)return false;foreach(char c in value)if(!(c>='0'&&c<='9'||c>='a'&&c<='f'))return false;return true;}
  // Semantic validation only. Caller must parse an externally hash-bound snapshot.
  public void Validate(){
   Require(schemaVersion==1&&profile=="makehuman-dressed-weight-reference-v1"&&coordinateSpace=="Blender-world-Z-up"&&!runtimeQualified&&!sourceWeightsAdjusted&&Hash(generatorSha256));
   Require(artifacts!=null&&artifacts.Length==2);var paths=new HashSet<string>(StringComparer.Ordinal);
   foreach(var a in artifacts){Require(a!=null);Require((a.path=="human-candidate.blend"||a.path=="human-candidate.fbx")&&paths.Add(a.path)&&a.bytes>0&&a.bytes<=512L*1024*1024&&Hash(a.sha256));}
   Require(deformBones!=null&&deformBones.Length>0&&deformBones.Length<=128);var bones=new HashSet<string>(StringComparer.Ordinal);
   foreach(var bone in deformBones)Require(Name(bone)&&bones.Add(bone));
   Require(meshes!=null&&meshes.Length==5);var roles=new HashSet<string>(StringComparer.Ordinal){"body","clothing","footwear","hair","eyes"};var names=new HashSet<string>(StringComparer.Ordinal);long total=0;
   foreach(var mesh in meshes){
    Require(mesh!=null);Require(roles.Remove(mesh.role)&&Name(mesh.name)&&names.Add(mesh.name)&&mesh.vertexCount>0&&mesh.vertexCount<=200000&&mesh.vertices!=null&&mesh.vertices.Length==mesh.vertexCount);
    total+=mesh.vertexCount;Require(total<=500000);
    foreach(var vertex in mesh.vertices){
     Require(vertex!=null&&vertex.position!=null);var p=vertex.position;Require(Finite(p.x)&&Finite(p.y)&&Finite(p.z));
     Require(vertex.weights!=null&&vertex.weights.Length>0&&vertex.weights.Length<=8);var used=new HashSet<string>(StringComparer.Ordinal);double sum=0;
     foreach(var w in vertex.weights){Require(w!=null);Require(w.bone!=null&&bones.Contains(w.bone)&&used.Add(w.bone)&&Finite(w.value)&&w.value>0&&w.value<=1);sum+=w.value;}
     Require(Math.Abs(sum-1)<=0.0001);
    }
   }
   Require(roles.Count==0);
  }
 }
}
