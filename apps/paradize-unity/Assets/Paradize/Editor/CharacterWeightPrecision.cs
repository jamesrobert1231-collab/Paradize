using System;
using System.IO;
using System.Collections.Generic;
namespace Paradize.Editor {
 public static class CharacterWeightPrecision {
  public const float NativePositiveFloor=1f/65535f;
  public const float MaximumAdjustment=.0001f;
  static void Require(bool value){if(!value)throw new InvalidDataException("CHARACTER_WEIGHT_PRECISION_INVALID");}
  // Derived runtime copy only. Never adjust source reference weights in place.
  public static CharacterWeightReference.Weight[] Prepare(CharacterWeightReference.Weight[] source){
   Require(source!=null&&source.Length>=1&&source.Length<=8);
   var result=new CharacterWeightReference.Weight[source.Length];var names=new HashSet<string>(StringComparer.Ordinal);double sum=0;
   for(int i=0;i<source.Length;i++){
    var item=source[i];Require(item!=null);
    var copy=new CharacterWeightReference.Weight{bone=item.bone,value=item.value};
    Require(!string.IsNullOrEmpty(copy.bone)&&copy.bone.Length<=256&&names.Add(copy.bone));foreach(char c in copy.bone)Require(!char.IsControl(c));
    Require(!float.IsNaN(copy.value)&&!float.IsInfinity(copy.value)&&copy.value>0&&copy.value<=1);
    sum+=copy.value;result[i]=copy;
   }
   Require(Math.Abs(sum-1)<=MaximumAdjustment);
   Array.Sort(result,(a,b)=>{int value=b.value.CompareTo(a.value);return value!=0?value:StringComparer.Ordinal.Compare(a.bone,b.bone);});
   float delta=0;
   for(int i=1;i<result.Length;i++)if(result[i].value<NativePositiveFloor){delta+=NativePositiveFloor-result[i].value;result[i].value=NativePositiveFloor;}
   Require(delta<=MaximumAdjustment&&result[0].value>delta);result[0].value-=delta;
   Array.Sort(result,(a,b)=>{int value=b.value.CompareTo(a.value);return value!=0?value:StringComparer.Ordinal.Compare(a.bone,b.bone);});
   return result;
  }
 }
}
