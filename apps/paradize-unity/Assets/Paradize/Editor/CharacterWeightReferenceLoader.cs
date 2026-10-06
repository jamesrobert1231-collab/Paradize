using UnityEngine;
namespace Paradize.Editor {
 public static class CharacterWeightReferenceLoader {
  public sealed class LoadedBundle {
   public readonly CharacterWeightReference Reference;
   public readonly CharacterArtifactBundle Artifacts;
   internal LoadedBundle(CharacterWeightReference reference,CharacterArtifactBundle artifacts){Reference=reference;Artifacts=artifacts;}
  }
  public static LoadedBundle LoadBundle(string path,long reviewedBytes,string reviewedSha256){
   var reference=Load(path,reviewedBytes,reviewedSha256);
   var artifacts=CharacterArtifactBundle.Read(System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(path)),reference.artifacts);
   return new LoadedBundle(reference,artifacts);
  }
  // Caller supplies reviewed reference identity. Artifact identities still need separate verification.
  public static CharacterWeightReference Load(string path,long reviewedBytes,string reviewedSha256){
   var snapshot=CharacterArtifactIntegrity.ReadVerified(path,reviewedBytes,reviewedSha256);
   string text=CharacterReferenceJson.ValidateReference(snapshot);
   var reference=JsonUtility.FromJson<CharacterWeightReference>(text);
   if(reference==null)throw new System.IO.InvalidDataException("CHARACTER_WEIGHT_REFERENCE_INVALID");
   reference.Validate();return reference;
  }
 }
}
