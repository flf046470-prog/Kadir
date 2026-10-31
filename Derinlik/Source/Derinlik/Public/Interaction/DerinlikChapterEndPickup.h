#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Interaction/DerinlikInteractable.h"
#include "DerinlikChapterEndPickup.generated.h"

class UStaticMeshComponent;

/** The object that ends a chapter when picked up (Phase 1: the MiniDV tape on the control-room desk). */
UCLASS()
class DERINLIK_API ADerinlikChapterEndPickup : public AActor, public IDerinlikInteractable
{
	GENERATED_BODY()

public:
	ADerinlikChapterEndPickup();

	virtual bool CanInteract_Implementation(APawn* Interactor) const override;
	virtual FText GetInteractionPrompt_Implementation() const override;
	virtual void Interact_Implementation(APawn* Interactor) override;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Pickup")
	TObjectPtr<UStaticMeshComponent> Mesh;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Pickup")
	FText Prompt = NSLOCTEXT("Derinlik", "PickupTape", "Take tape");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Chapter")
	FText ChapterTitle = NSLOCTEXT("Derinlik", "Chapter1End", "KAPI 01 \u2014 SAKARYA");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Chapter", meta = (ClampMin = "0"))
	float FadeSeconds = 2.5f;

private:
	bool bUsed = false;
};
