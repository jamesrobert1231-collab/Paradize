using System;
using System.Linq;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Paradize.Editor
{
    public static class HumanCandidateValidation
    {
        const string ModelPath = "Assets/Paradize/Candidates/Human/human-candidate.fbx";
        static readonly Dictionary<string, string> Textures = new Dictionary<string, string> {
            { "Human", "young_lightskinned_female_diffuse.png" },
            { "female_casualsuit01", "female_casualsuit01_diffuse.png" },
            { "shoes01", "shoes01_diffuse.png" },
            { "bob01", "bob01_diffuse.png" },
            { "low-poly", "brown_eye.png" }
        };

        static void ConfigureMaterial(SkinnedMeshRenderer renderer)
        {
            if (!Textures.TryGetValue(renderer.name, out var file)) throw new InvalidOperationException("Unexpected character mesh: " + renderer.name);
            string texturePath = "Assets/Paradize/Candidates/Human/Textures/" + file;
            var textureImporter = AssetImporter.GetAtPath(texturePath) as TextureImporter;
            if (textureImporter == null) throw new InvalidOperationException("Missing staged texture: " + file);
            textureImporter.maxTextureSize = 2048;
            textureImporter.sRGBTexture = true;
            textureImporter.mipmapEnabled = true;
            textureImporter.alphaIsTransparency = renderer.name == "bob01";
            textureImporter.SaveAndReimport();
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
            if (texture == null || texture.width < 256 || texture.mipmapCount < 2) throw new InvalidOperationException("Texture import incomplete");
            var shader = Shader.Find("Standard");
            if (shader == null || !shader.isSupported) throw new InvalidOperationException("Character shader unavailable");
            var material = new Material(shader) { name = renderer.name, mainTexture = texture };
            material.SetFloat("_Glossiness", .25f);
            if (renderer.name == "bob01") {
                material.SetFloat("_Mode", 1); material.SetFloat("_Cutoff", .4f);
                material.SetOverrideTag("RenderType", "TransparentCutout");
                material.EnableKeyword("_ALPHATEST_ON"); material.renderQueue = 2450;
            }
            string folder = "Assets/Paradize/Candidates/Human/Materials";
            if (!AssetDatabase.IsValidFolder(folder)) AssetDatabase.CreateFolder("Assets/Paradize/Candidates/Human", "Materials");
            string materialPath = folder + "/" + renderer.name + ".mat";
            var existing = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
            if (existing == null) AssetDatabase.CreateAsset(material, materialPath);
            else { EditorUtility.CopySerialized(material, existing); UnityEngine.Object.DestroyImmediate(material); material = existing; }
            renderer.sharedMaterials = new[] { material };
        }

        public static void Verify()
        {
            var importer = AssetImporter.GetAtPath(ModelPath) as ModelImporter;
            if (importer == null) throw new InvalidOperationException("Stage the reviewed human FBX first.");
            importer.animationType = ModelImporterAnimationType.Generic;
            importer.importAnimation = true;
            importer.animationCompression = ModelImporterAnimationCompression.Off;
            importer.isReadable = true;
            importer.importCameras = false;
            importer.importLights = false;
            importer.SaveAndReimport();
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
            var instance = UnityEngine.Object.Instantiate(model);
            try
            {
                var renderers = instance.GetComponentsInChildren<SkinnedMeshRenderer>();
                if (renderers.Length != 5 || renderers.Select(r => r.name).Distinct().Count() != 5) throw new InvalidOperationException("Expected body, clothing, shoes, hair and eyes.");
                var bounds = new Bounds(); bool started = false;
                foreach (var renderer in renderers)
                {
                    ConfigureMaterial(renderer);
                    if (renderer.bones.Length == 0 || renderer.bones.Any(b => b == null)) throw new InvalidOperationException("Missing skin bones.");
                    if (renderer.sharedMaterials.Any(m => m == null || m.shader == null)) throw new InvalidOperationException("Missing character materials.");
                    var mesh = renderer.sharedMesh;
                    if (mesh.vertexCount < 80 || mesh.boneWeights.Length != mesh.vertexCount) throw new InvalidOperationException("Incomplete character geometry or weights.");
                    foreach (var weight in mesh.boneWeights)
                        if (weight.weight0 + weight.weight1 + weight.weight2 + weight.weight3 < .99f) throw new InvalidOperationException("Unweighted or incomplete skin weight.");
                    var baked = new Mesh();
                    renderer.BakeMesh(baked, true);
                    Debug.Log("Human import geometry " + renderer.name + " scale=" + renderer.transform.lossyScale + " baked=" + baked.bounds.size + " renderer=" + renderer.bounds.size);
                    foreach (var vertex in baked.vertices)
                    {
                        var world = renderer.transform.TransformPoint(vertex);
                        if (!float.IsFinite(world.x) || !float.IsFinite(world.y) || !float.IsFinite(world.z)) throw new InvalidOperationException("Non-finite mesh position.");
                        if (!started) { bounds = new Bounds(world, Vector3.zero); started = true; }
                        else bounds.Encapsulate(world);
                    }
                    UnityEngine.Object.DestroyImmediate(baked);
                }
                if (bounds.size.y < 1.70f || bounds.size.y > 1.90f || bounds.size.x > 1.2f || bounds.size.z > .7f)
                    throw new InvalidOperationException("Human scale or orientation failed: " + bounds.size);
                var clips = AssetDatabase.LoadAllAssetsAtPath(ModelPath).OfType<AnimationClip>().Where(c => !c.name.StartsWith("__preview__") && c.length > 0).ToArray();
                if (clips.Length == 0) throw new InvalidOperationException("Breathing clip was lost in export.");
                foreach (var clip in clips) Debug.Log("Human clip " + clip.name + " seconds=" + clip.length + " curves=" + AnimationUtility.GetCurveBindings(clip).Length);
                var body = renderers.OrderByDescending(r => r.sharedMesh.vertexCount).First();
                var before = new Mesh(); var after = new Mesh();
                try
                {
                    clips[0].SampleAnimation(instance, 0);
                    body.BakeMesh(before, true);
                    clips[0].SampleAnimation(instance, clips[0].length * .5f);
                    body.BakeMesh(after, true);
                    var a = before.vertices; var b = after.vertices;
                    float movement = 0;
                    for (int i = 0; i < a.Length; i++) movement = Mathf.Max(movement, body.transform.TransformVector(a[i] - b[i]).magnitude);
                    if (movement < .00001f || movement > .05f) throw new InvalidOperationException("Breathing deformation missing or excessive: " + movement);
                    clips[0].SampleAnimation(instance, 0);
                    PrefabUtility.SaveAsPrefabAsset(instance, "Assets/Paradize/Candidates/Human/HumanCandidate.prefab");
                    AssetDatabase.SaveAssets();
                    RenderPreview(instance);
                    Debug.Log("PARADIZE_HUMAN_IMPORT_PASS meshes=" + renderers.Length + " height=" + bounds.size.y + " clips=" + clips.Length + " deformation=" + movement + " visualRealism=unqualified activated=false");
                }
                finally { UnityEngine.Object.DestroyImmediate(before); UnityEngine.Object.DestroyImmediate(after); }
            }
            finally { UnityEngine.Object.DestroyImmediate(instance); }
        }

        static void RenderPreview(GameObject instance)
        {
            var cameraObject = new GameObject("Human preview camera");
            var lightObject = new GameObject("Human preview light");
            var target = new RenderTexture(640, 800, 24);
            var pixels = new Texture2D(640, 800, TextureFormat.RGB24, false);
            var oldAmbient = RenderSettings.ambientLight;
            var oldActive = RenderTexture.active;
            try {
                instance.transform.position = new Vector3(10000, 0, 10000);
                foreach (var renderer in instance.GetComponentsInChildren<SkinnedMeshRenderer>()) renderer.updateWhenOffscreen = true;
                var camera = cameraObject.AddComponent<Camera>();
                camera.transform.position = instance.transform.position + new Vector3(1.4f, 1.4f, 3.5f);
                camera.transform.LookAt(instance.transform.position + Vector3.up * .9f);
                camera.orthographic = true; camera.orthographicSize = 1.05f;
                camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.07f, .08f, .1f);
                camera.targetTexture = target;
                var light = lightObject.AddComponent<Light>(); light.type = LightType.Directional; light.intensity = 1.3f;
                light.transform.rotation = Quaternion.Euler(35, -35, 0);
                RenderSettings.ambientLight = new Color(.45f, .45f, .45f);
                camera.Render(); RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, 640, 800), 0, 0); pixels.Apply();
                string directory = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../.build/characters"));
                Directory.CreateDirectory(directory);
                File.WriteAllBytes(Path.Combine(directory, "human-unity.png"), pixels.EncodeToPNG());
            }
            finally {
                RenderTexture.active = oldActive; RenderSettings.ambientLight = oldAmbient;
                UnityEngine.Object.DestroyImmediate(cameraObject); UnityEngine.Object.DestroyImmediate(lightObject);
                UnityEngine.Object.DestroyImmediate(target); UnityEngine.Object.DestroyImmediate(pixels);
            }
        }
    }
}
