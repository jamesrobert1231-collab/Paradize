using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Paradize.World;

namespace Paradize.Editor
{
    /// <summary>
    /// Bounded editor acceptance checks. Uses isolated preview scenes and releases
    /// each generated fixture before creating the next; never changes the user's scene.
    /// Run after IslandBuild.CreateScene has saved the production scene/resources.
    /// </summary>
    public static class IslandValidation
    {
        private const string SavedScenePath = "Assets/Paradize/Scenes/ParadizeIsland.unity";

        [MenuItem("PARADIZE/Verify island generation and persistence")]
        public static void RunVerification()
        {
            var report = new VerificationReport { utc = DateTime.UtcNow.ToString("O"), seed = IslandGenerator.DefaultSeed };
            var elapsed = Stopwatch.StartNew();
            try
            {
                Fingerprint first = GenerateAndInspect(IslandGenerator.DefaultSeed);
                report.sameSeedFirst = first.hash;
                report.uniqueMeshes = first.meshes;
                report.vertices = first.vertices;
                report.triangles = first.triangles;
                report.passed.Add("Every generated mesh has finite vertices, valid bounds and in-range triangle indices.");
                report.passed.Add("All seven districts are above 6.8 metres; owner arrival is above the terrain.");

                Fingerprint repeated = GenerateAndInspect(IslandGenerator.DefaultSeed);
                report.sameSeedRepeated = repeated.hash;
                Require(first.hash == repeated.hash, "Repeated seed changed generated mesh data.");
                report.passed.Add("Repeated seed produces the same SHA-256 of all generated mesh vertices, UVs, normals and triangles.");

                Fingerprint different = GenerateAndInspect(IslandGenerator.DefaultSeed + 1);
                report.differentSeed = different.hash;
                Require(first.hash != different.hash, "Different seed produced identical geometry.");
                report.passed.Add("Changing the seed changes generated geometry.");

                VerifySavedScene(report);
                report.success = true;
                UnityEngine.Debug.Log("PARADIZE_ISLAND_VALIDATION_PASS meshes=" + report.uniqueMeshes + " vertices=" + report.vertices +
                                      " triangles=" + report.triangles + " checks=" + report.passed.Count);
            }
            catch (Exception error)
            {
                report.failure = error.ToString();
                UnityEngine.Debug.LogError("PARADIZE_ISLAND_VALIDATION_FAILED " + error.Message);
                throw;
            }
            finally
            {
                elapsed.Stop();
                report.elapsedSeconds = elapsed.Elapsed.TotalSeconds;
                Directory.CreateDirectory("Temp");
                File.WriteAllText("Temp/ParadizeIslandVerification.json", JsonUtility.ToJson(report, true));
            }
        }

        private static Fingerprint GenerateAndInspect(int seed)
        {
            Scene preview = EditorSceneManager.NewPreviewScene();
            GameObject root = null;
            IslandGenerator generator = null;
            var resources = new List<UnityEngine.Object>();
            try
            {
                root = new GameObject("PARADIZE verification fixture");
                SceneManager.MoveGameObjectToScene(root, preview);
                generator = root.AddComponent<IslandGenerator>();
                generator.Generate(seed);
                foreach (UnityEngine.Object asset in generator.GeneratedAssets) resources.Add(asset);
                Require(generator.Seed == seed, "Generator did not retain the requested seed.");
                Require(generator.HasGeneratedIsland, "Generation produced no island root.");
                VerifyNavigation(generator);

                var result = new Fingerprint();
                using (SHA256 hash = SHA256.Create())
                using (var crypto = new CryptoStream(Stream.Null, hash, CryptoStreamMode.Write))
                using (var writer = new BinaryWriter(crypto))
                {
                    var unique = new HashSet<Mesh>();
                    foreach (MeshFilter filter in root.GetComponentsInChildren<MeshFilter>(true))
                    {
                        Require(filter.sharedMesh != null, "A generated renderer is missing its mesh: " + filter.name);
                        Mesh mesh = filter.sharedMesh;
                        if (!unique.Add(mesh)) continue;
                        InspectAndHashMesh(mesh, writer, ref result);
                    }
                    Require(result.meshes >= 7, "Missing expected island, vegetation or pavilion geometry.");
                    writer.Flush();
                    crypto.FlushFinalBlock();
                    result.hash = BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant();
                }
                return result;
            }
            finally
            {
                // Capture partial-generation resources too if an exception occurred during Generate.
                if (generator != null)
                    foreach (UnityEngine.Object asset in generator.GeneratedAssets)
                        if (!resources.Contains(asset)) resources.Add(asset);
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
                foreach (UnityEngine.Object resource in resources)
                    if (resource != null && !AssetDatabase.Contains(resource)) UnityEngine.Object.DestroyImmediate(resource);
                EditorSceneManager.ClosePreviewScene(preview);
            }
        }

