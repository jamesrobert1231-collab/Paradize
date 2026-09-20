using System;
using UnityEditor;
using UnityEngine;

namespace Paradize.Editor
{
    public static class CoastalMaterialImport
    {
        public static void ConfigureAndVerify()
        {
            foreach (string kind in new[] { "albedo", "normal" })
            {
                string path = "Assets/Paradize/Resources/CoastalMaterials/coast_sand_01_" + kind + ".jpg";
                var importer = AssetImporter.GetAtPath(path) as TextureImporter;
                if (importer == null) throw new InvalidOperationException("Missing coastal texture: " + kind);
                importer.textureType = kind == "normal" ? TextureImporterType.NormalMap : TextureImporterType.Default;
                importer.sRGBTexture = kind == "albedo";
                importer.mipmapEnabled = true;
                importer.maxTextureSize = 1024;
                importer.textureCompression = TextureImporterCompression.Compressed;
                importer.wrapMode = TextureWrapMode.Repeat;
                importer.anisoLevel = 2;
                importer.isReadable = false;
                importer.SaveAndReimport();
                var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
                if (texture == null || texture.width != 1024 || texture.height != 1024 || texture.mipmapCount <= 1)
                    throw new InvalidOperationException("Coastal texture import did not qualify: " + kind);
            }
            Debug.Log("PARADIZE_COASTAL_MATERIALS_PASS resolution=1024 mipmaps=enabled normalMap=qualified");
        }
    }
}
