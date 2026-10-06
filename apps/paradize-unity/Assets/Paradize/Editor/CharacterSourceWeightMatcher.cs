using System;
using System.IO;
using System.Collections.Generic;
namespace Paradize.Editor {
 public sealed class CharacterSourceWeightMatcher {
  struct Cell:IEquatable<Cell>{public long x,y,z;public bool Equals(Cell b){return x==b.x&&y==b.y&&z==b.z;}public override bool Equals(object b){return b is Cell&&Equals((Cell)b);}public override int GetHashCode(){unchecked{return x.GetHashCode()*397^y.GetHashCode()*31^z.GetHashCode();}}}
  sealed class Row {public float x,y,z;public CharacterWeightReference.Weight[] weights;}
  readonly Dictionary<Cell,List<Row>> cells=new Dictionary<Cell,List<Row>>();
  public const double PositionTolerance=.000002;
  static void Require(bool ok){if(!ok)throw new InvalidDataException("CHARACTER_SOURCE_WEIGHT_MATCH_INVALID");}
  static Cell Key(float x,float y,float z){
   Require(!float.IsNaN(x)&&!float.IsInfinity(x)&&!float.IsNaN(y)&&!float.IsInfinity(y)&&!float.IsNaN(z)&&!float.IsInfinity(z)&&Math.Abs((double)x)<=1e12&&Math.Abs((double)y)<=1e12&&Math.Abs((double)z)<=1e12);
   return new Cell{x=(long)Math.Round((double)x*100000),y=(long)Math.Round((double)y*100000),z=(long)Math.Round((double)z*100000)};
  }
  static CharacterWeightReference.Weight[] Copy(CharacterWeightReference.Weight[] weights){
   Require(weights!=null&&weights.Length>=1&&weights.Length<=8);var result=new CharacterWeightReference.Weight[weights.Length];var names=new HashSet<string>(StringComparer.Ordinal);double sum=0;
   for(int i=0;i<weights.Length;i++){var w=weights[i];Require(w!=null);var copy=new CharacterWeightReference.Weight{bone=w.bone,value=w.value};Require(!string.IsNullOrEmpty(copy.bone)&&copy.bone.Length<=256&&names.Add(copy.bone)&&!float.IsNaN(copy.value)&&!float.IsInfinity(copy.value)&&copy.value>0&&copy.value<=1);sum+=copy.value;result[i]=copy;}
   Require(Math.Abs(sum-1)<=.0001);Array.Sort(result,(a,b)=>StringComparer.Ordinal.Compare(a.bone,b.bone));return result;
  }
  static bool Same(CharacterWeightReference.Weight[] a,CharacterWeightReference.Weight[] b){if(a.Length!=b.Length)return false;for(int i=0;i<a.Length;i++)if(a[i].bone!=b[i].bone||a[i].value!=b[i].value)return false;return true;}
  public CharacterSourceWeightMatcher(CharacterWeightReference.Mesh source){
   Require(source!=null&&source.vertices!=null&&source.vertexCount>0&&source.vertexCount<=200000&&source.vertices.Length==source.vertexCount);
   foreach(var vertex in source.vertices){Require(vertex!=null&&vertex.position!=null);var p=vertex.position;var row=new Row{x=p.x,y=p.y,z=p.z,weights=Copy(vertex.weights)};var key=Key(row.x,row.y,row.z);List<Row> bucket;if(!cells.TryGetValue(key,out bucket)){bucket=new List<Row>();cells.Add(key,bucket);}bool duplicate=false;foreach(var existing in bucket)if(existing.x==row.x&&existing.y==row.y&&existing.z==row.z){Require(Same(existing.weights,row.weights));duplicate=true;break;}if(!duplicate){Require(bucket.Count<64);bucket.Add(row);}}
  }
  // Coordinates are already transformed into the reference's Blender-world-Z-up space.
  public CharacterWeightReference.Weight[] Match(float x,float y,float z){
   Cell q=Key(x,y,z);Row found=null;
   for(int dx=-1;dx<=1;dx++)for(int dy=-1;dy<=1;dy++)for(int dz=-1;dz<=1;dz++){
    List<Row> bucket;if(!cells.TryGetValue(new Cell{x=q.x+dx,y=q.y+dy,z=q.z+dz},out bucket))continue;
    foreach(var row in bucket)if(Math.Abs((double)x-row.x)<=PositionTolerance&&Math.Abs((double)y-row.y)<=PositionTolerance&&Math.Abs((double)z-row.z)<=PositionTolerance){Require(found==null||Same(found.weights,row.weights));found=row;}
   }
   Require(found!=null);return Copy(found.weights);
  }
 }
}
