using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.Build.Reporting;
using UnityEngine;
using UnityEngine.Rendering;
using Paradize.World;

namespace Paradize.Editor
{
    public static class IslandBuild
    {
        [MenuItem("PARADIZE/Create island scene")]
        public static void CreateScene()
        {
            if(!Application.isBatchMode && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            CoastalMaterialImport.ConfigureAndVerify();
            var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
            Directory.CreateDirectory("Assets/Paradize/Scenes");
            Directory.CreateDirectory("Assets/Paradize/Generated"); AssetDatabase.Refresh();
            var island=new GameObject("PARADIZE Island").AddComponent<IslandGenerator>(); island.Generate(41729);
            var ocean=new GameObject("Lunar ocean").AddComponent<OceanLunarSystem>();
            var sun=new GameObject("Bahama sun").AddComponent<Light>(); sun.type=LightType.Directional; sun.intensity=1.15f; sun.color=new Color(1,.93f,.78f); sun.shadows=LightShadows.Soft; sun.transform.rotation=Quaternion.Euler(36,-38,0);
            var camera=new GameObject("Owner viewpoint").AddComponent<Camera>(); camera.tag="MainCamera"; camera.nearClipPlane=.2f;camera.farClipPlane=12000;camera.fieldOfView=62;camera.depthTextureMode=DepthTextureMode.Depth;camera.allowHDR=true;camera.gameObject.AddComponent<AudioListener>();
            camera.transform.position=new Vector3(-790,145,-305);camera.transform.LookAt(new Vector3(-220,4,60));
            RenderSettings.ambientMode=AmbientMode.Trilight;RenderSettings.ambientSkyColor=new Color(.52f,.7f,.79f);RenderSettings.ambientEquatorColor=new Color(.37f,.53f,.57f);RenderSettings.ambientGroundColor=new Color(.27f,.29f,.25f);
            RenderSettings.fog=true;RenderSettings.fogMode=FogMode.ExponentialSquared;RenderSettings.fogDensity=.00013f;RenderSettings.fogColor=new Color(.55f,.79f,.87f);RenderSettings.sun=sun;
            var sky=new Material(Shader.Find("Skybox/Procedural"));sky.SetFloat("_SunSize",.035f);sky.SetFloat("_AtmosphereThickness",.85f);sky.SetColor("_SkyTint",new Color(.5f,.57f,.64f));sky.SetFloat("_Exposure",1.05f);RenderSettings.skybox=sky;
            var owner=new GameObject("PARADIZE Owner Session").AddComponent<IslandSession>();owner.Island=island;owner.Ocean=ocean;owner.View=camera;owner.Sun=sun;
            owner.SunnyAvatar=AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Paradize/Candidates/Human/HumanCandidate.prefab");
            owner.SunnyBreathing=AssetDatabase.LoadAllAssetsAtPath("Assets/Paradize/Candidates/Human/human-candidate.fbx").OfType<AnimationClip>().FirstOrDefault(c=>!c.name.StartsWith("__preview__") && c.length>0);
            if(owner.SunnyAvatar==null || owner.SunnyBreathing==null) throw new InvalidOperationException("Qualified Sunny avatar is missing.");
            ocean.Initialize();
            // Persist procedural resources so reopening a saved scene retains geometry.
            var seen=new HashSet<UnityEngine.Object>();
            Action<UnityEngine.Object> save=o=> {if(o==null || AssetDatabase.Contains(o) || !seen.Add(o))return; o.hideFlags=HideFlags.None; AssetDatabase.CreateAsset(o,AssetDatabase.GenerateUniqueAssetPath("Assets/Paradize/Generated/"+o.GetType().Name+".asset"));};
            foreach(var mf in UnityEngine.Object.FindObjectsByType<MeshFilter>(FindObjectsSortMode.None))save(mf.sharedMesh);
            foreach(var mc in UnityEngine.Object.FindObjectsByType<MeshCollider>(FindObjectsSortMode.None))save(mc.sharedMesh);
            foreach(var r in UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None))foreach(var m in r.sharedMaterials){if(m!=null){foreach(var property in m.GetTexturePropertyNames())save(m.GetTexture(property));save(m);}}
            save(sky);
            QualitySettings.SetQualityLevel(1,true);QualitySettings.shadowDistance=160;QualitySettings.shadows=ShadowQuality.All;QualitySettings.shadowResolution=ShadowResolution.Medium;QualitySettings.antiAliasing=2;
            PlayerSettings.companyName="PARADIZE";PlayerSettings.productName="PARADIZE";PlayerSettings.defaultScreenWidth=1440;PlayerSettings.defaultScreenHeight=900;PlayerSettings.fullScreenMode=FullScreenMode.Windowed;PlayerSettings.runInBackground=false;
            PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Standalone,ScriptingImplementation.Mono2x);
            PlayerSettings.colorSpace=ColorSpace.Linear;
            // The native owner bridge is literal loopback only, with bearer auth and no redirects.
            PlayerSettings.insecureHttpOption=InsecureHttpOption.AlwaysAllowed;
            EditorSceneManager.SaveScene(scene,"Assets/Paradize/Scenes/ParadizeIsland.unity");
            EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene("Assets/Paradize/Scenes/ParadizeIsland.unity",true)};AssetDatabase.SaveAssets();
            Debug.Log("PARADIZE_SCENE_READY seed=41729 districts="+island.DistrictPositions.Count);
        }
        public static void BuildWindows()
        {
            if(!File.Exists("Assets/Paradize/Scenes/ParadizeIsland.unity"))CreateScene();
            Directory.CreateDirectory("Builds/Windows");
            var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{"Assets/Paradize/Scenes/ParadizeIsland.unity"},locationPathName="Builds/Windows/PARADIZE.exe",target=BuildTarget.StandaloneWindows64,options=BuildOptions.None});
            if(report.summary.result!=BuildResult.Succeeded)throw new Exception("PARADIZE build failed: "+report.summary.result);
            Debug.Log("PARADIZE_BUILD_READY bytes="+report.summary.totalSize);
        }
        public static void QualifyAndBuild()
        {
            CreateScene();
            Verify();
            OceanLunarValidation.RunVerification();
            IslandValidation.RunVerification();
            BuildWindows();
        }
        public static void Verify()
        {
            EditorSceneManager.OpenScene("Assets/Paradize/Scenes/ParadizeIsland.unity");
            var island=UnityEngine.Object.FindFirstObjectByType<IslandGenerator>();var session=UnityEngine.Object.FindFirstObjectByType<IslandSession>();
            if(island==null || session==null || session.Ocean==null || session.View==null)throw new Exception("Scene missing required component");
            if(island.DistrictPositions.Count!=7 || !island.HasGeneratedIsland)throw new Exception("Saved island district state missing");
            int before=session.Ocean.transform.childCount;session.Ocean.Initialize();session.Ocean.Initialize();if(before!=session.Ocean.transform.childCount)throw new Exception("Ocean duplicated after reload");
            int count=0;foreach(var mf in UnityEngine.Object.FindObjectsByType<MeshFilter>(FindObjectsSortMode.None)){if(mf.sharedMesh!=null)count++;}
            if(count<5)throw new Exception("Scene geometry missing");
            Debug.Log("PARADIZE_VERIFY_PASS meshes="+count);
        }
    }
}
