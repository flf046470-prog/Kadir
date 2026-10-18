using UnityEngine;

namespace Derinlik
{
    /// <summary>Handheld torch: a soft shadowed spot light on the camera, toggled with F.</summary>
    public class Flashlight : MonoBehaviour
    {
        public Light spot;
        public bool startOn;

        void Awake()
        {
            if (spot == null) spot = GetComponentInChildren<Light>(true);
            if (spot != null) spot.enabled = startOn;
        }

        void Update()
        {
            if (spot == null || !DerinlikInput.FlashlightPressed) return;
            var controller = GetComponentInParent<FirstPersonController>();
            if (controller != null && !controller.InputEnabled) return;
            spot.enabled = !spot.enabled;
            ProceduralAudio.PlayAt(ProceduralAudio.Latch, transform.position, 0.5f, 4f);
        }
    }
}
