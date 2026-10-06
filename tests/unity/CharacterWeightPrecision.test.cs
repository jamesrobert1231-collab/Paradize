using System;
using System.IO;
using Paradize.Editor;
public static class CharacterWeightPrecisionTests {
 static CharacterWeightReference.Weight W(string name,float value){return new CharacterWeightReference.Weight{bone=name,value=value};}
 static void Reject(CharacterWeightReference.Weight[] value){bool failed=false;try{CharacterWeightPrecision.Prepare(value);}catch(InvalidDataException){failed=true;}if(!failed)throw new Exception("Invalid weights accepted");}
 public static int Run(){
  var source=new[]{W("Main",.99998f),W("TinyB",.00001f),W("TinyA",.00001f)};
  var result=CharacterWeightPrecision.Prepare(source);if(result.Length!=3||result[1].bone!="TinyA"||result[2].bone!="TinyB"||result[1].value!=CharacterWeightPrecision.NativePositiveFloor||source[1].value!=.00001f)throw new Exception("Influence or source preservation failed");
  double sum=0;foreach(var w in result)sum+=w.value;if(Math.Abs(sum-1)>.0000001)throw new Exception("Adjusted normalization changed");
  var again=CharacterWeightPrecision.Prepare(result);for(int i=0;i<3;i++)if(again[i].value!=result[i].value||again[i].bone!=result[i].bone)throw new Exception("Adjustment is not stable");
  var unequal=CharacterWeightPrecision.Prepare(new[]{W("Main",.999985f),W("Z",.00001f),W("A",.000005f)});var repeated=CharacterWeightPrecision.Prepare(unequal);for(int i=0;i<3;i++)if(unequal[i].bone!=repeated[i].bone||unequal[i].value!=repeated[i].value)throw new Exception("Floor-created tie changes order on repeat");
  Reject(null);Reject(new CharacterWeightReference.Weight[0]);Reject(new[]{W("A",float.NaN)});Reject(new[]{W("A",0)});Reject(new[]{W("A",.5f)});Reject(new[]{W("A",.5f),W("A",.5f)});
  var excessive=new CharacterWeightReference.Weight[8];excessive[0]=W("Main",.9999999f);for(int i=1;i<8;i++)excessive[i]=W("Tiny"+i,1e-8f);Reject(excessive);
  return 11;
 }
}
