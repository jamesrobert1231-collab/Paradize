#if UNITY_EDITOR
using System;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Paradize.World
{
    /// <summary>Batch entry point; no test package, external data, or network is required.</summary>
    public static class OceanLunarValidation
    {
        public static void RunVerification()
        {
            DateTime epoch = new DateTime(2000, 1, 6, 18, 14, 0, DateTimeKind.Utc);
            var newMoon = OceanLunarSystem.SampleAtUtc(epoch);
            var fullMoon = OceanLunarSystem.SampleAtUtc(epoch.AddDays(OceanLunarSystem.SynodicDays / 2.0));
            var quarter = OceanLunarSystem.SampleAtUtc(epoch.AddDays(OceanLunarSystem.SynodicDays / 4.0));
            var previousQuarter = OceanLunarSystem.SampleAtUtc(epoch.AddDays(-OceanLunarSystem.SynodicDays / 4.0));
            Near(newMoon.Phase01, 0f, 0.00001f, "epoch is new moon");
            Near(newMoon.Illumination01, 0f, 0.00001f, "new moon is dark");
            Near(fullMoon.Phase01, 0.5f, 0.00001f, "half synodic cycle is full moon");
            Near(fullMoon.Illumination01, 1f, 0.00001f, "full moon is illuminated");
            Near(quarter.Illumination01, 0.5f, 0.00001f, "quarter moon is half illuminated");
            Near(previousQuarter.Phase01, 0.75f, 0.00001f, "pre-epoch cycle wraps positively");
            Require(newMoon.Envelope > quarter.Envelope * 2f, "new-moon spring range exceeds quarter-moon neap range");
            Require(fullMoon.Envelope > quarter.Envelope * 2f, "full-moon spring range exceeds quarter-moon neap range");

            // Requirements-bound properties over two complete lunar cycles, not copied equations.
            float low = float.MaxValue;
            float high = float.MinValue;
            for (int step = 0; step <= 2880; step++)
            {
                var sample = OceanLunarSystem.SampleAtUtc(epoch.AddHours(step * 0.5));
                Require(sample.Phase01 >= 0f && sample.Phase01 < 1f, "phase remains in [0,1)");
                Require(sample.Illumination01 >= 0f && sample.Illumination01 <= 1f, "illumination remains a fraction");
                Require(sample.Envelope >= 0.3199f && sample.Envelope <= 0.7801f, "spring/neap envelope is bounded");
                Require(Mathf.Abs(sample.Height) <= 0.7801f, "synthetic sea level stays within design range");
                low = Mathf.Min(low, sample.Height);
                high = Mathf.Max(high, sample.Height);
            }
            Require(low < -0.7f && high > 0.7f, "clock produces both high and low spring tides");
            Near(OceanLunarSystem.SampleAtUtc(epoch.ToLocalTime()).Phase01, newMoon.Phase01, 0.00001f,
                "local and UTC representations describe the same instant");
            Require(OceanLunarSystem.PhaseName(0f) == "New moon", "phase name at new moon");
            Require(OceanLunarSystem.PhaseName(0.5f) == "Full moon", "phase name at full moon");

            VerifyShader("ParadizeOcean");
            VerifyShader("ParadizeMoon");
            var host = new GameObject("Ocean verification temporary");
            try
            {
                var ocean = host.AddComponent<OceanLunarSystem>();
                ocean.SetPreviewDays(float.NaN);
                Near(ocean.PreviewDays, 0f, 0f, "NaN preview returns to UTC");
                ocean.SetPreviewDays(float.PositiveInfinity);
                Near(ocean.PreviewDays, 0f, 0f, "infinite preview returns to UTC");
                ocean.SetPreviewDays(900f);
                Near(ocean.PreviewDays, 365f, 0f, "positive preview is clamped");
                ocean.SetPreviewDays(-900f);
                Near(ocean.PreviewDays, -365f, 0f, "negative preview is clamped");

                if (SystemInfo.graphicsDeviceType != GraphicsDeviceType.Null)
                {
                    ocean.Initialize();
                    Require(ocean.IsReady, "ocean renderer initializes");
                    int children = host.transform.childCount;
                    Require(children == 2, "water and moon visual objects exist");
                    ocean.Initialize();
                    Require(host.transform.childCount == children, "repeated initialization creates no duplicate geometry");
                    Require(host.GetComponentInChildren<Collider>() == null, "ocean and moon have no obstructive colliders");
                    var restoredHost = UnityEngine.Object.Instantiate(host);
                    try
                    {
                        var restored = restoredHost.GetComponent<OceanLunarSystem>();
                        restored.Initialize();
                        Require(restored.IsReady && restoredHost.transform.childCount == children,
                            "serialized preview rebinds without creating duplicate water or moon");
                    }
                    finally { UnityEngine.Object.DestroyImmediate(restoredHost); }
                    ocean.SetPreviewDays(7f);
                    Require(ocean.StatusLabel.Contains("preview"), "preview is visibly distinguished from live UTC");
                    ocean.SetPreviewDays(0f);
                    Require(ocean.StatusLabel.Contains("UTC live"), "zero preview restores live-clock status");
                    Require(ocean.StatusLabel.Contains("not a forecast"), "simulation is visibly identified");
                    Debug.Log("PARADIZE_OCEAN_RENDERER_INIT_PASS");
                }
                else Debug.Log("PARADIZE_OCEAN_RENDERER_INIT_UNVERIFIED: graphics device is Null; repeat with graphics enabled.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
            Debug.Log("PARADIZE_OCEAN_MATH_PASS: epochs, UTC, phase, tide range, spring/neap cycles, preview bounds, shader import verified.");
        }

        private static void VerifyShader(string resource)
        {
            Shader shader = Resources.Load<Shader>(resource);
            Require(shader != null, resource + " exists in Resources for player builds");
            if (ShaderUtil.ShaderHasError(shader))
            {
                foreach (var message in ShaderUtil.GetShaderMessages(shader))
                    Debug.LogError(resource + ": " + message.message);
                throw new InvalidOperationException(resource + " has shader compilation errors");
            }
        }

        private static void Near(float actual, float expected, float tolerance, string requirement)
        {
            Require(!float.IsNaN(actual) && Mathf.Abs(actual - expected) <= tolerance,
                requirement + $" (expected {expected}, actual {actual})");
        }

        private static void Require(bool condition, string requirement)
        {
            if (!condition) throw new InvalidOperationException("Ocean verification failed: " + requirement);
        }
    }
}
#endif
