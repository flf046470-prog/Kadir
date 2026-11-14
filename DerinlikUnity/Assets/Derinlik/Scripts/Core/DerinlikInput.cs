using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace Derinlik
{
    /// <summary>
    /// One place for all player input. Works with the new Input System package and with the
    /// legacy Input Manager, whichever the project has enabled, so no input assets are needed.
    /// Keys: WASD move, mouse look, Shift sprint, Ctrl/C crouch, F flashlight, E interact,
    /// right mouse / Q camcorder, Esc release cursor.
    /// </summary>
    public static class DerinlikInput
    {
        public static float MouseSensitivity = 1f;

        public static Vector2 Move
        {
            get
            {
#if ENABLE_INPUT_SYSTEM
                var k = Keyboard.current;
                Vector2 v = Vector2.zero;
                if (k != null)
                {
                    if (k.wKey.isPressed) v.y += 1f;
                    if (k.sKey.isPressed) v.y -= 1f;
                    if (k.dKey.isPressed) v.x += 1f;
                    if (k.aKey.isPressed) v.x -= 1f;
                }
                var pad = Gamepad.current;
                if (pad != null) v += pad.leftStick.ReadValue();
                return Vector2.ClampMagnitude(v, 1f);
#else
                var v = new Vector2(
                    (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f),
                    (Input.GetKey(KeyCode.W) ? 1f : 0f) - (Input.GetKey(KeyCode.S) ? 1f : 0f));
                return Vector2.ClampMagnitude(v, 1f);
#endif
            }
        }

        /// <summary>Degrees to turn this frame (x = yaw, y = pitch up).</summary>
        public static Vector2 Look
        {
            get
            {
#if ENABLE_INPUT_SYSTEM
                Vector2 v = Vector2.zero;
                if (Mouse.current != null) v += Mouse.current.delta.ReadValue() * 0.1f;
                if (Gamepad.current != null) v += Gamepad.current.rightStick.ReadValue() * (180f * Time.deltaTime);
                return v * MouseSensitivity;
#else
                return new Vector2(Input.GetAxisRaw("Mouse X"), Input.GetAxisRaw("Mouse Y")) * (2f * MouseSensitivity);
#endif
            }
        }

#if ENABLE_INPUT_SYSTEM
        static bool Held(Key key) => Keyboard.current != null && Keyboard.current[key].isPressed;
        static bool Down(Key key) => Keyboard.current != null && Keyboard.current[key].wasPressedThisFrame;
        public static bool SprintHeld => Held(Key.LeftShift) || (Gamepad.current != null && Gamepad.current.leftStickButton.isPressed);
        public static bool CrouchPressed => Down(Key.LeftCtrl) || Down(Key.C) || (Gamepad.current != null && Gamepad.current.buttonEast.wasPressedThisFrame);
        public static bool FlashlightPressed => Down(Key.F) || (Gamepad.current != null && Gamepad.current.dpad.up.wasPressedThisFrame);
        public static bool InteractPressed => Down(Key.E) || (Gamepad.current != null && Gamepad.current.buttonSouth.wasPressedThisFrame);
        public static bool CamcorderPressed => Down(Key.Q) || (Mouse.current != null && Mouse.current.rightButton.wasPressedThisFrame)
                                               || (Gamepad.current != null && Gamepad.current.leftTrigger.wasPressedThisFrame);
        public static bool ReleaseCursorPressed => Down(Key.Escape);
        public static bool ClickPressed => Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame;
#else
        public static bool SprintHeld => Input.GetKey(KeyCode.LeftShift);
        public static bool CrouchPressed => Input.GetKeyDown(KeyCode.LeftControl) || Input.GetKeyDown(KeyCode.C);
        public static bool FlashlightPressed => Input.GetKeyDown(KeyCode.F);
        public static bool InteractPressed => Input.GetKeyDown(KeyCode.E);
        public static bool CamcorderPressed => Input.GetKeyDown(KeyCode.Q) || Input.GetMouseButtonDown(1);
        public static bool ReleaseCursorPressed => Input.GetKeyDown(KeyCode.Escape);
        public static bool ClickPressed => Input.GetMouseButtonDown(0);
#endif
    }
}
