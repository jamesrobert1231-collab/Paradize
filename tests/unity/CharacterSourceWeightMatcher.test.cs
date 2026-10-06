using System;
using System.IO;
using Paradize.Editor;
public static class CharacterSourceWeightMatcherTests {
 static CharacterWeightReference.Vertex V(float x,string bone){return new CharacterWeightReference.Vertex{position=new CharacterWeightReference.Position{x=x},weights=new[]{new CharacterWeightReference.Weight{bone=bone,value=1}}};}
 static CharacterWeightReference.Mesh M(params CharacterWeightReference.Vertex[] vertices){return new CharacterWeightReference.Mesh{vertexCount=vertices.Length,vertices=vertices};}
 static void Reject(Action action){bool failed=false;try{action();}catch(InvalidDataException){failed=true;}if(!failed)throw new Exception("Invalid match accepted");}
 public static int Run(){
  var vertex=V(.0000049f,"A");var matcher=new CharacterSourceWeightMatcher(M(vertex));
  if(matcher.Match(.0000051f,0,0)[0].bone!="A")throw new Exception("Adjacent grid match failed");
  var first=matcher.Match(.0000049f,0,0);first[0].bone="Changed";vertex.weights[0].bone="SourceChanged";if(matcher.Match(.0000049f,0,0)[0].bone!="A")throw new Exception("Matcher is not isolated");
  new CharacterSourceWeightMatcher(M(V(0,"A"),V(0,"A"))).Match(0,0,0);
  Reject(()=>new CharacterSourceWeightMatcher(M(V(0,"A"),V(0,"B"))));
  var ambiguous=new CharacterSourceWeightMatcher(M(V(0,"A"),V(.000001f,"B")));Reject(()=>ambiguous.Match(.0000005f,0,0));
  Reject(()=>matcher.Match(1,0,0));Reject(()=>matcher.Match(float.NaN,0,0));Reject(()=>new CharacterSourceWeightMatcher(M(V(float.PositiveInfinity,"A"))));
  return 8;
 }
}