        private static void InspectAndHashMesh(Mesh mesh, BinaryWriter writer, ref Fingerprint result)
        {
            Vector3[] vertices = mesh.vertices;
            Vector3[] normals = mesh.normals;
            Vector2[] uv = mesh.uv;
            Require(vertices.Length > 0, "Empty mesh: " + mesh.name);
            Require(normals.Length == vertices.Length, "Missing mesh normals: " + mesh.name);
            Require(uv.Length == vertices.Length, "Missing mesh UVs: " + mesh.name);
            Bounds bounds = mesh.bounds;
            Require(Finite(bounds.center) && Finite(bounds.size), "Non-finite mesh bounds: " + mesh.name);
            bounds.Expand(.02f);
            writer.Write(mesh.name);
            writer.Write(vertices.Length);
            for (int i = 0; i < vertices.Length; i++)
            {
                if (!Finite(vertices[i])) throw new InvalidOperationException("Non-finite vertex in " + mesh.name);
                if (!Finite(normals[i])) throw new InvalidOperationException("Non-finite normal in " + mesh.name);
                if (!Finite(uv[i].x) || !Finite(uv[i].y)) throw new InvalidOperationException("Non-finite UV in " + mesh.name);
                if (!bounds.Contains(vertices[i])) throw new InvalidOperationException("Mesh bounds exclude a vertex in " + mesh.name);
                Write(writer, vertices[i]); Write(writer, normals[i]);
                writer.Write(uv[i].x); writer.Write(uv[i].y);
            }
            writer.Write(mesh.subMeshCount);
            int triangles = 0;
            for (int submesh = 0; submesh < mesh.subMeshCount; submesh++)
            {
                Require(mesh.GetTopology(submesh) == MeshTopology.Triangles, "Non-triangle surface in " + mesh.name);
                int[] indices = mesh.GetTriangles(submesh);
                Require(indices.Length % 3 == 0, "Incomplete triangle in " + mesh.name);
                writer.Write(indices.Length);
                foreach (int index in indices)
                {
                    if (index < 0 || index >= vertices.Length) throw new InvalidOperationException("Out-of-range index in " + mesh.name);
                    writer.Write(index);
                }
                triangles += indices.Length / 3;
            }
            Require(triangles > 0, "Mesh has no triangles: " + mesh.name);
            result.meshes++;
            result.vertices += vertices.Length;
            result.triangles += triangles;
        }

        private static void VerifyNavigation(IslandGenerator island)
        {
            string[] expected = { "command", "knowledge", "finance", "crm", "world", "studio", "agents" };
            Require(island.DistrictPositions.Count == expected.Length, "District navigation map did not reconstruct all seven entries.");
            foreach (string district in expected)
            {
                Require(island.DistrictPositions.TryGetValue(district, out Vector3 position), "Missing district: " + district);
                Require(Finite(position), "Non-finite district position: " + district);
                Vector3 local = island.transform.InverseTransformPoint(position);
                float terrainHeight = island.SampleHeight(local.x, local.z);
                Require(Finite(terrainHeight) && terrainHeight >= 6.79f, "District terrain is not above the safe floor: " + district);
                Require(local.y > terrainHeight && local.y < terrainHeight + 2f, "District waypoint is misplaced: " + district);
            }
            Vector3 arrival = island.transform.InverseTransformPoint(island.SpawnPoint);
            Require(Finite(arrival), "Non-finite owner arrival position.");
            Require(arrival.y >= island.SampleHeight(arrival.x, arrival.z) + 2f, "Owner arrival intersects the ground.");
        }

        private static void VerifySavedScene(VerificationReport report)
        {
            Require(File.Exists(SavedScenePath), "Saved scene is missing. Run IslandBuild.CreateScene before validation.");
            Scene scene = EditorSceneManager.OpenPreviewScene(SavedScenePath);
            try
            {
                IslandGenerator found = null;
                foreach (GameObject root in scene.GetRootGameObjects())
                {
                    IslandGenerator candidate = root.GetComponentInChildren<IslandGenerator>(true);
                    if (candidate == null) continue;
                    Require(found == null, "Saved scene contains multiple island generators.");
                    found = candidate;
                }
                Require(found != null, "Saved scene did not reload its island generator.");
                Require(found.HasGeneratedIsland, "Saved scene lost its generated island reference.");
                VerifyNavigation(found);
                int meshCount = 0;
                foreach (MeshFilter filter in found.GetComponentsInChildren<MeshFilter>(true))
                {
                    Require(filter.sharedMesh != null && AssetDatabase.Contains(filter.sharedMesh), "Saved scene references an unpersisted mesh: " + filter.name);
                    MeshRenderer renderer = filter.GetComponent<MeshRenderer>();
                    Require(renderer != null, "Saved scene has mesh geometry without a renderer.");
                    foreach (Material material in renderer.sharedMaterials)
                    {
                        Require(material != null && AssetDatabase.Contains(material), "Saved scene references an unpersisted material.");
                        foreach (string property in material.GetTexturePropertyNames())
                        {
                            Texture texture = material.GetTexture(property);
                            if (texture != null) Require(AssetDatabase.Contains(texture), "Saved material references an unpersisted texture.");
                        }
                    }
                    meshCount++;
                }
                Require(meshCount >= 7, "Saved scene lost generated geometry.");
                report.savedSceneRenderers = meshCount;
                report.passed.Add("Fresh preview reload retains the generated island, district map, arrival and persisted meshes/materials/textures.");
            }
            finally { EditorSceneManager.ClosePreviewScene(scene); }
        }

        private static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        private static bool Finite(Vector3 value) => Finite(value.x) && Finite(value.y) && Finite(value.z);
        private static void Write(BinaryWriter writer, Vector3 value) { writer.Write(value.x); writer.Write(value.y); writer.Write(value.z); }
        private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }

        private struct Fingerprint { public string hash; public int meshes, vertices, triangles; }
        [Serializable]
        private sealed class VerificationReport
        {
            public string utc;
            public bool success;
            public int seed;
            public string sameSeedFirst, sameSeedRepeated, differentSeed;
            public int uniqueMeshes, vertices, triangles, savedSceneRenderers;
            public double elapsedSeconds;
            public string failure;
            public List<string> passed = new List<string>();
        }
    }
}
