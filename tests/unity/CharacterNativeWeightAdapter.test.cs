using System;
using System.IO;
using UnityEngine;
using Paradize.Editor;
public static class CharacterNativeWeightAdapterTests {
 static CharacterWeightReference.Weight W(string bone,float weight){return new CharacterWeightReference.Weight{bone=bone,value=weight};}
 public static int Run(){
  var owner=new GameObject("Fixture");Mesh original=new Mesh(),derived=null;
  try{
   var renderer=owner.AddComponent<SkinnedMeshRenderer>();var bones=new Transform[5];var names=new[]{"Main","TinyB","TinyA","TinyD","TinyC"};for(int i=0;i<5;i++){bones[i]=new GameObject(names[i]).transform;bones[i].SetParent(owner.transform,false);}
   original.vertices=new[]{Vector3.zero,Vector3.right,Vector3.up};original.triangles=new[]{0,1,2};original.bindposes=new[]{Matrix4x4.identity,Matrix4x4.identity,Matrix4x4.identity,Matrix4x4.identity,Matrix4x4.identity};original.boneWeights=new[]{new BoneWeight{weight0=1},new BoneWeight{weight0=1},new BoneWeight{weight0=1}};renderer.sharedMesh=original;renderer.bones=bones;renderer.rootBone=bones[0];
   var source=new CharacterWeightReference.Mesh{name="Fixture",vertexCount=3,vertices=new CharacterWeightReference.Vertex[3]};for(int i=0;i<3;i++){var p=original.vertices[i];source.vertices[i]=new CharacterWeightReference.Vertex{position=new CharacterWeightReference.Position{x=-p.x,y=-p.z,z=p.y},weights=new[]{W("Main",.99996f),W("TinyB",.00001f),W("TinyA",.00001f),W("TinyC",.00001f),W("TinyD",.00001f)}};}
   derived=CharacterNativeWeightAdapter.BuildDerivedMesh(renderer,source);if(derived==original||renderer.sharedMesh!=original||original.GetBonesPerVertex()[0]!=1||derived.GetBonesPerVertex()[0]!=5)throw new Exception("Mesh ownership or influence preservation failed");
   var positions=derived.vertices;for(int i=0;i<3;i++)if(positions[i]!=original.vertices[i])throw new Exception("Geometry changed");
   source.vertices[0].weights=new[]{W("MissingBone",1)};bool rejected=false;try{var unexpected=CharacterNativeWeightAdapter.BuildDerivedMesh(renderer,source);UnityEngine.Object.DestroyImmediate(unexpected);}catch(InvalidDataException){rejected=true;}if(!rejected||renderer.sharedMesh!=original)throw new Exception("Invalid bone input changed renderer");
   return 3;
  }finally{if(derived!=null)UnityEngine.Object.DestroyImmediate(derived);UnityEngine.Object.DestroyImmediate(original);UnityEngine.Object.DestroyImmediate(owner);}
 }
}
