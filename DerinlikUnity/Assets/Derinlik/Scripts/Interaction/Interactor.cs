using UnityEngine;

namespace Derinlik
{
    /// <summary>Looks along the camera for an IInteractable within reach and uses it on E.</summary>
    public class Interactor : MonoBehaviour
    {
        public float reach = 2.2f;

        public IInteractable Focus { get; private set; }
        public string CurrentPrompt => Focus != null ? Focus.Prompt : string.Empty;

        FirstPersonController controller;
        Camera view;

        void Awake()
        {
            controller = GetComponent<FirstPersonController>();
            view = GetComponentInChildren<Camera>();
        }

        void Update()
        {
            Focus = null;
            if (view == null || (controller != null && !controller.InputEnabled)) return;

            var ray = new Ray(view.transform.position, view.transform.forward);
            if (Physics.Raycast(ray, out RaycastHit hit, reach, ~0, QueryTriggerInteraction.Ignore))
            {
                var candidate = hit.collider.GetComponentInParent<IInteractable>();
                if (candidate != null && candidate.CanInteract(gameObject)) Focus = candidate;
            }

            if (Focus != null && DerinlikInput.InteractPressed) Focus.Interact(gameObject);
        }
    }
}
