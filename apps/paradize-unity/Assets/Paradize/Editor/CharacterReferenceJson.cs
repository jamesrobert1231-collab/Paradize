using System;
using System.IO;
using System.Text;
using System.Globalization;
using System.Collections.Generic;
namespace Paradize.Editor {
 // Syntax validation before DTO decoding; semantic/schema validation remains separate.
 public static class CharacterReferenceJson {
  public static string Validate(byte[] snapshot){return Read(snapshot,null);}
  public static string ValidateReference(byte[] snapshot){return Read(snapshot,"root");}
  static string Read(byte[] snapshot,string shape){
   if(snapshot==null||snapshot.Length==0||snapshot.Length>128*1024*1024)throw new InvalidDataException("CHARACTER_REFERENCE_JSON_INVALID");
   string text=new UTF8Encoding(false,true).GetString(snapshot);var reader=new Reader(text);reader.Value(0,shape);reader.Space();reader.Require(reader.index==text.Length);return text;
  }
  static readonly Dictionary<string,Dictionary<string,string>> Shapes=new Dictionary<string,Dictionary<string,string>> {
   {"root",new Dictionary<string,string>{{"schemaVersion","integer"},{"profile","string"},{"coordinateSpace","string"},{"artifacts","artifact[]"},{"deformBones","string[]"},{"meshes","mesh[]"},{"runtimeQualified","bool"},{"sourceWeightsAdjusted","bool"},{"generatorSha256","string"}}},
   {"artifact",new Dictionary<string,string>{{"path","string"},{"bytes","integer"},{"sha256","string"}}},
   {"mesh",new Dictionary<string,string>{{"role","string"},{"name","string"},{"vertexCount","integer"},{"vertices","vertex[]"}}},
   {"vertex",new Dictionary<string,string>{{"position","position"},{"weights","weight[]"}}},
   {"position",new Dictionary<string,string>{{"x","number"},{"y","number"},{"z","number"}}},
   {"weight",new Dictionary<string,string>{{"bone","string"},{"value","number"}}}
  };
  sealed class Reader {
   readonly string text;public int index;int nodes,vertices;
   public Reader(string value){text=value;}
   public void Require(bool value){if(!value)throw new InvalidDataException("CHARACTER_REFERENCE_JSON_INVALID");}
   public void Space(){while(index<text.Length&&(text[index]==' '||text[index]=='\t'||text[index]=='\r'||text[index]=='\n'))index++;}
   bool Take(char c){if(index<text.Length&&text[index]==c){index++;return true;}return false;}
   void Literal(string value){foreach(char c in value)Require(Take(c));}
   static bool Digit(char c){return c>='0'&&c<='9';}
   string String(){
    Require(Take('"'));var result=new StringBuilder();bool closed=false;
    while(index<text.Length){char c=text[index++];if(c=='"'){closed=true;break;}Require(c>=32);
     if(c=='\\'){Require(index<text.Length);c=text[index++];switch(c){
      case '"':case '\\':case '/':break;
      case 'b':c='\b';break;case 'f':c='\f';break;case 'n':c='\n';break;case 'r':c='\r';break;case 't':c='\t';break;
      case 'u':Require(index+4<=text.Length);int code;Require(int.TryParse(text.Substring(index,4),NumberStyles.AllowHexSpecifier,CultureInfo.InvariantCulture,out code));index+=4;c=(char)code;break;
      default:Require(false);break;
     }}result.Append(c);Require(result.Length<=4096);
    }
    Require(closed);string value=result.ToString();for(int i=0;i<value.Length;i++){if(char.IsHighSurrogate(value[i])){Require(i+1<value.Length&&char.IsLowSurrogate(value[i+1]));i++;}else Require(!char.IsLowSurrogate(value[i]));}return value;
   }
   void Number(bool integer=false){
    int start=index;Take('-');Require(index<text.Length);
    if(!Take('0')){Require(text[index]>='1'&&text[index]<='9');while(index<text.Length&&Digit(text[index]))index++;}
    if(Take('.')){int begin=index;while(index<text.Length&&Digit(text[index]))index++;Require(index>begin);}
    if(Take('e')||Take('E')){if(!Take('+'))Take('-');int begin=index;while(index<text.Length&&Digit(text[index]))index++;Require(index>begin);}
    Require(index-start<=64);string token=text.Substring(start,index-start);Require(!integer||token.IndexOfAny(new[]{'.','e','E'})<0);if(integer){long whole;Require(long.TryParse(token,NumberStyles.AllowLeadingSign,CultureInfo.InvariantCulture,out whole)&&whole>=0&&whole<=512L*1024*1024);}double value;Require(double.TryParse(token,NumberStyles.Float,CultureInfo.InvariantCulture,out value)&&!double.IsNaN(value)&&!double.IsInfinity(value));
   }
   public void Value(int depth,string shape=null){
    Require(depth<=32&&++nodes<=8000000);Space();Require(index<text.Length);char c=text[index];
    Dictionary<string,string> fields=null;bool array=shape!=null&&shape.EndsWith("[]",StringComparison.Ordinal);
    if(shape!=null){if(Shapes.TryGetValue(shape,out fields))Require(c=='{');else if(array)Require(c=='[');else if(shape=="string")Require(c=='"');else if(shape=="bool")Require(c=='t'||c=='f');else {Require(shape=="integer"||shape=="number");Require(c=='-'||Digit(c));}}
    if(c=='"'){String();return;}
    if(Take('{')){Space();if(Take('}')){Require(fields==null||fields.Count==0);return;}var keys=new HashSet<string>(StringComparer.Ordinal);while(true){Space();Require(index<text.Length&&text[index]=='"');string key=String();Require(keys.Add(key)&&keys.Count<=256);string child=null;if(fields!=null)Require(fields.TryGetValue(key,out child));Space();Require(Take(':'));Value(depth+1,child);Space();if(Take('}')){Require(fields==null||keys.Count==fields.Count);return;}Require(Take(','));}}
    if(Take('[')){Space();if(Take(']'))return;int count=0;int limit=shape=="vertex[]"?200000:shape=="weight[]"?8:shape=="mesh[]"?5:shape=="artifact[]"?2:shape=="string[]"?128:8000000;while(true){Require(++count<=limit);if(shape=="vertex[]")Require(++vertices<=500000);Value(depth+1,array?shape.Substring(0,shape.Length-2):null);Space();if(Take(']'))return;Require(Take(','));}}
    if(c=='t'){Literal("true");return;}if(c=='f'){Literal("false");return;}if(c=='n'){Literal("null");return;}Number(shape=="integer");
   }
  }
 }
}
