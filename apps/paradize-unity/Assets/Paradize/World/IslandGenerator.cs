using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Paradize.World
{
    /// <summary>
    /// Seeded, fictional Bahamas-inspired limestone cay. Metres, sea level y=0.
    /// This is an original procedural environment, not surveyed terrain or a
    /// claim of photorealism. Wind/waves/tides are supplied by the ocean system.
    /// </summary>
    [ExecuteAlways]
    public sealed class IslandGenerator : MonoBehaviour
    {
        public const int DefaultSeed = 41729;
        public const float TerrainWidth = 3600f;
        public const int TerrainResolution = 257;

        [SerializeField] private int seed = DefaultSeed;
        [SerializeField] private Transform generatedRoot;
        private readonly Dictionary<string, Vector3> districtPositions = new Dictionary<string, Vector3>();
        private readonly List<UnityEngine.Object> generatedAssets = new List<UnityEngine.Object>();
        private readonly List<UnityEngine.Object> runtimeAssets = new List<UnityEngine.Object>();
        private readonly List<Vector2> districtCentres = new List<Vector2>();
        private System.Random random;
        private float noiseOffset;
        private Material sand, scrub, limestone, seabed, dune;
        private Material structure, darkMetal, accent, palmBark, palmLeaf;
        private Mesh cubeMesh, cylinderMesh;

        public Vector3 SpawnPoint { get; private set; }
        public int Seed => seed;
        public bool HasGeneratedIsland => generatedRoot != null;
        public IReadOnlyDictionary<string, Vector3> DistrictPositions => districtPositions;
        /// <summary>Editor tooling can save these generated meshes/materials/textures as assets.</summary>
        public IReadOnlyList<UnityEngine.Object> GeneratedAssets => generatedAssets;

        private static readonly string[] DistrictKeys =
            { "command", "knowledge", "finance", "crm", "world", "studio", "agents" };
        private static readonly Vector2[] DistrictLocations =
        {
            new Vector2(-440, -70), new Vector2(-660, 285), new Vector2(-185, 420),
            new Vector2(-620, -365), new Vector2(445, -460), new Vector2(705, 345),
            new Vector2(15, -410)
        };

        private void OnEnable()
        {
            // Dictionaries are not Unity-serialized; reconstruct the public navigation contract.
            noiseOffset = (float)((uint)seed % 65521u) * .0213f;
            RefreshDistrictPositions();
        }

        private void RefreshDistrictPositions()
        {
            districtPositions.Clear();
            for (int i = 0; i < DistrictKeys.Length; i++)
            {
                Vector2 centre = DistrictLocations[i];
                districtPositions.Add(DistrictKeys[i], transform.TransformPoint(new Vector3(centre.x, SampleHeight(centre.x, centre.y) + .9f, centre.y)));
            }
            Vector2 arrival = DistrictLocations[0] + new Vector2(0, -24);
            SpawnPoint = transform.TransformPoint(new Vector3(arrival.x, SampleHeight(arrival.x, arrival.y) + 2.8f, arrival.y));
        }

        public void Generate(int seed = DefaultSeed)
        {
            this.seed = seed;
            noiseOffset = (float)((uint)seed % 65521u) * .0213f;
            random = new System.Random(seed);
            ClearGenerated();
            districtPositions.Clear();
            districtCentres.Clear();
            districtCentres.AddRange(DistrictLocations);
            generatedRoot = new GameObject("PARADIZE • Procedural island").transform;
            generatedRoot.SetParent(transform, false);
            CreateMaterials();
            cubeMesh = MakeBox();
            cylinderMesh = MakeCylinder(20);
            BuildTerrain();
            for (int i = 0; i < DistrictKeys.Length; i++)
            {
                Vector2 centre = DistrictLocations[i];
                var local = new Vector3(centre.x, SampleHeight(centre.x, centre.y), centre.y);
                BuildDistrict(DistrictKeys[i], local, i == 0);
            }
            BuildPromenades();
            BuildVegetation();
            RefreshDistrictPositions();
        }

        /// <summary>Returns local terrain height; seed and fixed district clearings affect it.</summary>
        public float SampleHeight(float x, float z)
        {
            float result = NaturalHeight(x, z);
            for (int i = 0; i < DistrictLocations.Length; i++)
            {
                Vector2 centre = DistrictLocations[i];
                float distance = Vector2.Distance(new Vector2(x, z), centre);
                if (distance >= 88f) continue;
                float padHeight = Mathf.Max(6.8f, NaturalHeight(centre.x, centre.y));
                float blend = 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(42f, 88f, distance));
                result = Mathf.Lerp(result, padHeight, blend);
            }
            return result;
        }

        private float NaturalHeight(float x, float z)
        {
            float angle = Mathf.Atan2(z / 790f, x / 1210f);
            float radius = Mathf.Sqrt(x * x / (1210f * 1210f) + z * z / (790f * 790f));
            float outline = 1f + .055f * Mathf.Sin(angle * 5f + .4f) + .028f * Mathf.Sin(angle * 9f - .6f);
            float noise = Noise(x * .0028f, z * .0028f);
            float shore = (outline - radius) * 420f + (noise - .5f) * 27f;
            float land = Mathf.Lerp(-22f, 1.15f, Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(-135f, 12f, shore)));
            land += Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(10f, 140f, shore)) * (7f + noise * 17f);
            land += Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(70f, 200f, shore)) * (Noise(x * .008f, z * .008f) - .5f) * 3.5f;

            // A shallow sheltered turquoise lagoon with an eastern tidal channel.
            float lagoonRadius = Mathf.Sqrt(Mathf.Pow((x - 340f) / 450f, 2f) + Mathf.Pow((z - 50f) / 315f, 2f));
            float lagoonBlend = 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(.78f, 1.16f, lagoonRadius));
            land = Mathf.Lerp(land, -3.2f - noise * 2.5f, lagoonBlend);
            float channel = Mathf.Abs(z - (50f + Mathf.Sin(x * .004f) * 27f));
            float channelBlend = (1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(65f, 165f, channel))) *
                                 Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(510f, 735f, x));
            return Mathf.Lerp(land, Mathf.Min(land, -4.5f), channelBlend);
        }

        private float Noise(float x, float z) => Mathf.PerlinNoise(x + noiseOffset + 37.25f, z + noiseOffset + 81.13f);
        private float Range(float min, float max) => min + (float)random.NextDouble() * (max - min);

        private void CreateMaterials()
        {
            float seedOffset = (float)random.NextDouble() * 173f;
            sand = CoastalSandMaterial();
            dune = GroundMaterial("Dry dune sand", new Color(.71f, .64f, .45f), .18f, 1.6f, seedOffset + 21f);
            scrub = GroundMaterial("Coastal scrub ground", new Color(.26f, .32f, .20f), .24f, 2.1f, seedOffset + 42f);
            limestone = GroundMaterial("Weathered limestone", new Color(.56f, .59f, .51f), .16f, 2.9f, seedOffset + 89f);
            seabed = GroundMaterial("Shallow carbonate seabed", new Color(.53f, .75f, .68f), .11f, 1.3f, seedOffset + 63f);
            structure = Material("Pier limestone", new Color(.82f, .79f, .70f), .08f, .17f);
            darkMetal = Material("Weathered titanium", new Color(.10f, .15f, .17f), .35f, .22f);
            accent = Material("Warm wayfinding", new Color(.30f, .58f, .86f), .02f, .58f);
            accent.EnableKeyword("_EMISSION");
            accent.SetColor("_EmissionColor", new Color(.03f, .09f, .16f));
            palmBark = GroundMaterial("Palm trunk", new Color(.43f, .33f, .22f), .27f, 1.4f, seedOffset + 11f);
            palmLeaf = GroundMaterial("Palm and scrub foliage", new Color(.20f, .34f, .14f), .22f, 2.2f, seedOffset + 35f);
        }

        private Material Material(string name, Color colour, float metallic, float smoothness)
        {
            Shader shader = Shader.Find("Standard");
            if (shader == null) throw new InvalidOperationException("PARADIZE island requires the built-in Standard shader.");
            var material = new Material(shader) { name = name, color = colour, enableInstancing = true };
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Glossiness", smoothness);
            Register(material);
            return material;
        }
        private Material CoastalSandMaterial()
        {
            var albedo = Resources.Load<Texture2D>("CoastalMaterials/coast_sand_01_albedo");
            var normal = Resources.Load<Texture2D>("CoastalMaterials/coast_sand_01_normal");
            if (albedo == null || normal == null) throw new InvalidOperationException("Qualified coastal textures are missing.");
            var material = Material("Scanned coastal sand • Poly Haven CC0", Color.white, 0f, .16f);
            material.mainTexture = albedo;
            material.SetTexture("_BumpMap", normal);
            material.SetFloat("_BumpScale", .45f);
            material.EnableKeyword("_NORMALMAP");
            material.SetTextureScale("_MainTex", Vector2.one * 2f);
            material.SetTextureScale("_BumpMap", Vector2.one * 2f);
            return material;
        }

        private Material GroundMaterial(string name, Color colour, float variation, float slopeBias, float seedOffset)
        {
            Material material = Material(name, Color.white, 0f, .13f);
            const int size = 128;
            var texture = new Texture2D(size, size, TextureFormat.RGB24, true) { name = name + " detail", wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Bilinear };
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float nx = x / (float)size * 3f + seedOffset;
                float ny = y / (float)size * 3f + seedOffset;
                float grain = (Mathf.PerlinNoise(nx, ny) - .5f) * 2f;
                float broad = (Mathf.PerlinNoise(nx * 1.7f + 100f, ny * 1.7f + 77f) - .5f) * 2f;
                float vein = (Mathf.PerlinNoise(nx * 3.8f + 11f, ny * 3.8f - 9f) - .5f) * 2f;
                float falloff = Mathf.SmoothStep(.3f, 1.5f, (Mathf.Abs(x - size * .5f) + Mathf.Abs(y - size * .5f)) / size);
                float multiplier = 1f + grain * variation * .95f + broad * variation * .35f + vein * variation * .18f + (falloff * .25f);
                pixels[y * size + x] = colour * Mathf.Clamp(multiplier + Mathf.Sin(slopeBias * .1f) * .04f, .66f, 1.35f);
            }
            texture.SetPixels(pixels);
            texture.Apply(true, false);
            material.mainTexture = texture;
            material.SetTextureScale("_MainTex", new Vector2(11f, 9f));
            material.SetFloat("_Glossiness", Mathf.Clamp(0.65f - variation * .15f, 0.06f, 0.38f));
            material.SetFloat("_Metallic", 0f);
            Register(texture);
            return material;
        }

        private void BuildTerrain()
        {
            int n = TerrainResolution;
            var vertices = new Vector3[n * n];
            var uv = new Vector2[n * n];
            var groups = new List<int>[5];
            for (int i = 0; i < groups.Length; i++) groups[i] = new List<int>();
            for (int z = 0; z < n; z++)
            for (int x = 0; x < n; x++)
            {
                float wx = ((float)x / (n - 1) - .5f) * TerrainWidth;
                float wz = ((float)z / (n - 1) - .5f) * TerrainWidth;
                int index = z * n + x;
                vertices[index] = new Vector3(wx, SampleHeight(wx, wz), wz);
                uv[index] = new Vector2(wx, wz) / 8f;
            }
            for (int z = 0; z < n - 1; z++)
            for (int x = 0; x < n - 1; x++)
            {
                int a = z * n + x, b = a + 1, c = a + n, d = c + 1;
                AddTerrainTriangle(groups, vertices, a, c, b);
                AddTerrainTriangle(groups, vertices, b, c, d);
            }
            var mesh = new Mesh { name = "Seeded limestone cay", indexFormat = IndexFormat.UInt32, vertices = vertices, uv = uv, subMeshCount = groups.Length };
            for (int i = 0; i < groups.Length; i++) mesh.SetTriangles(groups[i], i);
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            Register(mesh);
            GameObject terrain = MeshObject("Island terrain", mesh, Vector3.zero, Vector3.one, generatedRoot, sand);
            terrain.GetComponent<MeshRenderer>().sharedMaterials = new[] { seabed, sand, dune, scrub, limestone };
            terrain.AddComponent<MeshCollider>().sharedMesh = mesh;
        }

        private void AddTerrainTriangle(List<int>[] groups, Vector3[] vertices, int a, int b, int c)
        {
            Vector3 p = (vertices[a] + vertices[b] + vertices[c]) / 3f;
            float slope = 1f - Mathf.Abs(Vector3.Cross(vertices[b] - vertices[a], vertices[c] - vertices[a]).normalized.y);
            int material = p.y < -.3f ? 0 : p.y < 2.6f ? 1 : p.y < 6.2f ? 2 : slope > .1f || Noise(p.x * .022f, p.z * .022f) > .75f ? 4 : 3;
            groups[material].Add(a); groups[material].Add(b); groups[material].Add(c);
        }

        private void BuildDistrict(string key, Vector3 centre, bool headquarters)
        {
            var parent = new GameObject("District • " + key).transform;
            parent.SetParent(generatedRoot, false);
            parent.localPosition = centre;
            float radius = headquarters ? 35f : 26f;
            MeshObject("Floating limestone terrace", cylinderMesh, new Vector3(0, .26f, 0), new Vector3(radius * 2f, .52f, radius * 2f), parent, structure, true);
            MeshObject("Circular graphite inlay", cylinderMesh, new Vector3(0, .54f, 0), new Vector3(radius * 1.72f, .055f, radius * 1.72f), parent, darkMetal);
            MeshObject("Interior deck", cylinderMesh, new Vector3(0, .58f, 0), new Vector3(radius * 1.67f, .055f, radius * 1.67f), parent, structure);
            MeshObject("Luminous arrival ring", Ring(radius - 1.3f, radius - 1.05f, .08f, 64), new Vector3(0, .57f, 0), Vector3.one, parent, accent);
            float roofHeight = headquarters ? 12f : 8f;
            float roofRadius = radius * .83f;
            MeshObject("Open oculus canopy", Ring(roofRadius * .38f, roofRadius, .65f, 64), Vector3.up * roofHeight, Vector3.one, parent, structure);
            MeshObject("Canopy edge light", Ring(roofRadius - .21f, roofRadius, .07f, 64), Vector3.up * (roofHeight - .08f), Vector3.one, parent, accent);
            for (int i = 0; i < 8; i++)
            {
                float angle = i * Mathf.PI * 2f / 8f;
                var position = new Vector3(Mathf.Cos(angle) * (roofRadius - 2f), roofHeight * .5f, Mathf.Sin(angle) * (roofRadius - 2f));
                MeshObject("Slender pavilion column", cylinderMesh, position, new Vector3(.65f, roofHeight, .65f), parent, darkMetal, true);
            }
            MeshObject("Central console pedestal", cylinderMesh, new Vector3(0, 1.28f, 0), new Vector3(4.8f, 1.3f, 4.8f), parent, darkMetal, true);
            MeshObject("Console surface", cylinderMesh, new Vector3(0, 1.96f, 0), new Vector3(4.9f, .09f, 4.9f), parent, accent);
            // Eight benches and planters use shared primitive geometry and materials.
            for (int i = 0; i < 4; i++)
            {
                float angle = (i + .5f) * Mathf.PI * .5f;
                Vector3 p = new Vector3(Mathf.Cos(angle) * radius * .67f, .94f, Mathf.Sin(angle) * radius * .67f);
                var bench = MeshObject("Terrace seating", cubeMesh, p, new Vector3(6.5f, .7f, 1.7f), parent, darkMetal, true);
                bench.transform.localRotation = Quaternion.Euler(0, -angle * Mathf.Rad2Deg, 0);
            }
            if (headquarters)
            {
                for (int i = 0; i < 3; i++)
                {
                    var arch = MeshObject("Command halo", Ring(5.8f + i * 1.5f, 6.05f + i * 1.5f, .22f, 48),
                        new Vector3(0, 17f + i * .7f, 0), Vector3.one, parent, i == 1 ? accent : structure);
                    arch.transform.localRotation = Quaternion.Euler(15f * i, 0, 12f * i);
                }
            }
        }

        private void BuildPromenades()
        {
            var vertices = new List<Vector3>();
            var uvs = new List<Vector2>();
            var indices = new List<int>();
            // Follow the inhabited western crescent; never draw a road across the lagoon.
            int[,] routes = { { 0, 1 }, { 1, 2 }, { 0, 3 }, { 3, 6 }, { 6, 4 } };
            for (int route = 0; route < routes.GetLength(0); route++)
            {
                Vector2 a = DistrictLocations[routes[route, 0]], b = DistrictLocations[routes[route, 1]];
                Vector2 direction = (b - a).normalized;
                Vector2 normal = new Vector2(-direction.y, direction.x);
                int steps = Mathf.CeilToInt(Vector2.Distance(a, b) / 8f);
                int start = vertices.Count;
                for (int i = 0; i <= steps; i++)
                {
                    float t = (float)i / steps;
                    Vector2 point = Vector2.Lerp(a, b, t) + normal * (Mathf.Sin(t * Mathf.PI) * 12f);
                    for (int side = 0; side < 2; side++)
                    {
                        Vector2 edge = point + normal * (side == 0 ? -2.5f : 2.5f);
                        vertices.Add(new Vector3(edge.x, SampleHeight(edge.x, edge.y) + .10f, edge.y));
                        uvs.Add(new Vector2(side, i));
                    }
                    if (i == 0) continue;
                    int p = start + (i - 1) * 2;
                    indices.Add(p); indices.Add(p + 2); indices.Add(p + 1);
                    indices.Add(p + 1); indices.Add(p + 2); indices.Add(p + 3);
                }
            }
            MeshObject("Pedestrian limestone promenades", Mesh("Crescent promenades", vertices, uvs, indices), Vector3.zero, Vector3.one, generatedRoot, sand);
        }

        private void BuildVegetation()
        {
            var trunks = new Geometry();
            var fronds = new Geometry();
            var bushes = new Geometry();
            int palmCount = 0;
            for (int attempt = 0; attempt < 2600 && palmCount < 190; attempt++)
            {
                float x = Range(-1120f, 1120f), z = Range(-670f, 670f);
                float y = SampleHeight(x, z);
                if (y < 3f || y > 21f || NearDistrict(x, z, 46f)) continue;
                if (Noise(x * .014f, z * .014f) < .47f) continue;
                AddPalm(new Vector3(x, y - .1f, z), Range(11f, 18f), trunks, fronds);
                palmCount++;
            }
            // Intentional arrival grove gives the first-person starting area a useful sense of scale.
            Vector2 command = DistrictLocations[0];
            for (int i = 0; i < 12; i++)
            {
                float angle = i * Mathf.PI * 2f / 12f;
                float x = command.x + Mathf.Cos(angle) * 47f, z = command.y + Mathf.Sin(angle) * 47f;
                AddPalm(new Vector3(x, SampleHeight(x, z), z), Range(13f, 17f), trunks, fronds);
            }
            for (int i = 0; i < 850; i++)
            {
                float x = Range(-1100, 1100), z = Range(-650, 650), y = SampleHeight(x, z);
                if (y < 6f || NearDistrict(x, z, 44f)) continue;
                AddShrub(bushes, new Vector3(x, y, z), Range(1.3f, 3.5f));
            }
            MeshObject("Palm trunks • combined", Mesh("Palm trunks", trunks.vertices, trunks.uv, trunks.triangles), Vector3.zero, Vector3.one, generatedRoot, palmBark);
            MeshObject("Palm crowns • combined", Mesh("Palm crowns", fronds.vertices, fronds.uv, fronds.triangles), Vector3.zero, Vector3.one, generatedRoot, palmLeaf);
            MeshObject("Coastal scrub • combined", Mesh("Coastal scrub", bushes.vertices, bushes.uv, bushes.triangles), Vector3.zero, Vector3.one, generatedRoot, palmLeaf);
        }

        private bool NearDistrict(float x, float z, float radius)
        {
            var point = new Vector2(x, z);
            foreach (Vector2 centre in districtCentres)
                if ((point - centre).sqrMagnitude < radius * radius) return true;
            return false;
        }

        private void AddPalm(Vector3 position, float height, Geometry trunks, Geometry leaves)
        {
            float angle = Range(0, Mathf.PI * 2f);
            Vector3 lean = new Vector3(Mathf.Cos(angle), 0, Mathf.Sin(angle)) * Range(1.2f, 3.3f);
            int first = trunks.vertices.Count;
            const int rings = 7, sides = 7;
            for (int ring = 0; ring <= rings; ring++)
            for (int side = 0; side <= sides; side++)
            {
                float t = (float)ring / rings, a = (float)side / sides * Mathf.PI * 2f;
                float radius = Mathf.Lerp(.47f, .22f, t);
                trunks.vertices.Add(position + Vector3.up * height * t + lean * t * t + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * radius);
                trunks.uv.Add(new Vector2((float)side / sides, t * 6f));
                if (ring == rings || side == sides) continue;
                int p = first + ring * (sides + 1) + side;
                trunks.Quad(p, p + sides + 1, p + 1, p + sides + 2, false);
            }
            Vector3 crown = position + Vector3.up * height + lean;
            for (int frond = 0; frond < 9; frond++)
            {
                float a = angle + frond * Mathf.PI * 2f / 9f;
                Vector3 radial = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                Vector3 across = new Vector3(-radial.z, 0, radial.x);
                float length = Range(5f, 7.3f);
                int start = leaves.vertices.Count;
                const int segments = 9;
                for (int j = 0; j <= segments; j++)
                {
                    float t = (float)j / segments;
                    Vector3 mid = crown + radial * length * t + Vector3.up * (Mathf.Sin(t * Mathf.PI) * 2.5f - t * t * 2.1f);
                    float width = Mathf.Sin(t * Mathf.PI) * .78f;
                    // Three vertices across create a folded, drooping frond rather than a flat card.
                    leaves.vertices.Add(mid - across * width - Vector3.up * width * .22f);
                    leaves.vertices.Add(mid + Vector3.up * width * .1f);
                    leaves.vertices.Add(mid + across * width - Vector3.up * width * .22f);
                    leaves.uv.Add(new Vector2(0, t * 3f)); leaves.uv.Add(new Vector2(.5f, t * 3f)); leaves.uv.Add(new Vector2(1, t * 3f));
                }
                for (int j = 1; j <= segments; j++)
                {
                    int p = start + (j - 1) * 3;
                    leaves.Quad(p, p + 1, p + 3, p + 4, true);
                    leaves.Quad(p + 1, p + 2, p + 4, p + 5, true);
                }
            }
        }

        private void AddShrub(Geometry data, Vector3 p, float size)
        {
            const int segments = 7;
            int first = data.vertices.Count;
            for (int ring = 0; ring < 4; ring++)
            for (int i = 0; i <= segments; i++)
            {
                float v = ring / 3f, a = i / (float)segments * Mathf.PI * 2f;
                float r = Mathf.Sin(v * Mathf.PI) * size;
                data.vertices.Add(p + new Vector3(Mathf.Cos(a) * r, v * size * 1.4f, Mathf.Sin(a) * r));
                data.uv.Add(new Vector2(i / (float)segments, v));
                if (ring == 3 || i == segments) continue;
                int k = first + ring * (segments + 1) + i;
                data.Quad(k, k + segments + 1, k + 1, k + segments + 2, false);
            }
        }

        private Mesh Ring(float inner, float outer, float thickness, int segments)
        {
            var data = new Geometry();
            // Separate faces retain clean flat normals at the ceramic edges.
            for (int i = 0; i < segments; i++)
            {
                float a = i / (float)segments * Mathf.PI * 2f, b = (i + 1f) / segments * Mathf.PI * 2f;
                Vector3 ia = new Vector3(Mathf.Cos(a) * inner, 0, Mathf.Sin(a) * inner);
                Vector3 ib = new Vector3(Mathf.Cos(b) * inner, 0, Mathf.Sin(b) * inner);
                Vector3 oa = new Vector3(Mathf.Cos(a) * outer, 0, Mathf.Sin(a) * outer);
                Vector3 ob = new Vector3(Mathf.Cos(b) * outer, 0, Mathf.Sin(b) * outer);
                Vector3 up = Vector3.up * thickness;
                data.Face(ia + up, ib + up, oa + up, ob + up);
                data.Face(oa, ob, ia, ib);
                data.Face(oa, oa + up, ob, ob + up);
                data.Face(ib, ib + up, ia, ia + up);
            }
            return Mesh("Oculus ring", data.vertices, data.uv, data.triangles);
        }

        private Mesh MakeCylinder(int segments)
        {
            var data = new Geometry();
            for (int i = 0; i < segments; i++)
            {
                float a = i / (float)segments * Mathf.PI * 2f, b = (i + 1f) / segments * Mathf.PI * 2f;
                Vector3 p = new Vector3(Mathf.Cos(a) * .5f, -.5f, Mathf.Sin(a) * .5f);
                Vector3 q = new Vector3(Mathf.Cos(b) * .5f, -.5f, Mathf.Sin(b) * .5f);
                data.Face(p, p + Vector3.up, q, q + Vector3.up);
                data.Triangle(Vector3.up * .5f, q + Vector3.up, p + Vector3.up);
                data.Triangle(Vector3.down * .5f, p, q);
            }
            return Mesh("Shared architectural cylinder", data.vertices, data.uv, data.triangles);
        }

        private Mesh MakeBox()
        {
            var data = new Geometry();
            data.Face(new Vector3(-.5f, -.5f, .5f), new Vector3(.5f, -.5f, .5f), new Vector3(-.5f, .5f, .5f), new Vector3(.5f, .5f, .5f));
            data.Face(new Vector3(.5f, -.5f, -.5f), new Vector3(-.5f, -.5f, -.5f), new Vector3(.5f, .5f, -.5f), new Vector3(-.5f, .5f, -.5f));
            data.Face(new Vector3(-.5f, -.5f, -.5f), new Vector3(-.5f, -.5f, .5f), new Vector3(-.5f, .5f, -.5f), new Vector3(-.5f, .5f, .5f));
            data.Face(new Vector3(.5f, -.5f, .5f), new Vector3(.5f, -.5f, -.5f), new Vector3(.5f, .5f, .5f), new Vector3(.5f, .5f, -.5f));
            data.Face(new Vector3(-.5f, .5f, .5f), new Vector3(.5f, .5f, .5f), new Vector3(-.5f, .5f, -.5f), new Vector3(.5f, .5f, -.5f));
            data.Face(new Vector3(-.5f, -.5f, -.5f), new Vector3(.5f, -.5f, -.5f), new Vector3(-.5f, -.5f, .5f), new Vector3(.5f, -.5f, .5f));
            return Mesh("Shared architectural box", data.vertices, data.uv, data.triangles);
        }

        private Mesh Mesh(string name, List<Vector3> vertices, List<Vector2> uv, List<int> indices)
        {
            var mesh = new Mesh { name = name, indexFormat = vertices.Count > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(vertices); mesh.SetUVs(0, uv); mesh.SetTriangles(indices, 0);
            mesh.RecalculateNormals(); mesh.RecalculateBounds();
            Register(mesh);
            return mesh;
        }

        private void Register(UnityEngine.Object asset)
        {
            generatedAssets.Add(asset);
            if (Application.isPlaying) runtimeAssets.Add(asset);
        }

        private GameObject MeshObject(string name, Mesh mesh, Vector3 position, Vector3 scale, Transform parent, Material material, bool collider = false)
        {
            var obj = new GameObject(name);
            obj.transform.SetParent(parent, false);
            obj.transform.localPosition = position;
            obj.transform.localScale = scale;
            obj.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = obj.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            if (collider) obj.AddComponent<MeshCollider>().sharedMesh = mesh;
            return obj;
        }

        private void ClearGenerated()
        {
            if (generatedRoot != null)
            {
                generatedRoot.gameObject.SetActive(false);
                if (Application.isPlaying) Destroy(generatedRoot.gameObject);
                else DestroyImmediate(generatedRoot.gameObject);
            }
            // Edit-time callers persist resources through AssetDatabase. Never destroy those assets.
            foreach (UnityEngine.Object asset in runtimeAssets) if (asset != null) Destroy(asset);
            runtimeAssets.Clear();
            generatedAssets.Clear();
        }

        private void OnDestroy()
        {
            if (!Application.isPlaying) return;
            foreach (UnityEngine.Object asset in runtimeAssets) if (asset != null) Destroy(asset);
            runtimeAssets.Clear();
            generatedAssets.Clear();
        }

        private sealed class Geometry
        {
            public readonly List<Vector3> vertices = new List<Vector3>();
            public readonly List<Vector2> uv = new List<Vector2>();
            public readonly List<int> triangles = new List<int>();
            public void Quad(int a, int b, int c, int d, bool doubleSided)
            {
                triangles.Add(a); triangles.Add(b); triangles.Add(c);
                triangles.Add(b); triangles.Add(d); triangles.Add(c);
                if (!doubleSided) return;
                // Separate back-face vertices keep RecalculateNormals from cancelling
                // the front normals to zero on the thin, double-sided palm leaves.
                int back = vertices.Count;
                vertices.Add(vertices[a]); vertices.Add(vertices[b]); vertices.Add(vertices[c]); vertices.Add(vertices[d]);
                uv.Add(uv[a]); uv.Add(uv[b]); uv.Add(uv[c]); uv.Add(uv[d]);
                triangles.Add(back + 2); triangles.Add(back + 1); triangles.Add(back);
                triangles.Add(back + 2); triangles.Add(back + 3); triangles.Add(back + 1);
            }
            public void Face(Vector3 a, Vector3 b, Vector3 c, Vector3 d)
            {
                int i = vertices.Count;
                vertices.Add(a); vertices.Add(b); vertices.Add(c); vertices.Add(d);
                uv.Add(Vector2.zero); uv.Add(Vector2.right); uv.Add(Vector2.up); uv.Add(Vector2.one);
                Quad(i, i + 1, i + 2, i + 3, false);
            }
            public void Triangle(Vector3 a, Vector3 b, Vector3 c)
            {
                int i = vertices.Count;
                vertices.Add(a); vertices.Add(b); vertices.Add(c);
                uv.Add(Vector2.zero); uv.Add(Vector2.right); uv.Add(Vector2.up);
                triangles.Add(i); triangles.Add(i + 1); triangles.Add(i + 2);
            }
        }
    }
}
