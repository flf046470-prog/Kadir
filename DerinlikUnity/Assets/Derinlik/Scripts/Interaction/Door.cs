using UnityEngine;

namespace Derinlik
{
    /// <summary>
    /// Hinged door. This object is the hinge; the panel is a child. Swings away from whoever
    /// opens it, can be locked, can start open, and can be slammed by horror events.
    /// </summary>
    public class Door : MonoBehaviour, IInteractable
    {
        public float openAngle = 95f;
        [Tooltip("Degrees per second. Slow: horror doors creak, they do not snap.")]
        public float swingSpeed = 110f;
        public float slamSpeed = 420f;
        public bool locked;
        public bool startOpen;
        [Tooltip("+1 swings toward -Z of the hinge, -1 toward +Z (used when startOpen).")]
        public float startOpenDirection = 1f;

        public bool IsOpen { get; private set; }

        float targetYaw;
        float currentYaw;
        float speed;
        Quaternion baseRotation;

        void Awake()
        {
            baseRotation = transform.localRotation;
            speed = swingSpeed;
            if (startOpen)
            {
                IsOpen = true;
                targetYaw = currentYaw = openAngle * Mathf.Sign(startOpenDirection);
                Apply();
            }
        }

        public bool CanInteract(GameObject interactor) => interactor != null;

        public string Prompt => locked ? "Kilitli" : (IsOpen ? "Kapat" : "Aç");

        public void Interact(GameObject interactor)
        {
            if (locked)
            {
                ProceduralAudio.PlayAt(ProceduralAudio.Latch, transform.position, 0.8f, 8f);
                return;
            }
            // Positive yaw swings the panel toward the hinge's -Z side, so pick the side away from the player.
            Vector3 toPlayer = interactor.transform.position - transform.position;
            float side = Vector3.Dot(transform.forward, toPlayer) < 0f ? -1f : 1f;
            SetOpen(!IsOpen, side, false);
        }

        /// <param name="direction">+1 or -1, see <see cref="Interact"/>.</param>
        public void SetOpen(bool open, float direction = 1f, bool slam = false)
        {
            IsOpen = open;
            targetYaw = open ? openAngle * Mathf.Sign(direction == 0f ? 1f : direction) : 0f;
            speed = slam ? slamSpeed : swingSpeed;
            if (slam && !open) Invoke(nameof(PlaySlam), Mathf.Abs(currentYaw) / slamSpeed);
        }

        void PlaySlam() => ProceduralAudio.PlayAt(ProceduralAudio.DoorSlam, transform.position, 1f, 40f);

        void Update()
        {
            if (Mathf.Approximately(currentYaw, targetYaw)) return;
            currentYaw = Mathf.MoveTowards(currentYaw, targetYaw, speed * Time.deltaTime);
            Apply();
        }

        void Apply() => transform.localRotation = baseRotation * Quaternion.Euler(0f, currentYaw, 0f);
    }
}
