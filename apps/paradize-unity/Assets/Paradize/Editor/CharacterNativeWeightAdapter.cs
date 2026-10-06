using System;
using System.IO;
using System.Collections.Generic;
using UnityEngine;
using Unity.Collections;
namespace Paradize.Editor {
 public static class CharacterNativeWeightAdapter {
  // Caller must use an instance imported from the verified FBX snapshot, in its neutral transform.
  // Returns an owned derived mesh. Never assigns a renderer or writes an asset.
  public static Mesh BuildDerivedMesh(SkinnedMeshRenderer renderer,CharacterWeightReference.Mesh source){
   if(renderer==null||source==null||renderer.name!=source.name||renderer.sharedMesh==null||!renderer.sharedMesh.isReadable)
    throw new InvalidDataException("CHARACTER_NATIVE_WEIGHT_INPUT_INVALID");
   var original=renderer.sharedMesh;var positions=original.vertices;var bones=renderer.bones;
   if(positions.Length==0||positions.Length>250000||bones.Length==0||bones.Length>128||original.bindposes.Length!=bones.Length)
    throw new InvalidDataException("CHARACTER_NATIVE_WEIGHT_INPUT_INVALID");
   var indices=new Dictionary<string,int>(StringComparer.Ordinal);
   for(int i=0;i<bones.Length;i++)if(bones[i]==null||indices.ContainsKey(bones[i].name))throw new InvalidDataException("CHARACTER_NATIVE_WEIGHT_BONES_INVALID");else indices.Add(bones[i].name,i);
   var matcher=new CharacterSourceWeightMatcher(source);var counts=new byte[positions.Length];var weights=new List<BoneWeight1>();
   for(int i=0;i<positions.Length;i++){
    Vector3 point=renderer.transform.TransformPoint(positions[i]);
    var prepared=CharacterWeightPrecision.Prepare(matcher.Match(-point.x,-point.z,point.y));counts[i]=(byte)prepared.Length;
    foreach(var weight in prepared){int index;if(!indices.TryGetValue(weight.bone,out index))throw new InvalidDataException("CHARACTER_NATIVE_WEIGHT_BONES_INVALID");weights.Add(new BoneWeight1{boneIndex=index,weight=weight.value});}
   }
   Mesh derived=null;
   try{
    derived=UnityEngine.Object.Instantiate(original);
    using(var nativeCounts=new NativeArray<byte>(counts,Allocator.Temp))using(var nativeWeights=new NativeArray<BoneWeight1>(weights.ToArray(),Allocator.Temp))derived.SetBoneWeights(nativeCounts,nativeWeights);
    var storedCounts=derived.GetBonesPerVertex();var storedWeights=derived.GetAllBoneWeights();int cursor=0;
    for(int i=0;i<counts.Length;i++){
     if(storedCounts[i]!=counts[i])throw new InvalidDataException("CHARACTER_NATIVE_WEIGHT_RETENTION_FAILED");
     int seen=0;
     for(int j=0;j<counts[i];j++){var actual=storedWeights[cursor+j];bool matched=false;if(actual.weight<=0||float.IsNaN(actual.weight)||float.IsInfinity(actual.weight))throw new InvalidDataException("CHARACTER_NATIVE_WEIGHT_RETENTION_FAILED");for(int k=0;k<counts[i];k++){var expected=weights[cursor+k];if(actual.boneIndex==expected.boneIndex&&(seen&(1<<k))==0&&Math.Abs(actual.weight-expected.weight)<=.0001f){seen|=1<<k;matched=true;break;}}if(!matched)throw new InvalidDataException("CHARACTER_NATIVE_WEIGHT_RETENTION_FAILED");}
     cursor+=counts[i];
    }
    if(cursor!=storedWeights.Length)throw new InvalidDataException("CHARACTER_NATIVE_WEIGHT_RETENTION_FAILED");
    return derived;
   }catch{if(derived!=null)UnityEngine.Object.DestroyImmediate(derived);throw;}
  }
 }
}
