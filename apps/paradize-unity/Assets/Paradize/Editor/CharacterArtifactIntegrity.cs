using System;
using System.IO;
using System.Security.Cryptography;
namespace Paradize.Editor {
    public static class CharacterArtifactIntegrity {
        // Expected values must come from reviewed provenance, never from the file being checked.
        public static void Verify(string path, long expectedBytes, string expectedSha256) {
            Read(path, expectedBytes, expectedSha256, false);
        }
        // Parse this owned snapshot directly; never reopen the path after verification.
        public static byte[] ReadVerified(string path, long expectedBytes, string expectedSha256) {
            if (expectedBytes > 128L * 1024 * 1024)
                throw new InvalidDataException("CHARACTER_ARTIFACT_EXPECTATION_INVALID");
            return Read(path, expectedBytes, expectedSha256, true);
        }
        static byte[] Read(string path, long expectedBytes, string expectedSha256, bool capture) {
            if (expectedBytes <= 0 || expectedBytes > 512L * 1024 * 1024 ||
                expectedSha256 == null || expectedSha256.Length != 64)
                throw new InvalidDataException("CHARACTER_ARTIFACT_EXPECTATION_INVALID");
            foreach (char c in expectedSha256)
                if (!(c >= '0' && c <= '9' || c >= 'a' && c <= 'f'))
                    throw new InvalidDataException("CHARACTER_ARTIFACT_EXPECTATION_INVALID");
            var file = new FileInfo(Path.GetFullPath(path));
            if ((file.Attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
                throw new InvalidDataException("CHARACTER_ARTIFACT_PATH_INVALID");
            for (var parent = file.Directory; parent != null; parent = parent.Parent)
                if ((parent.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("CHARACTER_ARTIFACT_PATH_INVALID");
            using (var stream = new FileStream(file.FullName, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var hash = SHA256.Create()) {
                if (stream.Length != expectedBytes) throw new InvalidDataException("CHARACTER_ARTIFACT_SIZE_MISMATCH");
                var snapshot = capture ? new byte[(int)expectedBytes] : null;
                var buffer = new byte[65536]; long count = 0; int read;
                while ((read = stream.Read(buffer, 0, buffer.Length)) != 0) {
                    count += read;
                    if (count > expectedBytes) throw new InvalidDataException("CHARACTER_ARTIFACT_SIZE_MISMATCH");
                    if (capture) Buffer.BlockCopy(buffer, 0, snapshot, (int)(count-read), read);
                    hash.TransformBlock(buffer, 0, read, buffer, 0);
                }
                hash.TransformFinalBlock(new byte[0], 0, 0);
                if (count != expectedBytes || BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant() != expectedSha256)
                    throw new InvalidDataException("CHARACTER_ARTIFACT_HASH_MISMATCH");
                return snapshot;
            }
        }
    }
}
