using UnityEngine;

namespace Derinlik
{
    /// <summary>One contract for doors, drawers, notes, switches, terminals, puzzle pieces and evidence.</summary>
    public interface IInteractable
    {
        bool CanInteract(GameObject interactor);
        string Prompt { get; }
        void Interact(GameObject interactor);
    }
}
