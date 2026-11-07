using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Derinlik
{
    public enum HorrorAction { CloseDoors, SlamAndLock, LightsOff, LightsOn, PlaySound, Custom }

    [System.Serializable]
    public class HorrorStep
    {
        [Tooltip("Seconds after the trigger fires.")] public float delay;
        public HorrorAction action;
        public GameObject[] targets;
        [Tooltip("For PlaySound; empty uses the built-in distant footsteps.")] public AudioClip clip;
        public string customTag;
    }

    /// <summary>
    /// Scripted, deterministic scare. When the player enters the trigger box the steps run on their
    /// delays. Fires once by default. Right-click the component > "Fire Now" to test.
    /// </summary>
    [RequireComponent(typeof(BoxCollider))]
    public class HorrorEventTrigger : MonoBehaviour
    {
        public List<HorrorStep> steps = new List<HorrorStep>();
        public bool fireOnce = true;
        public event System.Action<string> CustomStep;

        bool fired;

        void Reset() => GetComponent<BoxCollider>().isTrigger = true;

        void OnTriggerEnter(Collider other)
        {
            if (other.GetComponentInParent<FirstPersonController>() != null) FireNow();
        }

        [ContextMenu("Fire Now")]
        public void FireNow()
        {
            if (fireOnce && fired) return;
            fired = true;
            Debug.Log($"[Derinlik] HorrorEvent '{name}' fired ({steps.Count} steps)");
            foreach (var step in steps) StartCoroutine(Run(step));
        }

        [ContextMenu("Reset Trigger")]
        public void ResetTrigger()
        {
            StopAllCoroutines();
            fired = false;
        }

        IEnumerator Run(HorrorStep step)
        {
            if (step.delay > 0f) yield return new WaitForSeconds(step.delay);
            var targets = step.targets ?? new GameObject[0];
            switch (step.action)
            {
                case HorrorAction.CloseDoors:
                case HorrorAction.SlamAndLock:
                    foreach (var t in targets)
                    {
                        var door = t != null ? t.GetComponentInChildren<Door>() : null;
                        if (door == null) continue;
                        bool slam = step.action == HorrorAction.SlamAndLock;
                        door.SetOpen(false, 1f, slam);
                        if (slam) door.locked = true;
                    }
                    break;
                case HorrorAction.LightsOff:
                case HorrorAction.LightsOn:
                    foreach (var t in targets)
                        if (t != null)
                            foreach (var light in t.GetComponentsInChildren<Light>(true))
                                light.enabled = step.action == HorrorAction.LightsOn;
                    break;
                case HorrorAction.PlaySound:
                    Vector3 at = targets.Length > 0 && targets[0] != null ? targets[0].transform.position : transform.position;
                    ProceduralAudio.PlayAt(step.clip != null ? step.clip : ProceduralAudio.DistantSteps, at, 1f, 40f);
                    break;
            }
            if (!string.IsNullOrEmpty(step.customTag)) CustomStep?.Invoke(step.customTag);
        }
    }
}
