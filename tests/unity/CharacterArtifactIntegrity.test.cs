using System;
using System.IO;
using System.Security.Cryptography;
using Paradize.Editor;
public static class CharacterArtifactIntegrityTests {
    static void Reject(Action action, string code) {
        try { action(); } catch (InvalidDataException e) {
            if (e.Message == code) return;
            throw;
        }
        throw new Exception("Invalid artifact was accepted");
    }
    public static int Run(string directory) {
        if (Directory.Exists(directory)) throw new Exception("Fresh test directory required");
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, "fixture.bin");
        var bytes = new byte[65537];
        for (int i = 0; i < bytes.Length; i++) bytes[i] = (byte)(i % 251);
        File.WriteAllBytes(path, bytes);
        string digest;
        using (var hash = SHA256.Create()) digest = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        CharacterArtifactIntegrity.Verify(path, bytes.Length, digest);
        var snapshot = CharacterArtifactIntegrity.ReadVerified(path, bytes.Length, digest);
        for (int i=0;i<bytes.Length;i++) if(snapshot[i]!=bytes[i]) throw new Exception("Verified snapshot differs");
        Reject(() => CharacterArtifactIntegrity.ReadVerified(path, 128L*1024*1024+1, digest), "CHARACTER_ARTIFACT_EXPECTATION_INVALID");
        Reject(() => CharacterArtifactIntegrity.Verify(path, bytes.Length + 1, digest), "CHARACTER_ARTIFACT_SIZE_MISMATCH");
        Reject(() => CharacterArtifactIntegrity.Verify(path, bytes.Length - 1, digest), "CHARACTER_ARTIFACT_SIZE_MISMATCH");
        Reject(() => CharacterArtifactIntegrity.Verify(path, 0, digest), "CHARACTER_ARTIFACT_EXPECTATION_INVALID");
        Reject(() => CharacterArtifactIntegrity.Verify(path, -1, digest), "CHARACTER_ARTIFACT_EXPECTATION_INVALID");
        Reject(() => CharacterArtifactIntegrity.Verify(path, 512L*1024*1024+1, digest), "CHARACTER_ARTIFACT_EXPECTATION_INVALID");
        Reject(() => CharacterArtifactIntegrity.Verify(path, bytes.Length, null), "CHARACTER_ARTIFACT_EXPECTATION_INVALID");
        Reject(() => CharacterArtifactIntegrity.Verify(path, bytes.Length, "invalid"), "CHARACTER_ARTIFACT_EXPECTATION_INVALID");
        Reject(() => CharacterArtifactIntegrity.Verify(path, bytes.Length, new string('g',64)), "CHARACTER_ARTIFACT_EXPECTATION_INVALID");
        bytes[0] ^= 1; File.WriteAllBytes(path, bytes);
        if (snapshot[0] == bytes[0]) throw new Exception("Disk replacement altered verified snapshot");
        Reject(() => CharacterArtifactIntegrity.Verify(path, bytes.Length, digest), "CHARACTER_ARTIFACT_HASH_MISMATCH");
        Reject(() => CharacterArtifactIntegrity.Verify(directory, 1, digest), "CHARACTER_ARTIFACT_PATH_INVALID");
        return 14;
    }
}
