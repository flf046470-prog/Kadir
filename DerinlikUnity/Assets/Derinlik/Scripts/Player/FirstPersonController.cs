using UnityEngine;

namespace Derinlik
{
    /// <summary>
    /// Slow, deliberate first-person movement for Ekin: walk, sprint, crouch (with ceiling check),
    /// subtle head bob (scalable to zero), footsteps and mouse look.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public class FirstPersonController : MonoBehaviour
    {
        [Header("Movement (m/s)")]
        public float walkSpeed = 1.9f;
        public float sprintSpeed = 3.8f;
        public float crouchSpeed = 1.1f;
        public float gravity = -15f;

        [Header("Heights (m)")]
        public float standingHeight = 1.76f;
        public float crouchHeight = 1.04f;
        public float standingEye = 1.64f;
        public float crouchEye = 0.92f;

        [Header("Comfort")]
        [Range(0f, 1f)] public float headBobScale = 1f;
        public float headBobAmplitude = 0.012f;
        public float headBobFrequency = 1.8f;

        public Camera ViewCamera { get; private set; }
        public bool InputEnabled { get; set; } = true;
        public bool IsCrouched { get; private set; }

        CharacterController controller;
        float pitch;
        float verticalVelocity;
        float bobTime;
        float eyeHeight;
        float stepDistance;
        AudioSource footstepSource;

        void Awake()
        {
            controller = GetComponent<CharacterController>();
            controller.height = standingHeight;
            controller.center = new Vector3(0f, standingHeight * 0.5f, 0f);
            controller.radius = 0.32f;
            ViewCamera = GetComponentInChildren<Camera>();
            eyeHeight = standingEye;
            footstepSource = gameObject.AddComponent<AudioSource>();
            footstepSource.spatialBlend = 0f;
            footstepSource.volume = 0.35f;
        }

        void Start() => LockCursor(true);

        void Update()
        {
            if (DerinlikInput.ReleaseCursorPressed) LockCursor(false);
            else if (DerinlikInput.ClickPressed && Cursor.lockState != CursorLockMode.Locked && InputEnabled) LockCursor(true);

            bool active = InputEnabled && Cursor.lockState == CursorLockMode.Locked;
            if (active) UpdateLook();
            UpdateMovement(active);
            UpdateCamera();
        }

        public static void LockCursor(bool locked)
        {
            Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !locked;
        }

        void UpdateLook()
        {
            Vector2 look = DerinlikInput.Look;
            transform.Rotate(0f, look.x, 0f);
            pitch = Mathf.Clamp(pitch - look.y, -85f, 85f);
        }

        void UpdateMovement(bool active)
        {
            if (active && DerinlikInput.CrouchPressed) SetCrouched(!IsCrouched);

            Vector2 input = active ? DerinlikInput.Move : Vector2.zero;
            bool sprint = active && DerinlikInput.SprintHeld && !IsCrouched && input.y > 0.1f;
            float speed = IsCrouched ? crouchSpeed : (sprint ? sprintSpeed : walkSpeed);
            Vector3 move = (transform.right * input.x + transform.forward * input.y) * speed;

            if (controller.isGrounded && verticalVelocity < 0f) verticalVelocity = -2f;
            verticalVelocity += gravity * Time.deltaTime;
            move.y = verticalVelocity;
            controller.Move(move * Time.deltaTime);

            Vector3 flat = controller.velocity; flat.y = 0f;
            float horizontalSpeed = flat.magnitude;
            if (controller.isGrounded && horizontalSpeed > 0.2f)
            {
                bobTime += Time.deltaTime * headBobFrequency * (horizontalSpeed / walkSpeed) * Mathf.PI * 2f;
                stepDistance += horizontalSpeed * Time.deltaTime;
                float stride = IsCrouched ? 0.55f : (sprint ? 0.95f : 0.75f);
                if (stepDistance >= stride)
                {
                    stepDistance = 0f;
                    footstepSource.pitch = Random.Range(0.9f, 1.1f);
                    footstepSource.PlayOneShot(ProceduralAudio.Footstep, IsCrouched ? 0.4f : 1f);
                }
            }
            else
            {
                bobTime = 0f;
            }
        }

        void SetCrouched(bool crouch)
        {
            if (!crouch)
            {
                // Only stand up if there is room above the head.
                Vector3 bottom = transform.position + Vector3.up * controller.radius;
                float castDistance = standingHeight - controller.radius * 2f;
                if (Physics.SphereCast(bottom, controller.radius * 0.95f, Vector3.up, out _, castDistance, ~0, QueryTriggerInteraction.Ignore))
                    return;
            }
            IsCrouched = crouch;
            float h = crouch ? crouchHeight : standingHeight;
            controller.height = h;
            controller.center = new Vector3(0f, h * 0.5f, 0f);
        }

        void UpdateCamera()
        {
            if (ViewCamera == null) return;
            eyeHeight = Mathf.Lerp(eyeHeight, IsCrouched ? crouchEye : standingEye, 1f - Mathf.Exp(-10f * Time.deltaTime));
            float bob = Mathf.Sin(bobTime) * headBobAmplitude * headBobScale;
            ViewCamera.transform.localPosition = new Vector3(0f, eyeHeight + bob, 0f);
            ViewCamera.transform.localRotation = Quaternion.Euler(pitch, 0f, 0f);
        }
    }
}
