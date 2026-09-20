using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Paradize.World
{
    /// <summary>
    /// GPU wind waves plus an illustrative lunar/solar tide, using UTC by default.
    /// This synthetic island is not a surveyed coast; these are not tide forecasts.
    /// NOAA mechanism: https://oceanservice.noaa.gov/facts/springtide.html
    /// Surface waves: https://oceanservice.noaa.gov/facts/wavesinocean.html
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class OceanLunarSystem : MonoBehaviour
    {
        public const double SynodicDays = 29.530588853;
        // Approximate new-moon epoch; constant-period phases are deliberately illustrative.
        private static readonly DateTime Epoch = new DateTime(2000, 1, 6, 18, 14, 0, DateTimeKind.Utc);

        [SerializeField, Range(0f, 2f)] private float windStrength = 0.8f;
        [SerializeField] private float baseSeaLevel;
        [SerializeField, Min(4000f)] private float oceanWidth = 12000f;
        [SerializeField, Range(32, 160)] private int meshResolution = 128;

        public float TideHeight { get; private set; }
        public float Phase01 { get; private set; }
        public float Illumination01 { get; private set; }
        public float TideEnvelope { get; private set; }
        public float PreviewDays { get; private set; }
        public DateTime SimulationUtc { get; private set; }
        public string StatusLabel { get; private set; } = "Ocean initializing";
        public bool IsReady => water != null && waterMaterial != null;

        [SerializeField] private Transform water;
        [SerializeField] private Transform moon;
        [SerializeField] private Mesh oceanMesh;
        [SerializeField] private Material waterMaterial;
        [SerializeField] private Material moonMaterial;
        private bool ownsMesh;
        private bool ownsWaterMaterial;
        private bool ownsMoonMaterial;
        private float labelCooldown;
        private Camera viewCamera;
        private bool initialized;
        private static readonly int WaveTimeId = Shader.PropertyToID("_WaveTime");
        private static readonly int WindId = Shader.PropertyToID("_WindStrength");
        private static readonly int PhaseId = Shader.PropertyToID("_Phase");

        public struct LunarTideSample
        {
            public float Phase01;
            public float Illumination01;
            public float Height;
            public float Envelope;
        }

        /// <summary>Pure deterministic seam for phase/tide validation; UTC or local DateTime accepted.</summary>
        public static LunarTideSample SampleAtUtc(DateTime utc)
        {
            if (utc.Kind == DateTimeKind.Unspecified)
                utc = DateTime.SpecifyKind(utc, DateTimeKind.Utc);
            else if (utc.Kind != DateTimeKind.Utc)
                utc = utc.ToUniversalTime();

            double days = (utc - Epoch).TotalDays;
            double cycles = days / SynodicDays;
            double phase = cycles - Math.Floor(cycles);
            double lunar = 2.0 * Math.PI * (days * 24.0 / 12.4206012);
            double solar = 2.0 * Math.PI * (days * 24.0 / 12.0);
            // Two semidiurnal constituents interfere: larger range near alignment,
            // smaller range around quarter moons. Amplitudes are design values in metres.
            const double lunarAmplitude = 0.55;
            const double solarAmplitude = 0.23;
            return new LunarTideSample
            {
                Phase01 = (float)phase,
                Illumination01 = (float)(0.5 * (1.0 - Math.Cos(2.0 * Math.PI * phase))),
                Height = (float)(lunarAmplitude * Math.Cos(lunar) + solarAmplitude * Math.Cos(solar)),
                Envelope = (float)Math.Sqrt(lunarAmplitude * lunarAmplitude + solarAmplitude * solarAmplitude
                    + 2.0 * lunarAmplitude * solarAmplitude * Math.Cos(lunar - solar))
            };
        }

        public void Initialize()
        {
            if (initialized) return;
            // Scene creation can persist generated geometry/materials for an editor preview.
            // Rebind those objects after deserialization instead of creating a second ocean.
            if (water != null)
            {
                var savedRenderer = water.GetComponent<MeshRenderer>();
                var savedFilter = water.GetComponent<MeshFilter>();
                if (savedRenderer == null || savedFilter == null || savedRenderer.sharedMaterial == null)
                {
                    StatusLabel = "Ocean unavailable: saved surface is incomplete";
                    Debug.LogError(StatusLabel, this);
                    return;
                }
                waterMaterial = savedRenderer.sharedMaterial;
                oceanMesh = savedFilter.sharedMesh;
                if (Application.isPlaying)
                {
                    waterMaterial = new Material(waterMaterial);
                    savedRenderer.sharedMaterial = waterMaterial;
                    ownsWaterMaterial = true;
                }
                if (moon != null)
                {
                    var savedMoonRenderer = moon.GetComponent<MeshRenderer>();
                    if (savedMoonRenderer != null && savedMoonRenderer.sharedMaterial != null)
                    {
                        moonMaterial = savedMoonRenderer.sharedMaterial;
                        if (Application.isPlaying)
                        {
                            moonMaterial = new Material(moonMaterial);
                            savedMoonRenderer.sharedMaterial = moonMaterial;
                            ownsMoonMaterial = true;
                        }
                    }
                }
                initialized = true;
                SetPreviewDays(0f);
                LateUpdate();
                return;
            }
            Shader shader = Resources.Load<Shader>("ParadizeOcean");
            if (shader == null || !shader.isSupported)
            {
                StatusLabel = "Ocean unavailable: water shader unsupported or missing";
                Debug.LogError(StatusLabel, this);
                return;
            }
            initialized = true;
            waterMaterial = new Material(shader) { name = "PARADIZE Caribbean Water" };
            ownsWaterMaterial = true;
            var surface = new GameObject("Ocean • wind waves + lunar/solar tide");
            surface.transform.SetParent(transform, false);
            water = surface.transform;
            oceanMesh = BuildOceanMesh();
            ownsMesh = true;
            surface.AddComponent<MeshFilter>().sharedMesh = oceanMesh;
            var renderer = surface.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = waterMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;

            Shader lunarShader = Resources.Load<Shader>("ParadizeMoon");
            if (lunarShader != null && lunarShader.isSupported)
            {
                moonMaterial = new Material(lunarShader) { name = "PARADIZE Approximate Lunar Phase" };
                ownsMoonMaterial = true;
                var lunarDisc = GameObject.CreatePrimitive(PrimitiveType.Quad);
                lunarDisc.name = "Moon • illustrative phase, decorative sky position";
                moon = lunarDisc.transform;
                moon.SetParent(transform, false);
                moon.localPosition = new Vector3(-0.48f, 0.62f, 0.62f).normalized * 3800f;
                moon.localRotation = Quaternion.LookRotation(moon.localPosition, Vector3.up);
                moon.localScale = Vector3.one * 110f;
                Release(lunarDisc.GetComponent<Collider>());
                var moonRenderer = lunarDisc.GetComponent<MeshRenderer>();
                moonRenderer.sharedMaterial = moonMaterial;
                moonRenderer.shadowCastingMode = ShadowCastingMode.Off;
                moonRenderer.receiveShadows = false;
            }
            SetPreviewDays(0f);
            LateUpdate();
        }

        /// <summary>Offset the real UTC clock for a lunar-cycle preview; zero restores live UTC.</summary>
        public void SetPreviewDays(float offset)
        {
            if (float.IsNaN(offset) || float.IsInfinity(offset)) offset = 0f;
            PreviewDays = Mathf.Clamp(offset, -365f, 365f);
            labelCooldown = 0f;
            UpdateTide();
        }

        private void Update()
        {
            if (!initialized) return;
            UpdateTide();
            // Wind waves continue at normal speed while the tide/phase clock is previewed.
            waterMaterial.SetFloat(WaveTimeId, Time.timeSinceLevelLoad);
            waterMaterial.SetFloat(WindId, windStrength);
        }

        private void LateUpdate()
        {
            if (!initialized) return;
            if (viewCamera == null || !viewCamera.isActiveAndEnabled) viewCamera = Camera.main;
            if (viewCamera == null) return;
            viewCamera.depthTextureMode |= DepthTextureMode.Depth;
            Vector3 observer = viewCamera.transform.position;
            // A dense centre follows the observer; absolute world phase keeps waves coherent.
            water.position = new Vector3(Mathf.Round(observer.x / 40f) * 40f, baseSeaLevel + TideHeight,
                Mathf.Round(observer.z / 40f) * 40f);
            if (moon != null)
            {
                float distance = Mathf.Min(3800f, viewCamera.farClipPlane * 0.72f);
                moon.position = observer + new Vector3(-0.48f, 0.62f, 0.62f).normalized * distance;
                moon.rotation = Quaternion.LookRotation(moon.position - observer, Vector3.up);
                moon.localScale = Vector3.one * (distance * 0.029f);
            }
        }

        private void UpdateTide()
        {
            SimulationUtc = DateTime.UtcNow.AddDays(PreviewDays);
            LunarTideSample sample = SampleAtUtc(SimulationUtc);
            Phase01 = sample.Phase01;
            TideHeight = sample.Height;
            Illumination01 = sample.Illumination01;
            TideEnvelope = sample.Envelope;
            if (water != null)
            {
                Vector3 position = water.position;
                position.y = baseSeaLevel + TideHeight;
                water.position = position;
            }
            if (moonMaterial != null) moonMaterial.SetFloat(PhaseId, Phase01);
            labelCooldown -= Time.unscaledDeltaTime;
            if (labelCooldown > 0f) return;
            labelCooldown = 0.5f;
            string regime = TideEnvelope > 0.65f ? "spring range" : TideEnvelope < 0.43f ? "neap range" : "changing range";
            string mode = Mathf.Abs(PreviewDays) < 0.0001f ? "UTC live" : $"preview {PreviewDays:+0.0;-0.0;0} days";
            StatusLabel = $"{PhaseName(Phase01)} • {Illumination01:P0} lit • tide {TideHeight:+0.00;-0.00;0.00} m\n"
                + $"{regime} • {mode} • illustrative, not a forecast";
        }

        public static string PhaseName(float phase)
        {
            phase = Mathf.Repeat(phase, 1f);
            if (phase < 0.035f || phase >= 0.965f) return "New moon";
            if (phase < 0.215f) return "Waxing crescent";
            if (phase < 0.285f) return "First quarter";
            if (phase < 0.465f) return "Waxing gibbous";
            if (phase < 0.535f) return "Full moon";
            if (phase < 0.715f) return "Waning gibbous";
            if (phase < 0.785f) return "Last quarter";
            return "Waning crescent";
        }

        private Mesh BuildOceanMesh()
        {
            int resolution = Mathf.Clamp(meshResolution, 32, 160);
            int side = resolution + 1;
            var vertices = new Vector3[side * side];
            var normals = new Vector3[vertices.Length];
            var triangles = new int[resolution * resolution * 6];
            float halfSize = Mathf.Max(4000f, oceanWidth) * 0.5f;
            for (int z = 0; z < side; z++)
            {
                for (int x = 0; x < side; x++)
                {
                    int index = z * side + x;
                    vertices[index] = new Vector3(GridCoordinate(x, resolution) * halfSize, 0f,
                        GridCoordinate(z, resolution) * halfSize);
                    normals[index] = Vector3.up;
                }
            }
            int triangle = 0;
            for (int z = 0; z < resolution; z++)
            {
                for (int x = 0; x < resolution; x++)
                {
                    int i = z * side + x;
                    triangles[triangle++] = i;
                    triangles[triangle++] = i + side;
                    triangles[triangle++] = i + 1;
                    triangles[triangle++] = i + 1;
                    triangles[triangle++] = i + side;
                    triangles[triangle++] = i + side + 1;
                }
            }
            var mesh = new Mesh { name = "Ocean 128 grid with dense observer region" };
            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.triangles = triangles;
            // Shader displacement is outside the flat mesh; reserve bounds explicitly.
            mesh.bounds = new Bounds(Vector3.zero, new Vector3(halfSize * 2f, 12f, halfSize * 2f));
            // Keep editor-created geometry readable until the scene builder saves its asset.
            mesh.UploadMeshData(Application.isPlaying);
            return mesh;
        }

        private static float GridCoordinate(int index, int resolution)
        {
            float t = index / (float)resolution * 2f - 1f;
            return 0.08f * t + 0.92f * t * t * t;
        }

        private void OnDestroy()
        {
            if (ownsWaterMaterial) Release(waterMaterial);
            if (ownsMoonMaterial) Release(moonMaterial);
            if (ownsMesh) Release(oceanMesh);
            if (water != null) Release(water.gameObject);
            if (moon != null) Release(moon.gameObject);
        }

        private static void Release(UnityEngine.Object value)
        {
            if (value == null) return;
            #if UNITY_EDITOR
            // The scene builder may have saved formerly transient meshes/materials as assets.
            if (UnityEditor.EditorUtility.IsPersistent(value)) return;
            #endif
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
