#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "DerinlikCamcorderComponent.generated.h"

class UCameraComponent;
class UDerinlikCamcorderOverlayWidget;
class ADerinlikHiddenSymbol;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnCamcorderToggled, bool, bRaised);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnSymbolActivated, ADerinlikHiddenSymbol*, Symbol);

/**
 * Ekin's handheld camcorder. While raised it:
 *  - shows the viewfinder overlay and blends in the owner camera's post-process ("camcorder look"),
 *  - reveals every ADerinlikHiddenSymbol in the level,
 *  - activates a revealed symbol after the player holds it in frame for its dwell time.
 * No video is recorded: evidence will be stored as lightweight data (Phase 2).
 */
UCLASS(ClassGroup = (Derinlik), meta = (BlueprintSpawnableComponent))
class DERINLIK_API UDerinlikCamcorderComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UDerinlikCamcorderComponent();

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	UFUNCTION(BlueprintCallable, Category = "Camcorder")
	void SetRaised(bool bInRaised);

	UFUNCTION(BlueprintCallable, Category = "Camcorder")
	void ToggleRaised() { SetRaised(!bRaised); }

	UFUNCTION(BlueprintPure, Category = "Camcorder")
	bool IsRaised() const { return bRaised; }

	/** 0..1 progress of the symbol currently held in frame (for a HUD focus ring). */
	UFUNCTION(BlueprintPure, Category = "Camcorder")
	float GetDwellProgress() const;

	UPROPERTY(BlueprintAssignable, Category = "Camcorder")
	FOnCamcorderToggled OnCamcorderToggled;

	UPROPERTY(BlueprintAssignable, Category = "Camcorder")
	FOnSymbolActivated OnSymbolActivated;

protected:
	virtual void BeginPlay() override;

	/** WBP_CamcorderOverlay (parent: DerinlikCamcorderOverlayWidget). */
	UPROPERTY(EditDefaultsOnly, Category = "Camcorder")
	TSubclassOf<UDerinlikCamcorderOverlayWidget> OverlayWidgetClass;

	/** How far the camcorder can "see" a symbol (cm). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Camcorder")
	float SymbolTraceDistance = 1500.f;

	/** FOV while raised (slight zoom sells the viewfinder). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Camcorder")
	float RaisedFieldOfView = 70.f;

	/** Weight of the owner camera's PostProcessSettings while raised (set those settings in BP_DerinlikCharacter). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Camcorder", meta = (ClampMin = "0", ClampMax = "1"))
	float RaisedPostProcessWeight = 1.f;

private:
	void SetSymbolsRevealed(bool bRevealed);
	void UpdateDwell(float DeltaTime);

	UPROPERTY(Transient)
	TObjectPtr<UCameraComponent> OwnerCamera;

	UPROPERTY(Transient)
	TObjectPtr<UDerinlikCamcorderOverlayWidget> OverlayWidget;

	UPROPERTY(Transient)
	TWeakObjectPtr<ADerinlikHiddenSymbol> DwellTarget;

	bool bRaised = false;
	float DwellTime = 0.f;
	float DefaultFieldOfView = 85.f;
};
