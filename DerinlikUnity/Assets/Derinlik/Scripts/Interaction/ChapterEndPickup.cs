using UnityEngine;

namespace Derinlik
{
    /// <summary>Picking this up ends the chapter (Phase 1: the MiniDV tape on the control-room desk).</summary>
    public class ChapterEndPickup : MonoBehaviour, IInteractable
    {
        public string prompt = "Kaseti al";
        public string chapterTitle = "KAPI 01 — SAKARYA";
        public float fadeSeconds = 2.5f;

        bool used;

        public bool CanInteract(GameObject interactor) => !used;
        public string Prompt => prompt;

        public void Interact(GameObject interactor)
        {
            if (used) return;
            used = true;
            foreach (var r in GetComponentsInChildren<Renderer>()) r.enabled = false;
            foreach (var c in GetComponentsInChildren<Collider>()) c.enabled = false;
            ProceduralAudio.PlayAt(ProceduralAudio.Latch, transform.position, 0.7f, 5f);
            if (GameHUD.Instance != null) GameHUD.Instance.PlayChapterEnd(chapterTitle, fadeSeconds);
        }
    }
}
