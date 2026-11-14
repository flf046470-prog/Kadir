using System.Collections;
using UnityEngine;

namespace Derinlik
{
    /// <summary>
    /// A First Recorders' sigil, invisible to the naked eye and visible only through the camcorder.
    /// Holding it in frame for dwellSeconds activates it: linked objects (the stone slab) slide by
    /// moveOffset and OnActivated fires.
    /// </summary>
    public class HiddenSymbol : MonoBehaviour
    {
        public Renderer symbolRenderer;
        public float dwellSeconds = 2f;
        public Transform[] linkedObjects;
        public Vector3 moveOffset = new Vector3(0f, -2.25f, 0f);
        public float moveDuration = 4f;
        public bool stayVisibleAfterActivation = true;

        public bool IsActivated { get; private set; }
        public event System.Action OnActivated;

        void Awake()
        {
            if (symbolRenderer == null) symbolRenderer = GetComponentInChildren<Renderer>(true);
            SetRevealed(false);
        }

        public void SetRevealed(bool revealed)
        {
            if (symbolRenderer != null) symbolRenderer.enabled = revealed || (IsActivated && stayVisibleAfterActivation);
        }

        public void Activate()
        {
            if (IsActivated) return;
            IsActivated = true;
            ProceduralAudio.PlayAt(ProceduralAudio.DoorSlam, transform.position, 0.5f, 30f);
            StartCoroutine(MoveLinked());
            OnActivated?.Invoke();
        }

        IEnumerator MoveLinked()
        {
            if (linkedObjects == null || linkedObjects.Length == 0) yield break;
            var start = new Vector3[linkedObjects.Length];
            for (int i = 0; i < linkedObjects.Length; i++) if (linkedObjects[i] != null) start[i] = linkedObjects[i].position;
            for (float t = 0f; t < moveDuration; t += Time.deltaTime)
            {
                float k = Mathf.SmoothStep(0f, 1f, t / moveDuration);
                for (int i = 0; i < linkedObjects.Length; i++)
                    if (linkedObjects[i] != null) linkedObjects[i].position = start[i] + moveOffset * k;
                yield return null;
            }
            for (int i = 0; i < linkedObjects.Length; i++)
                if (linkedObjects[i] != null) linkedObjects[i].position = start[i] + moveOffset;
        }
    }
}
