using System.Collections;
using UnityEngine;

namespace Derinlik
{
    /// <summary>
    /// Minimal, cinematic HUD drawn with IMGUI (no UI assets needed for the prototype):
    /// a crosshair dot, the interaction prompt, a short intro card, and the chapter-end fade + title.
    /// </summary>
    public class GameHUD : MonoBehaviour
    {
        public static GameHUD Instance { get; private set; }

        public Interactor interactor;
        public FirstPersonController player;
        [TextArea] public string introText = "03.17'den önce oraya var.\nBundan sonra kimse sana inanmayacak.";
        public float introSeconds = 6f;

        float fade;
        string title;
        float titleAlpha;

        void Awake()
        {
            Instance = this;
            AudioListener.volume = 1f;
        }

        void Start() => StartCoroutine(Intro());

        IEnumerator Intro()
        {
            fade = 1f;
            title = introText;
            titleAlpha = 1f;
            yield return new WaitForSeconds(introSeconds * 0.6f);
            for (float t = 0f; t < 1f; t += Time.deltaTime / (introSeconds * 0.4f))
            {
                fade = 1f - t;
                titleAlpha = 1f - t;
                yield return null;
            }
            fade = 0f; titleAlpha = 0f; title = null;
        }

        public void PlayChapterEnd(string chapterTitle, float fadeSeconds)
        {
            StopAllCoroutines();
            StartCoroutine(ChapterEnd(chapterTitle, fadeSeconds));
        }

        IEnumerator ChapterEnd(string chapterTitle, float fadeSeconds)
        {
            if (player != null) player.InputEnabled = false;
            for (float t = 0f; t < 1f; t += Time.deltaTime / Mathf.Max(fadeSeconds, 0.01f))
            {
                fade = t;
                AudioListener.volume = 1f - t;
                yield return null;
            }
            fade = 1f;
            title = chapterTitle;
            for (float t = 0f; t < 1f; t += Time.deltaTime / 1.5f)
            {
                titleAlpha = t;
                yield return null;
            }
            titleAlpha = 1f;
            FirstPersonController.LockCursor(false);
        }

        void OnGUI()
        {
            float w = Screen.width, h = Screen.height;
            var old = GUI.color;

            if (fade < 0.99f)
            {
                GUI.color = new Color(1f, 1f, 1f, 0.6f);
                GUI.DrawTexture(new Rect(w / 2 - 1.5f, h / 2 - 1.5f, 3f, 3f), Texture2D.whiteTexture);

                string prompt = interactor != null ? interactor.CurrentPrompt : null;
                if (!string.IsNullOrEmpty(prompt))
                {
                    var style = new GUIStyle(GUI.skin.label) { fontSize = Mathf.RoundToInt(h * 0.024f), alignment = TextAnchor.MiddleCenter };
                    GUI.color = new Color(0f, 0f, 0f, 0.7f);
                    GUI.Label(new Rect(1, h / 2 + 41, w, 40), $"[E]  {prompt}", style);
                    GUI.color = new Color(0.9f, 0.88f, 0.84f, 1f);
                    GUI.Label(new Rect(0, h / 2 + 40, w, 40), $"[E]  {prompt}", style);
                }
            }

            if (fade > 0f)
            {
                GUI.color = new Color(0f, 0f, 0f, fade);
                GUI.DrawTexture(new Rect(0, 0, w, h), Texture2D.whiteTexture);
            }
            if (!string.IsNullOrEmpty(title) && titleAlpha > 0f)
            {
                var big = new GUIStyle(GUI.skin.label) { fontSize = Mathf.RoundToInt(h * 0.045f), alignment = TextAnchor.MiddleCenter, wordWrap = true };
                GUI.color = new Color(0.92f, 0.9f, 0.86f, titleAlpha);
                GUI.Label(new Rect(w * 0.1f, 0, w * 0.8f, h), title, big);
            }
            GUI.color = old;
        }
    }
}
