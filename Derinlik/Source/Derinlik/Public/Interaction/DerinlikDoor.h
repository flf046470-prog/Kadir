#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Interaction/DerinlikInteractable.h"
#include "DerinlikDoor.generated.h"

class UStaticMeshComponent;
class USceneComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnDoorStateChanged, bool, bIsOpen);

/** Hinged door that swings away from the interactor. Can be locked or forced shut by horror events. */
UCLASS()
class DERINLIK_API ADerinlikDoor : public AActor, public IDerinlikInteractable
{
	GENERATED_BODY()

public:
	ADerinlikDoor();

	virtual void Tick(float DeltaSeconds) override;

	virtual bool CanInteract_Implementation(APawn* Interactor) const override;
	virtual FText GetInteractionPrompt_Implementation() const override;
	virtual void Interact_Implementation(APawn* Interactor) override;

	/** Used by scripted horror events (e.g. door slams shut behind the player). */
	UFUNCTION(BlueprintCallable, Category = "Door")
	void SetOpen(bool bOpen, float Direction = 1.f);

	UFUNCTION(BlueprintCallable, Category = "Door")
	void SetLocked(bool bInLocked) { bLocked = bInLocked; }

	UFUNCTION(BlueprintPure, Category = "Door")
	bool IsOpen() const { return bIsOpen; }

	UPROPERTY(BlueprintAssignable, Category = "Door")
	FOnDoorStateChanged OnDoorStateChanged;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Door")
	TObjectPtr<USceneComponent> Hinge;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Door")
	TObjectPtr<UStaticMeshComponent> DoorMesh;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Door")
	float OpenAngle = 95.f;

	/** Degrees per second. Slow by default: horror doors creak, they don't snap. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Door", meta = (ClampMin = "1"))
	float SwingSpeed = 110.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Door")
	bool bLocked = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Door")
	FText LockedPrompt = NSLOCTEXT("Derinlik", "DoorLocked", "Locked");

private:
	UPROPERTY(SaveGame)
	bool bIsOpen = false;

	float TargetYaw = 0.f;
};
