#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "DerinlikInteractable.generated.h"

UINTERFACE(MinimalAPI, Blueprintable)
class UDerinlikInteractable : public UInterface
{
	GENERATED_BODY()
};

/**
 * Single reusable interaction contract for doors, drawers, notes, switches,
 * terminals, puzzle pieces and evidence. Implementable in C++ or Blueprint.
 */
class DERINLIK_API IDerinlikInteractable
{
	GENERATED_BODY()

public:
	/** Whether the actor currently accepts interaction from this pawn. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	bool CanInteract(APawn* Interactor) const;

	/** Short prompt shown in the HUD, e.g. "Open" / "Ac". */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	FText GetInteractionPrompt() const;

	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	void Interact(APawn* Interactor);
};
