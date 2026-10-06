using System;
using System.IO;
using System.Text;
using Paradize.Editor;
public static class CharacterReferenceJsonTests {
 public static int RunSchema(){
  string valid="{\"schemaVersion\":1,\"profile\":\"makehuman-dressed-weight-reference-v1\",\"coordinateSpace\":\"Blender-world-Z-up\",\"generatorSha256\":\""+new string('a',64)+"\",\"runtimeQualified\":false,\"sourceWeightsAdjusted\":false,\"artifacts\":[],\"deformBones\":[],\"meshes\":[]}";
  CharacterReferenceJson.ValidateReference(Encoding.UTF8.GetBytes(valid));
  var invalid=new[]{valid.Replace("\"schemaVersion\":1","\"schemaVersion\":1.0"),valid.Replace("\"runtimeQualified\":false,",""),valid.Replace("\"schemaVersion\":1","\"unknown\":0,\"schemaVersion\":1"),valid.Replace("\"sourceWeightsAdjusted\":false","\"sourceWeightsAdjusted\":null"),valid.Replace("\"artifacts\":[]","\"artifacts\":[{\"path\":\"x\",\"bytes\":1.5,\"sha256\":\"x\"}]"),valid.Replace("\"deformBones\":[]","\"deformBones\":[1]"),valid.Replace("\"meshes\":[]","\"meshes\":[{}]"),valid.Replace("\"profile\":","\"profile\":true,\"extra\":" )};
  foreach(var value in invalid){bool rejected=false;try{CharacterReferenceJson.ValidateReference(Encoding.UTF8.GetBytes(value));}catch(InvalidDataException){rejected=true;}if(!rejected)throw new Exception("Invalid schema shape accepted");}
  bool overflowRejected=false;try{CharacterReferenceJson.ValidateReference(Encoding.UTF8.GetBytes(valid.Replace("\"schemaVersion\":1","\"schemaVersion\":4294967297")));}catch(InvalidDataException){overflowRejected=true;}if(!overflowRejected)throw new Exception("DTO integer overflow accepted");
  var largeObject=new StringBuilder("{");for(int i=0;i<257;i++){if(i>0)largeObject.Append(',');largeObject.Append('"').Append(i).Append("\":0");}largeObject.Append('}');bool membersRejected=false;try{CharacterReferenceJson.Validate(Encoding.UTF8.GetBytes(largeObject.ToString()));}catch(InvalidDataException){membersRejected=true;}if(!membersRejected)throw new Exception("Object member cap ignored");
  return invalid.Length+3;
 }
 public static int Run(){
  var valid=new[]{"{}","[]","{\"value\":[true,false,null,-0,1.5e-3,\"\\ud83d\\ude00\"]}"};
  foreach(var value in valid)if(CharacterReferenceJson.Validate(Encoding.UTF8.GetBytes(value))!=value)throw new Exception("Valid JSON changed");
  var invalid=new[]{"{\"a\":1,\"a\":2}","{\"a\":1,\"\\u0061\":2}","[1,]","{\"a\":01}","{\"a\":NaN}","{\"a\":1e999}","{\"a\":\"\\ud800\"}","{}{}","[1.]","[+1]","[.1]","[1e]","[true false]","/*comment*/{}","\"\\x20\"","\"\\udc00\"",new string('[',34)+"0"+new string(']',34),"\""+new string('a',4097)+"\""};
  foreach(var value in invalid){bool rejected=false;try{CharacterReferenceJson.Validate(Encoding.UTF8.GetBytes(value));}catch(InvalidDataException){rejected=true;}if(!rejected)throw new Exception("Invalid JSON accepted");}
  bool badUtf8=false;try{CharacterReferenceJson.Validate(new byte[]{255});}catch(DecoderFallbackException){badUtf8=true;}if(!badUtf8)throw new Exception("Invalid UTF8 accepted");
  return valid.Length+invalid.Length+1;
 }
}
