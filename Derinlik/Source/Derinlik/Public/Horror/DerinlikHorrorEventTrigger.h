#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DerinlikHorrorEventTrigger.generated.h"

class UBoxComponent;
class USoundBase;

UENUM(BlueprintType)
enum class EDerinlikHorrorAction : uint8
{
	CloseDoors,     // ADerinlikDoor targets swing shut
	CloseAndLock,   // ... and stay locked
	LightsOff,      // every light component on the targets turns off
	LightsOn,
	PlaySound,      // Sound at the first target's location (or the trigger's)
	Custom          // does nothing itself; use CustomTag + OnCustomStep in Blueprint
};

USTRUCT(BlueprintType)
struct FDerinlikHorrorStep
{
	GENERATED_BODY()

	/** Seconds after the trigger fires. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, meta = (ClampMin = "0"))
	float Delay = 0.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	EDerinlikHorrorAction Action = EDerinlikHorrorAction::CloseDoors;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	TArray<TObjectPtr<AActor>> Targets;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	TObjectPtr<USoundBase> Sound;

	/** When set, OnCustomStep fires with this tag after the step runs (any action). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	FName CustomTag;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnHorrorCustomStep, FName, CustomTag);

/**
 * Scripted, deterministic scare: when the player enters the box, the steps run on their delays.
 * No randomness, fires once by default, and can be fired from the editor ("Fire Now") for testing.
 */
UCLASS()
class DERINLIK_API ADerinlikHorrorEventTrigger : public AActor
{
	GENERATED_BODY()

public:
	ADerinlikHorrorEventTrigger();

	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Horror")
	void FireNow();

	UFUNCTION(BlueprintCallable, Category = "Horror")
	void ResetTrigger();

	UPROPERTY(BlueprintAssignable, Category = "Horror")
	FOnHorrorCustomStep OnCustomStep;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Horror")
	TObjectPtr<UBoxComponent> TriggerBox;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Horror")
	TArray<FDerinlikHorrorStep> Steps;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Horror")
	bool bFireOnce = true;

private:
	UFUNCTION()
	void HandleOverlap(UPrimitiveComponent* OverlappedComponent, AActor* OtherActor, UPrimitiveComponent* OtherComp,
		int32 OtherBodyIndex, bool bFromSweep, const FHitResult& SweepResult);

	void ExecuteStep(int32 StepIndex);

	UPROPERTY(SaveGame)
	bool bHasFired = false;

	TArray<FTimerHandle> StepTimers;
};
