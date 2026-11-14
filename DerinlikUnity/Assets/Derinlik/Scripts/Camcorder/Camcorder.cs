using UnityEngine;

namespace Derinlik
{
    /// <summary>
    /// Ekin's camcorder (right mouse / Q). While raised: viewfinder overlay (corners, REC, timecode,
    /// vignette, grain), slight zoom, hidden symbols become visible, and a symbol held in frame for
    /// its dwell time activates. No video is recorded; evidence becomes lightweight data in Phase 2.
    /// </summary>
    public class Camcorder : MonoBehaviour
    {
        public float raisedFieldOfView = 52f;
        public float symbolRange = 15f;
        [Tooltip("In-world clock shown in the viewfinder; the chapter starts at 02:51, the deadline is 03:17.")]
        public float clockStartSeconds = 2 * 3600 + 51 * 60;

        public bool IsRaised { get; private set; }
        public float DwellProgress => dwellTarget != null ? Mathf.Clamp01(dwellTime / dwellTarget.dwellSeconds) : 0f;
        public event System.Action<HiddenSymbol> SymbolActivated;

        FirstPersonController controller;
        Camera view;
        float defaultFov;
        float recordSeconds;
        HiddenSymbol dwellTarget;
        float dwellTime;
        Texture2D vignette, grain;

        void Awake()
        {
            controller = GetComponent<FirstPersonController>();
            view = GetComponentInChildren<Camera>();
            if (view != null) defaultFov = view.fieldOfView;
            vignette = MakeVignette(256);
            grain = MakeGrain(128);
        }

        void Update()
        {
            if (DerinlikInput.CamcorderPressed && (controller == null || controller.InputEnabled)) SetRaised(!IsRaised);
            if (controller != null && !controller.InputEnabled && IsRaised) SetRaised(false);

            if (view != null)
            {
                float target = IsRaised ? raisedFieldOfView : defaultFov;
                view.fieldOfView = Mathf.Lerp(view.fieldOfView, target, 1f - Mathf.Exp(-8f * Time.deltaTime));
            }
            if (!IsRaised) return;
            recordSeconds += Time.deltaTime;
            UpdateDwell();
        }

        public void SetRaised(bool raised)
        {
            if (raised == IsRaised) return;
            IsRaised = raised;
            recordSeconds = 0f;
            dwellTarget = null;
            dwellTime = 0f;
            foreach (var symbol in FindObjectsByType<HiddenSymbol>(FindObjectsSortMode.None)) symbol.SetRevealed(raised);
            ProceduralAudio.PlayAt(ProceduralAudio.Latch, transform.position, 0.35f, 3f);
        }

        void UpdateDwell()
        {
            HiddenSymbol seen = null;
            var ray = new Ray(view.transform.position, view.transform.forward);
            if (Physics.Raycast(ray, out RaycastHit hit, symbolRange, ~0, QueryTriggerInteraction.Collide))
                seen = hit.collider.GetComponentInParent<HiddenSymbol>();

            if (seen == null || seen.IsActivated)
            {
                dwellTarget = null;
                dwellTime = 0f;
                return;
            }
            if (seen != dwellTarget)
            {
                dwellTarget = seen;
                dwellTime = 0f;
            }
            dwellTime += Time.deltaTime;
            if (dwellTime >= seen.dwellSeconds)
            {
                seen.Activate();
                SymbolActivated?.Invoke(seen);
                dwellTarget = null;
                dwellTime = 0f;
            }
        }

        void OnGUI()
        {
            if (!IsRaised) return;
            float w = Screen.width, h = Screen.height;
            var old = GUI.color;

            GUI.color = new Color(0f, 0f, 0f, 0.85f);
            GUI.DrawTexture(new Rect(0, 0, w, h), vignette, ScaleMode.StretchToFill);
            GUI.color = new Color(1f, 1f, 1f, 0.07f);
            float ox = Random.value, oy = Random.value;
            GUI.DrawTextureWithTexCoords(new Rect(0, 0, w, h), grain, new Rect(ox, oy, w / 256f, h / 256f));

            // viewfinder corners
            GUI.color = new Color(1f, 1f, 1f, 0.8f);
            float m = Mathf.Round(h * 0.06f), len = Mathf.Round(h * 0.07f), t = 3f;
            Bar(m, m, len, t); Bar(m, m, t, len);
            Bar(w - m - len, m, len, t); Bar(w - m - t, m, t, len);
            Bar(m, h - m - t, len, t); Bar(m, h - m - len, t, len);
            Bar(w - m - len, h - m - t, len, t); Bar(w - m - t, h - m - len, t, len);

            // centre focus mark, fills while a symbol is held in frame
            float c = 10f;
            Bar(w / 2 - c, h / 2, c * 2, 1.5f); Bar(w / 2, h / 2 - c, 1.5f, c * 2);
            if (DwellProgress > 0f)
            {
                GUI.color = new Color(0.55f, 0.85f, 1f, 0.9f);
                Bar(w / 2 - 40f, h / 2 + 24f, 80f * DwellProgress, 3f);
            }

            var style = new GUIStyle(GUI.skin.label) { fontSize = Mathf.RoundToInt(h * 0.028f), fontStyle = FontStyle.Bold };
            if (Mathf.Repeat(recordSeconds, 1f) < 0.6f)
            {
                GUI.color = new Color(0.9f, 0.1f, 0.1f, 1f);
                GUI.DrawTexture(new Rect(m + 18f, m + 22f, 14f, 14f), Texture2D.whiteTexture);
            }
            GUI.color = new Color(1f, 1f, 1f, 0.9f);
            int rec = Mathf.FloorToInt(recordSeconds);
            GUI.Label(new Rect(m + 40f, m + 12f, 400f, 40f), $"REC  {rec / 3600:00}:{rec / 60 % 60:00}:{rec % 60:00}", style);
            int clock = Mathf.FloorToInt(clockStartSeconds + Time.timeSinceLevelLoad);
            var right = new GUIStyle(style) { alignment = TextAnchor.UpperRight };
            GUI.Label(new Rect(w - m - 420f, m + 12f, 400f, 40f), $"{clock / 3600 % 24:00}:{clock / 60 % 60:00}:{clock % 60:00}", right);
            GUI.color = old;
        }

        static void Bar(float x, float y, float width, float height) =>
            GUI.DrawTexture(new Rect(x, y, width, height), Texture2D.whiteTexture);

        static Texture2D MakeVignette(int size)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float dx = (x + 0.5f) / size * 2f - 1f, dy = (y + 0.5f) / size * 2f - 1f;
                float a = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.55f, 1.45f, Mathf.Sqrt(dx * dx + dy * dy)));
                pixels[y * size + x] = new Color32(255, 255, 255, (byte)(a * 255));
            }
            tex.SetPixels32(pixels);
            tex.Apply();
            return tex;
        }

        static Texture2D MakeGrain(int size)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Point };
            var pixels = new Color32[size * size];
            var random = new System.Random(1317);
            for (int i = 0; i < pixels.Length; i++)
            {
                byte v = (byte)random.Next(0, 256);
                pixels[i] = new Color32(v, v, v, 255);
            }
            tex.SetPixels32(pixels);
            tex.Apply();
            return tex;
        }
    }
}
