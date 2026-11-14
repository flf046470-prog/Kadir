using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Derinlik.EditorTools
{
    /// <summary>
    /// Builds the Phase 1 Sakarya prototype scene (3-5 minutes): basement, wooden door, low
    /// stone corridor, camcorder-only sigil that sinks a slab, a door that slams behind the player,
    /// a light that dies, distant footsteps, and the control room with the tape that ends the chapter.
    /// Layout runs along +Z (metres). Everything is greybox: real art replaces it in Phase 2.
    /// </summary>
    public static class SakaryaPrototypeBuilder
    {
        public const string Root = "Assets/Derinlik";
        public const string ScenePath = Root + "/Scenes/Sakarya_Proto.unity";
        const string MatDir = Root + "/Materials";
        const string GenTexDir = Root + "/Textures/Generated";
        const string SigilPath = Root + "/Textures/T_FirstRecorderSigil.png";

        static Material concrete, stone, oldStone, wood, slabMat, dark, sigil;

        [MenuItem("Derinlik/Sakarya Prototipini Kur (Build Prototype Scene)", priority = 1)]
        public static void BuildFromMenu()
        {
            if (File.Exists(ScenePath) && !EditorUtility.DisplayDialog("DERİNLİK",
                    "Sakarya_Proto sahnesi zaten var. Yeniden kurulsun mu? (Sahnede yaptığın değişiklikler silinir.)",
                    "Yeniden kur", "Vazgeç"))
                return;
            Build();
        }

        public static void Build()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            EnsureFolder(Root + "/Scenes"); EnsureFolder(MatDir); EnsureFolder(GenTexDir);
            PlayerSettings.colorSpace = ColorSpace.Linear;
            CreateMaterials();

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            SetupAtmosphere();

            var level = new GameObject("Level").transform;
            var basement = Group("01_Basement", level);
            var corridorA = Group("02_CorridorA", level);
            var corridorB = Group("03_CorridorB", level);
            var control = Group("04_ControlRoom", level);
            var gameplay = Group("Gameplay", null);

            // 01 Basement: x -3..3, z 0..8, h 2.8. Exit door in the north wall (z 8..8.2), opening x -0.5..0.5.
            Room(basement, -3f, 3f, 0f, 8f, 2.8f, concrete, southWall: true, northOpening: 0.5f, northOpeningHeight: 2.1f);
            Box("Shelf", basement, new Vector3(-2.9f, 0f, 1.5f), new Vector3(-2.5f, 1.9f, 4.5f), wood);
            Box("ShelfBoard_1", basement, new Vector3(-2.95f, 0.6f, 1.45f), new Vector3(-2.45f, 0.64f, 4.55f), wood);
            Box("ShelfBoard_2", basement, new Vector3(-2.95f, 1.2f, 1.45f), new Vector3(-2.45f, 1.24f, 4.55f), wood);
            Box("Crate_1", basement, new Vector3(1.8f, 0f, 5.6f), new Vector3(2.6f, 0.7f, 6.4f), wood);
            Box("Crate_2", basement, new Vector3(2.0f, 0.7f, 5.8f), new Vector3(2.5f, 1.1f, 6.3f), wood);
            Box("Pipe", basement, new Vector3(2.85f, 2.4f, 0.2f), new Vector3(2.95f, 2.5f, 7.8f), dark);
            var bulbA = Bulb("Bulb_Basement", basement, new Vector3(0f, 2.55f, 3.5f), new Color(1f, 0.78f, 0.55f), 1.3f, 7f);
            Loop(basement, "RoomTone", new Vector3(0f, 1.5f, 4f), 0.35f, 12f);

            var doorA = DoorAt("Door_Basement", basement, new Vector3(-0.5f, 0f, 8.1f), 1.0f, 2.1f, false);

            // 02 Corridor A: x -0.6..0.6, z 8.2..18.3 (the slab sits in its last 30 cm), h 2.2, low beam (crouch) at z 12..15.
            Corridor(corridorA, 8.2f, 18.3f, 2.2f, stone);
            Box("LowCeiling", corridorA, new Vector3(-0.6f, 1.3f, 12f), new Vector3(0.6f, 2.2f, 15f), stone);
            Loop(corridorA, "Drip", new Vector3(0.4f, 0.2f, 16.5f), 0.6f, 8f);

            // Stone slab closing the corridor, and the sigil that only the camcorder sees.
            var slab = Box("SecretSlab", corridorA, new Vector3(-0.6f, 0f, 18f), new Vector3(0.6f, 2.2f, 18.3f), slabMat, isStatic: false);
            var symbol = new GameObject("HiddenSymbol");
            symbol.transform.SetParent(gameplay);
            symbol.transform.position = new Vector3(0f, 1.25f, 17.94f);
            var trace = symbol.AddComponent<BoxCollider>();
            trace.isTrigger = true;
            trace.size = new Vector3(0.8f, 0.8f, 0.06f);
            var quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            quad.name = "Sigil";
            Object.DestroyImmediate(quad.GetComponent<Collider>());
            quad.transform.SetParent(symbol.transform, false);
            quad.transform.localScale = new Vector3(0.8f, 0.8f, 1f);
            var quadRenderer = quad.GetComponent<MeshRenderer>();
            quadRenderer.sharedMaterial = sigil;
            quadRenderer.shadowCastingMode = ShadowCastingMode.Off;
            var hidden = symbol.AddComponent<HiddenSymbol>();
            hidden.symbolRenderer = quadRenderer;
            hidden.linkedObjects = new[] { slab.transform };
            hidden.moveOffset = new Vector3(0f, -2.25f, 0f);

            // 03 Corridor B: x -0.6..0.6, z 18.3..27, h 2.4. Door B starts open and slams behind the player.
            Corridor(corridorB, 18.3f, 27f, 2.4f, oldStone);
            // Frame at z 19.6: the open panel (1 m toward -Z) then clears the slab zone (z 18..18.3).
            Box("DoorFrame_L", corridorB, new Vector3(-0.6f, 0f, 19.5f), new Vector3(-0.5f, 2.4f, 19.7f), oldStone);
            Box("DoorFrame_R", corridorB, new Vector3(0.5f, 0f, 19.5f), new Vector3(0.6f, 2.4f, 19.7f), oldStone);
            Box("DoorFrame_Top", corridorB, new Vector3(-0.5f, 2.1f, 19.5f), new Vector3(0.5f, 2.4f, 19.7f), oldStone);
            var doorB = DoorAt("Door_CorridorB", corridorB, new Vector3(-0.5f, 0f, 19.6f), 1.0f, 2.1f, true);
            var bulbB = Bulb("Bulb_CorridorB", corridorB, new Vector3(0f, 2.25f, 23.5f), new Color(1f, 0.75f, 0.5f), 1.1f, 6f);
            var farPoint = new GameObject("FarFootsteps");
            farPoint.transform.SetParent(corridorB);
            farPoint.transform.position = new Vector3(0f, 1f, 26.8f);

            var trigger = new GameObject("HorrorEvent_DoorSlam");
            trigger.transform.SetParent(gameplay);
            trigger.transform.position = new Vector3(0f, 1.1f, 21.5f);
            var triggerBox = trigger.AddComponent<BoxCollider>();
            triggerBox.isTrigger = true;
            triggerBox.size = new Vector3(1.2f, 2.2f, 1f);
            var horror = trigger.AddComponent<HorrorEventTrigger>();
            horror.steps.Add(new HorrorStep { delay = 0f, action = HorrorAction.SlamAndLock, targets = new[] { doorB } });
            horror.steps.Add(new HorrorStep { delay = 0.6f, action = HorrorAction.LightsOff, targets = new[] { bulbB } });
            horror.steps.Add(new HorrorStep { delay = 2.2f, action = HorrorAction.PlaySound, targets = new[] { farPoint } });

            // 04 Control room: x -3..3, z 27.2..33, h 2.6, entered from the corridor.
            Room(control, -3f, 3f, 27.2f, 33f, 2.6f, oldStone, southWall: false, southOpening: 0.6f, southOpeningHeight: 2.2f);
            Box("Desk", control, new Vector3(-0.8f, 0f, 31.2f), new Vector3(0.8f, 0.78f, 32f), wood);
            Box("Console", control, new Vector3(-2.6f, 0f, 30f), new Vector3(-1.8f, 1.1f, 32.6f), oldStone);
            Bulb("Lamp_Control", control, new Vector3(0f, 2.4f, 30.5f), new Color(0.6f, 0.75f, 1f), 0.8f, 8f);
            var tape = Box("MiniDV_Tape", gameplay, new Vector3(-0.05f, 0.78f, 31.55f), new Vector3(0.05f, 0.8f, 31.62f), dark, isStatic: false);
            tape.AddComponent<ChapterEndPickup>();

            var player = CreatePlayer(gameplay, new Vector3(0f, 0.05f, 2f));
            var hud = new GameObject("HUD").AddComponent<GameHUD>();
            hud.transform.SetParent(gameplay);
            hud.player = player.GetComponent<FirstPersonController>();
            hud.interactor = player.GetComponent<Interactor>();

            Selection.activeGameObject = player;
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            Debug.Log($"[Derinlik] Sakarya prototype built: {ScenePath}. Press Play. ({doorA.name}, {bulbA.name} ready)");
        }

        // ---------------- geometry helpers ----------------

        static Transform Group(string name, Transform parent)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent);
            return go.transform;
        }

        static GameObject Box(string name, Transform parent, Vector3 min, Vector3 max, Material material, bool isStatic = true)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent);
            go.transform.position = (min + max) * 0.5f;
            go.transform.localScale = max - min;
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
            if (isStatic) GameObjectUtility.SetStaticEditorFlags(go, StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccluderStatic | StaticEditorFlags.OccludeeStatic);
            return go;
        }

        const float T = 0.2f; // wall thickness

        /// <summary>Rectangular room with optional centred openings in the south (-Z) and north (+Z) walls.</summary>
        static void Room(Transform parent, float x0, float x1, float z0, float z1, float height, Material m,
            bool southWall, float southOpening = 0f, float southOpeningHeight = 0f, float northOpening = 0f, float northOpeningHeight = 0f)
        {
            Box("Floor", parent, new Vector3(x0 - T, -T, z0 - T), new Vector3(x1 + T, 0f, z1 + T), m);
            Box("Ceiling", parent, new Vector3(x0 - T, height, z0 - T), new Vector3(x1 + T, height + T, z1 + T), m);
            Box("Wall_W", parent, new Vector3(x0 - T, 0f, z0), new Vector3(x0, height, z1), m);
            Box("Wall_E", parent, new Vector3(x1, 0f, z0), new Vector3(x1 + T, height, z1), m);
            EndWall(parent, "Wall_S", x0, x1, z0 - T, z0, height, southWall ? 0f : southOpening, southOpeningHeight, m);
            EndWall(parent, "Wall_N", x0, x1, z1, z1 + T, height, northOpening, northOpeningHeight, m);
        }

        static void EndWall(Transform parent, string name, float x0, float x1, float za, float zb, float height, float halfOpening, float openingHeight, Material m)
        {
            if (halfOpening <= 0f)
            {
                Box(name, parent, new Vector3(x0 - T, 0f, za), new Vector3(x1 + T, height, zb), m);
                return;
            }
            Box(name + "_L", parent, new Vector3(x0 - T, 0f, za), new Vector3(-halfOpening, height, zb), m);
            Box(name + "_R", parent, new Vector3(halfOpening, 0f, za), new Vector3(x1 + T, height, zb), m);
            Box(name + "_Top", parent, new Vector3(-halfOpening, openingHeight, za), new Vector3(halfOpening, height, zb), m);
        }

        static void Corridor(Transform parent, float z0, float z1, float height, Material m)
        {
            const float half = 0.6f;
            Box("Floor", parent, new Vector3(-half - T, -T, z0), new Vector3(half + T, 0f, z1), m);
            Box("Ceiling", parent, new Vector3(-half - T, height, z0), new Vector3(half + T, height + T, z1), m);
            Box("Wall_W", parent, new Vector3(-half - T, 0f, z0), new Vector3(-half, height, z1), m);
            Box("Wall_E", parent, new Vector3(half, 0f, z0), new Vector3(half + T, height, z1), m);
        }

        static GameObject DoorAt(string name, Transform parent, Vector3 hinge, float width, float height, bool startOpen)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent);
            go.transform.position = hinge;
            var panel = GameObject.CreatePrimitive(PrimitiveType.Cube);
            panel.name = "Panel";
            panel.transform.SetParent(go.transform, false);
            panel.transform.localPosition = new Vector3(width * 0.5f, height * 0.5f, 0f);
            panel.transform.localScale = new Vector3(width - 0.02f, height, 0.05f);
            panel.GetComponent<MeshRenderer>().sharedMaterial = wood;
            var door = go.AddComponent<Door>();
            door.startOpen = startOpen;
            door.startOpenDirection = 1f;
            return go;
        }

        static GameObject Bulb(string name, Transform parent, Vector3 position, Color color, float intensity, float range)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent);
            go.transform.position = position;
            var light = go.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = color;
            light.intensity = intensity;
            light.range = range;
            light.shadows = LightShadows.Soft;
            light.lightmapBakeType = LightmapBakeType.Realtime;
            var glass = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            glass.name = "Bulb";
            Object.DestroyImmediate(glass.GetComponent<Collider>());
            glass.transform.SetParent(go.transform, false);
            glass.transform.localScale = Vector3.one * 0.08f;
            var bulbMat = new Material(dark) { name = name + "_Glass" };
            SetEmissive(bulbMat, color * 2f);
            SaveMaterial(bulbMat);
            var r = glass.GetComponent<MeshRenderer>();
            r.sharedMaterial = bulbMat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            return go;
        }

        static void Loop(Transform parent, string name, Vector3 position, float volume, float maxDistance)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent);
            go.transform.position = position;
            go.AddComponent<AmbientLoop>().Configure(name, volume, maxDistance);
        }

        static GameObject CreatePlayer(Transform parent, Vector3 position)
        {
            var player = new GameObject("Player (Ekin)");
            player.transform.SetParent(parent);
            player.transform.position = position;
            player.AddComponent<CharacterController>();
            player.AddComponent<FirstPersonController>();
            player.AddComponent<Interactor>();
            player.AddComponent<Camcorder>();

            var camGo = new GameObject("Camera");
            camGo.tag = "MainCamera";
            camGo.transform.SetParent(player.transform, false);
            camGo.transform.localPosition = new Vector3(0f, 1.64f, 0f);
            var cam = camGo.AddComponent<Camera>();
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 120f;
            cam.fieldOfView = 70f;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Color.black;
            camGo.AddComponent<AudioListener>();

            var torchGo = new GameObject("FlashlightBeam");
            torchGo.transform.SetParent(camGo.transform, false);
            torchGo.transform.localPosition = new Vector3(0.18f, -0.15f, 0.1f);
            var torch = torchGo.AddComponent<Light>();
            torch.type = LightType.Spot;
            torch.spotAngle = 52f;
            torch.innerSpotAngle = 22f;
            torch.range = 18f;
            torch.intensity = 2.4f;
            torch.color = new Color(1f, 0.96f, 0.88f);
            torch.shadows = LightShadows.Soft;
            camGo.AddComponent<Flashlight>().spot = torch;
            return player;
        }

        static void SetupAtmosphere()
        {
            RenderSettings.skybox = null;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.025f, 0.025f, 0.03f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = new Color(0.02f, 0.02f, 0.022f);
            RenderSettings.fogDensity = 0.06f;
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Custom;
        }

        // ---------------- materials ----------------

        static void CreateMaterials()
        {
            concrete = Surface("M_Concrete", NoiseTexture("T_Concrete", new Color(0.42f, 0.41f, 0.39f), 6f, 0.35f, 11), 0.15f);
            stone = Surface("M_Stone", NoiseTexture("T_Stone", new Color(0.36f, 0.33f, 0.29f), 14f, 0.55f, 23), 0.1f);
            oldStone = Surface("M_OldStone", NoiseTexture("T_OldStone", new Color(0.3f, 0.29f, 0.27f), 22f, 0.6f, 37), 0.12f);
            wood = Surface("M_Wood", NoiseTexture("T_Wood", new Color(0.27f, 0.18f, 0.11f), 3f, 0.45f, 51, stretchY: 8f), 0.2f);
            slabMat = Surface("M_Slab", NoiseTexture("T_Slab", new Color(0.33f, 0.31f, 0.28f), 9f, 0.5f, 67), 0.08f);
            dark = Surface("M_Dark", null, 0.4f, new Color(0.05f, 0.05f, 0.05f));

            var importer = AssetImporter.GetAtPath(SigilPath) as TextureImporter;
            if (importer != null && !importer.alphaIsTransparency)
            {
                importer.alphaIsTransparency = true;
                importer.SaveAndReimport();
            }
            var sigilTex = AssetDatabase.LoadAssetAtPath<Texture2D>(SigilPath);
            sigil = new Material(Shader.Find("Sprites/Default")) { name = "M_Sigil", mainTexture = sigilTex, color = new Color(0.55f, 0.85f, 1f, 0.95f) };
            SaveMaterial(sigil);
        }

        static Shader LitShader()
        {
            bool srp = GraphicsSettings.currentRenderPipeline != null;
            var urp = Shader.Find("Universal Render Pipeline/Lit");
            return srp && urp != null ? urp : Shader.Find("Standard");
        }

        static Material Surface(string name, Texture2D albedo, float smoothness, Color? tint = null)
        {
            var m = new Material(LitShader()) { name = name };
            var color = tint ?? Color.white;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", color);
            if (m.HasProperty("_Color")) m.SetColor("_Color", color);
            if (albedo != null)
            {
                if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", albedo);
                if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", albedo);
            }
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smoothness);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smoothness);
            SaveMaterial(m);
            return AssetDatabase.LoadAssetAtPath<Material>($"{MatDir}/{name}.mat");
        }

        static void SetEmissive(Material m, Color color)
        {
            m.EnableKeyword("_EMISSION");
            if (m.HasProperty("_EmissionColor")) m.SetColor("_EmissionColor", color);
            m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
        }

        static void SaveMaterial(Material m)
        {
            string path = $"{MatDir}/{m.name}.mat";
            AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(m, path);
        }

        /// <summary>Tileable fractal noise as a stand-in albedo (no third-party textures in the prototype).</summary>
        static Texture2D NoiseTexture(string name, Color baseColor, float scale, float contrast, int seed, float stretchY = 1f)
        {
            const int size = 256;
            var tex = new Texture2D(size, size, TextureFormat.RGB24, true);
            var pixels = new Color[size * size];
            float ox = seed * 17.3f, oy = seed * 9.1f;
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float u = x / (float)size, v = y / (float)size;
                float n = 0f, amp = 0.5f, freq = scale;
                for (int o = 0; o < 4; o++)
                {
                    // Sample on a torus-like wrap so the texture tiles.
                    float a = Mathf.PerlinNoise(ox + u * freq, oy + v * freq * stretchY);
                    float b = Mathf.PerlinNoise(ox + (u - 1f) * freq, oy + v * freq * stretchY);
                    float c = Mathf.PerlinNoise(ox + u * freq, oy + (v - 1f) * freq * stretchY);
                    float d = Mathf.PerlinNoise(ox + (u - 1f) * freq, oy + (v - 1f) * freq * stretchY);
                    n += amp * Mathf.Lerp(Mathf.Lerp(a, b, u), Mathf.Lerp(c, d, u), v);
                    amp *= 0.5f; freq *= 2f;
                }
                float k = Mathf.Lerp(1f - contrast, 1f + contrast, n);
                pixels[y * size + x] = new Color(baseColor.r * k, baseColor.g * k, baseColor.b * k);
            }
            tex.SetPixels(pixels);
            tex.Apply();
            string path = $"{GenTexDir}/{name}.png";
            File.WriteAllBytes(path, tex.EncodeToPNG());
            Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(path);
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            string parent = Path.GetDirectoryName(path).Replace('\\', '/');
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }
    }

    /// <summary>First time the project opens with no prototype scene, build it and open it.</summary>
    [InitializeOnLoad]
    static class DerinlikFirstRun
    {
        static DerinlikFirstRun()
        {
            if (SessionState.GetBool("Derinlik.FirstRunChecked", false)) return;
            SessionState.SetBool("Derinlik.FirstRunChecked", true);
            EditorApplication.delayCall += () =>
            {
                if (EditorApplication.isPlayingOrWillChangePlaymode) return;
                if (File.Exists(SakaryaPrototypeBuilder.ScenePath))
                {
                    if (SceneManager.GetActiveScene().path != SakaryaPrototypeBuilder.ScenePath && string.IsNullOrEmpty(SceneManager.GetActiveScene().path))
                        EditorSceneManager.OpenScene(SakaryaPrototypeBuilder.ScenePath);
                    return;
                }
                SakaryaPrototypeBuilder.Build();
            };
        }
    }
}
